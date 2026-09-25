# ZeroStress Cockpit - Admin auf Zeit (Gewaehren)
# Nimmt ein Konto fuer eine begrenzte Zeit in die lokale Gruppe
# Administratoren (SID S-1-5-32-544) auf und legt eine geplante Aufgabe an,
# die es nach Ablauf wieder entfernt, auch wenn das Geraet zwischendurch
# aus war (StartWhenAvailable). Die Platzhalter fuellt die Konsole je Lauf;
# das Skript wird nach dem Lauf aus dem Tenant entfernt.
# Ausgabe: genau eine JSON-Zeile. Exit 0 = gewaehrt, Exit 1 = fehlgeschlagen.
# PowerShell 5.1, ASCII, keine Aliase.

$ErrorActionPreference = 'Stop'
$account = '__ACCOUNT__'
$minutes = __MINUTES__
$taskName = '__TASKNAME__'
$adminGroupSid = 'S-1-5-32-544'

$result = [ordered]@{
    schema = 'zsc.temp-admin/1'
    action = 'grant'
    account = $account
    grantedAt = $null
    expiresAt = $null
    minutes = $minutes
    taskName = $taskName
    alreadyMember = $false
    error = $null
}

try {
    $member = $null
    try {
        $member = Get-LocalGroupMember -SID $adminGroupSid -ErrorAction Stop | Where-Object { $_.Name -ieq $account }
    } catch { }
    if ($member) {
        $result.alreadyMember = $true
    } else {
        Add-LocalGroupMember -SID $adminGroupSid -Member $account -ErrorAction Stop
    }

    $revoke = "Remove-LocalGroupMember -SID '$adminGroupSid' -Member '$account' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false -ErrorAction SilentlyContinue"
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($revoke))
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand " + $encoded)
    $runAt = (Get-Date).AddMinutes($minutes)
    $trigger = New-ScheduledTaskTrigger -Once -At $runAt
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

    $result.grantedAt = (Get-Date).ToUniversalTime().ToString('o')
    $result.expiresAt = $runAt.ToUniversalTime().ToString('o')
} catch {
    $result.error = $_.Exception.Message
    Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 3)
    exit 1
}

Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 3)
exit 0
