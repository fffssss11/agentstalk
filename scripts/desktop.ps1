param(
    [string]$Name = 'agentstalk',
    [string]$Desktop = [Environment]::GetFolderPath('Desktop'),
    [switch]$Remove
)
# Creates or removes the desktop icon that starts this folder's panel. No Python is needed here:
# the launcher checks Python, offers first-run setup and then opens the panel.
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'launch.vbs'
$shortcutPath = Join-Path $Desktop ($Name + '.lnk')
$arguments = '"' + $launcher + '"'
# IShellLinkW keeps every character of the folder path. WScript.Shell shortcuts lose characters outside
# the system code page, for example a Chinese folder name on English Windows.
$source = @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
namespace AgentsTalk {
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")] internal class CShellLink { }
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
    internal interface IShellLinkW {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int size, IntPtr data, int flags);
        void GetIDList(out IntPtr list);
        void SetIDList(IntPtr list);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder folder, int size);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string folder);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder text, int size);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string text);
        void GetHotkey(out short key);
        void SetHotkey(short key);
        void GetShowCmd(out int command);
        void SetShowCmd(int command);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int size, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, int reserved);
        void Resolve(IntPtr window, int flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
    }
    public static class ShellLink {
        public static void Save(string link, string target, string arguments, string folder, string description, string icon) {
            var shortcut = (IShellLinkW)new CShellLink();
            shortcut.SetPath(target);
            shortcut.SetArguments(arguments);
            shortcut.SetWorkingDirectory(folder);
            shortcut.SetDescription(description);
            shortcut.SetIconLocation(icon, 0);
            ((IPersistFile)shortcut).Save(link, true);
        }
        public static string[] Read(string link) {
            var shortcut = (IShellLinkW)new CShellLink();
            ((IPersistFile)shortcut).Load(link, 0);
            var arguments = new StringBuilder(32768);
            var folder = new StringBuilder(32768);
            shortcut.GetArguments(arguments, arguments.Capacity);
            shortcut.GetWorkingDirectory(folder, folder.Capacity);
            return new[] { arguments.ToString(), folder.ToString() };
        }
    }
}
'@
$native = $true
try { if (-not ('AgentsTalk.ShellLink' -as [type])) { Add-Type -TypeDefinition $source } } catch { $native = $false }

function Read-Shortcut([string]$Path) {
    if ($native) { $parts = [AgentsTalk.ShellLink]::Read($Path); return @{ Arguments = $parts[0]; Folder = $parts[1] } }
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($Path)
    return @{ Arguments = $link.Arguments; Folder = $link.WorkingDirectory }
}

if (Test-Path -LiteralPath $shortcutPath) {
    $existing = Read-Shortcut $shortcutPath
    $ours = $existing.Arguments -eq $arguments
    if ($Remove) {
        if (-not $ours) { throw "桌面上的 $Name 图标启动的是其他目录（$($existing.Folder)），未删除。" }
        Remove-Item -LiteralPath $shortcutPath
        Write-Output "已删除桌面图标：$shortcutPath"
        return
    }
    if (-not $ours) {
        # Another copy of agentstalk owned this icon; keep it so the change can be undone.
        $backup = Join-Path $projectRoot ('.backups\shortcuts\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
        Copy-Item -LiteralPath $shortcutPath -Destination $backup
        Write-Output "原图标启动的是 $($existing.Folder)，已备份到 $backup"
    }
} elseif ($Remove) {
    Write-Output "桌面上没有 $Name 图标。"
    return
}
New-Item -ItemType Directory -Path $Desktop -Force | Out-Null
$target = Join-Path $env:WINDIR 'System32\wscript.exe'
$description = '启动 agentstalk 本地协作控制面板'
$icon = Join-Path $PSScriptRoot 'agentstalk.ico'
if ($native) {
    [AgentsTalk.ShellLink]::Save($shortcutPath, $target, $arguments, $projectRoot, $description, $icon)
} else {
    if ($projectRoot -match '[^\x00-\x7F]') { Write-Warning '无法使用 Unicode 快捷方式接口；目录名含非英文字符时，图标可能无法启动。' }
    $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $target
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.Description = $description
    $shortcut.IconLocation = $icon + ',0'
    $shortcut.Save()
}
Write-Output "已创建桌面图标：$shortcutPath"
Write-Output '双击它会检查 Python、首次运行时询问是否安装协作技能，然后打开控制面板。'
