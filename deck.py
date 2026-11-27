"""Read Canva PowerPoint exports and fill selected shapes in their original slides."""
import base64
import copy
import io
import os
import posixpath
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from lxml import etree as ET

MAX_FILE = 12 * 1024 * 1024
NS = {"p":"http://schemas.openxmlformats.org/presentationml/2006/main",
      "a":"http://schemas.openxmlformats.org/drawingml/2006/main",
      "r":"http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "rel":"http://schemas.openxmlformats.org/package/2006/relationships"}
LABELS = dict(name="姓名", subtitle="个人标题", contact="联系方式", email="邮箱", phone="电话",
              website="个人主页", education="教育背景", projects="项目经历", honors="竞赛与荣誉",
              skills="专业技能", languages="语言能力", activities="学生实践", experience="实践实习",
              exchange="交流经历", interests="研究方向", summary="个人介绍", portrait="简历照片")
HEADER = {"name","subtitle","contact","email","phone","website","portrait"}
Q = lambda ns, tag: "{%s}%s" % (NS[ns],tag)
def xml(data):
    root = ET.fromstring(data, ET.XMLParser(resolve_entities=False, no_network=True, load_dtd=False))
    if root.getroottree().docinfo.doctype:
        raise ValueError("模板 XML 含不支持的声明")
    return root

def dump(root):
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True, standalone=True)

