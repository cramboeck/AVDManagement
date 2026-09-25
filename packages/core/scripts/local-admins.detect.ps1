# ZeroStress Cockpit - Lokale Administratoren (Erkennung)
# Listet die Mitglieder der lokalen Gruppe Administratoren (SID S-1-5-32-544)
# ueber ADSI, weil Get-LocalGroupMember bei Entra-Konten auf manchen Builds
# fehlschlaegt. Je Mitglied: Name, Herkunft (lokal, Entra, Domaene), Klasse,
# SID, bei lokalen Konten aktiviert und letzte Anmeldung.
# ACHTUNG: Die Ausgabe enthaelt Kontonamen und ist damit personenbezogen.
# Die Konsole speichert sie verschluesselt und protokolliert jeden Blick.
# Ausgabe: genau eine JSON-Zeile (unter 2000 Zeichen). Exit 0 = nur Information.
# PowerShell 5.1, ASCII, keine Aliase.

$ErrorActionPreference = 'Stop'
$maxEntries = 12

$result = [ordered]@{
    schema = 'zsc.local-admins/1'
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
    hostname = $env:COMPUTERNAME
    members = @()
    memberCount = 0
    truncated = $false
    error = $null
}

function Get-SidString {
    param($Bytes)
    try {
        if ($null -eq $Bytes) { return '' }
        $sid = New-Object System.Security.Principal.SecurityIdentifier($Bytes, 0)
        return $sid.Value
    } catch {
        return ''
    }
}

try {
    $localUsers = @{}
    try {
        foreach ($u in (Get-LocalUser -ErrorAction Stop)) {
            $localUsers[$u.SID.Value] = $u
        }
    } catch { }

    $group = [ADSI]'WinNT://./Administrators,group'
    $entries = New-Object System.Collections.ArrayList
    foreach ($member in @($group.Invoke('Members'))) {
        $adsPath = [string]$member.GetType().InvokeMember('AdsPath', 'GetProperty', $null, $member, $null)
        $class = [string]$member.GetType().InvokeMember('Class', 'GetProperty', $null, $member, $null)
        $sidBytes = $null
        try { $sidBytes = $member.GetType().InvokeMember('objectSid', 'GetProperty', $null, $member, $null) } catch { }
        $sid = Get-SidString -Bytes $sidBytes

        # WinNT://DOMAIN/name, WinNT://AzureAD/name oder WinNT://S-1-12-1-...
        $path = $adsPath -replace '^WinNT://', ''
        $parts = $path -split '/'
        $source = 'Unknown'
        $name = $path
        if ($parts.Count -ge 2) {
            $name = $parts[$parts.Count - 1]
            $scope = $parts[0]
            if ($scope -ieq $env:COMPUTERNAME) { $source = 'Local' }
            elseif ($scope -ieq 'AzureAD') { $source = 'AzureAD' }
            elseif ($scope -match '^S-1-12-1-') { $source = 'AzureAD'; $name = $scope }
            elseif ($scope -match '^S-1-') { $source = 'Unknown'; $name = $scope }
            else { $source = 'Domain' }
        } elseif ($path -match '^S-1-12-1-') {
            $source = 'AzureAD'
        }
        if ([string]::IsNullOrEmpty($sid) -and $name -match '^S-1-') { $sid = $name }

        $enabled = $null
        $lastLogon = $null
        $builtIn = $false
        if ($source -eq 'Local' -and $localUsers.ContainsKey($sid)) {
            $u = $localUsers[$sid]
            $enabled = [bool]$u.Enabled
            if ($u.LastLogon) { $lastLogon = $u.LastLogon.ToUniversalTime().ToString('o') }
        }
        if ($sid -match '-500$') { $builtIn = $true }

        [void]$entries.Add([ordered]@{
            name = $name
            source = $source
            class = $class
            sid = $sid
            enabled = $enabled
            builtIn = $builtIn
            lastLogonAt = $lastLogon
        })
    }

    $result.memberCount = $entries.Count
    if ($entries.Count -gt $maxEntries) {
        $result.truncated = $true
        $result.members = @($entries.GetRange(0, $maxEntries))
    } else {
        $result.members = @($entries)
    }
} catch {
    $result.error = $_.Exception.Message
}

Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 4)
exit 0
