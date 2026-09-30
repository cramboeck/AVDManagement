# ZeroStress Cockpit - uninstall installed software without winget (one-off script)
# Finds the program by its exact display name in the Uninstall registry keys
# (64-bit, 32-bit, loaded user hives) or as an Appx/MSIX package, then runs the
# silent uninstall: msiexec for MSI, QuietUninstallString if present, known
# engines (Inno Setup, NSIS, InstallShield) with their silent switches. An EXE
# uninstaller without a known silent switch is NOT started unless extra
# arguments were supplied by the console; the script reports the command
# instead. Output: one JSON line (under 2000 characters). Exit 0 always.
# PowerShell 5.1, ASCII, no aliases. Contains no personal data.

$ErrorActionPreference = 'Stop'
$displayName = '__DISPLAY_NAME__'
$expectedVersion = '__VERSION__'
$kind = '__KIND__'
$extraArgs = '__EXTRA_ARGS__'
$timeoutSeconds = 900

$result = [ordered]@{
    schema = 'zsc.app-uninstall/1'
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
    displayName = $displayName
    kind = $kind
    found = $false
    matched = $null
    method = 'none'
    command = $null
    exitCode = $null
    success = $false
    rebootRequired = $false
    note = $null
    error = $null
}

function Get-Clipped {
    param([string]$Text, [int]$Max)
    if ([string]::IsNullOrEmpty($Text)) { return '' }
    if ($Text.Length -le $Max) { return $Text }
    return $Text.Substring(0, $Max - 3) + '...'
}

