# ZeroStress Cockpit - Update-Scan (Erkennung)
# Prueft, ob in den letzten 15 Minuten ein Online-Scan durch das
# Behebungsskript gelaufen ist (Markerdatei). Wenn nicht: Exit 1, Intune
# startet dann das Behebungsskript, das den Scan ausfuehrt und die
# Markerdatei schreibt. Der zweite Durchlauf der Erkennung liefert das
# Ergebnis des Scans als JSON.
# PowerShell 5.1, ASCII, keine Aliase. Enthaelt keine personenbezogenen Daten.

$ErrorActionPreference = 'Stop'
$freshMinutes = 15
$markerPath = Join-Path -Path $env:ProgramData -ChildPath 'ZeroStress\update-scan.json'

if (Test-Path -Path $markerPath) {
    try {
        $raw = Get-Content -Path $markerPath -Raw -Encoding UTF8
        $marker = ConvertFrom-Json -InputObject $raw
        $scannedAt = [DateTime]::Parse($marker.scannedAt).ToUniversalTime()
        $ageMinutes = ((Get-Date).ToUniversalTime() - $scannedAt).TotalMinutes
        if ($ageMinutes -lt $freshMinutes) {
            Write-Output $raw.Trim()
            exit 0
        }
    } catch {
        # Unlesbarer Marker: Scan erneut anfordern
    }
}

$pending = [ordered]@{
    schema = 'zsc.update-scan/1'
    state = 'scan-needed'
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
}
Write-Output (ConvertTo-Json -InputObject $pending -Compress)
exit 1
