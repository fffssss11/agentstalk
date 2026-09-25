# 发布与验收

## 当前版本

`0.3.0`，MIT 许可。源码包、Windows 便携包与校验值位于 [GitHub Release](https://github.com/fffssss11/agentstalk/releases/tag/v0.3.0)。

本版让 Windows 用户不必另外安装 Python：新增自带 python.org 官方嵌入式 Python 的便携包；第一次启动时询问是否创建桌面图标；README 与英文版全面重写，界面截图改用隔离演示数据生成。完整变化见 [CHANGELOG](../CHANGELOG.md)，从 0.2.0 升级见 [使用说明](user-guide.md#停止备份和升级)。

## 实际验证

2026-09-25，本机 Windows 11、Python 3.13.5、Node 24.18.0、npm 11.16.0、项目锁定的 Playwright 1.63.0 Chromium：

| 内容 | 结果 |
| --- | --- |
| Python | 142 项测试，141 项通过，1 项因本机无法创建符号链接跳过 |
| 浏览器 | `npm test` 的 5 项辅助函数测试与 browser、flow、instances、activity、workspace 五套回归全部通过 |
| 发布工具 | 精确清单 114 个文件，清单检查与源码隐私审计通过；`maintain.py verify --tests` 在解压后的干净副本中核对哈希、启动空白看板、加载页面资源，并再次通过全部 Python 测试 |
| 便携包 | `verify` 逐字节核对包内运行时与 python.org 原始压缩包（Python 3.13.15），并直接用包内 Python 运行 doctor、skill 安装器和控制面板。另将便携包解压到含中文和空格的路径，在找不到任何系统 Python 的环境中经启动器启动面板，用时 5.0 秒，服务进程为包内 `python.exe`；再次启动复用同一服务；包内 Python 安装的 skill 调用包内 Python，agent 读取正常；`stop.ps1` 正常停止 |
| 首次启动 | 桌面图标与 skill 两个询问由测试直接驱动启动器函数验证：依次出现、各问一次；从 0.2.0 升级的目录补问图标；已有打开本目录的图标时不问；打开另一副本的图标只在确认后替换，原图标先备份；提示中的命令写出实际使用的 Python |
| 界面截图 | README 的截图由 `node tests/preview.cjs` 在临时数据目录生成：模拟成员经 CLI 报到、派发、交付和验收，成员画面是标有「演示画面」的画布；逐张人工检查，不含真实路径、账号或对话 |
| 跨平台 CI | 发布前提交在 Windows、macOS、Ubuntu 与 Python 3.10、3.13 及 Linux Chromium 浏览器测试共 [7 个 job 全部通过](https://github.com/fffssss11/agentstalk/actions/runs/36090706028) |

发布前发现并修复、已加入回归测试的问题：便携包测试文件中的示例邮箱被发布包的隐私扫描拦下（改为运行时拼接）；首次运行提示写死了便携包用户没有的 `python` 命令；`maintain.py bump` 只更新了 README 源码包链接的地址而没有更新链接文字。标签触发的发布工作流新增 Windows 任务，本版是它的第一次运行，结果见 [Actions](https://github.com/fffssss11/agentstalk/actions)；配置本身不代表每次运行已经通过。

测试、截图、便携包实测和干净安装都使用独立目录，没有写入真实协作记录。0.2.0 的验证记录见 [v0.2.0 的发布说明](https://github.com/fffssss11/agentstalk/blob/v0.2.0/docs/release.md)，更早的维护验证见 [2026-09-18 维护报告](maintenance-2026-09-18.md)。

## 交付内容

- 源码 ZIP `agentstalk-0.3.0.zip`，内含 `SOURCE-MANIFEST.json`，记录每个源码文件的 SHA-256。
- Windows 便携包 `agentstalk-0.3.0-windows-x64.zip`：同一份源码加 `runtime/python/` 下原样收录的 python.org 嵌入式 Python 3.13.15；`SOURCE-MANIFEST.json` 另记录运行时的版本、下载地址与 SHA-256。
- 两个 ZIP 各自的校验文件与覆盖全部附件的 `SHA256SUMS.txt`。
- 宣传视频与 6 页介绍 PPT/PDF 沿用 [0.1.0-rc.3](https://github.com/fffssss11/agentstalk/releases/tag/v0.1.0-rc.3) 的附件，展示的是 0.2.0 重构前的界面，本版不重复上传。

发布工具只读取 `release-files.json` 的精确文件，不遍历真实聊天、附件、成果、配置、安装版路径、依赖或备份。同一源码字节生成确定的 ZIP；GitHub 发布工作流在 Linux 上构建两个包，再在 Windows 上重新构建便携包并要求字节一致，上传前再次核对两个 ZIP 与已测试的构建相同。校验值检查文件一致性，不提供作者签名。

## 已知边界

- 首次运行的桌面图标询问、skill 询问和「找不到 Python」提示由测试直接驱动启动器函数验证，未在真实桌面上人工点击；通过 winget 实际下载安装 Python 的步骤未执行。
- 便携包只提供 Windows x64，只在本机 Windows 11 与 GitHub Actions 的 Windows 运行器上验证，未在 ARM64 设备上验证。启动脚本没有代码签名（包内 `python.exe` 带 Python 软件基金会的签名）；从网页下载的 ZIP 如被 Windows 阻止运行脚本，按 [使用说明](user-guide.md#安装与首次启动) 先解除锁定再解压。
- 用管道捕获输出的方式运行 `scripts/launch.ps1 -NoOpen` 时（例如在脚本中读取它的输出），后台服务会继承调用方的输出管道，调用方要等服务停止才返回。双击图标和 `启动看板.cmd` 不受影响，计划在后续修订版修复。
- 查看成员窗口需要新版 Chrome 或 Edge；最小化的窗口会暂停画面。Firefox、Safari 与屏幕阅读器未验证。
- macOS/Linux 桌面启动器只在 CI 上验证生成与脚本语法，未在真实桌面双击，也没有原生安装包。
- 面板只能查看成员窗口，远程控制暂未提供，前提条件见 [维护与发布流程](maintenance.md#预留远程控制)。
- 未覆盖所有原生客户端的 skill 发现、实际模型/API 调用、媒体生成或账户组合。安装文件成功仍需检查实际报到。
- 不提供原生窗口自动创建、真实模型切换或回合停止后的自动唤醒保证。
- 仅面向可信本机，缺少多租户认证、系统沙箱及本地加密。没有第三方安全审计或性能收益基准。
- 介绍 PPT 使用微软雅黑，接收端可能替换字体；PDF 与 MP4 已渲染文字。

## 复现

按 [维护与发布流程](maintenance.md) 与 [发布检查清单](publication-checklist.md) 运行：

```sh
python scripts/maintain.py check --browser
python scripts/maintain.py build --portable
python scripts/maintain.py verify ./dist/release-VERSION/agentstalk-VERSION.zip --tests
python scripts/maintain.py verify ./dist/release-VERSION/agentstalk-VERSION-windows-x64.zip
```

`VERSION` 替换为实际版本。便携包的验证在 Windows 上会直接运行包内 Python。浏览器测试环境见 [贡献指南](../CONTRIBUTING.md)，视频制作见 [分镜与复现](promo/README.md)。`--allow-unlicensed` 仅供未选择许可证的私人候选审阅，公开 CI 与正常发布不使用该参数。
