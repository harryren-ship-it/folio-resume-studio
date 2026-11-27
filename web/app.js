"use strict";
const el = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const uid = () => crypto.randomUUID();
const glyph = {
  compose: "M4 5h9M4 10h6M4 15h4M13 17l-3 1 1-3 7-7 2 2z",
  library: "M3 6h6l2 2h10v11H3z",
  files: "M7 3h8l4 4v14H7zM14 3v5h5M4 6v12",
  arrow: "M4 12h15m-6-6 6 6-6 6",
  back: "M19 12H5m6-6-6 6 6 6",
  plus: "M12 5v14M5 12h14",
  check: "m4 12 5 5L20 6",
  edit: "m4 16-1 5 5-1L20 8l-4-4zM14 6l4 4",
  search: "M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 1 1 16 0",
  close: "m5 5 14 14M19 5 5 19",
  backup: "M4 14v5h16v-5M12 3v11m-4-4 4 4 4-4",
  page: "M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h5",
  up: "m5 15 7-7 7 7",
  down: "m5 9 7 7 7-7",
  remove: "M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  stack: "m3 8 9-5 9 5-9 5zM3 13l9 5 9-5",
};
const icon = (k) =>
  '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="' +
  glyph[k] +
  '"/></svg>';
const btn = (a, label, k = "", cls = "", data = "") =>
  '<button type="button" data-act="' +
  a +
  '" class="' +
  cls +
  '" ' +
  data +
  ">" +
  (k ? icon(k) : "") +
  label +
  "</button>";
const idAttr = (id) => 'data-id="' + esc(id) + '"';
const smallBtn = (a, label, k, id, extra = "") =>
  btn(
    a,
    "",
    k,
    "iconbtn",
    idAttr(id) +
      ' aria-label="' +
      esc(label) +
      '" title="' +
      esc(label) +
      '" ' +
      extra,
  );
const label = { build: "简历制作", library: "项目库", drafts: "我的简历" };
const categories = [
  "科研",
  "AI 应用",
  "技术训练",
  "工程",
  "竞赛",
  "实践",
  "其他",
];
const texts = {
  education: "",
  languages: "",
  skills: "",
  summary: "",
  interests: "",
  honors: "",
  activities: "",
  experience: "",
  exchange: "",
};
const hints = {
  interests: "填写与本次申请相关的方向",
  skills: "列出与本次投递相关、能结合项目说明的技能",
  honors: "每行一项，填写名称、级别与时间",
  experience: "团队或单位、本人职责、具体产出",
  summary: "用一两句话概括与目标相关的优势",
  activities: "活动名称、担任的角色与实际工作",
  exchange: "学校、项目、时间及参加状态",
};
let db,
  rev,
  templates,
  page = "build",
  step = 1,
  draft,
  search = "",
  filter = "",
  timer,
  chain = Promise.resolve(),
  change = 0,
  written = 0,
  saveError = "",
  noticeTimer,
  conflicted = false,
  pendingPhoto = null,
  pdfUrl = "";
