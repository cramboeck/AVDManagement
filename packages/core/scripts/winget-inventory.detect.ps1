# ZeroStress Cockpit - winget-Inventar (Erkennung)
# Listet die installierte Software, die winget der Quelle winget zuordnen
# kann (Maschinenkontext), als kompakte Liste von Paket-Ids. Installiert
# nichts. Weil Intune die Ausgabe auf 2048 Zeichen kuerzt, werden nur die
# Ids uebertragen (Versionen liefert das Intune-Inventar); bei sehr vielen
# Paketen wird die Liste gekuerzt und das gemeldet.
# Ausgabe: genau eine JSON-Zeile (unter 2000 Zeichen). Exit 0 = nur Information.
# PowerShell 5.1, ASCII, keine Aliase. Enthaelt keine personenbezogenen Daten.

$ErrorActionPreference = 'Stop'
$maxIdChars = 1750
$maxIdLength = 60

$result = [ordered]@{
    schema = 'zsc.winget-inventory/1'
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
    wingetVersion = $null
    scope = 'machine'
    count = 0
    ids = ''
    truncated = $false
    error = $null
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

function Get-WingetIds {
    param([string[]]$Lines)
    $ids = New-Object System.Collections.ArrayList
    for ($i = 1; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -notmatch '^\s*-{5,}\s*$') { continue }
        $header = $Lines[$i - 1]
        $columns = [regex]::Matches($header, '\S+')
        if ($columns.Count -lt 3) { continue }
        $starts = New-Object System.Collections.ArrayList
        foreach ($column in $columns) { [void]$starts.Add($column.Index) }
        for ($row = $i + 1; $row -lt $Lines.Count; $row++) {
            $line = $Lines[$row]
            if ([string]::IsNullOrWhiteSpace($line)) { break }
            if ($line -match '^\s*-{5,}\s*$') { break }
            if ($line.Length -le $starts[1]) { continue }
            $id = Get-Cell -Line $line -Start $starts[1] -End $starts[2]
            # Nur echte Katalog-Ids (Herausgeber.Paket); ARP-Eintraege ohne Quelle haben keine
            if ([string]::IsNullOrEmpty($id) -or $id -notmatch '^[A-Za-z0-9][A-Za-z0-9._+-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$') { continue }
            if ($id.Length -gt $maxIdLength) { continue }
            if (-not $ids.Contains($id)) { [void]$ids.Add($id) }
        }
        $i = $row
    }
    return $ids
}

try {
    $winget = Find-Winget
    if (-not $winget) {
        throw 'winget.exe not found; App Installer (Microsoft.DesktopAppInstaller) is missing or not provisioned for SYSTEM'
    }
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

    $ErrorActionPreference = 'Continue'
    $versionLines = @(& $winget --version 2>&1 | ForEach-Object { [string]$_ })
    if ($versionLines.Count -gt 0) { $result.wingetVersion = ($versionLines[-1]).Trim() }

    $rawLines = @(& $winget list --source winget --accept-source-agreements --disable-interactivity 2>&1 | ForEach-Object { [string]$_ })
    $ErrorActionPreference = 'Stop'

    $lines = New-Object System.Collections.ArrayList
    foreach ($raw in $rawLines) {
        foreach ($part in ($raw -split "`r")) {
            [void]$lines.Add(($part -replace '[\x08]', ''))
        }
    }

    $ids = Get-WingetIds -Lines ([string[]]$lines)
    $result.count = $ids.Count
    $builder = New-Object System.Text.StringBuilder
    foreach ($id in $ids) {
        $next = $(if ($builder.Length -eq 0) { $id } else { ';' + $id })
        if (($builder.Length + $next.Length) -gt $maxIdChars) { $result.truncated = $true; break }
        [void]$builder.Append($next)
    }
    $result.ids = $builder.ToString()
} catch {
    $result.error = $_.Exception.Message
}

Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 3)
exit 0
