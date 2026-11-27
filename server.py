"""Personal, loopback-only resume workspace. Custom PDF portraits use Pillow."""
import argparse
import base64
import hashlib
import io
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import threading
import urllib.request
import webbrowser
from functools import lru_cache
from urllib.parse import parse_qs
import deck
import canva_connect
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
TEMPLATES = json.loads((WEB / "templates.json").read_text(encoding="utf-8"))
PORTABLE_ENGINE = Path.home() / ".local/share/cv-skill-tools/TinyTeX/bin/windows/xelatex.exe"
ENGINE = PORTABLE_ENGINE if PORTABLE_ENGINE.is_file() else (shutil.which("xelatex") or "xelatex")
DB = Path(os.environ.get("FOLIO_DATA_FILE", str(ROOT / "data" / "workspace.json")))
LOCK = threading.Lock()
MAX_WORKSPACE_BYTES = 32 * 1024 * 1024

@lru_cache(maxsize=6)
def template_rows(blob):
    return deck.inspect(deck.decode(blob))

def custom_templates(s):
    records=s.get("userTemplates",[])
    if not isinstance(records,list): raise ValueError("模板库无效")
    seen=set()
    for r in records:
        if not isinstance(r,dict) or not isinstance(r.get("id"),str) or not re.fullmatch(r"user-[a-f0-9-]{36}",r["id"]) or r["id"] in seen:
            raise ValueError("模板编号无效")
        if not isinstance(r.get("name"),str) or not 1<=len(r["name"].strip())<=80:
            raise ValueError("模板名称无效")
        if not isinstance(r.get("blob"),str): raise ValueError("模板文件缺失")
        deck.bindings_ok(template_rows(r["blob"]),r.get("bindings"))
        seen.add(r["id"])
    return records

def catalog(s):
    return TEMPLATES+[deck.metadata(r) for r in custom_templates(s)]

def deck_source(template_id,s):
    record=next((r for r in s.get("userTemplates",[]) if r["id"]==template_id),None)
    if record: return deck.decode(record["blob"]),record["bindings"]
    t=next((r for r in TEMPLATES if r["id"]==template_id and r.get("kind")=="deck"),None)
    if t: return (WEB/"builtin"/(t["id"]+".pptx")).read_bytes(),t["bindings"]
    return None


def portrait_bytes(key, encoded):
    if not isinstance(key, str) or not re.fullmatch(r"[a-f0-9]{64}", key):
        raise ValueError("照片编号无效")
    if not isinstance(encoded, str) or len(encoded) > 2_000_000:
        raise ValueError("照片数据过大或无效")
    raw = base64.b64decode(encoded, validate=True)
    if not raw.startswith(b"\xff\xd8\xff") or not raw.endswith(b"\xff\xd9") or hashlib.sha256(raw).hexdigest() != key:
        raise ValueError("照片数据不完整")
    return raw

def encode(data):
    return json.dumps(data, ensure_ascii=False).encode("utf-8")

def initial():
    return {"projects": json.loads((WEB / "projects.json").read_text(encoding="utf-8")),
            "drafts": [], "active": None}

def check_state(s):
    if not isinstance(s, dict) or not isinstance(s.get("projects"), list) or not isinstance(s.get("drafts"), list):
        raise ValueError("工作区格式错误")
    template_ids={t["id"] for t in catalog(s)}
    portraits = s.get("portraits", {})
    if not isinstance(portraits, dict):
        raise ValueError("照片库无效")
    for key, encoded in portraits.items():
        portrait_bytes(key, encoded)
    def strings(obj, keys):
        if not isinstance(obj, dict) or not all(isinstance(obj.get(k), str) for k in keys):
            raise ValueError("文本字段无效")
    def project(p):
        strings(p, ["id","name","category","date","short","body"])
        if not p["name"].strip(): raise ValueError("请填写项目名称")
        if not isinstance(p.get("notes", ""), str):
            raise ValueError("项目备注无效")
        if any(not isinstance(p.get(k, ""), str) for k in ("role", "stack", "overview")):
            raise ValueError("项目角色、技术栈与概述必须为文本")
    def unique(rows):
        ids=[r["id"] for r in rows]
        if len(set(ids)) != len(ids): raise ValueError("记录编号重复")
    for p in s["projects"]: project(p)
    unique(s["projects"])
    for d in s["drafts"]:
        strings(d, ["id","title","template","updated"])
        if "portraitId" in d and (not isinstance(d["portraitId"], str) or d["portraitId"] not in portraits):
            raise ValueError("简历引用的照片缺失")
        if type(d.get("step", 1)) is not int or d.get("step", 1) not in (1, 2, 3):
            raise ValueError("简历步骤无效")
        if d["template"] not in template_ids or not isinstance(d.get("fields"),dict) or not isinstance(d.get("items"),list):
            raise ValueError("简历内容无效")
        if not all(isinstance(v,str) for v in d["fields"].values()): raise ValueError("栏目内容无效")
        for item in d["items"]:
            project(item)
            if item.get("mode") not in ("short","body","honor"): raise ValueError("项目版本无效")
        unique(d["items"])
    unique(s["drafts"])
    if s.get("active") is not None and s["active"] not in [d["id"] for d in s["drafts"]]:
        raise ValueError("当前简历编号无效")