const clone = (x) => JSON.parse(JSON.stringify(x));
const newDraft = () => ({
  id: uid(),
  title: "未命名简历",
  template: templates[0].id,
  step: 1,
  updated: new Date().toISOString(),
  items: [],
  fields: {
    name: "",
    subtitle: "",
    email: "",
    phone: "",
    website: "",
    ...texts,
    ...(window.studioProfile || {}),
  },
});
function message(s) {
  el("notice").textContent = s;
  el("notice").classList.add("on");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => el("notice").classList.remove("on"), 3200);
}
function saveStatus() {
  let n = el("saved");
  if (n) {
    n.textContent = saveError
      ? "保存失败"
      : written < change
        ? "正在保存…"
        : "已保存到本机";
    n.title = saveError || "工作区保存在本机数据文件中";
  }
}
function dirty() {
  change++;
  saveStatus();
  clearTimeout(timer);
  timer = setTimeout(() => flush().catch(() => {}), 240);
}
function saveDraft() {
  draft.updated = new Date().toISOString();
  draft.step = step;
  db.active = draft.id;
  if (!db.drafts.some((d) => d.id === draft.id)) db.drafts.unshift(draft);
  dirty();
}
function flush() {
  clearTimeout(timer);
  chain = chain
    .catch(() => {})
    .then(async () => {
      if (conflicted) throw Error(saveError);
      if (written === change) return;
      const n = change;
      try {
        if (db.portraits) {
          const referenced = new Set(db.drafts.map((d) => d.portraitId));
          for (const id of Object.keys(db.portraits))
            if (!referenced.has(id)) delete db.portraits[id];
        }
        const res = await fetch("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rev, state: db }),
        });
        const j = await res.json();
        if (!res.ok) {
          conflicted = res.status === 409;
          throw Error(j.error || "本机保存失败");
        }
        rev = j.rev;
        written = n;
        saveError = "";
      } catch (e) {
        saveError = e.message;
        message(saveError);
        throw e;
      } finally {
        saveStatus();
      }
    });
  return chain;
}
window.addEventListener("beforeunload", (e) => {
  if (written < change || pendingPhoto) {
    e.preventDefault();
    e.returnValue = "";
  }
});
const tpl = () => templates.find((t) => t.id === draft.template);
function modal(html) {
  el("dialog-body").innerHTML = html;
  if (!el("dialog").open) el("dialog").showModal();
}
function closeModal() {
  el("dialog").close();
}
el("dialog").addEventListener("close", () => {
  if (pdfUrl) {
    URL.revokeObjectURL(pdfUrl);
    pdfUrl = "";
  }
  el("dialog").classList.remove("pdf-dialog");
});
function modalHead(title) {
  return (
    '<div class="modalhead"><h2>' +
    esc(title) +
    "</h2>" +
    smallBtn("close", "关闭", "close", "") +
    "</div>"
  );
}
function shell() {
  el("side").innerHTML =
    '<div class="wordmark"><i class="brandmark"></i><span>Folio<span class="period">.</span></span></div><div class="branddesc">个人简历工作室</div><div class="navgroup">' +
    Object.entries(label)
      .map(([k, v]) =>
        btn(
          "nav",
          v + (k === "library" ? "<em>" + db.projects.length + "</em>" : ""),
          { build: "compose", library: "library", drafts: "files" }[k],
          page === k ? "nav active" : "nav",
          'data-page="' + k + '" ' + (page === k ? 'aria-current="page"' : ""),
        ),
      )
      .join("") +
    '</div><div class="sidefoot">' +
    btn("backup", "备份与恢复", "backup", "quiet") +
    '<div class="person"><b>'+esc((window.studioProfile?.name || "F").slice(0,1))+'</b><div>'+esc(window.studioProfile?.name || "Folio")+'<small>个人工作区</small></div></div></div>';
  el("top").innerHTML =
    '<div class="crumb">个人工作区 <span>/</span> <strong>' +
    label[page] +
    '</strong></div><span class="local"><i></i><span id="saved"></span></span>';
  saveStatus();
}
function heading(title, sub, action = "") {
  return (
    '<div class="heading"><div><h1>' +
    title +
    "</h1><p>" +
    sub +
    "</p></div>" +
    action +
    "</div>"
  );
}
function stepper() {
  return (
    '<div class="steps">' +
    ["选择模板", "选择项目", "填写内容"]
      .map(
        (s, i) =>
          '<button data-act="step" data-step="' +
          (i + 1) +
          '" ' +
          (i + 1 > step ? "disabled" : "") +
          ' class="' +
          (i + 1 === step ? "current" : i + 1 < step ? "done" : "") +
          '"><b>' +
          (i + 1 < step ? icon("check") : "0" + (i + 1)) +
          "</b>" +
          s +
          "</button>",
      )
      .join("") +
    "</div>"
  );
}
function canvaLink(t) {
  if (!t.canvaEdit) return "";
  return `<a class="secondary" target="_blank" rel="noopener noreferrer" href="${esc(t.canvaEdit)}">打开这款可画设计 ↗</a>`;
}
const projectFields = [
  ["stack", "技术栈"],
  ["overview", "概述"],
  ["body", "详细"],
];
function projectTitle(p) {
  const meta = [p.date, p.role].filter(Boolean).join("，");
  return p.name + (meta ? "（" + meta + "）" : "");
}
function projectArticle(p) {
  const meta = [p.date, p.role].filter(Boolean).join("，");
  const heading =
    '<div class="project-heading"><strong>' +
    esc(p.name) +
    "</strong>" +
    (meta ? " <small>（" + esc(meta) + "）</small>" : "") +
    "</div>";
  const fields = projectFields
    .filter(([k]) => p[k]?.trim())
    .map(
      ([k, label]) =>
        '<p class="project-part"><b>' + label + "：</b>" + esc(p[k]) + "</p>",
    )
    .join("");
  return '<section class="full-project">' + heading + fields + "</section>";
}
function projectText(p) {
  return [
    projectTitle(p),
    ...projectFields
      .filter(([k]) => p[k]?.trim())
      .map(([k, l]) => l + "：" + p[k]),
  ].join("\n");
}
function draftText() {
  const f = draft.fields;
  const title = [
    supportsHeader(tpl(),"name") ? f.name : "",
    supportsHeader(tpl(),"subtitle") ? f.subtitle : "",
    contactKeys.filter(k=>supportsHeader(tpl(),k)).map(k=>f[k]).filter(Boolean).join(" · "),
  ]
    .filter(Boolean)
    .join("\n");
  const sections = [];
  for (const [key, label] of tpl().sections) {
    let value = f[key] || "";
    if (key === "projects")
      value = draft.items
        .filter((p) => p.mode !== "honor")
        .map((p) =>
          p.mode === "short" ? [p.name, p.short].join("\n") : projectText(p),
        )
        .join("\n\n");
    if (key === "honors")
      value = [
        value,
        ...draft.items.filter((p) => p.mode === "honor").map((p) => p.short),
      ]
        .filter(Boolean)
        .join("\n");
    if (value.trim()) sections.push(label + "\n" + value);
  }
  return [title, ...sections].filter(Boolean).join("\n\n");
}
async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    message("已复制文案");
  } catch {
    modal(
      modalHead("复制文案") +
        '<label class="field"><span>选中后复制到可画</span><textarea id="copyText" readonly rows="12">' +
        esc(value) +
        "</textarea></label>",
    );
    el("copyText").select();
  }
}
function row(p, pick = false) {
  const i = draft.items.findIndex((x) => x.id === p.id),
    sel = i !== -1;
  return (
    '<div class="row ' +
    (pick && sel ? "chosen" : "") +
    '">' +
    (pick
      ? btn(
          "toggle",
          sel ? icon("check") : "",
          "",
          "tick " + (sel ? "checked" : ""),
          idAttr(p.id) +
            ' aria-label="选择 ' +
            esc(p.name) +
            '" aria-pressed="' +
            sel +
            '"',
        )
      : "") +
    '<div class="rowtext"><small>' +
    esc(p.category) +
    " <span> / </span> " +
    esc(p.date || "日期未填") +
    "</small><h3>" +
    esc(p.name) +
    "</h3><p>" +
    esc(p.short) +
    "</p>" +
    (page === "library"
      ? '<details class="project-details"><summary>查看完整描述</summary>' +
        projectArticle(p) +
        btn("copyProject", "复制项目文案", "", "secondary", idAttr(p.id)) +
        "</details>"
      : "") +
    "</div>" +
    (!pick ? smallBtn("edit", "编辑 " + p.name, "edit", p.id) : "") +
    "</div>"
  );
}
function miniLibrary() {
  return (
    '<div class="sectionhead"><h2>项目库 <small>' +
    db.projects.length +
    "</small></h2>" +
    btn(
      "nav",
      "管理项目库 " + icon("arrow"),
      "",
      "textbtn",
      'data-page="library"',
    ) +
    '</div><div class="rows">' +
    db.projects
      .slice(0, 3)
      .map((p) => row(p))
      .join("") +
    "</div>"
  );
}
function templateScreen() {
  const cards = templates
    .map((t) => {
      const selected = draft.template === t.id;
      const sample = "/samples/" + t.id;
      if (t.kind === "deck") return deckCard(t, selected);
      return `<div class="sample-card ${t.id} ${selected ? "selected" : ""}">
      <button class="template" data-act="template" ${idAttr(t.id)} aria-pressed="${selected}" aria-label="选择${t.name}模板">
        <span class="stage"><img src="${sample}.png" width="1072" height="1516" alt="" /></span>
        <span class="tinfo"><strong>${t.name}</strong><span>${t.audience}</span></span>
        <span class="radio" aria-hidden="true">${selected ? icon("check") : ""}</span>
      </button>
      <div class="sample-foot">${t.canvaSource ? '<a href="'+esc(t.canvaSource)+'" target="_blank" rel="noopener noreferrer">可画原版 ↗</a>' : ''}<a href="${sample}.pdf" target="_blank" rel="noopener" aria-label="查看${t.name}的 PDF 样张">PDF 样张 ${icon("eye")}</a></div>
    </div>`;
    })
    .join("");
  return (
    heading(
      "选择简历模板",
      "选择版式，或把自己的可画设计加入模板库。",
      btn("importTemplate", "从可画导入模板", "plus", "primary"),
    ) +
    '<div class="gallery">' +
    cards +
    '</div><div class="actions"><span>已选模板 <b>' +
    esc(tpl().name) +
    "</b></span>" +
    btn("next", "下一步，选择项目 " + icon("arrow"), "", "primary") +
    "</div>" +
    miniLibrary()
  );
}
function filters() {
  return (
    '<div class="filterbar"><label class="search">' +
    icon("search") +
    '<input id="search" aria-label="搜索项目" placeholder="搜索项目名称或内容" value="' +
    esc(search) +
    '"></label><select id="category" aria-label="筛选项目分类"><option value="">全部分类</option>' +
    categories
      .map(
        (c) =>
          "<option " + (filter === c ? "selected" : "") + ">" + c + "</option>",
      )
      .join("") +
    "</select></div>"
  );
}
function results(pick) {
  const ps = db.projects.filter(
    (p) =>
      (!filter || p.category === filter) &&
      [p.name, p.role, p.stack, p.overview, p.short, p.body]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    ps.map((p) => row(p, pick)).join("") ||
    '<div class="empty">没有匹配的项目。</div>'
  );
}
function selectedList() {
  return draft.items.length
    ? draft.items
        .map(
          (p, i) =>
            '<div class="picked"><div><h3>' +
            esc(p.name) +
            '</h3><select data-mode="' +
            esc(p.id) +
            '" aria-label="项目描述篇幅"><option value="body" ' +
            (p.mode === "body" ? "selected" : "") +
            '>展开描述</option><option value="short" ' +
            (p.mode === "short" ? "selected" : "") +
            ">一行短版</option>" +
            (p.category === "竞赛" || p.mode === "honor"
              ? '<option value="honor" ' +
                (p.mode === "honor" ? "selected" : "") +
                ">荣誉栏一行</option>"
              : "") +
            '</select></div><div class="move">' +
            smallBtn("up", "上移", "up", p.id, i === 0 ? "disabled" : "") +
            smallBtn(
              "down",
              "下移",
              "down",
              p.id,
              i === draft.items.length - 1 ? "disabled" : "",
            ) +
            smallBtn("editCopy", "编辑这份简历中的描述", "edit", p.id) +
            smallBtn("unpick", "移出简历", "close", p.id) +
            "</div></div>",
        )
        .join("")
    : '<p class="empty">从项目库勾选本次要展示的经历。</p>';
}
function pickScreen() {
  return (
    heading("选择项目", "勾选本次投递要展示的经历，在右侧调整顺序与篇幅。") +
    '<div class="split"><section>' +
    filters() +
    '<div id="results">' +
    results(true) +
    '</div></section><section class="basket"><h2>已选项目 <small>' +
    draft.items.length +
    "</small></h2>" +
    selectedList() +
    '</section></div><div class="actions">' +
    btn("prev", "上一步", "back", "secondary") +
    btn("next", "下一步，填写内容 " + icon("arrow"), "", "primary") +
    "</div>"
  );
}
function field(
  key,
  name,
  val,
  area = false,
  placeholder = "",
  required = false,
) {
  const attr =
    ' name="' +
    key +
    '" ' +
    (required ? "required " : "") +
    'placeholder="' +
    esc(placeholder) +
    '"';
  return (
    '<label class="field"><span>' +
    name +
    "</span>" +
    (area
      ? '<textarea rows="3"' + attr + ">" + esc(val) + "</textarea>"
      : "<input" + attr + ' value="' + esc(val) + '">') +
    "</label>"
  );
}
function safeLines(val) {
  return esc(val || "")
    .split("\n")
    .filter(Boolean)
    .map((x) => "<p>" + x + "</p>")
    .join("");
}
function portraitSource(t, d) {
  const custom = db.portraits?.[d.portraitId];
  if (custom) return "data:image/jpeg;base64," + custom;
  if (t.kind === "deck") return "";
  return t.id === "engineering"
    ? "/template-assets/engineering/portrait.png"
    : "/template-assets/common/portrait.jpg";
}
function portraitMarkup(t, d) {
  const src = portraitSource(t, d);
  if (t.id === "engineering" && d.portraitId)
    return '<span class="resume-portrait portrait-frame"><img src="' + src + '" alt="简历照片"></span>';
  return '<img class="resume-portrait' + (d.portraitId ? " custom-portrait" : "") + '" src="' + src + '" alt="简历照片">';
}
function portraitField() {
  if (!tpl().usesPortrait) return "";
  return '<div class="field photo-field"><strong>简历照片</strong><div class="photo-controls">' +
    (portraitSource(tpl(), draft) ? '<img class="photo-thumb" src="' + portraitSource(tpl(), draft) + '" alt="当前照片">' : "") +
    '<div><div class="photo-buttons">' + btn("choosePortrait", draft.portraitId ? "更换照片" : "上传本地照片", "", "secondary") +
    (draft.portraitId ? btn("resetPortrait", tpl().kind === "deck" ? "移除照片" : "恢复默认照片", "", "textbtn") : "") +
    '</div><small>支持 JPG、PNG、WebP，按模板居中裁切。</small></div></div>' +
    '<input type="file" id="portraitUpload" hidden accept="image/jpeg,image/png,image/webp"></div>';
}
async function applyPortrait(file, owner) {
  if (file.type && !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("请选择 JPG、PNG 或 WebP 照片。");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw Error("无法读取这张照片，请重新选择。");
    }
    const scale = Math.min(1, 960 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL("image/jpeg", 0.88).split(",")[1];
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const id = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
    if (!db.drafts.includes(owner) || !templates.find((t) => t.id === owner.template)?.usesPortrait) return;
    if (!db.portraits) db.portraits = {};
    db.portraits[id] = encoded;
    owner.portraitId = id;
    owner.updated = new Date().toISOString();
    dirty();
    if (draft === owner && page === "build" && step === 3) render();
    await flush();
  } finally {
    URL.revokeObjectURL(url);
  }
}
function paper() {
  const t = tpl(),
    f = draft.fields;
  const contacts = contactKeys.filter(k=>supportsHeader(t,k)).map(k=>f[k])
    .filter(Boolean)
    .map((v) => "<p>" + esc(v) + "</p>")
    .join("");
  const name = supportsHeader(t,"name") ? "<h2>" + esc(f.name) + "</h2>" : "";
  const subtitle = supportsHeader(t,"subtitle") && f.subtitle
    ? '<div class="identity">' + esc(f.subtitle) + "</div>"
    : "";
  let header = "<div>" + name + subtitle + "</div><div>" + contacts + "</div>";
  if (t.usesPortrait && portraitSource(t, draft)) {
    header = portraitMarkup(t, draft) + "<div>" +
      name + subtitle + contacts + "</div>";
  }
  const sections = new Map();
  t.sections.forEach(([key, label]) => {
      let content;
      if (key === "projects") {
        content = draft.items
          .filter((p) => p.mode !== "honor")
          .map((p) => {
            if (p.mode === "body") return projectArticle(p);
            const description = safeLines(p.short);
            return (
              '<section class="entry"><strong>' +
              esc(p.name) +
              "</strong><small>" +
              esc(p.date) +
              "</small><div>" +
              description +
              "</div></section>"
            );
          })
          .join("");
      } else {
        const extras =
          key === "honors"
            ? draft.items.filter((p) => p.mode === "honor").map((p) => p.short)
            : [];
        content = safeLines([f[key], ...extras].filter(Boolean).join("\n"));
      }
      if (!content) return;
      const english = t.englishSections?.[key];
      const symbol = t.sectionIcons?.[key];
      sections.set(key,
        '<section class="cv-section"><h4>' +
        (symbol ? `<img alt="" src="/template-assets/${t.id}/${symbol}.png">` : "") +
        esc(label) +
        (english ? "<em>" + esc(english) + "</em>" : "") +
        "</h4><div>" +
        content +
        "</div></section>"
      );
    });
  let paired = "";
  if (t.pairedSections?.every((keys) => keys.some((key) => sections.has(key)))) {
    const columns = t.pairedSections.map((keys) => keys.map((key) => {
      const html = sections.get(key) || "";
      sections.delete(key);
      return html;
    }).join(""));
    paired = '<div class="profile-columns">' + columns.map((html) => "<div>" + html + "</div>").join("") + "</div>";
  }
  return (
    '<article class="paper ' +
    t.id +
    '"><header>' +
    header +
    "</header>" +
    paired + [...sections.values()].join("") +
    "</article>"
  );
}
function fillScreen() {
  const f = draft.fields;
  const headerField=(key,label)=>supportsHeader(tpl(),key) ? field(key,label,f[key]) : "";
  return (
    heading("填写简历内容", "栏目随模板切换，留空的栏目会在成品中自动隐藏。") +
    '<div class="editor"><div class="formcol" id="fields">' +
    field("title", "简历文件名", draft.title) +
    headerField("name", "姓名") +
    headerField("subtitle", "个人标题") +
    headerField("email", "邮箱") +
    headerField("phone", "电话") +
    headerField("website", "个人主页") +
    portraitField() +
    "<hr>" +
    tpl()
      .sections.filter(([k]) => k !== "projects")
      .map(([k, l]) => field(k, l, f[k], true, hints[k] || ""))
      .join("") +
    '</div><div class="preview"><div class="sectionhead"><h2>内容预览</h2><small>A4 · ' +
    esc(tpl().name) +
    '</small></div><div id="paper">' +
    paper() +
    '</div><p class="muted">' + (tpl().kind === "deck" ? "这里仅预览栏目文字。生成 PDF 可查看模板中的实际位置与分页。" : "最终分页以导出的 PDF 为准。") + '</p>' +
    '<div class="export-actions">' +
    btn("pdf", "生成并查看 PDF", "eye", "primary") +
    (tpl().kind === "deck" ? btn("exportDeck", "下载可编辑 PPTX", "", "secondary") : "") +
    btn("transfer", "用其他模板新建", "files", "secondary", idAttr(draft.id)) +
    btn("copyDraft", "复制简历文案", "", "secondary") +
    canvaLink(tpl()) +
    "</div>" +
    '</div></div><div class="actions">' +
    btn("prev", "返回项目选择", "back", "secondary") +
    btn(
      "nav",
      "我的简历 " + icon("arrow"),
      "",
      "secondary",
      'data-page="drafts"',
    ) +
    "</div>"
  );
}
function library() {
  return (
    heading(
      "项目库",
      "维护可重复使用的项目描述，制作简历时按需选取。",
      btn("add", "新建项目", "plus", "primary"),
    ) +
    filters() +
    '<div id="results" class="rows">' +
    results(false) +
    "</div>"
  );
}
function chooseTransfer(source) {
  el("dialog").classList.remove("pdf-dialog");
  if (pdfUrl) {
    URL.revokeObjectURL(pdfUrl);
    pdfUrl = "";
  }
  const choices = templates.filter((t) => t.id !== source.template).map((t) =>
    btn("applyTransfer", (t.kind === "deck" ? deckMini(t) : '<img alt="" src="/samples/' + esc(t.id) + '.png">') + '<span><strong>' +
      esc(t.name) + "</strong><small>" + esc(t.audience) + "</small></span>", "", "transfer-choice",
      idAttr(source.id) + ' data-target="' + esc(t.id) + '"')
  );
  modal(modalHead("用其他模板新建") + "<p>从「" + esc(source.title) +
    "」导入内容。选择模板后将另存一份简历。</p>" +
    '<div class="transfer-options">' + choices.join("") + "</div>");
}
function transferDraft(source, target) {
  const from = templates.find((t) => t.id === source.template);
  const sections = new Map(target.sections);
  const fields = {};
  const skipped = [];
  for (const [key,label] of Object.entries({name:"姓名",subtitle:"个人标题",email:"邮箱",phone:"电话",website:"个人主页"})) {
    fields[key] = "";
    if (!supportsHeader(from,key)) continue;
    if (supportsHeader(target,key)) fields[key] = source.fields[key] ?? "";
    else if (source.fields[key]?.trim()) skipped.push(label);
  }
  const equivalent = { activities: "experience", experience: "activities" };
  for (const [key, label] of from.sections) {
    if (key === "projects" || !source.fields[key]?.trim()) continue;
    const dest = sections.has(key) ? key : equivalent[key];
    if (sections.has(dest)) {
      fields[dest] = [fields[dest], source.fields[key]].filter(Boolean).join("\n");
    } else {
      skipped.push(label);
    }
  }
  const items = [];
  for (const item of source.items) {
    if (sections.has(item.mode === "honor" ? "honors" : "projects")) items.push(clone(item));
    else skipped.push(item.name);
  }
  const baseTitle = source.title + " · " + target.name;
  let title = baseTitle;
  for (let n = 2; db.drafts.some((d) => d.title === title); n++) title = baseTitle + "（" + n + "）";
  const copy = { id: uid(), title, template: target.id, fields, items, step: 3, updated: new Date().toISOString() };
  if (from.usesPortrait && !target.usesPortrait && (from.kind !== "deck" || source.portraitId)) skipped.push("简历照片");
  if (from.usesPortrait && target.usesPortrait && source.portraitId) copy.portraitId = source.portraitId;
  return { copy, skipped };
}
async function applyTransfer(source, target) {
  const buttons = el("dialog-body").querySelectorAll("[data-act=applyTransfer]");
  for (const b of buttons) b.disabled = true;
  try {
    await flush();
    const { copy, skipped } = transferDraft(source, target);
    draft = copy;
    step = 3;
    saveDraft();
    go("build");
    if (skipped.length) {
      modal(modalHead("部分内容未导入") + "<p>「" + esc(target.name) +
        "」没有以下栏目。对应内容保留在原简历中。</p><ul>" +
        skipped.map((s) => "<li>" + esc(s) + "</li>").join("") +
        '</ul><div class="modalactions">' + btn("close", "查看新简历", "", "primary") + "</div>");
    } else closeModal();
    await flush();
    if (!skipped.length) message("已用新模板另存简历");
  } catch (err) {
    message(err.message);
    for (const b of buttons) b.disabled = false;
  }
}
function drafts() {
  return (
    heading(
      "我的简历",
      "每份简历独立保存所选项目、描述版本与栏目内容。",
      btn("new", "新建简历", "plus", "primary"),
    ) +
    (db.drafts.length
      ? db.drafts
          .slice()
          .sort((a, b) => b.updated.localeCompare(a.updated))
          .map(
            (d) =>
              '<div class="row draft-row"><div class="rowtext"><small>' +
              esc(templates.find((t) => t.id === d.template).name) +
              " · " +
              d.items.length +
              " 个项目</small><h3>" +
              esc(d.title) +
              "</h3><p>更新于 " +
              esc(new Date(d.updated).toLocaleString("zh-CN")) +
              '</p></div><div class="draft-actions">' +
              btn("openDraft", "继续编辑", "edit", "secondary", idAttr(d.id)) +
              btn("transfer", "用其他模板新建", "files", "secondary", idAttr(d.id)) +
              smallBtn("duplicate", "复制为新简历", "files", d.id) +
              smallBtn("deleteDraft", "删除简历", "remove", d.id) +
              "</div></div>",
          )
          .join("")
      : '<div class="empty">还没有保存的简历。新建一份，从选择模板开始。</div>')
  );
}
function render() {
  shell();
  el("main").innerHTML =
    page === "build"
      ? stepper() + [templateScreen, pickScreen, fillScreen][step - 1]()
      : page === "library"
        ? library()
        : drafts();
}
const routes = { build: "", library: "projects", drafts: "drafts" };
function routePage() {
  if (location.hash === "#templates") {
    step = 1;
    return "build";
  }
  return (
    Object.keys(routes).find((k) => routes[k] === location.hash.slice(1)) ||
    "build"
  );
}
function go(p, push = true) {
  page = p;
  search = "";
  filter = "";
  if (push && location.hash.slice(1) !== routes[p]) {
    history.pushState(
      null,
      "",
      location.pathname + (routes[p] ? "#" + routes[p] : ""),
    );
  }
  render();
  window.scrollTo(0, 0);
}
window.addEventListener("popstate", () => {
  if (db) go(routePage(), false);
});
function editor(p, copy = false) {
  modal(
    modalHead(copy ? "编辑本份简历的项目描述" : p ? "编辑项目" : "新建项目") +
      '<form id="projectForm" data-copy="' +
      copy +
      '" data-id="' +
      esc(p?.id || "") +
      '">' +
      field("name", "项目名称", p?.name || "", false, "", true) +
      '<div class="formpair">' +
      field("date", "时间", p?.date || "", false, "例如 2026.07–08") +
      '<label class="field"><span>分类</span><select name="category">' +
      categories
        .map(
          (c) =>
            "<option " +
            (p?.category === c ? "selected" : "") +
            ">" +
            c +
            "</option>",
        )
        .join("") +
      "</select></label></div>" +
      field(
        "role",
        "本人承担角色",
        p?.role || "",
        false,
        "例如 独立开发、负责视觉感知",
      ) +
      field(
        "stack",
        "技术栈",
        p?.stack || "",
        false,
        "使用的工具、平台和方法",
      ) +
      field(
        "overview",
        "概述",
        p?.overview || "",
        true,
        "项目解决了什么问题？",
      ) +
      field(
        "body",
        "详细",
        p?.body || "",
        true,
        "本人职责、关键行动与结果。",
        true,
      ) +
      field(
        "short",
        "一行短版（也用于荣誉栏）",
        p?.short || "",
        true,
        "适合篇幅有限时使用。",
        true,
      ) +
      (copy
        ? ""
        : field(
            "notes",
            "选材备注与证据（仅项目库可见）",
            p?.notes || "",
            true,
            "记录分工、证明材料或适合的方向",
          )) +
      '<div class="modalactions">' +
      (p && !copy
        ? btn("deleteProject", "删除项目", "remove", "danger", idAttr(p.id))
        : "") +
      btn("close", "取消", "", "secondary") +
      '<button class="primary">保存项目</button></div></form>',
  );
}
function askDelete(project, id) {
  const item = (project ? db.projects : db.drafts).find((p) => p.id === id);
  modal(
    modalHead(project ? "删除项目" : "删除简历") +
      "<p>确定删除「" +
      esc(item.name || item.title) +
      "」？" +
      (project ? "已选入简历的项目副本仍会保留。" : "") +
      '</p><div class="modalactions">' +
      btn("close", "取消", "", "secondary") +
      btn(
        project ? "confirmedProject" : "confirmedDraft",
        "确认删除",
        "",
        "danger",
        idAttr(id),
      ) +
      "</div>",
  );
}
function backup() {
  modal(
    modalHead("备份与恢复") +
      '<p>备份包含项目库与所有简历。恢复备份会替换当前工作区。</p><div class="modalactions">' +
      btn("download", "下载备份", "backup", "secondary") +
      btn("import", "选择备份文件", "", "primary") +
      '</div><input type="file" accept=".json" id="fileImport" hidden>',
  );
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
let importing = null;
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "search") {
    search = t.value;
    el("results").innerHTML = results(page === "build");
  }
  if (t.closest("#fields") && t.name && t.type !== "file") {
    if (t.name === "title") draft.title = t.value;
    else draft.fields[t.name] = t.value;
    el("paper").innerHTML = paper();
    saveDraft();
  }
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.id === "portraitUpload" && t.files.length) {
    if (pendingPhoto) return;
    pendingPhoto = applyPortrait(t.files[0], draft);
    try {
      await pendingPhoto;
    } catch (err) {
      message(err.message);
    } finally {
      t.value = "";
      pendingPhoto = null;
    }
    return;
  }
  if (t.closest("#fields") && t.name === "title" && !t.value.trim()) {
    draft.title = t.value = "未命名简历";
    saveDraft();
  }
  if (t.id === "category") {
    filter = t.value;
    el("results").innerHTML = results(page === "build");
  }
  if (t.dataset.mode) {
    draft.items.find((p) => p.id === t.dataset.mode).mode = t.value;
    saveDraft();
  }
  if (t.id === "fileImport" && t.files.length) {
    try {
      const file = t.files[0];
      if (file.size > 40 * 1024 * 1024) throw Error();
      const j = JSON.parse(await file.text());
      if (
        j.format !== "folio-1" ||
        !Array.isArray(j.state.projects) ||
        !Array.isArray(j.state.drafts)
      )
        throw Error();
      importing = j.state;
      modal(
        modalHead("恢复工作区") +
          "<p>将替换为备份中的 " +
          importing.projects.length +
          " 个项目、" +
          importing.drafts.length +
          ' 份简历。</p><div class="modalactions">' +
          btn("close", "取消", "", "secondary") +
          btn("restore", "确认恢复", "", "primary") +
          "</div>",
      );
    } catch {
      message("无法读取此备份文件。");
    }
  }
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "projectForm") return;
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  for (const key of ["name", "short", "body"])
    if (!data[key].trim()) {
      message("请填写项目名称、详细和一行短版");
      return;
    }
  const id = e.target.dataset.id;
  if (e.target.dataset.copy === "true") {
    Object.assign(
      draft.items.find((p) => p.id === id),
      data,
    );
    saveDraft();
    closeModal();
    render();
    message("已更新这份简历中的描述");
    return;
  }
  if (id)
    Object.assign(
      db.projects.find((p) => p.id === id),
      data,
    );
  else db.projects.unshift({ id: uid(), ...data });
  dirty();
  closeModal();
  render();
  message("项目已更新");
});
async function exportPDF(button) {
  if (supportsHeader(tpl(),"name") && !draft.fields.name?.trim()) {
    message("请先填写姓名");
    return;
  }
  button.disabled = true;
  button.textContent = "正在排版…";
  const source = draft;
  try {
    await pendingPhoto;
    await flush();
    const resp = await fetch("/api/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: source }),
    });
    if (!resp.ok) throw Error((await resp.json()).error);
    const b = await resp.blob();
    if (draft !== source || page !== "build") return;
    pdfUrl = URL.createObjectURL(b);
    el("dialog").classList.add("pdf-dialog");
    modal(
      modalHead("成品预览") +
        '<iframe title="简历 PDF" src="' +
        pdfUrl +
        '"></iframe><div class="modalactions"><a class="primary" href="' +
        pdfUrl +
        '" download="' +
        esc(source.title || "简历") +
        '.pdf">下载 PDF</a>' + btn("transfer", "用其他模板新建", "files", "secondary", idAttr(source.id)) + "</div>",
    );
  } catch (e) {
    message(e.message);
  } finally {
    button.disabled = false;
    button.innerHTML = icon("eye") + "生成并查看 PDF";
  }
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || b.disabled) return;
  const a = b.dataset.act,
    id = b.dataset.id;
  let p;
  switch (a) {
    case "choosePortrait":
      if (!pendingPhoto) el("portraitUpload").click();
      break;
    case "resetPortrait":
      if (pendingPhoto) break;
      delete draft.portraitId;
      saveDraft();
      render();
      break;
    case "transfer": {
      try {
        await pendingPhoto;
        const source = db.drafts.find((d) => d.id === id);
        if (source) chooseTransfer(source);
      } catch (err) { message(err.message); }
      break;
    }
    case "applyTransfer": {
      const source = db.drafts.find((d) => d.id === id);
      const target = templates.find((t) => t.id === b.dataset.target);
      if (source && target && source.template !== target.id) await applyTransfer(source, target);
      break;
    }
    case "nav":
      go(b.dataset.page);
      break;
    case "template":
      draft.template = id;
      saveDraft();
      render();
      break;
    case "step":
    case "next":
    case "prev":
      if (location.hash === "#templates")
        history.replaceState(null, "", location.pathname);
      step =
        a === "step" ? Number(b.dataset.step) : step + (a === "next" ? 1 : -1);
      step = Math.max(1, Math.min(3, step));
      search = "";
      filter = "";
      saveDraft();
      render();
      window.scrollTo(0, 0);
      break;
    case "toggle":
    case "unpick":
      if (draft.items.some((x) => x.id === id))
        draft.items = draft.items.filter((x) => x.id !== id);
      else {
        p = db.projects.find((x) => x.id === id);
        if (p) draft.items.push({ ...clone(p), mode: "body" });
      }
      saveDraft();
      render();
      break;
    case "up":
    case "down": {
      const i = draft.items.findIndex((x) => x.id === id),
        j = i + (a === "up" ? -1 : 1);
      if (i >= 0 && j >= 0 && j < draft.items.length) {
        [draft.items[i], draft.items[j]] = [draft.items[j], draft.items[i]];
        saveDraft();
        render();
      }
      break;
    }
    case "editCopy":
      editor(
        draft.items.find((x) => x.id === id),
        true,
      );
      break;
    case "edit":
      editor(db.projects.find((x) => x.id === id));
      break;
    case "add":
      editor(null);
      break;
    case "close":
      closeModal();
      break;
    case "deleteProject":
    case "deleteDraft":
      askDelete(a === "deleteProject", id);
      break;
    case "confirmedProject":
      db.projects = db.projects.filter((x) => x.id !== id);
      dirty();
      closeModal();
      render();
      break;
    case "confirmedDraft":
      db.drafts = db.drafts.filter((x) => x.id !== id);
      if (draft.id === id) {
        draft = newDraft();
        step = 1;
        db.active = null;
      }
      dirty();
      closeModal();
      render();
      break;
    case "new":
      draft = newDraft();
      step = 1;
      saveDraft();
      go("build");
      break;
    case "duplicate": {
      const original = db.drafts.find((x) => x.id === id);
      draft = {
        ...clone(original),
        id: uid(),
        title: original.title + "（副本）",
      };
      step = 1;
      saveDraft();
      go("build");
      break;
    }
    case "openDraft":
      draft = db.drafts.find((x) => x.id === id);
      step = draft.step || 1;
      db.active = id;
      dirty();
      go("build");
      break;
    case "copyProject":
      await copyText(projectText(db.projects.find((p) => p.id === id)));
      break;
    case "copyDraft":
      await copyText(draftText());
      break;
    case "pdf":
      await exportPDF(b);
      break;
    case "backup":
      backup();
      break;
    case "download":
      try { await pendingPhoto; } catch (err) { message(err.message); return; }
      download(
        new Blob([JSON.stringify({ format: "folio-1", state: db }, null, 2)], {
          type: "application/json",
        }),
        "纸间-简历库备份.json",
      );
      break;
    case "import":
      el("fileImport").click();
      break;
    case "restore":
      try {
        await flush();
        const resp = await fetch("/api/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rev, state: importing }),
        });
        if (!resp.ok) throw Error((await resp.json()).error);
        location.reload();
      } catch (err) {
        message(err.message);
      }
      break;
  }
});
window.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch("/api/state"),
      v = await res.json();
    if (!res.ok) throw Error(v.error);
    db = v.state;
    rev = v.rev;
    templates = v.templates;
    window.canvaConfigured = Boolean(v.canvaConfigured);
    window.studioProfile = v.profile || {};
    draft = db.drafts.find((d) => d.id === db.active) || newDraft();
    step = draft.step || 1;
    go(routePage(), false);
  } catch (e) {
    el("main").textContent =
      "工作区未能打开。请使用“打开简历工作室.cmd”启动。 " + e.message;
  }
});
