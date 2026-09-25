# ZeroStress Cockpit - Speicherinfo (Erkennung)
# Alle festen Volumes mit Belegung und Zustand sowie die physischen
# Datentraeger mit Typ (SSD/HDD), Bus, Groesse, Zustand und Firmware.
# Ausgabe: genau eine JSON-Zeile (unter 2000 Zeichen). Exit 0 = nur Information.
# PowerShell 5.1, ASCII, keine Aliase. Enthaelt keine personenbezogenen Daten.

$ErrorActionPreference = 'Stop'
$maxVolumes = 8
$maxDisks = 6
$maxNameLength = 30

$result = [ordered]@{
    schema = 'zsc.storage-info/1'
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
    volumes = @()
    disks = @()
    truncated = $false
    error = $null
}

function Get-Clipped {
    param([string]$Text, [int]$Max)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    if ($Text.Length -le $Max) { return $Text }
    return $Text.Substring(0, $Max - 3) + '...'
}

try {
    $volumes = New-Object System.Collections.ArrayList
    $fixed = Get-Volume -ErrorAction Stop |
        Where-Object { $_.DriveType -eq 'Fixed' -and $_.Size -gt 0 } |
        Sort-Object -Property DriveLetter
    foreach ($volume in $fixed) {
        $letter = ''
        if ($volume.DriveLetter) { $letter = [string]$volume.DriveLetter + ':' }
        [void]$volumes.Add([ordered]@{
            letter = $letter
            label = Get-Clipped -Text ([string]$volume.FileSystemLabel) -Max 20
            fs = [string]$volume.FileSystem
            totalGb = [math]::Round($volume.Size / 1GB, 1)
            freeGb = [math]::Round($volume.SizeRemaining / 1GB, 1)
            freePercent = [math]::Round(($volume.SizeRemaining / $volume.Size) * 100, 0)
            health = [string]$volume.HealthStatus
        })
    }
    if ($volumes.Count -gt $maxVolumes) {
        $result.truncated = $true
        $result.volumes = @($volumes.GetRange(0, $maxVolumes))
    } else {
        $result.volumes = @($volumes)
    }
} catch {
    $result.error = 'volumes: ' + $_.Exception.Message
}

try {
    $disks = New-Object System.Collections.ArrayList
    $physical = Get-PhysicalDisk -ErrorAction Stop | Sort-Object -Property DeviceId
    foreach ($disk in $physical) {
        [void]$disks.Add([ordered]@{
            id = [string]$disk.DeviceId
            model = Get-Clipped -Text ([string]$disk.FriendlyName) -Max $maxNameLength
            media = [string]$disk.MediaType
            bus = [string]$disk.BusType
            sizeGb = [math]::Round($disk.Size / 1GB, 0)
            health = [string]$disk.HealthStatus
            firmware = Get-Clipped -Text ([string]$disk.FirmwareVersion) -Max 16
        })
    }
    if ($disks.Count -gt $maxDisks) {
        $result.truncated = $true
        $result.disks = @($disks.GetRange(0, $maxDisks))
    } else {
        $result.disks = @($disks)
    }
} catch {
    if ($result.error) { $result.error = $result.error + '; ' }
    $result.error = [string]$result.error + 'disks: ' + $_.Exception.Message
}

Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 4)
exit 0