def load_state():
    s = json.loads(DB.read_text(encoding="utf-8")) if DB.is_file() else initial()
    check_state(s)
    return s, hashlib.sha256(encode(s)).hexdigest()

def save(s):
    DB.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=DB.parent, delete=False) as f:
        name=f.name
        try:
            f.write(encode(s)); f.flush(); os.fsync(f.fileno())
        except Exception:
            f.close(); os.unlink(name); raise
    try: os.replace(name, DB)
    finally:
        if os.path.exists(name): os.unlink(name)

def escape(text):
    replacements={"\\":r"\textbackslash{}", "{":r"\{","}":r"\}","#":r"\#","$":r"\$","%":r"\%","&":r"\&","_":r"\_","^":r"\textasciicircum{}","~":r"\textasciitilde{}"}
    return "".join(replacements.get(c,c) for c in text if c >= " ")

def document_body(draft, template):
    fields = draft["fields"]
    contact = [
        r"\allowbreak{}".join(escape(char) for char in fields[key])
        for key in ("phone", "email", "website") if fields.get(key)
    ]
    body = [r"\begin{document}\color{Ink}\bodysetup",
            r"\folioHeader{%s}{%s}{%s}" % (escape(fields.get("name", "")),
              escape(fields.get("subtitle", "")), r"\par ".join(contact))]
    projects = [item for item in draft["items"] if item["mode"] != "honor"]
    sections = {}
    for key, label in template["sections"]:
        lines = [line for line in fields.get(key, "").splitlines() if line.strip()]
        if key == "honors":
            lines.extend(item["short"] for item in draft["items"] if item["mode"] == "honor")
        if not (projects if key == "projects" else lines):
            continue
        marker = template.get("sectionIcons", {}).get(key) or template.get("englishSections", {}).get(key, "")
        block = [r"\folioSection{%s}{%s}" % (escape(label), escape(marker))]
        if key == "projects":
            for index, item in enumerate(projects):
                if index:
                    block.append(r"\nextproject")
                if item["mode"] == "body":
                    meta = "，".join(value for value in (item["date"], item.get("role")) if value)
                    block.append(r"\folioFullTitle{%s}{%s}" % (escape(item["name"]), escape(meta)))
                    for field, caption in (("stack", "技术栈"), ("overview", "概述"), ("body", "详细")):
                        paragraphs = [escape(v) for v in item.get(field, "").splitlines() if v.strip()]
                        if paragraphs:
                            block.append(r"\folioField{%s}{%s}" % (caption, r"\par ".join(paragraphs)))
                else:
                    block.append(r"\folioProject{%s}{%s}" % (escape(item["name"]), escape(item["date"])))
                    block.extend(escape(v) + r"\par" for v in item["short"].splitlines() if v.strip())
                    block.append(r"\folioCloseProject")
        else:
            block.extend(escape(line) + r"\par" for line in lines)
        sections[key] = "\n".join(block + [r"\folioCloseSection"])
    pair = template.get("pairedSections")
    if pair and all(any(key in sections for key in column) for column in pair):
        columns = ["\n".join(sections.pop(key) for key in keys if key in sections) for keys in pair]
        body.append(r"\folioPair{%s}{%s}" % tuple(columns))
    body.extend(sections.values())
    return body + [r"\end{document}"]


