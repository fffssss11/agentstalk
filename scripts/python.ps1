function Find-AgentsTalkPython {
    $candidates = @()
    if ($env:AGENTS_TALK_PYTHON) { $candidates += $env:AGENTS_TALK_PYTHON }
    $saved = Join-Path $PSScriptRoot 'python-path.txt'
    if (Test-Path -LiteralPath $saved) { $candidates += (Get-Content -LiteralPath $saved -Raw).Trim() }
    # Honor a working explicit/saved interpreter before probing unrelated launchers.
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        $resolved = Test-AgentsTalkPython $candidate
        if ($resolved) { return $resolved }
    }
    # The Windows portable package ships the official embeddable Python next to the sources.
    $bundled = Test-AgentsTalkPython (Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime\python\python.exe')
    if ($bundled) { return $bundled }
    $candidates = @()
    foreach ($name in @('python.exe', 'python3.exe')) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command) { $candidates += $command.Source }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        $resolved = Test-AgentsTalkPython $candidate
        if ($resolved) { return $resolved }
    }
    $candidates = @()
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        # List installed interpreters without asking the launcher to install a runtime.
        $found = & $py.Source --list-paths 2>$null
        if ($LASTEXITCODE -eq 0) {
            foreach ($line in $found) {
                if ($line -match '(?i)([A-Z]:\\.*python(?:w)?\.exe)\s*$') { $candidates += $Matches[1] }
            }
        }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        $resolved = Test-AgentsTalkPython $candidate
        if ($resolved) { return $resolved }
    }
    # python.org installs that were not added to PATH, including a fresh per-user winget install.
    $candidates = @()
    $bases = @($env:ProgramFiles, ${env:ProgramFiles(x86)})
    if ($env:LOCALAPPDATA) { $bases = @(Join-Path $env:LOCALAPPDATA 'Programs\Python') + $bases }
    foreach ($base in $bases) {
        if (-not $base -or -not (Test-Path -LiteralPath $base)) { continue }
        $candidates += Get-ChildItem -LiteralPath $base -Directory -Filter 'Python3*' -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'python.exe' }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        $resolved = Test-AgentsTalkPython $candidate
        if ($resolved) { return $resolved }
    }
    throw 'Python 3.10+ was not found. Install Python, reopen the terminal, or set AGENTS_TALK_PYTHON to its executable.'
}

function Test-AgentsTalkPython([string]$Candidate) {
    if (-not $Candidate -or -not (Test-Path -LiteralPath $Candidate)) { return $null }
    try {
        # JSON keeps the path ASCII, so non-ASCII folders survive any console code page.
        $found = & $Candidate -c 'import json, sys; assert sys.version_info >= (3,10); print(json.dumps(sys.executable))' 2>$null
        if ($LASTEXITCODE -eq 0 -and $found) { return [string](($found | Select-Object -Last 1) | ConvertFrom-Json) }
    } catch { }
    return $null
}
