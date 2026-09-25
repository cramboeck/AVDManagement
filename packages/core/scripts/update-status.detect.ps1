# ZeroStress Cockpit - Update-Stand (Erkennung)
# Liest ausstehende Windows-Updates aus dem lokalen Update-Cache, ohne einen
# Online-Scan auszuloesen, und meldet Neustartbedarf sowie die letzten
# erfolgreichen Such- und Installationszeitpunkte.
# Ausgabe: genau eine JSON-Zeile (unter 2000 Zeichen). Exit 0 = nur Information.
# PowerShell 5.1, ASCII, keine Aliase. Enthaelt keine personenbezogenen Daten.

$ErrorActionPreference = 'Stop'
$maxEntries = 8
$maxTitleLength = 70

$result = [ordered]@{
    schema = 'zsc.update-status/1'
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
    pendingCount = 0
    pending = @()
    truncated = $false
    rebootRequired = $false
    lastSearchAt = $null
    lastInstallAt = $null
    error = $null
}

function Get-ShortTitle {
    param([string]$Title)
    if ([string]::IsNullOrEmpty($Title)) { return '' }
    if ($Title.Length -le $maxTitleLength) { return $Title }
    return $Title.Substring(0, $maxTitleLength - 3) + '...'
}

try {
    $session = New-Object -ComObject 'Microsoft.Update.Session'
    $searcher = $session.CreateUpdateSearcher()
    $searcher.Online = $false
    $search = $searcher.Search('IsInstalled=0 and IsHidden=0')

    $entries = New-Object System.Collections.ArrayList
    foreach ($update in $search.Updates) {
        $kb = ''
        if ($update.KBArticleIDs.Count -gt 0) { $kb = 'KB' + [string]$update.KBArticleIDs.Item(0) }
        [void]$entries.Add([ordered]@{
            title = Get-ShortTitle -Title ([string]$update.Title)
            kb = $kb
            severity = [string]$update.MsrcSeverity
            downloaded = [bool]$update.IsDownloaded
        })
    }

    $result.pendingCount = $entries.Count
    if ($entries.Count -gt $maxEntries) {
        $result.truncated = $true
        $result.pending = @($entries.GetRange(0, $maxEntries))
    } else {
        $result.pending = @($entries)
    }

    $autoUpdate = New-Object -ComObject 'Microsoft.Update.AutoUpdate'
    $searchDate = $autoUpdate.Results.LastSearchSuccessDate
    if ($searchDate -and $searchDate -is [DateTime]) {
        $result.lastSearchAt = $searchDate.ToUniversalTime().ToString('o')
    }
    $installDate = $autoUpdate.Results.LastInstallationSuccessDate
    if ($installDate -and $installDate -is [DateTime]) {
        $result.lastInstallAt = $installDate.ToUniversalTime().ToString('o')
    }
} catch {
    $result.error = $_.Exception.Message
}

$rebootKeys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
)
foreach ($key in $rebootKeys) {
    if (Test-Path -Path $key) { $result.rebootRequired = $true }
}

Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 4)
exit 0