function Get-UninstallEntries {
    $paths = New-Object System.Collections.ArrayList
    [void]$paths.Add('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')
    [void]$paths.Add('HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
    if (-not (Test-Path -Path 'HKU:\')) {
        New-PSDrive -Name 'HKU' -PSProvider 'Registry' -Root 'HKEY_USERS' -ErrorAction SilentlyContinue | Out-Null
    }
    $hives = Get-ChildItem -Path 'HKU:\' -ErrorAction SilentlyContinue | Where-Object { $_.PSChildName -match '^S-1-5-21-' -and $_.PSChildName -notmatch '_Classes$' }
    foreach ($hive in $hives) {
        [void]$paths.Add(('HKU:\' + $hive.PSChildName + '\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'))
        [void]$paths.Add(('HKU:\' + $hive.PSChildName + '\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'))
    }
    $entries = New-Object System.Collections.ArrayList
    foreach ($path in $paths) {
        if (-not (Test-Path -Path $path)) { continue }
        $keys = Get-ChildItem -Path $path -ErrorAction SilentlyContinue
        foreach ($key in $keys) {
            $props = Get-ItemProperty -Path $key.PSPath -ErrorAction SilentlyContinue
            if (-not $props) { continue }
            $name = [string]$props.DisplayName
            if ([string]::IsNullOrWhiteSpace($name)) { continue }
            [void]$entries.Add([pscustomobject]@{
                name = $name.Trim()
                version = [string]$props.DisplayVersion
                publisher = [string]$props.Publisher
                keyName = $key.PSChildName
                scope = $(if ($path -like 'HKU:*') { 'user' } else { 'machine' })
                uninstallString = [string]$props.UninstallString
                quietUninstallString = [string]$props.QuietUninstallString
                windowsInstaller = $(if ($props.WindowsInstaller -eq 1) { $true } else { $false })
                installLocation = [string]$props.InstallLocation
            })
        }
    }
    return ,$entries
}

function Get-ExePath {
    param([string]$CommandLine)
    $line = $CommandLine.Trim()
    if ($line.StartsWith('"')) {
        $end = $line.IndexOf('"', 1)
        if ($end -gt 1) { return $line.Substring(1, $end - 1) }
    }
    $match = [regex]::Match($line, '^(.+?\.exe)', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($match.Success) { return $match.Groups[1].Value }
    return $line
}

function Get-Engine {
    param([string]$ExePath)
    if ([string]::IsNullOrWhiteSpace($ExePath) -or -not (Test-Path -LiteralPath $ExePath)) { return 'unknown' }
    $fileName = [System.IO.Path]::GetFileName($ExePath)
    $dir = [System.IO.Path]::GetDirectoryName($ExePath)
    if ($fileName -match '^unins\d{3}\.exe$' -and (Test-Path -LiteralPath (Join-Path -Path $dir -ChildPath ($fileName -replace '\.exe$', '.dat')))) { return 'inno' }
    try {
        $bytes = [System.IO.File]::ReadAllBytes($ExePath)
        $limit = [Math]::Min($bytes.Length, 4MB)
        $text = [System.Text.Encoding]::ASCII.GetString($bytes, 0, $limit)
        if ($text.Contains('Nullsoft')) { return 'nsis' }
        if ($text.Contains('Inno Setup')) { return 'inno' }
        if ($text.Contains('InstallShield')) { return 'installshield' }
    } catch { }
    return 'unknown'
}

function Invoke-Uninstall {
    param([string]$FilePath, [string]$Arguments)
    $result.command = Get-Clipped -Text (('"' + $FilePath + '" ' + $Arguments).Trim()) -Max 400
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -PassThru -WindowStyle Hidden -ErrorAction Stop
    $finished = $process.WaitForExit($timeoutSeconds * 1000)
    if (-not $finished) {
        try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch { }
        throw ('Uninstaller did not finish within ' + $timeoutSeconds + ' seconds and was stopped; it probably waited for user input')
    }
    return $process.ExitCode
}

function Invoke-CommandLine {
    param([string]$CommandLine)
    $result.command = Get-Clipped -Text $CommandLine -Max 400
    $comspec = Join-Path -Path $env:SystemRoot -ChildPath 'System32\cmd.exe'
    $process = Start-Process -FilePath $comspec -ArgumentList ('/d /c "' + $CommandLine + '"') -PassThru -WindowStyle Hidden -ErrorAction Stop
    $finished = $process.WaitForExit($timeoutSeconds * 1000)
    if (-not $finished) {
        try { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } catch { }
        throw ('Uninstaller did not finish within ' + $timeoutSeconds + ' seconds and was stopped; it probably waited for user input')
    }
    return $process.ExitCode
}

function Set-ExitResult {
    param([int]$Code)
    $result.exitCode = $Code
    switch ($Code) {
        0 { $result.success = $true }
        1605 { $result.success = $true; $result.note = 'product was not installed (msiexec 1605)' }
        3010 { $result.success = $true; $result.rebootRequired = $true; $result.note = 'reboot required to finish' }
        1641 { $result.success = $true; $result.rebootRequired = $true; $result.note = 'uninstaller initiated a reboot' }
        default { $result.note = ('uninstaller exit code ' + $Code) }
    }
}

try {
    if ($kind -eq 'appx') {
        $packages = @(Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq $displayName })
        $provisioned = @(Get-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -ieq $displayName })
        if ($packages.Count -eq 0 -and $provisioned.Count -eq 0) {
            $result.note = 'no Appx package with this name for any user'
            $result.success = $true
        } else {
            $result.found = $true
            $result.method = 'appx'
            $result.matched = [ordered]@{ name = $displayName; version = $(if ($packages.Count -gt 0) { [string]$packages[0].Version } else { $null }); publisher = $(if ($packages.Count -gt 0) { [string]$packages[0].Publisher } else { $null }); scope = 'allusers' }
            foreach ($package in $packages) {
                Remove-AppxPackage -Package $package.PackageFullName -AllUsers -ErrorAction Stop
            }
            foreach ($prov in $provisioned) {
                Remove-AppxProvisionedPackage -Online -PackageName $prov.PackageName -ErrorAction Stop | Out-Null
            }
            $remaining = @(Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue | Where-Object { $_.Name -ieq $displayName })
            $result.exitCode = 0
            $result.success = ($remaining.Count -eq 0)
            if (-not $result.success) { $result.note = 'package still present after removal' }
            $result.command = ('Remove-AppxPackage -AllUsers ' + $packages.Count + ' package(s), Remove-AppxProvisionedPackage ' + $provisioned.Count)
        }
    } else {
        $entries = Get-UninstallEntries
        $candidates = @($entries | Where-Object { $_.name -ieq $displayName })
        if ($candidates.Count -gt 1 -and -not [string]::IsNullOrEmpty($expectedVersion)) {
            $byVersion = @($candidates | Where-Object { $_.version -eq $expectedVersion })
            if ($byVersion.Count -gt 0) { $candidates = $byVersion }
        }
        if ($candidates.Count -eq 0) {
            $result.note = 'no Uninstall registry entry with this exact display name'
            $result.success = $true
        } else {
            $entry = $candidates[0]
            $result.found = $true
            $result.matched = [ordered]@{ name = $entry.name; version = $entry.version; publisher = $entry.publisher; scope = $entry.scope; key = $entry.keyName }
            $productCode = $null
            if ($entry.keyName -match '^\{[0-9A-Fa-f-]{36}\}$') { $productCode = $entry.keyName }
            elseif ($entry.uninstallString -match '\{[0-9A-Fa-f-]{36}\}') { $productCode = $Matches[0] }

            if ($entry.windowsInstaller -or ($entry.uninstallString -match '(?i)msiexec' -and $productCode)) {
                if (-not $productCode) { throw 'MSI entry without product code' }
                $result.method = 'msi'
                $arguments = '/x ' + $productCode + ' /qn /norestart REBOOT=ReallySuppress'
                if (-not [string]::IsNullOrWhiteSpace($extraArgs)) { $arguments = $arguments + ' ' + $extraArgs }
                $code = Invoke-Uninstall -FilePath (Join-Path -Path $env:SystemRoot -ChildPath 'System32\msiexec.exe') -Arguments $arguments
                Set-ExitResult -Code $code
            }
            elseif (-not [string]::IsNullOrWhiteSpace($entry.quietUninstallString)) {
                $result.method = 'quiet'
                $line = $entry.quietUninstallString
                if (-not [string]::IsNullOrWhiteSpace($extraArgs)) { $line = $line + ' ' + $extraArgs }
                $code = Invoke-CommandLine -CommandLine $line
                Set-ExitResult -Code $code
            }
            elseif (-not [string]::IsNullOrWhiteSpace($entry.uninstallString)) {
                $exe = Get-ExePath -CommandLine $entry.uninstallString
                $engine = Get-Engine -ExePath $exe
                if (-not [string]::IsNullOrWhiteSpace($extraArgs)) {
                    $result.method = 'custom'
                    $code = Invoke-CommandLine -CommandLine ($entry.uninstallString + ' ' + $extraArgs)
                    Set-ExitResult -Code $code
                }
                elseif ($engine -eq 'inno') {
                    $result.method = 'inno'
                    $code = Invoke-Uninstall -FilePath $exe -Arguments '/VERYSILENT /NORESTART /SUPPRESSMSGBOXES'
                    Set-ExitResult -Code $code
                }
                elseif ($engine -eq 'nsis') {
                    $result.method = 'nsis'
                    $code = Invoke-Uninstall -FilePath $exe -Arguments '/S'
                    Set-ExitResult -Code $code
                }
                elseif ($engine -eq 'installshield') {
                    $result.method = 'installshield'
                    $code = Invoke-Uninstall -FilePath $exe -Arguments '/s /x /v"/qn REBOOT=ReallySuppress"'
                    Set-ExitResult -Code $code
                }
                else {
                    $result.method = 'none'
                    $result.command = Get-Clipped -Text $entry.uninstallString -Max 400
                    $result.note = 'no silent switch known for this uninstaller; supply arguments in the console and retry'
                }
            }
            else {
                $result.note = 'registry entry has no uninstall command'
            }
        }
    }
} catch {
    $result.error = Get-Clipped -Text $_.Exception.Message -Max 400
}

$json = $result | ConvertTo-Json -Compress -Depth 4
if ($json.Length -gt 1990) {
    $result.command = Get-Clipped -Text ([string]$result.command) -Max 120
    $json = $result | ConvertTo-Json -Compress -Depth 4
}
Write-Output $json
exit 0
