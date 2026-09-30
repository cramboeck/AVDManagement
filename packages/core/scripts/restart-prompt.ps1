# ZeroStress Cockpit - restart with deferral (one-off script with embedded parameters)
# Runs as SYSTEM via Intune remediation. Stores the restart request in the
# registry, registers a SYSTEM task that restarts the device at the deadline
# (unless it has been restarted meanwhile) and a per-user task that shows a
# dialog to the logged-on user: restart now, or defer up to the configured
# number of times. Everything lives on the device; the console is not needed
# after this script ran. Output: one JSON line. Exit 0 = scheduled.
# PowerShell 5.1, ASCII, no aliases. Contains no personal data.

$ErrorActionPreference = 'Stop'
$deadlineMinutes = __DEADLINE_MINUTES__
$maxDeferrals = __MAX_DEFERRALS__
$deferMinutes = __DEFER_MINUTES__
$message = '__MESSAGE__'
$taskName = '__TASKNAME__'

$stateKey = 'HKLM:\SOFTWARE\ZeroStress\Restart'
$scriptDir = Join-Path -Path $env:ProgramData -ChildPath 'ZeroStress\restart'
$promptScript = Join-Path -Path $scriptDir -ChildPath 'restart-prompt-user.ps1'
$deadlineScript = Join-Path -Path $scriptDir -ChildPath 'restart-deadline.ps1'

$result = [ordered]@{
    schema = 'zsc.restart-prompt/1'
    action = 'schedule'
    scheduledAt = $null
    deadlineAt = $null
    deferrals = $maxDeferrals
    deferMinutes = $deferMinutes
    taskName = $taskName
    userSessionPresent = $false
    error = $null
}

