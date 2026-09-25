# ZeroStress Cockpit - Admin auf Zeit (Entziehen)
# Entfernt ein Konto sofort aus der lokalen Gruppe Administratoren und
# loescht die geplante Rueckbau-Aufgabe. Platzhalter fuellt die Konsole.
# Ausgabe: genau eine JSON-Zeile. Exit 0 = entzogen oder nicht Mitglied, Exit 1 = fehlgeschlagen.
# PowerShell 5.1, ASCII, keine Aliase.

$ErrorActionPreference = 'Stop'
$account = '__ACCOUNT__'
$taskName = '__TASKNAME__'
$adminGroupSid = 'S-1-5-32-544'

$result = [ordered]@{
    schema = 'zsc.temp-admin/1'
    action = 'revoke'
    account = $account
    revokedAt = $null
    wasMember = $false
    taskRemoved = $false
    error = $null
}

try {
    $member = $null
    try {
        $member = Get-LocalGroupMember -SID $adminGroupSid -ErrorAction Stop | Where-Object { $_.Name -ieq $account }
    } catch { }
    if ($member) {
        Remove-LocalGroupMember -SID $adminGroupSid -Member $account -ErrorAction Stop
        $result.wasMember = $true
    }
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($task) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
        $result.taskRemoved = $true
    }
    $result.revokedAt = (Get-Date).ToUniversalTime().ToString('o')
} catch {
    $result.error = $_.Exception.Message
    Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 3)
    exit 1
}

Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 3)
exit 0
