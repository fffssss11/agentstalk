# 发布与验收

## 当前版本

`0.2.0`，MIT 许可，首个正式版。源码包与校验值位于 [GitHub Release](https://github.com/fffssss11/agentstalk/releases/tag/v0.2.0)。

本版重构网页工作台：成员实时画面、项目与单独会话、事件要点与详情、多套主题；新增桌面图标与首次运行检查，以及维护、原地升级和标签触发的发布工具。完整变化见 [CHANGELOG](../CHANGELOG.md)，从 0.1.0-rc.3 升级见 [使用说明](user-guide.md#停止备份和升级)。

## 实际验证

2026-09-24 至 25 日，本机 Windows 11、Python 3.13.5、Node 24.18.0、npm 11.16.0、项目锁定的 Playwright 1.63.0 Chromium：

| 内容 | 结果 |
| --- | --- |
| Python | 137 项测试，136 项通过，1 项因本机无法创建符号链接跳过 |
| 浏览器 | `npm test` 的 5 项辅助函数测试与 browser、flow、instances、activity、workspace 五套回归全部通过 |
| 发布工具 | 精确清单 108 个文件，清单检查与源码隐私审计通过；`maintain.py verify --tests` 在解压后的干净副本中核对哈希、启动空白看板、加载页面资源，并再次通过全部 Python 测试 |
| 从 GitHub 部署 | 按新用户步骤克隆仓库：`doctor` 通过；`创建桌面图标.cmd` 生成的图标以 Unicode 保存，目标、参数与图标正确；经快捷方式启动面板用时 4.1 秒，再次启动复用同一服务，`stop.ps1` 正常停止；部署目录自带的 Python 与浏览器测试全部通过 |
| 协作全流程 | 部署版本连接隔离数据，模拟三名成员完成报到、派发、认领、交付和独立验收；面板实时显示每次事件，人工消息送达全部成员 |
| 成员画面 | 用 Chromium 自动选择一个真实桌面窗口完成绑定，画面状态为「实时」且内容持续变化；无界面浏览器无法捕获桌面窗口 |
| 升级 | 0.1.0-rc.3 源码包安装的目录原地升级后，旧页面文件移除、新界面可用、原有消息保留；可回滚 |
| 跨平台 CI | 发布前提交在 Windows、macOS、Ubuntu 与 Python 3.10、3.13 及 Linux Chromium 浏览器测试共 [7 个 job 全部通过](https://github.com/fffssss11/agentstalk/actions/runs/36025846162) |

CI 与部署实测中发现的问题已在发布前修复并加入回归测试：英文版 Windows 上中文目录的桌面图标丢失字符、Python 位于中文路径时启动器读到乱码、测试中的临时路径别名比较，以及一处浏览器测试时序。最终提交的 CI 与发布工作流运行记录见 [Actions](https://github.com/fffssss11/agentstalk/actions)；配置本身不代表每次运行已经通过。

测试、截图、部署实测和干净安装都使用独立目录，没有写入真实协作记录。0.2.0 之前的维护验证见 [2026-09-18 维护报告](maintenance-2026-09-18.md)，更早版本的记录见对应的 Release 页面。

## 交付内容

- 源码 ZIP `agentstalk-0.2.0.zip`，内含 `SOURCE-MANIFEST.json`，记录每个源码文件的 SHA-256。
- ZIP 独立校验文件与覆盖全部附件的 `SHA256SUMS.txt`。
- 宣传视频与 6 页介绍 PPT/PDF 沿用 [0.1.0-rc.3](https://github.com/fffssss11/agentstalk/releases/tag/v0.1.0-rc.3) 的附件，展示的是重构前的界面，本版不重复上传。

发布工具只读取 `release-files.json` 的精确文件，不遍历真实聊天、附件、成果、配置、安装版路径、依赖或备份。同一源码字节生成确定的 ZIP，GitHub 发布工作流会重新构建并核对与已测试的构建字节一致。校验值检查文件一致性，不提供作者签名。

## 已知边界

- 首次运行的 skill 询问和「找不到 Python」提示由测试直接驱动启动器函数验证，未在真实桌面上人工点击；通过 winget 实际下载安装 Python 的步骤未执行。
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
python scripts/maintain.py build
python scripts/maintain.py verify ./dist/release-VERSION/agentstalk-VERSION.zip --tests
```

`VERSION` 替换为实际版本。浏览器测试环境见 [贡献指南](../CONTRIBUTING.md)，视频制作见 [分镜与复现](promo/README.md)。`--allow-unlicensed` 仅供未选择许可证的私人候选审阅，公开 CI 与正常发布不使用该参数。
