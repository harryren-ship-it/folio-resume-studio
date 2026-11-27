"use strict";
let stagedDeck = null;
let importSession = 0;
let sampleUrl = "";
const contactKeys = ["phone", "email", "website"];
function supportsHeader(t, key) {
  return !t.headerFields || t.headerFields.includes(key) ||
    (contactKeys.includes(key) && t.headerFields.includes("contact"));
}
function deckMini(t) {
  return t.builtin ? '<img alt="" src="/samples/' + esc(t.id) + '.png">' :
    '<span class="deck-mini" aria-hidden="true"><i></i><i></i><i></i></span>';
}
function deckCard(t, selected) {
  return '<div class="sample-card ' + (selected ? "selected" : "") + '">' +
    '<button class="template" data-act="template" ' + idAttr(t.id) + ' aria-pressed="'+selected+'"><span class="stage">' +
    deckMini(t) + '</span><span class="tinfo"><strong>' + esc(t.name) + '</strong><span>' + esc(t.audience) +
    '</span></span><span class="radio">'+(selected ? icon("check") : "")+'</span></button><div class="sample-foot">' +
    btn("deckSample","查看原版样张","eye","textbtn",idAttr(t.id)) +
    (!t.builtin ? btn("editMapping","编辑栏目","","textbtn",idAttr(t.id)) : "") + '</div></div>';
}
async function postStudio(path, data) {
  const response = await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  if (!response.ok) throw Error((await response.json()).error || "操作未完成");
  return response;
}
function importError(err) {
  if (el("importStatus")) el("importStatus").textContent=err.message;
  else message(err.message);
}
function openImporter() {
  stagedDeck=null;
  const redirect = location.origin+"/canva/callback";
  modal(modalHead("从可画导入模板") +
    '<div class="import-tabs" role="group" aria-label="导入方式">'+
    btn("importTab","本地文件","","secondary",'data-tab="file" aria-pressed="true"')+
    btn("importTab","可画链接","","secondary",'data-tab="link" aria-pressed="false"')+'</div>'+
    '<section id="filePane"><p>在可画里使用喜欢的模板，选择「分享 → 下载 → Microsoft PowerPoint (.pptx)」。</p>'+
    '<label class="field"><span>选择模板文件 · 最大 12 MB</span><input id="deckFile" type="file" accept=".pptx"></label></section>'+
    '<section id="linkPane" hidden><p>在可画里点「使用此模板」，粘贴生成的设计链接，再授权读取这份设计。</p>'+
    '<form id="connectForm"><label class="field"><span>可画设计链接</span><input name="link" type="url" required placeholder="https://www.canva.com/design/…"></label>'+
    (window.canvaConfigured ? "" : '<details class="connect-config" open><summary>连接自己的 Canva Connect 集成</summary>'+
    '<p>在 <a href="https://www.canva.com/developers/integrations" target="_blank" rel="noopener noreferrer">开发者后台</a> 启用 design:content:read，并登记此回调地址。</p><code>'+esc(redirect)+'</code>'+
    '<label class="field"><span>Client ID</span><input name="clientId" required autocomplete="off"></label>'+
    '<label class="field"><span>Client secret（仅本次授权使用）</span><input type="password" name="clientSecret" required autocomplete="off"></label></details>')+
    '<button class="primary" type="submit">连接可画并导入</button></form></section>'+
    '<p id="importStatus" role="status"></p>');
}
function mappingScreen(title) {
  const {rows,labels,bindings}=stagedDeck;
  let last=0; let list="";
  for(const row of rows) {
    if(last!==row.page){list+="<h3>第 "+row.page+" 页</h3>";last=row.page;}
    const options=row.picture ? [["","保留原图"],["portrait","简历照片"]] :
      [["","保留原文"],["clear","清空示例文字"],...Object.entries(labels).filter(([k])=>k!=="portrait")];
    list+='<label class="mapping-row"><span>'+esc(row.text)+'</span><select data-binding="'+esc(row.key)+'">'+
      options.map(([k,v])=>'<option value="'+k+'" '+(bindings[row.key]===k?"selected":"")+'>'+esc(v)+'</option>').join("")+"</select></label>";
  }
  modal(modalHead(title) + '<form id="mappingForm"><label class="field"><span>模板名称</span><input name="templateName" maxlength="80" required value="'+esc(stagedDeck.name)+'"></label>'+
    '<p>把示例文字对应到简历栏目，固定的标题和装饰保留原样。照片可对应到原设计中的一张图片。</p>'+
    btn("stagedSample","查看原设计","eye","secondary")+
    '<div class="mapping-list">'+list+'</div><p id="importStatus" role="status"></p><div class="modalactions"><button class="primary" type="submit">保存到本地模板库</button></div></form>');
}
async function inspectDeck(blob,name,id,existing) {
  const current=importSession;
  const data=await (await postStudio("/api/templates/inspect",{blob})).json();
  if(current!==importSession || !el("dialog").open) return;
  const bindings={...existing};
  if(!existing) for(const row of data.rows) {
    const m=/^\{\{([a-z]+)\}\}$/i.exec(row.text.trim());
    if(m && Object.hasOwn(data.labels,m[1]) && (m[1]==="portrait")===row.picture) bindings[row.key]=m[1];
  }
  stagedDeck={blob,name,id,bindings,rows:data.rows,labels:data.labels};
  mappingScreen(id ? "编辑模板栏目" : "匹配模板栏目");
}
async function connect(form) {
  const current=++importSession;
  const button=form.querySelector("button[type=submit]");
  button.disabled=true;
  let popup=window.open("about:blank","_blank");
  if(popup) popup.opener=null;
  try {
    const info=Object.fromEntries(new FormData(form));
    const {ticket,authorize}=await (await postStudio("/api/canva/start",info)).json();
    if(current!==importSession) { if(popup) popup.close();return; }
    if(form.elements.clientSecret) form.elements.clientSecret.value="";
    if(popup) popup.location.replace(authorize);
    el("importStatus").innerHTML='在可画授权后会自动进入栏目匹配。 <a target="_blank" rel="noopener noreferrer" href="'+esc(authorize)+'">打开授权页 ↗</a>';
    while(current===importSession && el("dialog").open){
      await new Promise(r=>setTimeout(r,1400));
      if(current!==importSession || !el("dialog").open) return;
      const result=await (await postStudio("/api/canva/poll",{ticket})).json();
      if(result.status==="error") throw Error(result.error);
      if(result.status==="ready"){
        await inspectDeck(result.blob,"我的可画模板");return;
      }
    }
  } catch(err) {
    if(popup && !popup.closed) popup.close();
    importError(err);
  } finally {button.disabled=false;}
}
document.addEventListener("change",async e=>{
  if(e.target.id!=="deckFile" || !e.target.files[0]) return;
  const file=e.target.files[0];const current=++importSession;
  el("importStatus").textContent="正在读取模板中的文本框…";
  try {
    if(!/\.pptx$/i.test(file.name) || file.size>12*1024*1024) throw Error("请选择 12 MB 以内的 .pptx 文件。");
    const reader=new FileReader();
    const blob=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result.split(",")[1]);reader.onerror=()=>reject(Error("文件读取失败"));reader.readAsDataURL(file);});
    if(current===importSession) await inspectDeck(blob,file.name.replace(/\.pptx$/i,"").slice(0,80));
  }catch(err){importError(err);e.target.value="";}
});
document.addEventListener("submit",async e=>{
  if(e.target.id==="connectForm"){e.preventDefault();await connect(e.target);return;}
  if(e.target.id!=="mappingForm") return;
  e.preventDefault();
  const form=e.target, button=form.querySelector("button[type=submit]");
  const name=form.elements.templateName.value.trim();
  const bindings={};
  for(const s of form.querySelectorAll("[data-binding]")) if(s.value) bindings[s.dataset.binding]=s.value;
  if(!name || !Object.values(bindings).some(v=>v!=="clear" && v!=="portrait")){
    importError(Error("请为模板命名，并至少关联一个文本框。"));return;
  }
  button.disabled=true;
  try {
    await flush();
    const {id,blob}=stagedDeck;
    const record={id:id || "user-"+uid(),name,bindings,blob};
    const records=[...(db.userTemplates||[])];
    const index=records.findIndex(r=>r.id===id);
    if(index<0) records.push(record); else records[index]=record;
    const proposed={...db,userTemplates:records};
    const saved=await (await postStudio("/api/state",{rev,state:proposed})).json();
    rev=saved.rev;db.userTemplates=records;
    const values=new Set(Object.values(bindings));
    const header=["name","subtitle","email","phone","website","contact","portrait"];
    const meta={id:record.id,name,kind:"deck",audience:"我的可画模板",
      sections:Object.entries(stagedDeck.labels).filter(([key])=>values.has(key)&&!header.includes(key)),
      headerFields:header.filter(k=>values.has(k)),usesPortrait:values.has("portrait")};
    const i=templates.findIndex(t=>t.id===record.id);
    if(i<0) templates.push(meta); else templates[i]=meta;
    closeModal();render();message("模板已保存，可在模板库中选择");
  }catch(err){importError(err);}finally{button.disabled=false;}
});
async function sample(data,button) {
  button.disabled=true;
  try{
    const blob=await (await postStudio("/api/templates/sample",data)).blob();
    if(sampleUrl) URL.revokeObjectURL(sampleUrl);
    sampleUrl=URL.createObjectURL(blob);
    const existing=el("deckPreview");if(existing) existing.remove();
    if(!el("dialog").open) modal(modalHead("模板样张"));
    const frame=document.createElement("iframe");frame.title="模板原版样张";frame.id="deckPreview";frame.src=sampleUrl;
    el("dialog-body").insertBefore(frame,el("dialog-body").querySelector("form"));frame.scrollIntoView({block:"nearest"});
  }catch(err){importError(err);}finally{button.disabled=false;}
}
document.addEventListener("click",async e=>{
  const b=e.target.closest("[data-act]");if(!b || b.disabled) return;
  const a=b.dataset.act;
  if(a==="importTemplate"){++importSession;openImporter();}
  if(a==="importTab"){
    ++importSession;
    const file=b.dataset.tab==="file";
    el("filePane").hidden=!file;el("linkPane").hidden=file;el("importStatus").textContent="";
    document.querySelectorAll("[data-act=importTab]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));
  }
  if(a==="stagedSample") await sample({blob:stagedDeck.blob},b);
  if(a==="deckSample") await sample({id:b.dataset.id},b);
  if(a==="editMapping"){
    const r=db.userTemplates.find(t=>t.id===b.dataset.id);
    modal(modalHead("读取模板")+'<p id="importStatus">正在读取栏目…</p>');
    try {await inspectDeck(r.blob,r.name,r.id,r.bindings);}catch(err){importError(err);}
  }
  if(a==="exportDeck"){
    b.disabled=true;
    try {
      await pendingPhoto;await flush();
      const blob=await (await postStudio("/api/pptx",{draft})).blob();
      download(blob,(draft.title||"简历")+".pptx");
    } catch(err){message(err.message);} finally{b.disabled=false;}
  }
});
el("dialog").addEventListener("close",()=>{
  ++importSession;stagedDeck=null;
  if(sampleUrl){URL.revokeObjectURL(sampleUrl);sampleUrl="";}
});
