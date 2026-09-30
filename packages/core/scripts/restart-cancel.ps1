# ZeroStress Cockpit - cancel a scheduled restart (one-off script)
# Removes the deadline and prompt tasks, the registry request and aborts a
# shutdown that is already counting down. Output: one JSON line.
# PowerShell 5.1, ASCII, no aliases. Contains no personal data.

$ErrorActionPreference = 'Stop'
$taskName = '__TASKNAME__'
$stateKey = 'HKLM:\SOFTWARE\ZeroStress\Restart'

$result = [ordered]@{
    schema = 'zsc.restart-prompt/1'
    action = 'cancel'
    cancelledAt = $null
    hadRequest = $false
    tasksRemoved = 0
    shutdownAborted = $false
    error = $null
}

try {
    if (Test-Path -Path $stateKey) {
        $result.hadRequest = $true
        Remove-Item -Path $stateKey -Recurse -Force
    }
    foreach ($suffix in @('-Deadline', '-Prompt')) {
        $task = Get-ScheduledTask -TaskName ($taskName + $suffix) -ErrorAction SilentlyContinue
        if ($task) {
            Unregister-ScheduledTask -TaskName ($taskName + $suffix) -Confirm:$false -ErrorAction Stop
            $result.tasksRemoved = $result.tasksRemoved + 1
        }
    }
    $abort = Start-Process -FilePath (Join-Path -Path $env:SystemRoot -ChildPath 'System32\shutdown.exe') -ArgumentList '/a' -PassThru -Wait -WindowStyle Hidden -ErrorAction SilentlyContinue
    if ($abort -and $abort.ExitCode -eq 0) { $result.shutdownAborted = $true }
    $result.cancelledAt = (Get-Date).ToUniversalTime().ToString('o')
} catch {
    $result.error = $_.Exception.Message
    Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 3)
    exit 1
}

Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 3)
exit 0
