param([switch]$NoOpen, [ValidateRange(1,65535)][int]$Port = 8765)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $projectRoot '.runtime'
New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
$serverStem = if ($Port -eq 8765) { 'server' } else { 'server-' + $Port }
$expectedVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'VERSION') -Raw).Trim()
# A double-click is interactive; -NoOpen is the automation mode and never shows dialogs.
$interactive = -not $NoOpen
# Python prints UTF-8; read it as UTF-8 so folder names and messages keep their characters.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$launchMutex = New-Object System.Threading.Mutex($false, ('Local\AgentsTalkDashboard' + $Port))
$acquired = $false
$serverProcess = $null
$isReady = $false

function Show-Message([string]$Text, [string]$Buttons = 'OK', [string]$Icon = 'Information') {
    Add-Type -AssemblyName PresentationFramework
    return [string][System.Windows.MessageBox]::Show($Text, 'agentstalk', $Buttons, $Icon)
}

function Invoke-Native([string]$Program, [string[]]$Arguments, [switch]$StdoutOnly) {
    # Windows PowerShell turns native stderr into terminating errors under 'Stop'.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if ($StdoutOnly) { return ((& $Program @Arguments 2>$null) | Out-String) }
        return ((& $Program @Arguments 2>&1) | Out-String)
    } finally { $ErrorActionPreference = $previous }
}

function Get-Python {
    # Returns $null when the person chose to install Python later.
    . (Join-Path $PSScriptRoot 'python.ps1')
    try { return Find-AgentsTalkPython } catch { if (-not $interactive) { throw } }
    $intro = "没有找到 Python 3.10 或更高版本，agentstalk 需要它才能运行。`n`n"
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if ($winget) {
        $answer = Show-Message ($intro + "是：用 Windows 自带的 winget 为当前用户安装 Python 3.13（需要联网，并同意 Python 的许可条款）`n否：打开 Python 官网下载页，安装后再双击图标`n取消：暂不处理") 'YesNoCancel' 'Question'
    } else {
        $answer = if ((Show-Message ($intro + '是否打开 Python 官网下载页？安装后再双击图标。') 'YesNo' 'Question') -eq 'Yes') { 'No' } else { 'Cancel' }
    }
    if ($answer -eq 'No') { Start-Process 'https://www.python.org/downloads/windows/' }
    if ($answer -ne 'Yes') { return $null }
    $install = Start-Process -FilePath $winget.Source -Wait -PassThru -ArgumentList @(
        'install', '--id', 'Python.Python.3.13', '--exact', '--scope', 'user', '--accept-package-agreements', '--accept-source-agreements')
    # Pick up the installer's PATH change without signing out.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    try { return Find-AgentsTalkPython } catch {
        throw "Python 安装没有完成（winget 退出码 $($install.ExitCode)）。请从 https://www.python.org/downloads/ 安装后再双击图标。"
    }
}

function Invoke-FirstRunSetup([string]$PythonPath) {
    # Asked once per folder. Skills that belong to another folder are reported, never replaced.
    $marker = Join-Path $runtimePath 'setup.json'
    if (-not $interactive -or (Test-Path -LiteralPath $marker)) { return }
    $installer = Join-Path $PSScriptRoot 'install_skills.py'
    $report = Invoke-Native $PythonPath @($installer, '--clients', 'codex', 'claude', 'zcode', 'reasonix', '--status') -StdoutOnly | ConvertFrom-Json
    $names = @{ codex = 'Codex'; claude = 'Claude Code'; zcode = 'ZCode'; reasonix = 'Reasonix' }
    $ready = @()
    $notes = @()
    foreach ($client in @('codex', 'claude', 'zcode', 'reasonix')) {
        $row = $report.clients.$client
        if (-not $row -or -not $row.detected) { continue }
        if ($row.state -in @('missing', 'outdated')) { $ready += $client }
        elseif ($row.state -eq 'other') { $notes += "$($names[$client])：协作技能指向另一个目录 $($row.project)，本次不改动。" }
        elseif ($row.state -eq 'unmanaged') { $notes += "$($names[$client])：$($row.target) 已有其他来源的同名技能，本次不改动。" }
    }
    $outcome = 'nothing-to-install'
    if ($ready.Count) {
        $list = ($ready | ForEach-Object { '  ' + $names[$_] + ' → ' + $report.clients.$_.target }) -join "`n"
        $text = "首次运行：可以为这些客户端安装 agentstalk 协作技能，之后在客户端的新对话中调用 agents-talk 即可接入。`n`n$list"
        if ($notes.Count) { $text += "`n`n" + ($notes -join "`n") }
        if ((Show-Message ($text + "`n`n现在安装吗？") 'YesNo' 'Question') -eq 'Yes') {
            $output = Invoke-Native $PythonPath (@($installer, '--clients') + $ready + @('--apply'))
            if ($LASTEXITCODE -eq 0) {
                $outcome = 'installed'
                Show-Message ('已安装：' + (($ready | ForEach-Object { $names[$_] }) -join '、')) | Out-Null
            } else {
                $outcome = 'failed'
                Show-Message ("协作技能没有安装成功，控制面板仍会启动：`n`n" + $output.Trim()) 'OK' 'Warning' | Out-Null
            }
        } else { $outcome = 'declined' }
    } elseif ($notes.Count) {
        Show-Message ("首次运行检查：`n`n" + ($notes -join "`n") + "`n`n如需改用本目录，请运行：`npython scripts\install_skills.py --clients <客户端> --replace-project --apply") | Out-Null
    }
    @{ skills = $outcome; clients = $ready; checked = (Get-Date).ToString('s') } | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding UTF8
}