def decode(encoded):
    if not isinstance(encoded,str) or len(encoded) > 4*((MAX_FILE+2)//3):
        raise ValueError("请选择 12 MB 以内的 PPTX 模板")
    return base64.b64decode(encoded, validate=True)

def read_package(raw):
    if len(raw)>MAX_FILE: raise ValueError("模板超过 12 MB")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            files=archive.infolist()
            if len(files)>2000 or sum(f.file_size for f in files)>64*1024*1024:
                raise ValueError("模板过大，请减少页面或图片")
            parts={}
            for f in files:
                n=f.filename
                if n.endswith("/"): continue
                if n.startswith("ppt/printerSettings/"): continue
                if n in parts or "\\" in n or not re.fullmatch(r"(?:ppt/|docProps/|_rels/)[A-Za-z0-9_./ -]+|\[Content_Types\]\.xml",n) or ".." in n.split("/"):
                    raise ValueError("请选择标准 PowerPoint 导出文件")
                if re.search(r"(?:/activeX/|/embeddings/|/externalLinks/|/webextensions/|vbaProject)",n,re.I):
                    raise ValueError("请导出仅含文字和图片的模板")
                data=archive.read(f)
                if n.endswith((".xml",".rels")):
                    root=xml(data)
                    if n.endswith(".rels"):
                        for rel in list(root):
                            if rel.get("Type","").endswith("/printerSettings"):
                                root.remove(rel)
                            elif rel.get("TargetMode","").lower()=="external":
                                if not rel.get("Type","").endswith("/hyperlink"):
                                    raise ValueError("模板含外部资源，请在可画中将素材嵌入后导出")
                                root.remove(rel)
                            else:
                                target=rel.get("Target","")
                                if ":" in target or "\\" in target or target.startswith("//"):
                                    raise ValueError("模板包含外部资源，请先将素材嵌入设计")
                        data=dump(root)
                    if n=="[Content_Types].xml" and b"macroenabled" in data.lower():
                        raise ValueError("不支持宏模板")
                elif not n.lower().endswith((".png",".jpg",".jpeg",".gif")):
                    raise ValueError("模板含不支持的媒体，请将插画或图表转为 PNG 后导出")
                parts[n]=data
            if "ppt/presentation.xml" not in parts or "[Content_Types].xml" not in parts:
                raise ValueError("请选择可画导出的 PPTX 文件")
            return parts
    except (zipfile.BadZipFile, KeyError, RuntimeError, ET.XMLSyntaxError) as exc:
        raise ValueError("无法读取 PowerPoint 文件，请重新导出 .pptx") from exc

def slide_names(parts):
    pres=xml(parts["ppt/presentation.xml"])
    rels=xml(parts.get("ppt/_rels/presentation.xml.rels",b"<rels/>"))
    paths={r.get("Id"):posixpath.normpath(posixpath.join("ppt",r.get("Target",""))).lstrip("/") for r in rels}
    names=[paths.get(s.get(Q("r","id"))) for s in pres.findall("p:sldIdLst/p:sldId",NS)]
    if not 1<=len(names)<=12 or any(not n or not re.fullmatch(r"ppt/slides/slide\d+\.xml",n) or n not in parts for n in names):
        raise ValueError("请选择包含 1 至 12 页的简历模板")
    return names

def shapes(parts):
    for page,n in enumerate(slide_names(parts),1):
        root=xml(parts[n]); rows=[]
        for shape in root.xpath("//p:sp[p:txBody] | //p:pic",namespaces=NS):
            meta=shape.find(".//p:cNvPr",NS)
            if meta is None: continue
            picture=shape.tag==Q("p","pic")
            text="\n".join("".join(p.itertext(Q("a","t"))) for p in shape.findall("p:txBody/a:p",NS)).strip() if not picture else ""
            if not text and not picture: continue
            key=str(page)+":"+meta.get("id","")
            rows.append((shape,{"key":key,"page":page,"picture":picture,"text":text[:180] or meta.get("name","图片")}))
        yield n,root,rows

def inspect(raw):
    parts=read_package(raw)
    rows=[r for _,_,entries in shapes(parts) for _,r in entries]
    if len(rows)>350 or not any(not r["picture"] for r in rows):
        raise ValueError("未找到可编辑的文本框，或元素过多。请选择含文字图层的简历设计。")
    return rows

def bindings_ok(rows,bindings):
    available={r["key"]:r for r in rows}
    if not isinstance(bindings,dict) or not bindings or not any(k in LABELS and k!="portrait" for k in bindings.values()):
        raise ValueError("请至少关联一个文本框")
    for k,v in bindings.items():
        if k not in available or v not in set(LABELS)|{"clear"} or (v=="portrait")!=available[k]["picture"]:
            raise ValueError("模板字段映射无效")

def metadata(record):
    values=set(record["bindings"].values())
    return {"id":record["id"],"name":record["name"],"kind":"deck","audience":"我的可画模板",
            "sections":[[k,v] for k,v in LABELS.items() if k in values and k not in HEADER],
            "headerFields":[k for k in HEADER if k in values], "usesPortrait":"portrait" in values,"assets":[]}

def fields(draft):
    values=dict(draft["fields"])
    values["contact"]=" · ".join(values[k] for k in ("phone","email","website") if values.get(k))
    blocks=[]; honors=[values.get("honors","")]
    for p in draft["items"]:
        if p["mode"]=="honor":
            honors.append(p["short"]); continue
        meta="，".join(x for x in (p.get("date"),p.get("role")) if x)
        title=p["name"]+("（"+meta+"）" if meta else "")
        lines=[title]
        if p["mode"]=="short": lines.append(p["short"])
        else:
            lines.extend(label+"："+p[k] for k,label in (("stack","技术栈"),("overview","概述"),("body","详细")) if p.get(k))
        blocks.append("\n".join(lines))
    values["projects"]="\n\n".join(blocks)
    values["honors"]="\n".join(x for x in honors if x)
    return values

def fill_text(shape,text):
    box=shape.find("p:txBody",NS)
    paragraphs=box.findall("a:p",NS)
    if not paragraphs: return
    basis=paragraphs[0]
    for p in paragraphs: box.remove(p)
    style=basis.find("a:pPr",NS); runstyle=basis.find(".//a:rPr",NS)
    for line in (text.splitlines() or [""]):
        p=ET.SubElement(box,Q("a","p"))
        if style is not None: p.append(copy.deepcopy(style))
        r=ET.SubElement(p,Q("a","r"))
        if runstyle is not None: r.append(copy.deepcopy(runstyle))
        ET.SubElement(r,Q("a","t")).text=line
    body=box.find("a:bodyPr",NS)
    if body is not None:
        for child in list(body):
            if child.tag in [Q("a",k) for k in ("noAutofit","spAutoFit","normAutofit")]: body.remove(child)
        ET.SubElement(body,Q("a","normAutofit"))

def fill(raw,bindings,draft,photo):
    parts=read_package(raw); values=fields(draft)
    for n,root,entries in shapes(parts):
        for shape,r in entries:
            field=bindings.get(r["key"])
            if not field: continue
            if field!="portrait":
                fill_text(shape,values.get(field,"") if field!="clear" else "");continue
            if not photo:
                shape.getparent().remove(shape);continue
            blip=shape.find(".//a:blip",NS)
            if blip is None: continue
            relname=posixpath.join(posixpath.dirname(n),"_rels",posixpath.basename(n)+".rels")
            rels=xml(parts[relname])
            rid="rIdFolio"+r["key"].replace(":","x")
            while any(rel.get("Id")==rid for rel in rels): rid+="x"
            ET.SubElement(rels,Q("rel","Relationship"),Id=rid,Type=NS["r"]+"/image",Target="../media/folio-"+rid+".jpg")
            blip.set(Q("r","embed"),rid)
            from PIL import Image, ImageOps
            size=shape.find("p:spPr/a:xfrm/a:ext",NS)
            w,h=(float(size.get("cx")),float(size.get("cy"))) if size is not None else (3,4)
            ratio=max(0.05,min(20,w/max(h,1)))
            with Image.open(io.BytesIO(photo)) as im:
                out=io.BytesIO(); ImageOps.fit(im.convert("RGB"),(max(1,round(750*min(1,ratio))),max(1,round(750*min(1,1/ratio))))).save(out,"JPEG",quality=90)
            crop=shape.find("p:blipFill/a:srcRect",NS)
            if crop is not None: crop.attrib.clear()
            parts["ppt/media/folio-"+rid+".jpg"]=out.getvalue();parts[relname]=dump(rels)
            ct=xml(parts["[Content_Types].xml"])
            if not any(c.get("Extension")=="jpg" for c in ct):
                ET.SubElement(ct,"{"+ET.QName(ct).namespace+"}Default",Extension="jpg",ContentType="image/jpeg")
                parts["[Content_Types].xml"]=dump(ct)
        parts[n]=dump(root)
    out=io.BytesIO()
    with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:
        for n,data in parts.items(): z.writestr(n,data)
    return out.getvalue()

def to_pdf(raw):
    candidates=[shutil.which("soffice"),shutil.which("libreoffice"),os.path.join(os.environ.get("ProgramFiles",""),"LibreOffice/program/soffice.com"),"/Applications/LibreOffice.app/Contents/MacOS/soffice"]
    exe=next((x for x in candidates if x and Path(x).is_file()),None)
    if not exe: raise ValueError("PDF 导出需要 LibreOffice。也可以下载可编辑 PPTX，在 PowerPoint 中导出 PDF。")
    with tempfile.TemporaryDirectory() as tmp:
        folder=Path(tmp); (folder/"resume.pptx").write_bytes(raw)
        subprocess.run([exe,"-env:UserInstallation="+(folder/"profile").as_uri(),"--headless","--nologo","--norestore","--convert-to","pdf:impress_pdf_Export","--outdir",tmp,str(folder/"resume.pptx")],cwd=tmp,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        if not (folder/"resume.pdf").is_file(): raise ValueError("LibreOffice 未能转换这个模板，可下载 PPTX 检查版式。")
        return (folder/"resume.pdf").read_bytes()
