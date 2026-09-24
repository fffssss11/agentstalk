#!/bin/sh
# Create (or with --remove, delete) the agentstalk desktop launcher on macOS or Linux.
# Usage: sh scripts/desktop.sh [--remove]
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case $root in
  *'"'* | *'\'* | *'$'* | *'`'*) echo "目录路径含有引号、反斜杠、\$ 或反引号，无法生成启动器：$root" >&2; exit 1 ;;
esac
if [ "$(uname -s)" = Darwin ]; then
  desktop=$HOME/Desktop
  launcher=$desktop/agentstalk.command
else
  desktop=$(xdg-user-dir DESKTOP 2>/dev/null || true)
  [ -n "$desktop" ] || desktop=$HOME/Desktop
  launcher=$desktop/agentstalk.desktop
fi
if [ "${1:-}" = --remove ]; then
  if [ -f "$launcher" ] && grep -qF "$root/scripts/launch.sh" "$launcher"; then
    rm -f "$launcher"
    echo "已删除桌面启动器：$launcher"
  else
    echo '桌面上没有属于本目录的启动器。'
  fi
  exit 0
fi
mkdir -p "$desktop"
if [ "$(uname -s)" = Darwin ]; then
  printf '#!/bin/sh\nexec sh "%s/scripts/launch.sh"\n' "$root" > "$launcher"
else
  cat > "$launcher" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=agentstalk
Comment=Start the local Agents Talk panel
Exec=sh "$root/scripts/launch.sh"
Icon=$root/scripts/agentstalk.png
Terminal=true
Categories=Development;
EOF
  # GNOME asks before running a new desktop file; mark it trusted when gio is available.
  if command -v gio >/dev/null 2>&1; then gio set "$launcher" metadata::trusted true 2>/dev/null || true; fi
fi
chmod +x "$launcher"
echo "已创建桌面启动器：$launcher"
echo '双击它会检查 Python、首次运行时询问是否安装协作技能，然后打开控制面板。'
