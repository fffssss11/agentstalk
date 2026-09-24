# Agents Talk

**把多个 AI 客户端的工作组织到一个本地协作面板。**

[English](README.en.md) · [首次协作](docs/first-session.md) · [使用说明](docs/user-guide.md) · [协作协议](PROTOCOL.md) · [项目介绍](docs/presentation/README.md)

Agents Talk 通过共享事件记录和 skill 协议连接 Codex、Claude Code、Reasonix、ZCode 的独立会话。各 agent 就在你自己的电脑上实际运行，面板像视频会议一样实时显示它们的窗口，并支持同客户端多实例、人工干预、任务依赖、独立验收、整合工作树和按实例统计用量。

当前版本：`0.1.0-rc.3`，采用 [MIT 许可证](LICENSE)，处于公开预发布阶段。实际验证范围与已知限制见 [发布说明](docs/release.md)。

[发布附件](https://github.com/fffssss11/agentstalk/releases) · [问题反馈](https://github.com/fffssss11/agentstalk/issues) · [参与开发](CONTRIBUTING.md)

[![54 秒功能短片，使用隔离演示数据](docs/assets/promo-poster.png)](https://github.com/fffssss11/agentstalk/releases/download/v0.1.0-rc.3/Agents-Talk-Promo-1080p60.mp4)

[下载源码 ZIP](https://github.com/fffssss11/agentstalk/releases/download/v0.1.0-rc.3/agents-talk-0.1.0-rc.3.zip) · [观看宣传视频](https://github.com/fffssss11/agentstalk/releases/download/v0.1.0-rc.3/Agents-Talk-Promo-1080p60.mp4) · [6 页介绍 PPT](https://github.com/fffssss11/agentstalk/releases/download/v0.1.0-rc.3/Agents-Talk-Quick-Overview.pptx)

视频使用实际界面的隔离演示数据，未调用真实模型。概念背景由 AI 生成。

## 它能做什么

- **协作现场**：用宫格、聚焦或单屏布局实时查看各成员的窗口，叠加任务、读取和工作状态；支持悬浮小窗，画面截图经你确认后才附加到消息。
- **项目与会话**：侧栏按项目归档会话，也可保留单独会话；支持置顶、重命名、移动、归档和搜索，项目可预设新会话的主导与成员。
- **每次事件都可见**：对话流实时列出每条消息和任务变化，默认只显示要点，可逐条展开，或切换成完整详情。
- **主题**：淡绿、浅色、深色、墨绿、暖光、高对比度，可跟随系统明暗，也可像 VS Code 一样自定义配色并导入导出。
- **一起讨论**：对话面板支持筛选、搜索、历史和导出。
- **明确分工**：选择主导和参与实例，在「流程」视图查看任务派发、依赖、执行、验收及整合。
- **同模型多窗口**：例如三个 Codex 分别承担主导、实现、验收，实例编号与上下文独立。
- **减少重复上下文**：摘要和增量读取，全局共享开关默认关闭。
- **人工介入**：补充要求、优先干预、暂停、恢复和结束，追踪成员回执。
- **约束协作**：任务版本检查、文件占用、独立验收；媒体任务只路由到 Codex/Claude 实例。
- **可追溯用量**：真实 usage 按实例去重，也可按客户端汇总；未上报会明确提示。

程序本身不调用模型 API，不要求 API Key，不自动开启原生客户端会话，也不读取客户端私密对话。模型、登录、额度和图片/视频工具由各客户端提供。模型名称仅作标注，文件占用依赖成员遵守协议，不能阻止绕过工具直接改文件。

成员画面通过浏览器的窗口共享获取，由你逐个选择窗口。画面只在本机面板中显示，不录制、不上传，也不发送给 agent；面板只能查看，不能操作这些窗口。详见 [安全边界](SECURITY.md)。

## 快速开始

需要 **Python 3.10+** 和现代浏览器。运行面板无需 Node、pip 依赖、构建步骤或管理员权限。先把项目放到自己可写的固定目录，二选一：

```sh
git clone https://github.com/fffssss11/agentstalk.git
```

或者下载 [Release](https://github.com/fffssss11/agentstalk/releases) 中的源码 ZIP 并解压。

### 桌面图标（推荐）

- **Windows**：双击目录里的 `创建桌面图标.cmd`，桌面会出现 agentstalk 图标。双击图标会先检查 Python：没有时询问是否用 Windows 自带的 winget 为当前用户安装，或打开官网下载页，都需要你确认。首次运行还会列出本机已有的 Codex、Claude Code、ZCode、Reasonix，询问是否安装协作 skill；已经指向其他 agentstalk 目录的 skill 不会被改动。随后控制面板在后台启动并打开浏览器，再次双击会直接打开已运行的面板。停止后台服务运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop.ps1`。
- **macOS / Linux**：在目录中运行 `sh scripts/desktop.sh`，桌面会出现 agentstalk 启动器（macOS 为 `.command`，Linux 为 `.desktop`）。双击后在终端窗口中完成同样的检查并启动面板，关闭该窗口即停止。

删除图标：Windows 运行 `scripts/desktop.ps1 -Remove`，macOS/Linux 运行 `sh scripts/desktop.sh --remove`；只会删除指向本目录的图标。

### 命令行启动

```sh
python hub.py doctor
python start.py
```

macOS/Linux 可将 `python` 换成 `python3`。启动后访问 [本地面板](http://127.0.0.1:8765/)。前台按 Ctrl+C 停止服务。数据仅在本机保存，服务固定监听回环地址，不要通过反向代理公开到网络。查看成员窗口需要新版 Chrome 或 Edge；其他浏览器仍可使用对话、任务和流程。

### 升级到新版本

先停止看板，把新版本解压到任意新目录，在新目录中运行（第一条只预览）：

```sh
python scripts/upgrade.py 旧目录路径
python scripts/upgrade.py 旧目录路径 --apply
```

升级只替换发布清单里的程序文件，会话、附件、配置和成果保持不变；被替换的文件先备份到旧目录的 `.backups/`，可以一条命令回滚。详见 [使用说明](docs/user-guide.md#停止备份和升级)。

### 安装协作 skill

仅选择你实际使用的客户端。下列命令先预览，再确认写入：

```sh
python scripts/install_skills.py --clients codex claude
python scripts/install_skills.py --clients codex claude --apply
```

安装器生成本机路径，只改安装目标，不把路径写回源码；覆盖内容前保留私人备份。默认目录为 `~/.codex/skills`、`~/.claude/skills`、`~/.zcode/skills`；Codex 支持 `CODEX_HOME`。Reasonix 在 Windows 使用 `%APPDATA%/reasonix/skills`，其他系统必须指定实际目录。任意客户端都可显式指定目标：

```sh
python scripts/install_skills.py --clients reasonix --target reasonix=./my-client-skills --apply
```

这会安装 `agents-talk` 和 `agents-talk-plan`。Claude 执行 skill 附原生 Stop 提醒，不为其他客户端注入 Claude hook。原生客户端发现及执行仍需你实际核对，ZCode 可在其技能设置中确认。

Windows 也可以一条命令安装默认 Codex、Claude、ZCode skill 并创建 agentstalk 桌面图标：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install.ps1
```

自选成员可在 PowerShell 中运行 `& ./scripts/install.ps1 -Clients codex,claude`。`-Preview` 只预览，`-NoShortcut` 不创建图标。双击 `启动看板.cmd` 或桌面图标会复用本目录已有服务，重启电脑后再双击即可；不添加开机自启动。

查看各客户端的安装状态（只读）：`python scripts/install_skills.py --clients codex claude zcode reasonix --status`。已由其他目录安装的 skill 需要确认后加 `--replace-project` 才会改为指向本目录。

卸载只删除该安装器记录且内容未改动的 skill 文件，保留用户修改与其他资源：

```sh
python scripts/install_skills.py --clients codex claude --uninstall
python scripts/install_skills.py --clients codex claude --uninstall --apply
```

自定义安装目录需要使用相同 `--target`。卸载不删除历史、成果、客户端程序或桌面图标，图标可按上文删除。旧安装器创建的无清单文件会跳过，先核对再手动处理。

### 开始一次协作

1. 在面板创建会话，选择主导和本次参与实例，不使用的成员取消勾选。
2. 同客户端多窗口时，点击「管理协作实例」分别创建角色，再复制各实例的「接入说明」。
3. 在每个独立客户端对话中选择实际模型并发送对应说明，看到真实报到和读取记录后再安排工作。
4. 在「现场」为每位成员点「绑定窗口」，在浏览器弹窗里选择该 agent 所在的窗口。窗口可以被遮挡，但不要最小化。
5. 在面板提出需求，或先调用 `agents-talk-plan` 生成分工提示词，再把各段发到对应窗口。

规划示例：`使用 agents-talk-plan：我要做本地资料检索工具，Codex 主导，Claude 协同。请集中确认缺失信息并生成每个实例的启动提示词。`

「流程」视图和对话只显示正式记录；尚未发布的原生客户端内部过程只能在成员画面中看到，不会写入记录。回合停止后需要重新接入，软件不保证后台自动唤醒。

## 开发和分发

```sh
python -m unittest discover -s tests -v
npm ci
npx playwright install chromium
npm test
```

Node 20+ 和 Playwright 只用于浏览器测试。测试使用隔离数据及专用端口，不写正式日志。[开发说明](CONTRIBUTING.md) 包含环境覆盖和项目结构。

**不要直接压缩正在使用的项目目录。** 发布工具仅收录 `release-files.json` 中的确切源码，排除聊天、附件、业务成果、本机配置和备份，并检查个人路径与常见密钥特征。检查方法不能替代人工审查。

```sh
python scripts/maintain.py status
python scripts/maintain.py check --browser
python scripts/maintain.py build
```

版本号、干净副本验证、同步公开仓库和标签触发的草稿 Release 见 [维护与发布流程](docs/maintenance.md)。工具不会自动提交、推送或公开发布。源码包附文件清单及 SHA-256，Release 提供附件校验值。

## 许可证与关联声明

[MIT License](LICENSE)，Copyright (c) 2026 fffssss11。第三方工具与素材说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。客户端名称用于标识互操作对象，本项目不声明得到 OpenAI、Anthropic、Reasonix 或 ZCode 官方授权、支持或背书。
