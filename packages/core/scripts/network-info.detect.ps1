# ZeroStress Cockpit - Netzwerkinfo (Erkennung)
# Aktive Netzwerkadapter mit IPv4-Adresse, Praefix, Gateway, DNS, DHCP, MAC,
# Verbindungsart und Geschwindigkeit; bei WLAN die verbundene SSID; dazu
# Domaenen- oder Arbeitsgruppenname und WinHTTP-Proxy.
# Ausgabe: genau eine JSON-Zeile (unter 2000 Zeichen). Exit 0 = nur Information.
# PowerShell 5.1, ASCII, keine Aliase. Enthaelt keine personenbezogenen Daten.

$ErrorActionPreference = 'Stop'
$maxAdapters = 6
$maxNameLength = 28

$result = [ordered]@{
    schema = 'zsc.network-info/1'
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
    hostname = $env:COMPUTERNAME
    domain = $null
    domainJoined = $null
    adapters = @()
    truncated = $false
    proxy = $null
    error = $null
}

function Get-Clipped {
    param([string]$Text, [int]$Max)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    if ($Text.Length -le $Max) { return $Text }
    return $Text.Substring(0, $Max - 3) + '...'
}

try {
    $computer = Get-CimInstance -ClassName Win32_ComputerSystem
    $result.domain = [string]$computer.Domain
    $result.domainJoined = [bool]$computer.PartOfDomain
} catch { }

$ssidByInterface = @{}
try {
    $wlan = & netsh.exe wlan show interfaces 2>$null
    $currentName = $null
    foreach ($line in $wlan) {
        if ($line -match '^\s*Name\s*:\s*(.+)$') { $currentName = $Matches[1].Trim() }
        if ($line -match '^\s*SSID\s*:\s*(.+)$' -and $currentName) { $ssidByInterface[$currentName] = $Matches[1].Trim() }
    }
} catch { }

try {
    $adapters = New-Object System.Collections.ArrayList
    $configs = Get-NetIPConfiguration -Detailed -ErrorAction SilentlyContinue |
        Where-Object { $_.NetAdapter -and $_.NetAdapter.Status -eq 'Up' }
    foreach ($config in $configs) {
        $adapter = $config.NetAdapter
        $ipv4 = @($config.IPv4Address | ForEach-Object { [string]$_.IPAddress })
        $prefix = $null
        if ($config.IPv4Address) { $prefix = [int]($config.IPv4Address | Select-Object -First 1).PrefixLength }
        $gateway = $null
        if ($config.IPv4DefaultGateway) { $gateway = [string]($config.IPv4DefaultGateway | Select-Object -First 1).NextHop }
        $dns = @()
        if ($config.DNSServer) {
            $dns = @($config.DNSServer | Where-Object { $_.AddressFamily -eq 2 } | ForEach-Object { [string[]]$_.ServerAddresses } | Select-Object -First 3)
        }
        $dhcp = $null
        try {
            $ifCfg = Get-NetIPInterface -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction Stop
            $dhcp = ([string]$ifCfg.Dhcp -eq 'Enabled')
        } catch { }
        $medium = [string]$adapter.PhysicalMediaType
        $kind = 'other'
        if ($medium -match '802\.11') { $kind = 'wifi' }
        elseif ($medium -match '802\.3') { $kind = 'ethernet' }
        elseif ($adapter.InterfaceDescription -match 'VPN|TAP|Wintun|WireGuard|Cisco|Fortinet|GlobalProtect|SonicWall') { $kind = 'vpn' }
        $entry = [ordered]@{
            name = Get-Clipped -Text ([string]$adapter.Name) -Max $maxNameLength
            kind = $kind
            ipv4 = $ipv4
            prefix = $prefix
            gateway = $gateway
            dns = $dns
            dhcp = $dhcp
            mac = [string]$adapter.MacAddress
            speed = [string]$adapter.LinkSpeed
            ssid = $null
        }
        if ($kind -eq 'wifi' -and $ssidByInterface.ContainsKey([string]$adapter.Name)) { $entry.ssid = $ssidByInterface[[string]$adapter.Name] }
        [void]$adapters.Add($entry)
    }
    if ($adapters.Count -gt $maxAdapters) {
        $result.truncated = $true
        $result.adapters = @($adapters.GetRange(0, $maxAdapters))
    } else {
        $result.adapters = @($adapters)
    }
} catch {
    $result.error = $_.Exception.Message
}

try {
    $proxyOutput = & netsh.exe winhttp show proxy 2>$null
    $proxyLine = ($proxyOutput | Where-Object { $_ -match 'Proxy' } | Select-Object -First 1)
    if ($proxyLine) { $result.proxy = Get-Clipped -Text ($proxyLine.Trim()) -Max 80 }
} catch { }

Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 4)
exit 0
