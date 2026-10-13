$ErrorActionPreference = 'Stop'
try {
    $projectDirectory = $PSScriptRoot
    $nodeExecutable = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    $serverScript = Join-Path $projectDirectory 'server.js'
    if ([string]::IsNullOrWhiteSpace($env:DATA_FILE)) {
        $dataPath = Join-Path $projectDirectory 'data\data.json'
    } elseif ([IO.Path]::IsPathRooted($env:DATA_FILE)) {
        $dataPath = $env:DATA_FILE
    } else {
        $dataPath = Join-Path $projectDirectory $env:DATA_FILE
    }
    $logDirectory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($dataPath))
    [IO.Directory]::CreateDirectory($logDirectory) | Out-Null
    $outputLog = Join-Path $logDirectory 'startup.log'
    $errorLog = Join-Path $logDirectory 'startup-error.log'
    $backgroundProcess = Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $serverScript + '"') `
        -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput $outputLog `
        -RedirectStandardError $errorLog -PassThru
    [IO.File]::WriteAllText((Join-Path $logDirectory 'startup.pid'), [string]$backgroundProcess.Id)
    for ($startupAttempt = 0; $startupAttempt -lt 100; $startupAttempt++) {
        $backgroundProcess.Refresh()
        if ($backgroundProcess.HasExited) { throw "Service exited before startup. See $errorLog" }
        if ([IO.File]::Exists($outputLog)) {
            $startupLogStream = [IO.File]::Open($outputLog, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
            $startupLogReader = New-Object IO.StreamReader($startupLogStream)
            try { $startupText = $startupLogReader.ReadToEnd() } finally { $startupLogReader.Dispose() }
            if ($startupText -match 'http://localhost:\d+/') { exit 0 }
        }
        Start-Sleep -Milliseconds 100
    }
    throw "Service startup timed out. See $errorLog"
} catch {
    if ($backgroundProcess) {
        try { if (-not $backgroundProcess.HasExited) { $backgroundProcess.Kill() } } catch {}
    }
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    exit 1
}
