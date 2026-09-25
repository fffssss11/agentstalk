# 工具与素材说明

项目源码及随附原创文档按 [MIT License](LICENSE) 分发。

- 源码包不捆绑 Python。Windows 便携包（`agentstalk-版本-windows-x64.zip`）的 `runtime/python/` 目录是 python.org 发布的官方嵌入式 Python，版本与 SHA-256 固定在 `scripts/portable.py`，文件原样收录、未作修改。它按 Python Software Foundation License 分发，完整许可证及其包含的第三方组件声明见同目录的 `LICENSE.txt`。
- Node.js、Playwright 与浏览器仅用于开发测试或宣传素材渲染，适用各自的许可证。Playwright 锁定版本见 `package-lock.json`，上游为 [microsoft/playwright](https://github.com/microsoft/playwright)。
- FFmpeg 仅用于可选视频编码，源码包不捆绑其程序或编解码器。请查阅所用构建的 [FFmpeg 许可说明](https://ffmpeg.org/legal.html)。
- 项目演示截图来自独立临时会话，不含私人聊天。任务完成状态仅解释界面，不代表真实模型执行结果。
- `docs/assets/concept-art.png` 为 AI 生成的概念背景。宣传封面复用该图，与真实界面截图分别标注。相关许可仅涵盖项目有权授予的内容。
- 0.1.0-rc.3 宣传短片的配乐由 `docs/promo/render.cjs` 合成，不使用采样、第三方歌曲或人声录音。脚本随项目许可分发。
- PPT 与宣传短片渲染使用本机微软雅黑，项目不捆绑字体文件。PPT 接收端缺少字体时可能替换，PDF 和 MP4 已渲染文字。
- 0.3.0 的展示片（Release 附件）没有配乐，由 Playwright 逐帧渲染、FFmpeg 编码。界面截自在隔离数据上真实运行的面板；文字使用 Noto Sans SC、JetBrains Mono 与 Geist（均按 SIL Open Font License 1.1 发布），模拟的文件管理器与对话框使用本机微软雅黑 UI。项目不捆绑这些字体文件。
- Codex、Claude Code、Reasonix、ZCode 等名称仅标识兼容对象，商标权属于各自权利人。MIT 许可不授予第三方商标权，也不表示官方关联或背书。
