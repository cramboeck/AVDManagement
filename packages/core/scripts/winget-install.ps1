# ZeroStress Cockpit - winget install/upgrade (one-off script with embedded parameters)
# Installs or upgrades exactly one package from the winget source in machine
# scope. The package id, mode and optional version are embedded by the
# console after strict validation; there is no free text. Output: one JSON
# line (under 2000 characters). Exit 0 always; the JSON carries the result.
# PowerShell 5.1, ASCII, no aliases. Contains no personal data.

$ErrorActionPreference = 'Stop'
$packageId = '__PACKAGE_ID__'
$mode = '__MODE__'
$requestedVersion = '__VERSION__'

$result = [ordered]@{
    schema = 'zsc.winget-install/1'
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
    id = $packageId
    mode = $mode
    requestedVersion = $(if ([string]::IsNullOrEmpty($requestedVersion)) { $null } else { $requestedVersion })
    wingetVersion = $null
    exitCode = $null
    success = $false
    note = $null
    installedVersion = $null
    message = $null
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

function Get-CleanLines {
    param([string[]]$Raw)
    $lines = New-Object System.Collections.ArrayList
    foreach ($item in $Raw) {
        foreach ($part in ($item -split "`r")) {
            $clean = ($part -replace '[\x08]', '').Trim()
            if ($clean -match '^[\s\-\\|/]*$') { continue }
            [void]$lines.Add($clean)
        }
    }
    return $lines
}

function Get-InstalledVersion {
    param([string]$Winget, [string]$Id)
    $raw = @(& $Winget list --id $Id --exact --source winget --accept-source-agreements --disable-interactivity 2>&1 | ForEach-Object { [string]$_ })
    $lines = Get-CleanLines -Raw $raw
    foreach ($line in $lines) {
        $tokens = @($line -split '\s{2,}')
        for ($i = 0; $i -lt $tokens.Count; $i++) {
            if ($tokens[$i] -ieq $Id -and ($i + 1) -lt $tokens.Count) { return $tokens[$i + 1] }
        }
    }
    return $null
}

try {
    if ($mode -ne 'install' -and $mode -ne 'upgrade') { throw ('Unsupported mode: ' + $mode) }
    $winget = Find-Winget
    if (-not $winget) {
        throw 'winget.exe not found; App Installer (Microsoft.DesktopAppInstaller) is missing or not provisioned for SYSTEM'
    }
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

    $ErrorActionPreference = 'Continue'
    $versionLines = @(& $winget --version 2>&1 | ForEach-Object { [string]$_ })
    if ($versionLines.Count -gt 0) { $result.wingetVersion = ($versionLines[-1]).Trim() }

    $arguments = New-Object System.Collections.ArrayList
    [void]$arguments.Add($mode)
    [void]$arguments.AddRange(@('--id', $packageId, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity', '--source', 'winget', '--scope', 'machine'))
    if (-not [string]::IsNullOrEmpty($requestedVersion)) { [void]$arguments.AddRange(@('--version', $requestedVersion)) }
    if ($mode -eq 'upgrade') { [void]$arguments.Add('--include-unknown') }

    $raw = @(& $winget @arguments 2>&1 | ForEach-Object { [string]$_ })
    $exitCode = $LASTEXITCODE
    $result.exitCode = $exitCode
    $lines = Get-CleanLines -Raw $raw
    $tail = @()
    if ($lines.Count -gt 0) {
        $start = [Math]::Max(0, $lines.Count - 3)
        $tail = @($lines.GetRange($start, $lines.Count - $start))
    }
    $result.message = Get-Clipped -Text ($tail -join ' | ') -Max 300

    switch ($exitCode) {
        0 { $result.success = $true }
        -1978335189 { $result.success = $true; $result.note = 'no applicable update; already current' }
        -1978335212 { $result.note = 'no package found matching the id' }
        -1978335216 { $result.note = 'no applicable installer for this device (architecture or scope)' }
        -1978334967 { $result.note = 'installer failed; see message' }
        -1978335135 { $result.note = 'a reboot is required to finish the installation'; $result.success = $true }
        default { }
    }

    $result.installedVersion = Get-InstalledVersion -Winget $winget -Id $packageId
    $ErrorActionPreference = 'Stop'
} catch {
    $result.error = $_.Exception.Message
}

Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 3)
exit 0
