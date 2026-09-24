param(
    [string[]]$Clients = @('codex', 'claude', 'zcode'),
    [switch]$NoShortcut,
    [switch]$Preview
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'python.ps1')
$pythonExe = Find-AgentsTalkPython
$arguments = @((Join-Path $PSScriptRoot 'install_skills.py'), '--clients') + $Clients
if (-not $Preview) { $arguments += '--apply' }
& $pythonExe @arguments
if ($LASTEXITCODE -ne 0) { throw 'Skill installation failed; inspect the message above.' }
if ($Preview) { return }
$pythonExe | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'python-path.txt') -Encoding UTF8
if (-not $NoShortcut) { & (Join-Path $PSScriptRoot 'desktop.ps1') }
