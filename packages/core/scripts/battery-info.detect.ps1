# ZeroStress Cockpit - Akkuzustand (Erkennung)
# Liest je Akku Auslegungs- und Vollladekapazitaet, Ladezyklen, Ladestand
# und Status aus WMI (root\wmi und Win32_Battery). Gesundheit = Vollladung
# geteilt durch Auslegung. Geraete ohne Akku melden hasBattery=false.
# Ausgabe: genau eine JSON-Zeile. Exit 0 = nur Information.
# PowerShell 5.1, ASCII, keine Aliase. Enthaelt keine personenbezogenen Daten.

$ErrorActionPreference = 'Stop'

$result = [ordered]@{
    schema = 'zsc.battery-info/1'
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
    hasBattery = $false
    batteries = @()
    onAcPower = $null
    error = $null
}

$statusLabels = @{
    1 = 'Discharging'; 2 = 'AC'; 3 = 'FullyCharged'; 4 = 'Low'; 5 = 'Critical'
    6 = 'Charging'; 7 = 'ChargingHigh'; 8 = 'ChargingLow'; 9 = 'ChargingCritical'
    10 = 'Undefined'; 11 = 'PartiallyCharged'
}

try {
    $win32 = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue)
    $static = @(Get-CimInstance -Namespace 'root\wmi' -ClassName BatteryStaticData -ErrorAction SilentlyContinue)
    $full = @(Get-CimInstance -Namespace 'root\wmi' -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue)
    $cycles = @(Get-CimInstance -Namespace 'root\wmi' -ClassName BatteryCycleCount -ErrorAction SilentlyContinue)

    if ($win32.Count -gt 0 -or $static.Count -gt 0) {
        $result.hasBattery = $true
    }
    try {
        $power = Get-CimInstance -Namespace 'root\wmi' -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($power) { $result.onAcPower = [bool]$power.PowerOnline }
    } catch { }

    $entries = New-Object System.Collections.ArrayList
    $count = [math]::Max($win32.Count, $static.Count)
    for ($i = 0; $i -lt $count; $i++) {
        $w = $null; if ($i -lt $win32.Count) { $w = $win32[$i] }
        $s = $null; if ($i -lt $static.Count) { $s = $static[$i] }
        $f = $null; if ($i -lt $full.Count) { $f = $full[$i] }
        $c = $null; if ($i -lt $cycles.Count) { $c = $cycles[$i] }

        $design = $null; if ($s -and $s.DesignedCapacity) { $design = [int]$s.DesignedCapacity }
        $fullCap = $null; if ($f -and $f.FullChargedCapacity) { $fullCap = [int]$f.FullChargedCapacity }
        $health = $null
        if ($design -and $fullCap -and $design -gt 0) { $health = [math]::Round(($fullCap / $design) * 100, 0) }
        $statusCode = $null; if ($w) { $statusCode = [int]$w.BatteryStatus }
        $statusText = 'Unknown'
        if ($statusCode -ne $null -and $statusLabels.ContainsKey($statusCode)) { $statusText = $statusLabels[$statusCode] }

        [void]$entries.Add([ordered]@{
            name = $(if ($w) { [string]$w.Name } elseif ($s) { [string]$s.DeviceName } else { 'Battery' })
            manufacturer = $(if ($s) { [string]$s.ManufactureName } else { '' })
            designCapacityMwh = $design
            fullChargeCapacityMwh = $fullCap
            healthPercent = $health
            cycleCount = $(if ($c) { [int]$c.CycleCount } else { $null })
            chargePercent = $(if ($w) { [int]$w.EstimatedChargeRemaining } else { $null })
            status = $statusText
            chemistry = $(if ($s) { [string]$s.Chemistry } else { '' })
        })
    }
    $result.batteries = @($entries)
} catch {
    $result.error = $_.Exception.Message
}

Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 4)
exit 0
