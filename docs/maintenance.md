# 维护与发布流程

[返回快速开始](../README.md) · [发布说明](release.md) · [公开发布检查](publication-checklist.md) · [参与开发](../CONTRIBUTING.md)

本页是维护者的唯一操作流程：日常维护、版本号、构建、验证、同步公开仓库和发布。隐私与材料审阅的具体条目见 [公开发布检查](publication-checklist.md)，每个版本的实测结果写在 [发布说明](release.md)，用户侧的升级与回滚见 [使用说明](user-guide.md#停止备份和升级)。

## 三个位置

| 位置 | 用途 | 规则 |
| --- | --- | --- |
| 私人工作目录 | 开发、真实协作、私人证据 | 不是 Git 仓库；禁止整体压缩或提交 |
| 公开克隆，例如 `.runtime/github-publish/agentstalk` | 只含发布清单文件的 Git 工作区 | 由 `maintain.py sync` 更新并暂存，提交、打标签和推送由你执行 |
| GitHub | 代码、CI、Release | 推送 `v*` 标签后工作流只生成草稿，你审阅后再发布 |

所有发布内容只来自 `release-files.json`。`scripts/build_release.py` 拒绝私人路径、运行数据和常见密钥特征；`scripts/audit_public.py` 检查源码、Git 追踪清单、提交邮箱和附件。两者都是模式检查，不能代替人工审阅。

## 工具

| 命令 | 作用 | 写入 |
| --- | --- | --- |
| `python scripts/maintain.py status` | 清单缺漏、未登记的新源码、版本号与发布页是否一致，以及自最近一次构建以来的文件变化 | 只读 |
| `python scripts/maintain.py check [--browser]` | 全部发布关卡：隔离 doctor、Python 测试、清单、隐私扫描、JS 语法；`--browser` 加跑 Playwright | 仅临时目录 |
| `python scripts/maintain.py bump 版本号 [--apply]` | 同步 `VERSION`、`package.json`、lockfile、README 的版本与源码包链接，把 CHANGELOG「Unreleased」定为该版本 | 默认预览 |
| `python scripts/maintain.py notes [版本号]` | 从 CHANGELOG 输出发布说明 | 只读 |
| `python scripts/maintain.py build [--portable]` | 生成 `dist/release-版本号/`：源码 ZIP、`.sha256`、`SHA256SUMS.txt`、`RELEASE-NOTES.md`；加 `--portable` 同时生成自带 Python 的 Windows 便携包 | 写 `dist/`，拒绝覆盖 |
| `python scripts/maintain.py sums 目录` | 向发布目录追加 PPT、PDF、视频等附件后重算校验值 | 写该目录 |
| `python scripts/maintain.py verify ZIP [--tests]` | 解压到临时目录，核对清单与哈希、隐私扫描、doctor、实际启动与空白看板 | 仅临时目录 |
| `python scripts/maintain.py sync 公开克隆 [--apply]` | 把清单文件镜像到公开克隆并暂存，删除已退出清单的追踪文件，运行 `audit_public.py --tracked` | 默认预览，不提交 |
| `python scripts/upgrade.py 旧目录` | 用户从发布包原地升级，含备份与回滚 | 默认预览 |
| `python scripts/make_icons.py [--check]` | 按面板图标重新生成桌面图标；`--check` 只核对已提交的图标是否一致 | 写 `scripts/agentstalk.*` |

`maintain.py` 不提交、不打标签、不推送、不上传。

## 日常维护

1. 修改后按 [参与开发](../CONTRIBUTING.md) 运行相应测试，界面变化检查桌面与窄屏。
2. 在 CHANGELOG「Unreleased」记录用户能感知的变化，写实际行为，不写计划。
3. 新增维护文件加入 `release-files.json`，保持按字母排序。`maintain.py status` 会列出源码目录中未登记的文件；私人或临时文件应放到 `workspace/`、`.runtime/` 等被排除的位置。
4. 协作规则变化只改 `PROTOCOL.md`，其他文档链接过去。
5. Dependabot 每周检查 npm 与 GitHub Actions。Actions 固定到提交 SHA，升级 PR 通过 CI 后再合并；`playwright` 由 lockfile 锁定，只用于测试。

## 版本号

采用 `主版本.次版本.修订号`，需要外部试用时加 `-rc.N`。修复为修订号；新功能或界面调整为次版本；需要用户迁移数据或协议不兼容时为主版本（`0.x` 期间可用次版本，但 CHANGELOG 必须写明迁移方式）。

标签固定为 `v` 加 `VERSION` 的内容，例如 `v0.3.0`。带 `-` 的版本由工作流自动标成 pre-release。已发布的标签不再移动；发布后发现问题，发布新的修订号。

## 发布步骤

1. `python scripts/maintain.py status`，确认清单一致，对照文件变化补全 CHANGELOG。
2. `python scripts/maintain.py check --browser`。
3. `python scripts/maintain.py bump 0.3.0` 预览，确认后加 `--apply`。
4. 手动更新 [发布说明](release.md)：当前版本、实际执行的命令与结果、未验证的平台和已知边界。`status` 在三个版本页都写明新版本前会报错。
5. 版本变化后再运行一次 `python scripts/maintain.py check --browser`。
6. `python scripts/maintain.py build --portable`，然后分别验证两个包：`python scripts/maintain.py verify dist/release-0.3.0/agentstalk-0.3.0.zip --tests` 与 `python scripts/maintain.py verify dist/release-0.3.0/agentstalk-0.3.0-windows-x64.zip`。在 Windows 上验证便携包时，会直接用包内的 Python 运行 doctor、skill 安装器和控制面板，并逐字节核对包内运行时与 python.org 的原始压缩包。
7. 按 [公开发布检查](publication-checklist.md) 完成三轮人工审阅，包括截图、演示材料和附件。
8. 同步公开克隆：

   ```sh
   git -C .runtime/github-publish/agentstalk pull --ff-only
   python scripts/maintain.py sync .runtime/github-publish/agentstalk
   python scripts/maintain.py sync .runtime/github-publish/agentstalk --apply
   git -C .runtime/github-publish/agentstalk diff --cached
   ```

9. 审阅暂存差异后，由你提交、打标签并推送：

   ```sh
   git -C .runtime/github-publish/agentstalk commit -m "Release 0.3.0"
   git -C .runtime/github-publish/agentstalk tag -a v0.3.0 -m "Agents Talk 0.3.0"
   git -C .runtime/github-publish/agentstalk push origin HEAD v0.3.0
   ```

10. GitHub Actions「Release」依次核对标签与 `VERSION`、运行全部测试和浏览器测试，在 Linux 上构建并验证源码包和便携包；再在真实的 Windows 机器上重新构建便携包，要求与 Linux 构建字节一致，并用包内 Python 实际启动。最后在只有写权限的独立任务中重新构建，确认两个 ZIP 的 SHA-256 与已测试的构建一致，再创建草稿 Release。
11. 在 GitHub 草稿中核对说明和附件。需要附加演示材料时，先放进本地 `dist/release-0.3.0/`，运行 `python scripts/maintain.py sums dist/release-0.3.0` 重算校验值，再上传材料并替换校验文件：`gh release upload v0.3.0 材料文件 dist/release-0.3.0/SHA256SUMS.txt --clobber`。确认后点 Publish。
12. 发布后下载附件核对校验值，把 CI 运行链接补进下一版的发布说明。

构建可复现：同一源码在本机与 CI 生成的 ZIP 字节相同，可直接比较 `SHA256SUMS.txt`。

## Windows 便携包与内置 Python

便携包 = 发布清单中的源码 + `runtime/python/` 下的 python.org 官方嵌入式 Python。版本、下载地址和 SHA-256 固定在 `scripts/portable.py` 的 `PYTHON_VERSION`、`RUNTIME_URL`、`RUNTIME_SHA256`。构建时下载一次到 `.runtime/cache/`，每次使用前都重新校验；运行时文件原样收录，不作修改。

- 更新内置 Python：从 `https://www.python.org/api/v2/downloads/release_file/` 取得新版本嵌入式包（`embed-amd64.zip`）的 `sha256_sum`，更新上面三个常量，运行 `python scripts/maintain.py build --portable` 与 `verify`。只选择仍发布二进制安装包的 Python 版本，并保持与 CI 测试的版本系列一致。
- Python 发布安全修复时，应随之发布 agentstalk 修订版，让便携包用户通过升级获得修复。
- 嵌入式 Python 以隔离模式运行：不会把脚本所在目录加入 `sys.path`，也忽略 `PYTHONUTF8` 等环境变量，并且不含 `tkinter`、`venv`。程序代码需要显式加入导入路径、显式使用 UTF-8；`verify` 在 Windows 上会实际运行包内 Python 来发现这类问题。
- 升级时，便携包会替换包内 Python，源码包则保留已有的内置 Python；正在运行的内置 Python 不能升级它自己，请用新版本目录里的 `runtime\python\python.exe` 运行升级脚本。

## 失败与回退

- 草稿阶段 CI 失败：修复后，如草稿从未发布，可删除草稿和远端标签（`gh release delete v0.3.0 --cleanup-tag`）再重新打标签；已发布的版本不移动标签，改发修订号。
- 发布后发现严重问题：尽快发布修订版，在旧 Release 说明中标注问题和替代版本，不删除用户可能已校验的附件。
- 发现泄露的密钥：先撤销或轮换，再按 [公开发布检查](publication-checklist.md) 处理仓库和历史。
- 用户升级失败：`upgrade.py` 在写入前备份所有被替换或移除的文件，`--rollback` 可恢复，见 [使用说明](user-guide.md#停止备份和升级)。

## 兼容约定

- `board.jsonl` 只追加，旧事件必须继续可读；新增字段要兼容旧记录，损坏时报告行号而不是静默跳过。
- `.library.json` 记录项目与会话整理，带 `version` 字段，损坏时面板暂停整理写入并保留原文件。格式变化由 `hub.py` 读取时迁移，不交给升级脚本处理。
- 界面偏好保存在浏览器 `agents-talk.*` 本地存储中；改名时要兼容旧值或回到默认值。
- `upgrade.py` 只替换发布清单中的程序文件，永远不改配置、记录、附件、业务目录、已安装的 skill 和备份。数据迁移必须由程序在读取时完成。

## 公开仓库一次性设置

- 启用私密漏洞报告，保持 SECURITY.md 中的入口有效。
- Actions 默认工作流权限设为只读；发布工作流只在创建草稿的任务中申请 `contents: write`。
- 为 `main` 设置分支保护，要求「Validate」通过；为 `v*` 标签设置规则，限制创建与删除。
- 仓库提交身份使用 GitHub 隐私邮箱，只在公开克隆中配置，不修改全局 Git 身份。

## 预留：远程控制

当前版本只在本机面板里查看成员窗口：画面来自浏览器的窗口共享，不录制、不上传、不发送给 agent，也不发送任何键盘或鼠标输入。服务仍只监听回环地址。

远程控制暂不实现。如果以后增加，必须满足以下前提后再合入：

- 由独立的本机助手进程实现，不扩大网页服务的监听范围。
- 每个会话、每个窗口都需要人明确授权，面板持续显示控制中状态，可随时收回。
- 控制事件单独记录可审计，不混入 agent 对话日志。
- 同步更新 PROTOCOL.md、SECURITY.md 和本页，并补充隔离测试。
