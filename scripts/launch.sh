#!/bin/sh
# Desktop launcher for macOS and Linux: find Python 3.10+, ask about skills on the first run, then run
# the panel in this terminal window. Closing the window or pressing Ctrl+C stops it.
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd) || exit 1
cd "$root" || exit 1
wait_key() { printf '%s' "$1"; read -r _ || true; }
python=
for candidate in "${AGENTS_TALK_PYTHON:-}" python3 python; do
  [ -n "$candidate" ] && command -v "$candidate" >/dev/null 2>&1 || continue
  if "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
    python=$candidate
    break
  fi
done
if [ -z "$python" ]; then
  echo '没有找到 Python 3.10 或更高版本，agentstalk 需要它才能运行。'
  case "$(uname -s)" in
    Darwin) echo '请从 https://www.python.org/downloads/macos/ 安装，或运行 brew install python，然后重新双击图标。' ;;
    *) echo '请用系统包管理器安装，例如 sudo apt install python3 或 sudo dnf install python3，然后重新双击图标。' ;;
  esac
  wait_key '按回车键关闭…'
  exit 1
fi
# First-run questions are asked once each; one added later (the launcher) is still asked after an upgrade.
setup=.runtime/setup.json
if ! grep -qs '"shortcut"' "$setup" && [ -t 0 ] && [ "$(sh scripts/desktop.sh --status 2>/dev/null)" != ours ]; then
  printf '是否在桌面创建 agentstalk 启动器？以后双击它就能打开控制面板。[y/N] '
  read -r answer || answer=
  case $answer in [yY]*) sh scripts/desktop.sh ;; esac
fi
if ! grep -qs '"skills"' "$setup"; then
  "$python" scripts/install_skills.py --clients codex claude zcode reasonix --setup
fi
mkdir -p .runtime && printf '{"skills": "asked", "shortcut": "asked"}\n' > "$setup"
echo 'agentstalk 控制面板正在启动；关闭此窗口或按 Ctrl+C 即停止。'
"$python" start.py || wait_key '控制面板已退出，按回车键关闭…'
