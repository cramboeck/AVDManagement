# ZeroStress Cockpit - device monitor (detection only, meant for an hourly schedule)
# Collects the facts a client monitor needs without an agent: uptime, pending
# reboot, free space per fixed volume, automatic services that are not
# running, disk and hardware errors from the System log (24 h), machine
# certificates about to expire, Defender signature age. Thresholds live in
# the console; the script only reports. Exit 1 = something to look at
# (Intune shows "With issues"), exit 0 = nothing. Output: one JSON line
# (under 2000 characters). PowerShell 5.1, ASCII, no aliases. No personal data.

$ErrorActionPreference = 'SilentlyContinue'

$result = [ordered]@{
    schema = 'zsc.monitor/1'
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
    uptimeHours = $null
    pendingReboot = $false
    volumes = @()
    stoppedServices = @()
    systemErrors24h = 0
    systemErrorSources = @()
    expiringCerts = @()
    defenderSignatureAgeDays = $null
    defenderRealTime = $null
    issues = 0
}

$os = Get-CimInstance -ClassName Win32_OperatingSystem
if ($os -and $os.LastBootUpTime) {
    $result.uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
}

# Pending reboot flags of CBS, Windows Update and file renames
$rebootKeys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
)
foreach ($key in $rebootKeys) {
    if (Test-Path -Path $key) { $result.pendingReboot = $true }
}
$pendingRename = Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name 'PendingFileRenameOperations'
if ($pendingRename -and $pendingRename.PendingFileRenameOperations) { $result.pendingReboot = $true }

# Fixed volumes: drive letter, free percent, free GB (up to 6 volumes)
$volumes = New-Object System.Collections.ArrayList
$disks = Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType = 3'
foreach ($disk in $disks) {
    if (-not $disk.Size -or $disk.Size -le 0) { continue }
    $freePercent = [math]::Round(($disk.FreeSpace / $disk.Size) * 100, 1)
    [void]$volumes.Add([ordered]@{
        drive = [string]$disk.DeviceID
        freePercent = $freePercent
        freeGB = [math]::Round($disk.FreeSpace / 1GB, 1)
        sizeGB = [math]::Round($disk.Size / 1GB, 1)
    })
    if ($volumes.Count -ge 6) { break }
}
$result.volumes = @($volumes)

# Automatic services that are not running (delayed-start and trigger-started services excluded)
$stopped = New-Object System.Collections.ArrayList
$services = Get-CimInstance -ClassName Win32_Service -Filter "StartMode = 'Auto' AND State <> 'Running'"
foreach ($service in $services) {
    if ($service.DelayedAutoStart -eq $true) { continue }
    if ($service.ExitCode -eq 0 -and $service.State -eq 'Stopped' -and $service.Name -match '^(sppsvc|TrustedInstaller|WbioSrvc|MapsBroker|edgeupdate|gupdate|GoogleUpdaterService.*|MicrosoftEdgeElevationService|CDPSvc|BITS|DoSvc|wuauserv|RemoteRegistry|SharedAccess|tiledatamodelsvc|WSearch|ShellHWDetection|SysMain)$') { continue }
    [void]$stopped.Add([string]$service.Name)
    if ($stopped.Count -ge 10) { break }
}
$result.stoppedServices = @($stopped)

# Disk, file system and hardware errors in the System log over the last 24 hours
$since = (Get-Date).AddHours(-24)
$sources = @('disk', 'Ntfs', 'volmgr', 'storahci', 'stornvme', 'Microsoft-Windows-WHEA-Logger', 'Microsoft-Windows-Kernel-Power')
$events = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Level = @(1, 2); StartTime = $since; ProviderName = $sources } -MaxEvents 200
$errorCount = 0
$sourceNames = New-Object System.Collections.ArrayList
foreach ($event in $events) {
    if ($event.ProviderName -eq 'Microsoft-Windows-Kernel-Power' -and $event.Id -ne 41) { continue }
    $errorCount = $errorCount + 1
    if (-not $sourceNames.Contains([string]$event.ProviderName)) { [void]$sourceNames.Add([string]$event.ProviderName) }
}
$result.systemErrors24h = $errorCount
$result.systemErrorSources = @($sourceNames)

# Machine certificates expiring within 30 days (subject shortened, no keys)
$certs = New-Object System.Collections.ArrayList
$limit = (Get-Date).AddDays(30)
$store = Get-ChildItem -Path 'Cert:\LocalMachine\My'
foreach ($cert in $store) {
    if ($cert.NotAfter -gt $limit) { continue }
    $subject = [string]$cert.Subject
    if ($subject.Length -gt 60) { $subject = $subject.Substring(0, 57) + '...' }
    [void]$certs.Add([ordered]@{ subject = $subject; notAfter = $cert.NotAfter.ToUniversalTime().ToString('yyyy-MM-dd'); thumbprint = $cert.Thumbprint.Substring(0, 8) })
    if ($certs.Count -ge 5) { break }
}
$result.expiringCerts = @($certs)

# Defender: signature age and real-time protection (absent on devices with other AV)
$mp = $null
if (Get-Command -Name 'Get-MpComputerStatus') { $mp = Get-MpComputerStatus }
if ($mp) {
    $result.defenderSignatureAgeDays = [int]$mp.AntivirusSignatureAge
    $result.defenderRealTime = [bool]$mp.RealTimeProtectionEnabled
}

# Issue count for the Intune state; the console applies its own thresholds
$issues = 0
if ($result.pendingReboot) { $issues = $issues + 1 }
foreach ($v in $result.volumes) { if ($v.freePercent -lt 10) { $issues = $issues + 1 } }
$issues = $issues + $result.stoppedServices.Count
if ($result.systemErrors24h -gt 0) { $issues = $issues + 1 }
$issues = $issues + $result.expiringCerts.Count
if ($result.defenderSignatureAgeDays -ne $null -and $result.defenderSignatureAgeDays -gt 3) { $issues = $issues + 1 }
if ($result.defenderRealTime -eq $false) { $issues = $issues + 1 }
$result.issues = $issues

$json = ConvertTo-Json -InputObject $result -Compress -Depth 4
if ($json.Length -gt 1990) {
    $result.stoppedServices = @($result.stoppedServices | Select-Object -First 3)
    $result.expiringCerts = @($result.expiringCerts | Select-Object -First 2)
    $json = ConvertTo-Json -InputObject $result -Compress -Depth 4
}
Write-Output $json
if ($issues -gt 0) { exit 1 }
exit 0