$userScript = @'
# Shown to the logged-on user by the scheduled task ZSC-Restart-Prompt. Reads the
# request from the registry and offers restart now or defer.
$ErrorActionPreference = 'Stop'
$stateKey = 'HKLM:\SOFTWARE\ZeroStress\Restart'
if (-not (Test-Path -Path $stateKey)) { exit 0 }
$state = Get-ItemProperty -Path $stateKey
$deadline = [DateTime]::Parse([string]$state.DeadlineUtc).ToUniversalTime()
if ((Get-Date).ToUniversalTime() -ge $deadline) { exit 0 }
$bootRaw = (Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime
if ([string]$state.BootTime -ne $bootRaw.ToUniversalTime().ToString('o')) { exit 0 }
$remaining = [int]$state.DeferralsRemaining
$deferMinutes = [int]$state.DeferMinutes
$message = [string]$state.Message

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Neustart erforderlich'
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$form.Width = 520
$form.Height = 260

$label = New-Object System.Windows.Forms.Label
$label.Left = 20
$label.Top = 20
$label.Width = 470
$label.Height = 80
$label.Text = $message
$form.Controls.Add($label)

$info = New-Object System.Windows.Forms.Label
$info.Left = 20
$info.Top = 110
$info.Width = 470
$info.Height = 50
$deadlineLocal = $deadline.ToLocalTime().ToString('dd.MM.yyyy HH:mm')
if ($remaining -gt 0) {
    $info.Text = 'Spaetestens um ' + $deadlineLocal + ' startet das Geraet automatisch neu. Sie koennen noch ' + $remaining + ' Mal um ' + $deferMinutes + ' Minuten verschieben. Bitte speichern Sie Ihre Arbeit.'
} else {
    $info.Text = 'Spaetestens um ' + $deadlineLocal + ' startet das Geraet automatisch neu. Ein Verschieben ist nicht mehr moeglich. Bitte speichern Sie Ihre Arbeit.'
}
$form.Controls.Add($info)

$restartButton = New-Object System.Windows.Forms.Button
$restartButton.Text = 'Jetzt neu starten'
$restartButton.Left = 190
$restartButton.Top = 175
$restartButton.Width = 150
$restartButton.Height = 32
$restartButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.Controls.Add($restartButton)

$deferButton = New-Object System.Windows.Forms.Button
$deferButton.Text = 'Spaeter (' + $deferMinutes + ' Min)'
$deferButton.Left = 350
$deferButton.Top = 175
$deferButton.Width = 140
$deferButton.Height = 32
$deferButton.Enabled = ($remaining -gt 0)
$deferButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($deferButton)
$form.AcceptButton = $restartButton
$form.CancelButton = $deferButton

# Closes the dialog after five minutes without counting it as a deferral; the task shows it again later
$script:timedOut = $false
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300000
$timer.Add_Tick({ $script:timedOut = $true; $form.Close() })
$timer.Start()

$choice = $form.ShowDialog()
$timer.Stop()
if ($choice -eq [System.Windows.Forms.DialogResult]::OK) {
    Start-Process -FilePath (Join-Path -Path $env:SystemRoot -ChildPath 'System32\shutdown.exe') -ArgumentList ('/r /t 30 /c "Neustart durch Benutzer bestaetigt. Bitte Arbeit speichern."') -WindowStyle Hidden
    exit 0
}
if (-not $script:timedOut -and $remaining -gt 0) {
    Set-ItemProperty -Path $stateKey -Name 'DeferralsRemaining' -Value ($remaining - 1) -Type DWord
}
exit 0
'@

$deadlineScriptText = @'
# Runs as SYSTEM at the deadline: restart unless the device was restarted meanwhile.
$ErrorActionPreference = 'SilentlyContinue'
$stateKey = 'HKLM:\SOFTWARE\ZeroStress\Restart'
$taskName = '__TASKNAME__'
$state = $null
if (Test-Path -Path $stateKey) { $state = Get-ItemProperty -Path $stateKey }
$bootRaw = (Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime
$restarted = ($null -eq $state) -or ([string]$state.BootTime -ne $bootRaw.ToUniversalTime().ToString('o'))
$message = 'Geplanter Neustart durch die IT. Bitte Arbeit speichern.'
if ($state -and $state.Message) { $message = [string]$state.Message }
Unregister-ScheduledTask -TaskName ($taskName + '-Prompt') -Confirm:$false
Unregister-ScheduledTask -TaskName ($taskName + '-Deadline') -Confirm:$false
Remove-Item -Path $stateKey -Recurse -Force
if (-not $restarted) {
    Start-Process -FilePath (Join-Path -Path $env:SystemRoot -ChildPath 'System32\shutdown.exe') -ArgumentList ('/r /f /t 120 /c "' + $message + '"') -WindowStyle Hidden
}
exit 0
'@

try {
    if ($deadlineMinutes -lt 15 -or $deadlineMinutes -gt 1440) { throw 'deadline out of range' }
    New-Item -Path $scriptDir -ItemType Directory -Force | Out-Null
    Set-Content -Path $promptScript -Value $userScript -Encoding ASCII
    Set-Content -Path $deadlineScript -Value ($deadlineScriptText.Replace('__TASKNAME__', $taskName)) -Encoding ASCII

    $now = Get-Date
    $deadline = $now.AddMinutes($deadlineMinutes)
    $bootTime = (Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')

    if (-not (Test-Path -Path $stateKey)) { New-Item -Path $stateKey -Force | Out-Null }
    Set-ItemProperty -Path $stateKey -Name 'DeadlineUtc' -Value $deadline.ToUniversalTime().ToString('o') -Type String
    Set-ItemProperty -Path $stateKey -Name 'BootTime' -Value $bootTime -Type String
    Set-ItemProperty -Path $stateKey -Name 'DeferralsRemaining' -Value $maxDeferrals -Type DWord
    Set-ItemProperty -Path $stateKey -Name 'DeferMinutes' -Value $deferMinutes -Type DWord
    Set-ItemProperty -Path $stateKey -Name 'Message' -Value $message -Type String
    Set-ItemProperty -Path $stateKey -Name 'TaskName' -Value $taskName -Type String

    # Users may decrement the deferral counter; nothing else in the key changes from user context
    $acl = Get-Acl -Path $stateKey
    $usersSid = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')
    $rule = New-Object System.Security.AccessControl.RegistryAccessRule($usersSid, 'SetValue, ReadKey', 'ContainerInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -Path $stateKey -AclObject $acl

    # Deadline task: SYSTEM, runs at the deadline, also if the device was off at that time
    $deadlineAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $deadlineScript + '"')
    $deadlineTrigger = New-ScheduledTaskTrigger -Once -At $deadline
    $systemPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $deadlineSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName ($taskName + '-Deadline') -Action $deadlineAction -Trigger $deadlineTrigger -Principal $systemPrincipal -Settings $deadlineSettings -Force | Out-Null

    # Prompt task: interactive for members of Users, at logon and every deferMinutes until the deadline
    $promptAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $promptScript + '"')
    $logonTrigger = New-ScheduledTaskTrigger -AtLogOn
    $repeatTrigger = New-ScheduledTaskTrigger -Once -At $now.AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $deferMinutes) -RepetitionDuration (New-TimeSpan -Minutes $deadlineMinutes)
    $usersPrincipal = New-ScheduledTaskPrincipal -GroupId 'S-1-5-32-545' -RunLevel Limited
    $promptSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName ($taskName + '-Prompt') -Action $promptAction -Trigger @($logonTrigger, $repeatTrigger) -Principal $usersPrincipal -Settings $promptSettings -Force | Out-Null

    $sessions = @(Get-CimInstance -ClassName Win32_LogonSession -ErrorAction SilentlyContinue | Where-Object { $_.LogonType -eq 2 -or $_.LogonType -eq 11 })
    $result.userSessionPresent = ($sessions.Count -gt 0)
    if ($result.userSessionPresent) {
        try { Start-ScheduledTask -TaskName ($taskName + '-Prompt') } catch { }
    }

    $result.scheduledAt = $now.ToUniversalTime().ToString('o')
    $result.deadlineAt = $deadline.ToUniversalTime().ToString('o')
} catch {
    $result.error = $_.Exception.Message
    Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 3)
    exit 1
}

Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 3)
exit 0
