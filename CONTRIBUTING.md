# 参与开发

## 环境和验证

运行依赖 Python 3.10+ 标准库。界面为本地 HTML/CSS/JavaScript，不依赖 CDN 或前端构建器。浏览器开发测试额外需要 Node 20+。

```sh
python -m unittest discover -s tests -v
npm ci
npx playwright install chromium
npm run check
npm test
```

Linux CI 安装浏览器及系统依赖使用 `npx playwright install --with-deps chromium`。`npm test` 先验证测试服务隔离，再依次运行 browser、flow、instances、activity、workspace 五套浏览器测试，分别使用 18765、18766、18767、18771、18772；单独运行可用 `npm run test:flow` 等。workspace 测试用画布模拟窗口共享，不捕获真实屏幕，也不需要系统授权。启动检查只访问健康接口并核对新进程 PID，端口被其他服务占用会失败，不应复用其他服务。用 `AGENTS_TALK_PYTHON` 指定 Python 可执行文件，用 `AGENTS_TALK_BROWSER` 指定已有 Chromium 系浏览器；默认使用 Playwright 下载的 Chromium。不要设置变量指向真实会话数据。浏览器下载受网络限制时可用环境变量指定本机已安装的浏览器，不要关闭 TLS 验证。

公开 README 截图用 `node tests/preview.cjs` 重新生成，额外使用 18768 端口，数据目录是临时目录。它先拍下新用户看到的空白面板（`dashboard.png`），再建立一个演示会话：模拟成员通过 CLI 报到、派发、交付和验收，成员画面是标有「演示画面」的画布，不捕获真实屏幕，也不调用模型；用量明确标为演示数据。生成的 `docs/assets/screenshot-*.png` 提交前要逐张检查，不能出现真实路径、账号或对话。

所有测试使用临时状态目录与 `config.example.json`。桌面图标测试通过 `AGENTS_TALK_DESKTOP` 写入临时目录，不碰开发者的真实桌面；便携包测试用替身运行时，不联网下载 Python。截图写入 `.runtime/`，只包含隔离测试数据。发布验证另检查解压后的干净副本，不允许测试依赖开发者已有 `config.json`、`python-path.txt` 或安装的全局 skill。

## 代码地图

| 入口 | 职责 |
| --- | --- |
| `hub.py` | CLI、事件事务、状态推导、上下文范围及回环 HTTP 服务 |
| `web/index.html`、`web/app.css` | 页面结构、主题变量、响应式与减少动态效果样式 |
| `web/js/` | 不经构建的普通脚本，共享全局作用域，按 `hub.WEB_FILES` 顺序加载：`util` 工具与弹层，`themes` 主题，`state` 同步与会话状态，`sidebar` 项目与会话，`capture` 窗口画面，`stage` 现场，`chat` 对话与输入，`panels` 任务、成员与实例，`flow` 流程与记录，`settings` 设置与提醒，`main` 视图与启动 |
| `scripts/maintain.py` | 维护状态、发布关卡、版本号、构建、干净副本验证和公开克隆同步 |
| `scripts/upgrade.py` | 从发布包原地升级，含预览、备份与回滚 |
| `start.py` | 无安装依赖的前台启动入口 |
| `创建桌面图标.cmd`、`scripts/desktop.ps1`、`scripts/launch.ps1` | Windows 桌面图标与双击启动：检查或经确认安装 Python、首次运行询问 skill、后台启动面板 |
| `scripts/desktop.sh`、`scripts/launch.sh` | macOS/Linux 桌面启动器，在终端窗口中完成同样的检查 |
| `scripts/make_icons.py` | 按面板图标生成 `agentstalk.ico` 与 `agentstalk.png`，`--check` 核对可复现 |
| `scripts/portable.py` | Windows 便携包：发布源码加固定版本、按 SHA-256 校验的 python.org 嵌入式 Python |
| `scripts/install_skills.py` | 可预览的 skill 安装、备份、归属清单及保守卸载 |
| `scripts/project_tools.py` | 只读环境诊断 |
| `scripts/build_release.py` | 精确清单打包和发布前静态检查 |
| `scripts/audit_public.py` | 源码、Git 身份及演示附件的只读隐私检查 |
| `skills/` | 两个可移植 skill 的唯一维护源 |
| `PROTOCOL.md` | agent 的读写及协作规则 |
| `tests/` | 后端回归、发布/安装回归及浏览器验证 |

事件写入在跨进程事务锁内完成验证与追加；不直接修改旧事件。人类 HTTP 写入使用页面凭证和来源检查，agent 通过 CLI 使用明确实例身份。它们共享同一份本地事件状态，但上下文输出不同，详细信任边界见 SECURITY.md。

## 提交要求

- 修复优先附带可复现测试，使用虚构的隔离输入，不复制真实聊天、原生客户端日志或附件。
- 保留旧日志兼容性、实例身份、文件占用、人工确认和独立验收约束。
- 规则变化更新 PROTOCOL.md，README 只保留入口与用户摘要；不复制第二份完整协议。
- 新增维护文件时更新 `release-files.json`，不要把整个目录递归加入发布清单；`python scripts/maintain.py status --strict` 会列出遗漏。新增前端脚本还需加入 `hub.py` 的 `WEB_FILES`、`web/index.html` 和 `package.json` 的 `check`。
- 窗口画面只能留在页面内：不录制、不上传、不发给 agent，截图必须经人预览确认。不要加入远程控制或输入注入，相关前提见 [维护与发布流程](docs/maintenance.md#预留远程控制)。
- UI 变化验证桌面、窄屏、键盘、减少动画偏好，覆盖发送、控制和断线重连。
- 不在运行时引入外部遥测、未经确认的安装、未经请求的远程调用或真实客户端代发。Windows 桌面启动器只在用户确认后调用 winget 安装 Python；首次运行的 skill 安装同样需要确认，且不改动属于其他目录的 skill。
- 公开问题/变更说明中注明实际执行的命令、结果和未验证的平台，不把 CI 配置写成已通过的 CI 结果。

## 发布前

跟随 [维护与发布流程](docs/maintenance.md)。版本号用 `python scripts/maintain.py bump` 同时更新 `VERSION`、`package.json`、lockfile 和 README；每个版本的实测结果写入 [发布说明](docs/release.md)。发布清单只打包源码，`.gitignore` 仅保护 Git 默认选择，不能清除曾经提交的秘密，也不替代人工安全审查。

贡献代码按本项目 MIT 许可证分发。提交前确认你有权贡献相关内容，不包含私人数据或未经授权的第三方材料。
