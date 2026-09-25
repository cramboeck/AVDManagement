# ZeroStress Cockpit - winget-Updates (Erkennung)
# Fragt winget auf dem Geraet nach verfuegbaren Updates fuer installierte
# Software (Maschinenkontext, Quelle winget). Installiert nichts.
# Die Tabellenausgabe von winget ist sprachabhaengig; die Spalten werden
# deshalb ueber die Trennlinie und die Positionen der Kopfzeile bestimmt,
# nicht ueber Spaltennamen. Reihenfolge ist immer Name, Id, Version,
# Verfuegbar, Quelle.
# Ausgabe: genau eine JSON-Zeile (unter 2000 Zeichen). Exit 0 = nur Information.
# PowerShell 5.1, ASCII, keine Aliase. Enthaelt keine personenbezogenen Daten.

$ErrorActionPreference = 'Stop'
$maxEntries = 15
$maxNameLength = 24
$maxIdLength = 40

$result = [ordered]@{
    schema = 'zsc.winget-updates/1'
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
    wingetVersion = $null
    scope = 'machine'
    updateCount = 0
    updates = @()
    truncated = $false
    error = $null
}

function Get-Clipped {
    param([string]$Text, [int]$Max)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    if ($Text.Length -le $Max) { return $Text }
    return $Text.Substring(0, $Max - 3) + '...'
}

function Find-Winget {
    $candidates = New-Object System.Collections.ArrayList
    $command = Get-Command -Name 'winget.exe' -ErrorAction SilentlyContinue
    if ($command -and $command.Source) { [void]$candidates.Add($command.Source) }
    $appsRoot = Join-Path -Path $env:ProgramFiles -ChildPath 'WindowsApps'
    if (Test-Path -Path $appsRoot) {
        $packages = Get-ChildItem -Path $appsRoot -Directory -Filter 'Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe' -ErrorAction SilentlyContinue |
            Sort-Object -Property Name -Descending
        foreach ($package in $packages) {
            [void]$candidates.Add((Join-Path -Path $package.FullName -ChildPath 'winget.exe'))
        }
    }
    foreach ($candidate in $candidates) {
        if (Test-Path -Path $candidate) { return $candidate }
    }
    return $null
}

function Get-Cell {
    param([string]$Line, [int]$Start, [int]$End)
    if ($Line.Length -le $Start) { return '' }
    if ($End -lt 0 -or $End -gt $Line.Length) { $End = $Line.Length }
    return $Line.Substring($Start, $End - $Start).Trim()
}

function ConvertFrom-WingetTable {
    param([string[]]$Lines)
    $entries = New-Object System.Collections.ArrayList
    for ($i = 1; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -notmatch '^\s*-{5,}\s*$') { continue }
        $header = $Lines[$i - 1]
        $columns = [regex]::Matches($header, '\S+')
        if ($columns.Count -lt 4) { continue }
        $starts = New-Object System.Collections.ArrayList
        foreach ($column in $columns) { [void]$starts.Add($column.Index) }
        for ($row = $i + 1; $row -lt $Lines.Count; $row++) {
            $line = $Lines[$row]
            if ([string]::IsNullOrWhiteSpace($line)) { break }
            if ($line -match '^\s*-{5,}\s*$') { break }
            if ($line.Length -le $starts[2]) { break }
            $id = Get-Cell -Line $line -Start $starts[1] -End $starts[2]
            $available = Get-Cell -Line $line -Start $starts[3] -End $(if ($starts.Count -gt 4) { $starts[4] } else { -1 })
            if ([string]::IsNullOrEmpty($id) -or [string]::IsNullOrEmpty($available)) { continue }
            [void]$entries.Add([ordered]@{
                name = Get-Clipped -Text (Get-Cell -Line $line -Start $starts[0] -End $starts[1]) -Max $maxNameLength
                id = Get-Clipped -Text $id -Max $maxIdLength
                installed = Get-Cell -Line $line -Start $starts[2] -End $starts[3]
                available = $available
            })
        }
        $i = $row
    }
    return $entries
}

try {
    $winget = Find-Winget
    if (-not $winget) {
        throw 'winget.exe not found; App Installer (Microsoft.DesktopAppInstaller) is missing or not provisioned for SYSTEM'
    }

    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

    # Native Befehle melden Fortschritt ueber stderr; das darf kein Abbruch sein
    $ErrorActionPreference = 'Continue'
    $versionLines = @(& $winget --version 2>&1 | ForEach-Object { [string]$_ })
    if ($versionLines.Count -gt 0) { $result.wingetVersion = ($versionLines[-1]).Trim() }

    $rawLines = @(& $winget upgrade --include-unknown --accept-source-agreements --disable-interactivity --source winget 2>&1 |
        ForEach-Object { [string]$_ })
    $ErrorActionPreference = 'Stop'

    # Fortschrittszeichen und Wagenruecklaeufe entfernen
    $lines = New-Object System.Collections.ArrayList
    foreach ($raw in $rawLines) {
        foreach ($part in ($raw -split "`r")) {
            $clean = $part -replace '[\x08]', ''
            [void]$lines.Add($clean)
        }
    }

    $entries = ConvertFrom-WingetTable -Lines ([string[]]$lines)
    $result.updateCount = $entries.Count
    if ($entries.Count -gt $maxEntries) {
        $result.truncated = $true
        $result.updates = @($entries.GetRange(0, $maxEntries))
    } else {
        $result.updates = @($entries)
    }
} catch {
    $result.error = $_.Exception.Message
}

Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 4)
exit 0