def write_portrait(art, template, raw):
    from PIL import Image, ImageOps
    try:
        with Image.open(io.BytesIO(raw)) as photo:
            if photo.format != "JPEG" or max(photo.size) > 1024:
                raise ValueError("请重新选择照片")
            photo = photo.convert("RGB")
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("照片无法读取，请重新选择") from exc
    if template["id"] == "engineering":
        # The PNG includes the dark rule and frame as well as the photo.
        path = art / "portrait.png"
        with Image.open(path) as original:
            frame = original.convert("RGB")
        frame.paste(ImageOps.fit(photo, (602, 593)), (141, 25))
        frame.save(path)
    else:
        ImageOps.fit(photo, (480, 640)).save(art / "portrait.jpg", quality=93)


def make_pdf(draft, photo=None):
    template = next(t for t in TEMPLATES if t["id"] == draft["template"])
    asset_root = Path(os.environ.get("CV_SKILL_ROOT") or Path.home() / ".local/share/cv-skill")
    body = document_body(draft, template)
    with tempfile.TemporaryDirectory() as folder:
        work = Path(folder)
        (work / "common").mkdir()
        local_class = ROOT / "layouts/resume.cls"
        shutil.copyfile(local_class if local_class.is_file() else asset_root / "templates/common/resume.cls", work / "common/resume.cls")
        shutil.copyfile(ROOT / "layouts/base.tex", work / "base.tex")
        shutil.copyfile(ROOT / "layouts" / (template["id"] + ".tex"), work / "style.tex")
        art = work / "art"
        art.mkdir()
        for filename in template["assets"]:
            shutil.copyfile(WEB / "template-assets" / template["id"] / filename, art / filename)
        if template.get("usesPortrait") and photo is not None:
            write_portrait(art, template, photo)
        elif template.get("usesPortrait") and template["id"] != "engineering":
            shutil.copyfile(WEB / "template-assets/common/portrait.jpg", art / "portrait.jpg")

        def compile_pdf(compact=False):
            lines = [r"\documentclass{common/resume}"]
            if compact:
                lines.append(r"\def\FolioCompact{1}")
            lines.extend([r"\input{base.tex}", r"\input{style.tex}"] + body)
            (work / "resume.tex").write_text("\n".join(lines), encoding="utf-8")
            result = subprocess.run(
                [str(ENGINE), "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "resume.tex"],
                cwd=folder, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            if result.returncode:
                errors = re.findall(rb"^! (.+)$", result.stdout, re.M)
                detail = errors[0].decode("utf-8", errors="replace").strip() if errors else ""
                raise ValueError("XeLaTeX 编译失败。" + detail)
            summary = re.search(rb"Output written on resume\.pdf \((\d+) pages?", result.stdout)
            return (work / "resume.pdf").read_bytes(), int(summary.group(1)) if summary else None

        pdf, pages = compile_pdf()
        if pages == 2:
            compact_pdf, compact_pages = compile_pdf(compact=True)
            if compact_pages == 1:
                return compact_pdf
        return pdf


class WorkspaceServer(ThreadingHTTPServer):
    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def send(self,code,body,mime="application/json; charset=utf-8"):
        self.send_response(code); self.send_header("Content-Type",mime); self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff"); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
    def allowed(self):
        host="127.0.0.1:"+str(self.server.server_port)
        return self.headers.get("Host")==host and self.headers.get("Origin","http://"+host)=="http://"+host
    def do_GET(self):
        if not self.allowed(): return self.send(403,b"{}")
        route=urlsplit(self.path).path
        if route=="/api/status": return self.send(200,encode({"app":"folio-resume-studio-v1"}))
        if route=="/api/state":
            try:
                with LOCK: s,rev=load_state()
                profile_file=DB.parent/"profile.json"
                profile=json.loads(profile_file.read_text(encoding="utf-8")) if profile_file.is_file() else {}
                return self.send(200,encode({"state":s,"rev":rev,"templates":catalog(s),"profile":profile,"canvaConfigured":bool(os.environ.get("CANVA_CLIENT_ID") and os.environ.get("CANVA_CLIENT_SECRET"))}))
            except (ValueError,OSError): return self.send(500,encode({"error":"工作区读取失败，请检查数据文件。"}))
        if route=="/canva/callback":
            try:
                canva_connect.callback(parse_qs(urlsplit(self.path).query))
                return self.send(200,"<!doctype html><meta charset=utf-8><meta name=referrer content=no-referrer><title>可画授权</title><p>可以关闭此页，回到简历工作室查看导入结果。</p>".encode(),"text/html; charset=utf-8")
            except ValueError as exc: return self.send(400,encode({"error":str(exc)}))
        files={"/":("index.html","text/html; charset=utf-8"),"/app.js":("app.js","text/javascript; charset=utf-8"),"/imports.js":("imports.js","text/javascript; charset=utf-8"),"/style.css":("style.css","text/css; charset=utf-8")}
        for template in TEMPLATES:
            for filename in template["assets"]:
                key = "template-assets/" + template["id"] + "/" + filename
                files["/" + key] = (key, "image/png")
            for ext, mime in (("png", "image/png"), ("pdf", "application/pdf")):
                key = "samples/" + template["id"] + "." + ext
                files["/" + key] = (key, mime)
        files["/template-assets/common/portrait.jpg"] = ("template-assets/common/portrait.jpg","image/jpeg")
        if route not in files: return self.send(404,b"{}")
        name,mime=files[route]
        if not (WEB/name).is_file(): return self.send(404,b"{}")
        self.send(200,(WEB/name).read_bytes(),mime)
    def do_POST(self):
        if not self.allowed() or self.headers.get_content_type()!="application/json": return self.send(403,b"{}")
        try:
            size=int(self.headers.get("Content-Length","0"))
            if not 0<size<=MAX_WORKSPACE_BYTES: return self.send(413,encode({"error":"工作区超过 32 MB"}))
            data=json.loads(self.rfile.read(size).decode("utf-8"))
            if self.path=="/api/templates/inspect":
                rows=template_rows(data["blob"])
                return self.send(200,encode({"rows":rows,"labels":deck.LABELS}))
            if self.path=="/api/templates/sample":
                if "blob" in data: raw=deck.decode(data["blob"])
                else:
                    with LOCK: state,_=load_state()
                    source=deck_source(data["id"],state)
                    if not source: raise ValueError("模板不存在")
                    raw=source[0]
                clean=deck.fill(raw,{},{"fields":{},"items":[]},None)
                return self.send(200,deck.to_pdf(clean),"application/pdf")
            if self.path=="/api/canva/start":
                return self.send(200,encode(canva_connect.begin(data,"http://127.0.0.1:%s/canva/callback"%self.server.server_port)))
            if self.path=="/api/canva/poll":
                return self.send(200,encode(canva_connect.poll(data["ticket"])))
            if self.path=="/api/state":
                s=data["state"]; check_state(s)
                with LOCK:
                    _,rev=load_state()
                    if data["rev"]!=rev: return self.send(409,encode({"error":"另一个标签页已修改工作区。请先备份当前内容，再刷新。"}))
                    save(s)
                return self.send(200,encode({"rev":hashlib.sha256(encode(s)).hexdigest()}))
            if self.path in ("/api/pdf","/api/pptx"):
                d=data["draft"]
                portraits = {}
                key = d.get("portraitId")
                with LOCK: state, _ = load_state()
                if isinstance(key, str):
                    if key in state.get("portraits", {}):
                        portraits[key] = state["portraits"][key]
                check_state({"projects":[],"drafts":[d],"portraits":portraits,"userTemplates":state.get("userTemplates",[])})
                photo = base64.b64decode(portraits[key]) if portraits else None
                source=deck_source(d["template"],state)
                if source:
                    raw=deck.fill(source[0],source[1],d,photo)
                    if self.path=="/api/pptx":
                        return self.send(200,raw,"application/vnd.openxmlformats-officedocument.presentationml.presentation")
                    return self.send(200,deck.to_pdf(raw),"application/pdf")
                if self.path=="/api/pptx": raise ValueError("此模板使用 LaTeX，请选择导出 PDF")
                return self.send(200,make_pdf(d, photo),"application/pdf")
            self.send(404,b"{}")
        except (ValueError,KeyError,TypeError) as e: self.send(400,encode({"error":str(e)}))
        except (OSError,subprocess.TimeoutExpired): self.send(500,encode({"error":"本地文件读写或 XeLaTeX 编译失败，请检查磁盘和工具路径。"}))

if __name__=="__main__":
    parser=argparse.ArgumentParser(); parser.add_argument("--port",type=int,default=18430); parser.add_argument("--open",action="store_true"); args=parser.parse_args()
    url="http://127.0.0.1:"+str(args.port)
    try: server=WorkspaceServer(("127.0.0.1",args.port),Handler)
    except OSError:
        with urllib.request.urlopen(url+"/api/status",timeout=3) as response:
            if json.load(response).get("app")!="folio-resume-studio-v1": raise
        if args.open: webbrowser.open(url)
    else:
        if args.open: threading.Timer(.25,lambda:webbrowser.open(url)).start()
        server.serve_forever()
