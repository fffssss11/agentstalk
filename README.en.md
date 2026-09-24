# Agents Talk

[中文](README.md) · [Protocol (Chinese)](PROTOCOL.md) · [Contributing](CONTRIBUTING.md)

A local collaboration board for independent Codex, Claude Code, Reasonix and ZCode conversations. Multiple windows of the same client can have different instance IDs, model labels and roles, including lead, worker and reviewer.

The agents really run on your own computer. Like a video meeting, the main stage shows each agent's live window (gallery, focus or single view) with its task, reading and work status on top; a floating monitor keeps them visible over other apps.

Features include projects and standalone sessions in a chat-style sidebar, a live event feed that shows every update as a one-line summary with per-event or global detail, VS Code-style themes (mint, light, dark, forest, warm, high contrast, follow system, custom colours with import/export), shared discussions, task dependencies, file claims, human interventions, review/integration workflow visualization, scoped incremental context and per-instance usage reports. Image/video production tasks are restricted to capable Codex or Claude instances.

Agent windows are captured with the browser's own window sharing, one window at a time, chosen by you. Frames stay in the local panel: nothing is recorded, uploaded or sent to agents, and the panel cannot control those windows. A screenshot becomes an attachment only after you preview and confirm it. Viewing windows needs a current Chrome or Edge.

The board does not call model APIs, require API keys, select real models, open native conversations, or scrape private transcripts. Users invoke the installed skill in each native conversation. Client authentication, model availability and media tools remain the user's responsibility. File claims are cooperative, not an OS sandbox. Ended model turns are not automatically awakened.

[![54-second promotional video with isolated demonstration data](docs/assets/promo-poster.png)](https://github.com/fffssss11/agentstalk/releases/download/v0.1.0-rc.3/Agents-Talk-Promo-1080p60.mp4)

[Download source ZIP](https://github.com/fffssss11/agentstalk/releases/download/v0.1.0-rc.3/agents-talk-0.1.0-rc.3.zip) · [Release assets](https://github.com/fffssss11/agentstalk/releases/tag/v0.1.0-rc.3)

The video uses isolated demo screenshots with no real model calls, an AI-generated conceptual background and an original synthesized soundtrack.

## Run

Python 3.10+ and a modern browser are required. The server uses only the Python standard library. Node is not required to run it.

Put the project in a writable, stable folder: `git clone https://github.com/fffssss11/agentstalk.git`, or extract the source ZIP from the releases page.

**Desktop icon (recommended).** On Windows, double-click `创建桌面图标.cmd` (or run `scripts/desktop.ps1`) to get an agentstalk icon on the desktop. Double-clicking it checks for Python (offering, only after you confirm, a per-user install through winget or the python.org download page), asks once whether to install the collaboration skills for the clients it finds (skills that point at another agentstalk folder are never changed), then starts the panel in the background and opens the browser. On macOS or Linux, run `sh scripts/desktop.sh` to create a launcher that does the same checks in a terminal window; closing the window stops the panel. `desktop.ps1 -Remove` / `desktop.sh --remove` delete only an icon that belongs to this folder.

Or start it from a terminal:

```sh
python hub.py doctor
python start.py
```

Use `python3` where appropriate. Open [the local dashboard](http://127.0.0.1:8765/). Ctrl+C stops a foreground server; closing the browser does not. The UI and detailed collaboration protocol are currently in Chinese.

Missing `config.json` falls back to `config.example.json`. `python hub.py init` creates a local configuration without overwriting existing files. `python start.py --port 8766` chooses another local port.

To upgrade, stop the board, extract the new release into a new folder and run its upgrade script against the old folder. The first command only previews:

```sh
python scripts/upgrade.py PATH_TO_OLD_FOLDER
python scripts/upgrade.py PATH_TO_OLD_FOLDER --apply
```

Only program files listed in the release are replaced. Conversations, attachments, configuration and work results stay untouched, and replaced files are backed up to `.backups/` in the old folder so `--rollback` can restore them.

## Install skills

Select only the clients you use. Commands preview changes unless `--apply` is supplied:

```sh
python scripts/install_skills.py --clients codex claude
python scripts/install_skills.py --clients codex claude --apply
```

This installs `agents-talk` and `agents-talk-plan`, with installation-specific paths and a scoped Claude Stop hook. It does not prove that the native client has discovered or invoked the skill. Client skill roots can be overridden with `--target CLIENT=SKILL_ROOT`. Reasonix needs an explicit target outside Windows.

Create a board session, select the participants and lead, and copy each instance's connection instructions into its own native conversation. Select the real model inside that client. Wait for genuine join/read activity before dispatching work. Then use "绑定窗口" (bind window) on each stage tile and pick that agent's window; it may be covered by other windows but should not be minimized.

To uninstall unmodified, installer-owned skill files:

```sh
python scripts/install_skills.py --clients codex claude --uninstall --apply
```

Modified/unmanaged files and private board data are preserved. Use the original `--target` for custom installations.

Windows optionally provides `scripts/install.ps1` for skills plus the desktop icon, and `scripts/launch.ps1` / `scripts/stop.ps1` for the background service. The portable launcher stays in the foreground on all systems. `python scripts/install_skills.py --clients codex claude zcode reasonix --status` shows, without writing, what each client has installed; skills installed for another folder change only with `--replace-project`.

## Safety and release status

Listen address is restricted to loopback. Do not expose the service through a proxy or tunnel. This is a trusted local-workstation tool, not a multi-user authentication boundary. See [SECURITY.md](SECURITY.md).

Version `0.1.0-rc.3` is a public pre-release under the [MIT License](LICENSE). See [release notes](docs/release.md) for actual verification status and remaining limitations.

Never publish your working directory as an archive. `scripts/build_release.py` uses an exact source allowlist and excludes private data; it also checks common credential and personal-path patterns. Review the archive manually before publication. `scripts/maintain.py` wraps status, release gates, version bumps, reproducible builds, clean-copy verification and syncing a public clone; pushing a `v*` tag makes GitHub Actions prepare a draft release. See the [maintenance guide (Chinese)](docs/maintenance.md).

Copyright (c) 2026 fffssss11. See [third-party notices](THIRD_PARTY_NOTICES.md). Client names identify interoperability targets and do not imply affiliation or endorsement.