function Get-StartupProblem([string]$PythonPath) {
    $message = '控制面板启动失败。'
    try {
        $doctor = Invoke-Native $PythonPath @((Join-Path $projectRoot 'hub.py'), 'doctor') -StdoutOnly | ConvertFrom-Json
        $failed = @($doctor.checks | Where-Object { -not $_.ok } | ForEach-Object { $_.name + '：' + $_.detail })
        if ($failed.Count) { $message += "`n`n环境检查发现：`n" + ($failed -join "`n") }
    } catch { }
    return $message + "`n`n详细日志：.runtime\" + $serverStem + '-error.log'
}

try {
    try { $acquired = $launchMutex.WaitOne(20000) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }
    if (-not $acquired) { throw '另一个启动过程仍在进行，请稍候再试。' }
    $panelUrl = 'http://127.0.0.1:' + $Port + '/'
    $dataPath = if ($env:AGENTS_TALK_DATA) { [IO.Path]::GetFullPath($env:AGENTS_TALK_DATA) } else { $projectRoot }
    if ($dataPath -ne [IO.Path]::GetPathRoot($dataPath)) { $dataPath = $dataPath.TrimEnd([char[]]'\/') }
    $configPath = if ($env:AGENTS_TALK_CONFIG) { [IO.Path]::GetFullPath($env:AGENTS_TALK_CONFIG) } else { Join-Path $projectRoot 'config.json' }
    $probe = $null
    try { $probe = Invoke-RestMethod -Uri ($panelUrl + 'api/health') -TimeoutSec 2 } catch { }
    if ($probe) {
        if ($probe.app -eq 'agents-talk' -and $probe.version -eq 2 -and $probe.root -eq $projectRoot -and $probe.data -eq $dataPath -and $probe.config -eq $configPath -and $probe.app_version -eq $expectedVersion) {
            $isReady = $true
        } elseif ($probe.app -eq 'agents-talk' -and $probe.root -eq $projectRoot) {
            throw "本目录的控制面板正在以版本 $($probe.app_version) 或其他数据设置运行。请先关闭它：前台窗口按 Ctrl+C，后台服务运行 scripts\stop.ps1，然后再双击图标。"
        } elseif ($probe.app -eq 'agents-talk') {
            throw "端口 $Port 已被另一个 agentstalk 控制面板占用（目录：$($probe.root)）。请先关闭它，或用 -Port 指定其他端口。"
        } else {
            throw "端口 $Port 已被其他程序占用，没有停止任何进程。"
        }
    }
    if (-not $isReady) {
        $socket = New-Object System.Net.Sockets.TcpClient
        try {
            $connected = $socket.ConnectAsync('127.0.0.1', $Port).Wait(1000)
            if ($connected -and $socket.Connected) { throw 'PORT_OCCUPIED' }
        } catch {
            if ($_.Exception.Message -eq 'PORT_OCCUPIED') { throw "端口 $Port 已被其他程序占用，没有停止任何进程。" }
        } finally { $socket.Dispose() }
        $pythonPath = Get-Python
        if (-not $pythonPath) { return }
        # Remember the interpreter so later launches skip discovery.
        $pythonPath | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'python-path.txt') -Encoding UTF8
        # Setup problems are logged but never keep the panel from starting.
        try { Invoke-FirstRunSetup $pythonPath } catch { $_ | Out-String | Set-Content -LiteralPath (Join-Path $runtimePath 'setup-error.log') -Encoding UTF8 }
        $hubPath = Join-Path $projectRoot 'hub.py'
        # Resolve relative environment paths in the caller's directory before the
        # child changes its working directory to the maintained project.
        $serverArguments = @($hubPath, '--data-dir', $dataPath)
        # Preserve the default missing-config fallback by passing --config only
        # when the caller selected one explicitly.
        if ($env:AGENTS_TALK_CONFIG) { $serverArguments += @('--config', $configPath) }
        $serverArguments += @('serve', '--no-open', '--port', [string]$Port)
        # Windows command-line parsing requires doubled trailing backslashes
        # before the closing quote, including a directory ending in a separator.
        $serverArguments = ($serverArguments | ForEach-Object { '"' + ($_ -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"' }) -join ' '
        $serverProcess = Start-Process -FilePath $pythonPath -ArgumentList $serverArguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimePath ($serverStem + '.log')) -RedirectStandardError (Join-Path $runtimePath ($serverStem + '-error.log')) -PassThru
        $serverProcess.Id | Set-Content -LiteralPath (Join-Path $runtimePath ($serverStem + '.pid'))
        $startupClock = [System.Diagnostics.Stopwatch]::StartNew()
        while ($startupClock.Elapsed.TotalSeconds -lt 30) {
            Start-Sleep -Milliseconds 250
            try {
                $probe = Invoke-RestMethod -Uri ($panelUrl + 'api/health') -TimeoutSec 1
                if ($probe.app -eq 'agents-talk' -and $probe.version -eq 2 -and $probe.pid -eq $serverProcess.Id -and $probe.root -eq $projectRoot -and $probe.data -eq $dataPath -and $probe.config -eq $configPath -and $probe.app_version -eq $expectedVersion) { $isReady = $true; break }
            } catch { }
            if ($serverProcess.HasExited) { break }
        }
        if (-not $isReady) { throw (Get-StartupProblem $pythonPath) }
    }
    if (-not $NoOpen) { Start-Process $panelUrl }
} catch {
    # Only clean up the child launched by this invocation, never an existing service.
    if ($serverProcess -and -not $isReady -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -ErrorAction SilentlyContinue
    }
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $runtimePath 'launch-error.log') -Encoding UTF8
    if ($NoOpen) { throw }
    Show-Message $_.Exception.Message 'OK' 'Error' | Out-Null
    exit 1
} finally {
    if ($acquired) { $launchMutex.ReleaseMutex() }
    $launchMutex.Dispose()
}
