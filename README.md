# Folio · 本地简历工作室

在浏览器里维护项目库，选模板、选项目、填写栏目。每份简历保存独立的项目描述和照片，换模板时可以另存一份，并查看未能对应的栏目。

## 启动

需要 Python 3.9 或更新版本。以下命令在项目目录中运行。

```sh
python -m pip install -r requirements.txt
python server.py --open
```

浏览器入口为 `http://127.0.0.1:18430/`。可通过 `python server.py --port 18431 --open` 指定其他端口。工作区默认保存在 `data/workspace.json`，也可以在启动进程时设置 `FOLIO_DATA_FILE`。

| 模板 | 可导出的成品 | 需要的本机软件 |
| --- | --- | --- |
| 松墨 · 通用简历 | 可自动分页的 PDF | XeLaTeX，含 xeCJK、geometry、needspace、enumitem、Fandol 字体或相应中文字体 |
| 深海 · 求职简历、导入的可画模板 | 可编辑 PPTX | Python 依赖即可 |
| 深海 · 求职简历、导入的可画模板 | PDF 和原版样张预览 | LibreOffice，或在 PowerPoint 中打开下载的 PPTX 自行导出 |

安装所需导出工具后重新打开工作室。文字排版效果与本机安装的字体有关。

## 导入自己的可画模板

在「选择模板 → 从可画导入模板」中选择以下任一入口。

**本地文件。** 在可画中使用模板，将设计下载为 Microsoft PowerPoint (.pptx)，然后选择该文件。支持 1–12 页、最大 12 MB 的设计。图片或 PDF 已经丢失独立文本框，导入时请选择含可编辑文字的 PPTX。可导入常用的 PNG、JPEG、GIF 插图。含外部媒体、嵌入对象或不支持的插图格式时，界面会提示重新导出。

**可画链接。** 从自己的设计复制 `https://www.canva.com/design/…` 或 `https://www.canva.cn/design/…`。素材市场链接请先点「使用此模板」。此入口使用 Canva Connect 的 OAuth 和 PPTX 导出 API，运行者需要配置自己的集成。

1. 在 [Canva 开发者后台](https://www.canva.com/developers/integrations) 创建或选择有权使用的集成，启用 `design:content:read`。
2. 登记工作室显示的回调地址。默认是 `http://127.0.0.1:18430/canva/callback`，端口应与当前工作室一致。
3. 在本机连接表单填写 Client ID 和 Client secret，或给本机服务进程设置 `CANVA_CLIENT_ID` 和 `CANVA_CLIENT_SECRET`。在 Canva 授权页选择有权访问该设计的账号。
4. 授权后回到工作室，等待导出完成。只有支持官方 API 和 PPTX 导出的账号、地区及设计才能走这个入口。可画中国区链接也需要当前授权账号能够通过该 API 访问相应设计。

链接导入会把设计 ID 发送给 Canva。凭据和授权令牌仅在本次连接中使用。项目、简历正文和本地照片均保存在本机。可参阅 [Canva 授权文档](https://www.canva.dev/docs/connect/authentication/) 和 [设计导出 API](https://www.canva.dev/docs/connect/api-reference/exports/create-design-export-job/)。

## 匹配栏目与生成简历

导入后，工作室按页列出原设计的文本框和图片。将文本框对应到姓名、教育背景、项目经历等栏目；固定标题选「保留原文」，无用示例选「清空示例文字」。给图片选择「简历照片」，即可在填简历时上传个人照片。多个框关联同一栏目时会重复显示该栏内容。

自行设计模板时，可用 `{{name}}`、`{{education}}`、`{{projects}}`、`{{skills}}`、`{{contact}}` 等标记整段文本，导入时会自动对应。编辑器里的内容预览用来校对文字。PDF 或 PPTX 展示原模板的页面结构、色块和图层。PPTX 模板有固定页数，较长的项目描述可改用短版，或在下载的 PPTX 中调整框高、字号与分页。

已保存的模板可在模板库中重新编辑栏目映射。项目库支持详细版、短版和荣誉条目。「我的简历 → 用其他模板新建」会复制可用内容并列出跳过的栏目。侧栏的「备份与恢复」可以迁移项目、简历、照片及已导入的模板。

## 数据与许可

仓库附带两套原创示例模板，项目库初始为空。运行产生的工作区、个人备份和导入素材均由使用者自行管理。公开分享可画素材时，请查看自己所用素材的授权范围。[Canva 内容许可说明](https://www.canva.com/licensing-explained/)

本项目使用 [MIT 许可证](LICENSE)。
