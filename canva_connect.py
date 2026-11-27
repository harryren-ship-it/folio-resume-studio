"""Local, short-lived Canva OAuth sessions. Only the design ID goes to the API."""
import base64
import hashlib
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

API="https://api.canva.com/rest/v1"
sessions={}
lock=threading.Lock()

def design_id(link):
    url=urllib.parse.urlsplit(link.strip())
    if url.scheme!="https" or url.hostname not in {"www.canva.com","canva.com","www.canva.cn","canva.cn"} or url.username or url.password:
        raise ValueError("请输入可画设计的 HTTPS 链接")
    m=re.match(r"^/design/([A-Za-z0-9_-]{5,100})(?:/|$)",url.path)
    if not m or m.group(1)=="play":
        raise ValueError("请先在可画点「使用此模板」，再从自己的设计中复制链接。")
    return m.group(1)

def begin(data,redirect):
    did=design_id(data.get("link",""))
    client=os.environ.get("CANVA_CLIENT_ID") or data.get("clientId","").strip()
    secret=os.environ.get("CANVA_CLIENT_SECRET") or data.get("clientSecret","").strip()
    if not client or not secret: raise ValueError("请先填写自己的 Canva Connect 集成凭据")
    verifier=secrets.token_urlsafe(64); state=secrets.token_urlsafe(32); ticket=secrets.token_urlsafe(32)
    challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    with lock:
        for k in list(sessions):
            if time.monotonic()>sessions[k]["expires"]: del sessions[k]
        if len(sessions)>=20: raise ValueError("当前授权较多，请稍后重试")
        sessions[ticket]=dict(state=state,verifier=verifier,design=did,client=client,secret=secret,redirect=redirect,status="waiting",expires=time.monotonic()+600)
    params=dict(client_id=client,code_challenge=challenge,code_challenge_method="s256",response_type="code",scope="design:content:read",state=state,redirect_uri=redirect)
    return {"ticket":ticket,"authorize":"https://www.canva.com/api/oauth/authorize?"+urllib.parse.urlencode(params)}

def request_json(url,body=None,headers=None):
    req=urllib.request.Request(url,data=body,headers=dict({"User-Agent":"Folio-Resume-Studio"},**(headers or {})))
    with urllib.request.urlopen(req,timeout=25) as res: return json.loads(res.read(2_000_000))

def download(url):
    def checked(u):
        p=urllib.parse.urlsplit(u)
        if p.scheme!="https" or not (p.hostname or "").endswith((".canva.com",".canva.cn",".canvausercontent.com")) or p.username or p.password or p.port not in (None,443):
            raise ValueError("可画返回的下载地址不受支持，请使用文件导入。")
        return u
    class SafeRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,req,fp,code,msg,headers,newurl):
            return super().redirect_request(req,fp,code,msg,headers,checked(newurl))
    with urllib.request.build_opener(SafeRedirect()).open(checked(url),timeout=30) as res:
        data=res.read(12*1024*1024+1)
    if len(data)>12*1024*1024: raise ValueError("文件大于 12 MB，请在可画中减少图片或页面")
    return data

def export(session,code):
    basic=base64.b64encode((session["client"]+":"+session["secret"]).encode()).decode()
    form=urllib.parse.urlencode(dict(grant_type="authorization_code",code=code,code_verifier=session["verifier"],redirect_uri=session["redirect"])).encode()
    token=request_json(API+"/oauth/token",form,{"Authorization":"Basic "+basic,"Content-Type":"application/x-www-form-urlencoded"})["access_token"]
    headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"}
    job=request_json(API+"/exports",json.dumps({"design_id":session["design"],"format":{"type":"pptx"}}).encode(),headers)["job"]
    until=time.monotonic()+100
    while job["status"]=="in_progress" and time.monotonic()<until:
        time.sleep(1.5)
        job=request_json(API+"/exports/"+urllib.parse.quote(job["id"],safe=""),headers=headers)["job"]
    if job["status"]!="success" or not job.get("urls"): raise ValueError("可画未能导出 PPTX，请检查设计类型和导出权限。")
    return download(job["urls"][0])

def callback(query):
    state=query.get("state",[""])[0]
    with lock:
        pair=next(((k,v) for k,v in sessions.items() if v["status"]=="waiting" and v["expires"]>time.monotonic() and secrets.compare_digest(v["state"],state)),None)
        if pair is None: raise ValueError("授权已失效，请回到工作室重新连接")
        ticket,session=pair; session["status"]="working"
    def finish():
        try:
            if "error" in query or not query.get("code"): raise ValueError("已取消可画授权。")
            raw=export(session,query["code"][0])
            result={"status":"ready","blob":base64.b64encode(raw).decode()}
        except urllib.error.HTTPError as exc:
            result={"status":"error","error":"可画返回 HTTP %s，请检查集成权限、账号和设计是否支持 PPTX 导出。也可使用文件导入。"%exc.code}
        except ValueError as exc: result={"status":"error","error":str(exc)}
        except Exception: result={"status":"error","error":"连接可画失败，请重试或使用可画导出的文件。"}
        with lock:
            if ticket in sessions: sessions[ticket]=dict(result,expires=time.monotonic()+180)
    threading.Thread(target=finish,daemon=True).start()

def poll(ticket):
    with lock:
        s=sessions.get(ticket)
        if not s or s["expires"]<time.monotonic():
            sessions.pop(ticket,None)
            raise ValueError("授权已过期，请重新连接")
        if s["status"] in ("waiting","working"): return {"status":s["status"]}
        del sessions[ticket]
        return {k:v for k,v in s.items() if k!="expires"}
