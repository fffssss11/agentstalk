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
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutPath) {
    $existing = $shell.CreateShortcut($shortcutPath)
    $ours = $existing.Arguments -eq ('"' + $launcher + '"')
    if ($Remove) {
        if (-not $ours) { throw "桌面上的 $Name 图标启动的是其他目录（$($existing.WorkingDirectory)），未删除。" }
        Remove-Item -LiteralPath $shortcutPath
        Write-Output "已删除桌面图标：$shortcutPath"
        return
    }
    if (-not $ours) {
        # Another copy of agentstalk owned this icon; keep it so the change can be undone.
        $backup = Join-Path $projectRoot ('.backups\shortcuts\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
        Copy-Item -LiteralPath $shortcutPath -Destination $backup
        Write-Output "原图标启动的是 $($existing.WorkingDirectory)，已备份到 $backup"
    }
} elseif ($Remove) {
    Write-Output "桌面上没有 $Name 图标。"
    return
}
New-Item -ItemType Directory -Path $Desktop -Force | Out-Null
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + $launcher + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = '启动 agentstalk 本地协作控制面板'
$shortcut.IconLocation = (Join-Path $PSScriptRoot 'agentstalk.ico') + ',0'
$shortcut.Save()
Write-Output "已创建桌面图标：$shortcutPath"
Write-Output '双击它会检查 Python、首次运行时询问是否安装协作技能，然后打开控制面板。'
