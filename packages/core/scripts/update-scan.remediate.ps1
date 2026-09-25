# ZeroStress Cockpit - Update-Scan (Behebung)
# Fuehrt einen Online-Scan gegen die konfigurierte Updatequelle aus
# (Windows Update, WSUS oder Windows Update for Business) und schreibt das
# Ergebnis als Markerdatei, die das Erkennungsskript anschliessend ausgibt.
# Installiert nichts. Exit 0 = Scan abgeschlossen, Exit 1 = Scan fehlgeschlagen.
# PowerShell 5.1, ASCII, keine Aliase. Enthaelt keine personenbezogenen Daten.

$ErrorActionPreference = 'Stop'
$maxEntries = 8
$maxTitleLength = 70
$markerDirectory = Join-Path -Path $env:ProgramData -ChildPath 'ZeroStress'
$markerPath = Join-Path -Path $markerDirectory -ChildPath 'update-scan.json'

$result = [ordered]@{
    schema = 'zsc.update-scan/1'
    state = 'scanned'
    scannedAt = $null
    durationSeconds = 0
    pendingCount = 0
    pending = @()
    truncated = $false
    rebootRequired = $false
    error = $null
}

function Get-ShortTitle {
    param([string]$Title)
    if ([string]::IsNullOrEmpty($Title)) { return '' }
    if ($Title.Length -le $maxTitleLength) { return $Title }
    return $Title.Substring(0, $maxTitleLength - 3) + '...'
}

$started = Get-Date
try {
    $session = New-Object -ComObject 'Microsoft.Update.Session'
    $searcher = $session.CreateUpdateSearcher()
    $searcher.Online = $true
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
} catch {
    $result.state = 'failed'
    $result.error = $_.Exception.Message
}

$result.scannedAt = (Get-Date).ToUniversalTime().ToString('o')
$result.durationSeconds = [int]((Get-Date) - $started).TotalSeconds

$rebootKeys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
)
foreach ($key in $rebootKeys) {
    if (Test-Path -Path $key) { $result.rebootRequired = $true }
}

$json = ConvertTo-Json -InputObject $result -Compress -Depth 4
if (-not (Test-Path -Path $markerDirectory)) {
    New-Item -Path $markerDirectory -ItemType Directory -Force | Out-Null
}
Set-Content -Path $markerPath -Value $json -Encoding UTF8 -Force

Write-Output $json
if ($result.state -eq 'failed') { exit 1 }
exit 0
