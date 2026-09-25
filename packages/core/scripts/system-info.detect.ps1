# ZeroStress Cockpit - Systeminfo (Erkennung)
# Sammelt den technischen Zustand eines Geraets: Betriebssystem, Laufzeit,
# Neustartbedarf, Systemlaufwerk, Speicher, Firmware, TPM, Secure Boot,
# BitLocker-Status des Systemlaufwerks und Defender-Zustand.
# Bewusst ohne Benutzernamen oder andere personenbezogene Daten.
# Ausgabe: genau eine JSON-Zeile. Exit 0 = nur Information.
# PowerShell 5.1, ASCII, keine Aliase.

$ErrorActionPreference = 'Stop'

$result = [ordered]@{
    schema = 'zsc.system-info/1'
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
    hostname = $env:COMPUTERNAME
    os = $null
    osVersion = $null
    osBuild = $null
    installedAt = $null
    lastBootAt = $null
    uptimeHours = $null
    rebootRequired = $false
    systemDrive = [ordered]@{ letter = $env:SystemDrive; totalGb = $null; freeGb = $null; freePercent = $null }
    memoryGb = $null
    cpu = $null
    manufacturer = $null
    model = $null
    biosVersion = $null
    tpm = [ordered]@{ present = $null; ready = $null }
    secureBoot = $null
    bitlocker = [ordered]@{ status = $null; protection = $null; encryptedPercent = $null }
    defender = [ordered]@{ mode = $null; realTime = $null; signatureAgeDays = $null; lastQuickScanAt = $null }
    errors = @()
}
$problems = New-Object System.Collections.ArrayList

function Add-Problem {
    param([string]$Area, [string]$Message)
    [void]$problems.Add(($Area + ': ' + $Message))
}

try {
    $os = Get-CimInstance -ClassName Win32_OperatingSystem
    $result.os = [string]$os.Caption
    $result.osVersion = [string]$os.Version
    $result.osBuild = [string]$os.BuildNumber
    if ($os.InstallDate) { $result.installedAt = $os.InstallDate.ToUniversalTime().ToString('o') }
    if ($os.LastBootUpTime) {
        $result.lastBootAt = $os.LastBootUpTime.ToUniversalTime().ToString('o')
        $result.uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
    }
    $result.memoryGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
} catch { Add-Problem -Area 'os' -Message $_.Exception.Message }

try {
    $computer = Get-CimInstance -ClassName Win32_ComputerSystem
    $result.manufacturer = [string]$computer.Manufacturer
    $result.model = [string]$computer.Model
} catch { Add-Problem -Area 'computer' -Message $_.Exception.Message }

try {
    $bios = Get-CimInstance -ClassName Win32_BIOS
    $result.biosVersion = [string]$bios.SMBIOSBIOSVersion
} catch { Add-Problem -Area 'bios' -Message $_.Exception.Message }

try {
    $cpu = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1
    $result.cpu = ([string]$cpu.Name).Trim()
} catch { Add-Problem -Area 'cpu' -Message $_.Exception.Message }

try {
    $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter ("DeviceID='" + $env:SystemDrive + "'")
    if ($disk -and $disk.Size -gt 0) {
        $result.systemDrive.totalGb = [math]::Round($disk.Size / 1GB, 1)
        $result.systemDrive.freeGb = [math]::Round($disk.FreeSpace / 1GB, 1)
        $result.systemDrive.freePercent = [math]::Round(($disk.FreeSpace / $disk.Size) * 100, 0)
    }
} catch { Add-Problem -Area 'disk' -Message $_.Exception.Message }

$rebootKeys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
)
foreach ($key in $rebootKeys) {
    if (Test-Path -Path $key) { $result.rebootRequired = $true }
}

try {
    $tpm = Get-Tpm
    $result.tpm.present = [bool]$tpm.TpmPresent
    $result.tpm.ready = [bool]$tpm.TpmReady
} catch { Add-Problem -Area 'tpm' -Message $_.Exception.Message }

try {
    $result.secureBoot = [bool](Confirm-SecureBootUEFI)
} catch {
    # Legacy-BIOS oder nicht unterstuetzt: Secure Boot ist dann aus
    $result.secureBoot = $false
}

try {
    $volume = Get-BitLockerVolume -MountPoint $env:SystemDrive
    $result.bitlocker.status = [string]$volume.VolumeStatus
    $result.bitlocker.protection = [string]$volume.ProtectionStatus
    $result.bitlocker.encryptedPercent = [int]$volume.EncryptionPercentage
} catch { Add-Problem -Area 'bitlocker' -Message $_.Exception.Message }

try {
    $mp = Get-MpComputerStatus
    $result.defender.mode = [string]$mp.AMRunningMode
    $result.defender.realTime = [bool]$mp.RealTimeProtectionEnabled
    $result.defender.signatureAgeDays = [int]$mp.AntivirusSignatureAge
    if ($mp.QuickScanEndTime) { $result.defender.lastQuickScanAt = $mp.QuickScanEndTime.ToUniversalTime().ToString('o') }
} catch { Add-Problem -Area 'defender' -Message $_.Exception.Message }

$result.errors = @($problems)
Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 4)
exit 0
