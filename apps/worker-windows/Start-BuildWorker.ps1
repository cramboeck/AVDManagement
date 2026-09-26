<#
.SYNOPSIS
    ZeroStress Cockpit build worker: turns installer plus manifest into .intunewin.

.DESCRIPTION
    Polls the Cockpit API for build jobs, downloads the installer, generates a
    PSAppDeployToolkit v4 wrapper from the build plan (or packages the
    installer as is), runs IntuneWinAppUtil.exe, uploads the artifact and
    reports the result. PowerShell 5.1 compatible, ASCII only, no aliases.

    Authentication: Bearer token from ZSC_WORKER_TOKEN or the DPAPI file
    worker.token written by Set-WorkerToken.ps1. The token never lands in
    the config file or the log.

.PARAMETER ConfigPath
    Path to worker.config.json (see worker.config.example.json).

.PARAMETER Once
    Process at most one build, then exit. Useful for scheduled tasks.
#>
[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path -Path $PSScriptRoot -ChildPath 'worker.config.json'),
    [switch]$Once
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

$script:LogLines = New-Object -TypeName System.Collections.Generic.List[string]
$script:Config = $null
$script:Token = $null
$script:TemplatePath = Join-Path -Path $PSScriptRoot -ChildPath 'templates\Invoke-AppDeployToolkit.template.ps1'

function Write-Log {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
    )
    $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] [' + $Level + '] ' + $Message
    $script:LogLines.Add($line)
    if ($Level -eq 'ERROR') { Write-Host $line -ForegroundColor Red }
    elseif ($Level -eq 'WARN') { Write-Host $line -ForegroundColor Yellow }
    else { Write-Host $line }
}

function Read-Config {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw ('Config not found: ' + $Path + ' (copy worker.config.example.json)')
    }
    $raw = Get-Content -LiteralPath $Path -Raw
    $cfg = ConvertFrom-Json -InputObject $raw
    foreach ($name in @('apiUrl', 'workDir', 'intuneWinAppUtilPath')) {
        if (-not ($cfg.PSObject.Properties.Name -contains $name) -or [string]::IsNullOrWhiteSpace([string]$cfg.$name)) {
            throw ('Config value missing: ' + $name)
        }
    }
    if (-not ($cfg.PSObject.Properties.Name -contains 'workerId') -or [string]::IsNullOrWhiteSpace([string]$cfg.workerId)) {
        Add-Member -InputObject $cfg -MemberType NoteProperty -Name 'workerId' -Value $env:COMPUTERNAME -Force
    }
    if (-not ($cfg.PSObject.Properties.Name -contains 'pollSeconds') -or -not $cfg.pollSeconds) {
        Add-Member -InputObject $cfg -MemberType NoteProperty -Name 'pollSeconds' -Value 30 -Force
    }
    if (-not ($cfg.PSObject.Properties.Name -contains 'psadtTemplatePath')) {
        Add-Member -InputObject $cfg -MemberType NoteProperty -Name 'psadtTemplatePath' -Value $null -Force
    }
    if (-not ($cfg.PSObject.Properties.Name -contains 'signingThumbprint')) {
        Add-Member -InputObject $cfg -MemberType NoteProperty -Name 'signingThumbprint' -Value $null -Force
    }
    if (-not ($cfg.PSObject.Properties.Name -contains 'keepWorkFolders')) {
        Add-Member -InputObject $cfg -MemberType NoteProperty -Name 'keepWorkFolders' -Value $false -Force
    }
    if ($cfg.workerId -notmatch '^[A-Za-z0-9._-]{1,100}$') {
        throw 'workerId may only contain letters, digits, dot, underscore and dash'
    }
    $cfg.apiUrl = ([string]$cfg.apiUrl).TrimEnd('/')
    if ($cfg.apiUrl -notmatch '^https://' -and $cfg.apiUrl -notmatch '^http://(localhost|127\.0\.0\.1)') {
        throw 'apiUrl must use https (http only for localhost)'
    }
    if (-not (Test-Path -LiteralPath $cfg.intuneWinAppUtilPath -PathType Leaf)) {
        throw ('IntuneWinAppUtil.exe not found: ' + $cfg.intuneWinAppUtilPath)
    }
    return $cfg
}

function Read-Token {
    if (-not [string]::IsNullOrWhiteSpace($env:ZSC_WORKER_TOKEN)) {
        return $env:ZSC_WORKER_TOKEN
    }
    $tokenFile = Join-Path -Path $PSScriptRoot -ChildPath 'worker.token'
    if (Test-Path -LiteralPath $tokenFile -PathType Leaf) {
        $secure = ConvertTo-SecureString -String (Get-Content -LiteralPath $tokenFile -Raw).Trim()
        $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        }
        finally {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        }
    }
    throw 'No worker token: set ZSC_WORKER_TOKEN or run Set-WorkerToken.ps1'
}

function Invoke-Api {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST', 'PUT')][string]$Method,
        [Parameter(Mandatory = $true)][string]$Path,
        [object]$Body = $null,
        [string]$OutFile = $null,
        [string]$InFile = $null
    )
    $headers = @{
        'Authorization' = 'Bearer ' + $script:Token
        'X-Worker-Id' = [string]$script:Config.workerId
    }
    $uri = $script:Config.apiUrl + $Path
    $params = @{
        Method = $Method
        Uri = $uri
        Headers = $headers
        UseBasicParsing = $true
        TimeoutSec = 3600
    }
    if ($OutFile) { $params['OutFile'] = $OutFile }
    if ($InFile) {
        $params['InFile'] = $InFile
        $params['ContentType'] = 'application/octet-stream'
    }
    elseif ($null -ne $Body) {
        $params['Body'] = (ConvertTo-Json -InputObject $Body -Depth 10 -Compress)
        $params['ContentType'] = 'application/json; charset=utf-8'
    }
    $response = Invoke-WebRequest @params
    if ($OutFile) { return $response }
    if ($response.StatusCode -eq 204 -or [string]::IsNullOrWhiteSpace($response.Content)) { return $null }
    return ConvertFrom-Json -InputObject $response.Content
}

function Send-BuildLog {
    param([string]$BuildId, [string]$Message)
    try {
        Invoke-Api -Method 'POST' -Path ('/worker/builds/' + $BuildId + '/log') -Body @{ message = $Message } | Out-Null
    }
    catch {
        Write-Log -Message ('Progress report failed: ' + $_.Exception.Message) -Level 'WARN'
    }
}

function Write-Step {
    param([string]$BuildId, [string]$Message)
    Write-Log -Message $Message
    Send-BuildLog -BuildId $BuildId -Message $Message
}

function ConvertTo-PsLiteral {
    param([AllowNull()][AllowEmptyString()][string]$Value)
    if ($null -eq $Value) { $Value = '' }
    return "'" + $Value.Replace("'", "''") + "'"
}

function Get-Installer {
    param([object]$Plan, [string]$Folder)
    $target = Join-Path -Path $Folder -ChildPath $Plan.installer.fileName
    Invoke-Api -Method 'GET' -Path ('/worker/builds/' + $Plan.buildId + '/installer') -OutFile $target | Out-Null
    $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne ([string]$Plan.installer.sha256).ToLowerInvariant()) {
        throw ('Installer hash mismatch: expected ' + $Plan.installer.sha256 + ', got ' + $hash)
    }
    return $target
}

function New-InstallBlock {
    param([object]$Plan)
    if ([string]$Plan.manifest.installerType -ne 'psadt') { throw 'Install block is only generated for psadt packages' }
    $installerKind = if ($Plan.installer.fileName -match '\.msi$') { 'msi' } else { 'exe' }
    $installerArguments = [string]$Plan.installerArguments
    $lines = New-Object -TypeName System.Collections.Generic.List[string]
    if ($installerKind -eq 'msi') {
        $line = '    Start-ADTMsiProcess -Action ''Install'' -FilePath $installerPath'
        if (-not [string]::IsNullOrWhiteSpace($installerArguments)) { $line += ' -AdditionalArgumentList ' + (ConvertTo-PsLiteral -Value $installerArguments) }
        $lines.Add($line)
    }
    else {
        $line = '    Start-ADTProcess -FilePath $installerPath'
        if (-not [string]::IsNullOrWhiteSpace($installerArguments)) { $line += ' -ArgumentList ' + (ConvertTo-PsLiteral -Value $installerArguments) }
        $line += ' -WindowStyle ''Hidden'''
        $lines.Add($line)
    }
    return ($lines -join "`r`n")
}

function New-UninstallBlock {
    param([object]$Plan)
    $installerKind = if ($Plan.installer.fileName -match '\.msi$') { 'msi' } else { 'exe' }
    $cmd = [string]$Plan.uninstallCommand
    $lines = New-Object -TypeName System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($cmd)) {
        # cmd /c with an extra pair of quotes keeps inner quotes intact
        $lines.Add('    $uninstallLine = ' + (ConvertTo-PsLiteral -Value $cmd))
        $lines.Add('    Start-ADTProcess -FilePath (Join-Path -Path $env:SystemRoot -ChildPath ''System32\cmd.exe'') -ArgumentList (''/c "'' + $uninstallLine + ''"'') -WindowStyle ''Hidden''')
    }
    elseif ($installerKind -eq 'msi') {
        $lines.Add('    Start-ADTMsiProcess -Action ''Uninstall'' -FilePath $installerPath')
    }
    else {
        $lines.Add('    throw ''No uninstall command in the package manifest; add one and rebuild''')
    }
    return ($lines -join "`r`n")
}

function New-CloseProcessesBlock {
    param([object]$Plan)
    $names = @()
    if ($null -ne $Plan.processesToClose) { $names = @($Plan.processesToClose | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) }
    if ($names.Count -eq 0) {
        return '    Show-ADTInstallationWelcome -CheckDiskSpace'
    }
    $items = @()
    foreach ($n in $names) { $items += ('@{ Name = ' + (ConvertTo-PsLiteral -Value ([string]$n)) + ' }') }
    return '    Show-ADTInstallationWelcome -CloseProcesses @(' + ($items -join ', ') + ') -CloseProcessesCountdown 60 -CheckDiskSpace'
}

function New-WrapperScript {
    param([object]$Plan)
    if (-not (Test-Path -LiteralPath $script:TemplatePath -PathType Leaf)) {
        throw ('Wrapper template missing: ' + $script:TemplatePath)
    }
    $m = $Plan.manifest
    $content = Get-Content -LiteralPath $script:TemplatePath -Raw
    $markerPlain = ([string]$Plan.markerKeyPath).Replace('HKLM:\', 'HKLM\')
    $map = @{
        '__ZSC_DISPLAY_NAME__' = ([string]$Plan.displayName).Replace('#', '')
        '__ZSC_IDENTIFIER__' = [string]$Plan.packageIdentifier
        '__ZSC_MARKER_PLAIN__' = $markerPlain
        '__ZSC_VENDOR__' = ConvertTo-PsLiteral -Value ([string]$m.vendor)
        '__ZSC_NAME__' = ConvertTo-PsLiteral -Value ([string]$m.name)
        '__ZSC_VERSION__' = ConvertTo-PsLiteral -Value ([string]$m.version)
        '__ZSC_ARCH__' = ConvertTo-PsLiteral -Value ([string]$m.architecture)
        '__ZSC_LANG__' = ConvertTo-PsLiteral -Value ([string]$m.language)
        '__ZSC_REVISION__' = ConvertTo-PsLiteral -Value ([string]$m.revision)
        '__ZSC_DATE__' = ConvertTo-PsLiteral -Value (Get-Date -Format 'yyyy-MM-dd')
        '__ZSC_MARKER_KEY__' = ConvertTo-PsLiteral -Value ([string]$Plan.markerKeyPath)
        '__ZSC_PACKAGE_ID_LITERAL__' = ConvertTo-PsLiteral -Value ([string]$Plan.packageIdentifier)
        '__ZSC_INSTALLER_FILE__' = ConvertTo-PsLiteral -Value ([string]$Plan.installer.fileName)
        '__ZSC_CLOSE_PROCESSES__' = New-CloseProcessesBlock -Plan $Plan
        '__ZSC_INSTALL_BLOCK__' = New-InstallBlock -Plan $Plan
        '__ZSC_UNINSTALL_BLOCK__' = New-UninstallBlock -Plan $Plan
    }
    # Kein Platzhalter ist Praefix eines anderen; Reihenfolge daher unerheblich
    foreach ($key in $map.Keys) {
        $content = $content.Replace($key, [string]$map[$key])
    }
    if ($content -match '__ZSC_[A-Z_]+__') {
        throw ('Unresolved placeholder in wrapper: ' + $Matches[0])
    }
    return $content
}

function New-PsadtSource {
    param([object]$Plan, [string]$InstallerPath, [string]$SourceDir)
    $template = [string]$script:Config.psadtTemplatePath
    if ([string]::IsNullOrWhiteSpace($template) -or -not (Test-Path -LiteralPath $template -PathType Container)) {
        throw 'psadtTemplatePath is not set or does not exist (download the PSAppDeployToolkit v4 template folder)'
    }
    $moduleManifest = Join-Path -Path $template -ChildPath 'PSAppDeployToolkit\PSAppDeployToolkit.psd1'
    if (-not (Test-Path -LiteralPath $moduleManifest -PathType Leaf)) {
        throw ('PSADT v4 module not found under the template folder: ' + $moduleManifest)
    }
    # Inhalt der Vorlage kopieren, nicht den Ordner selbst (SourceDir existiert bereits)
    Copy-Item -Path (Join-Path -Path $template -ChildPath '*') -Destination $SourceDir -Recurse -Force
    foreach ($sub in @('Files', 'SupportFiles')) {
        $dir = Join-Path -Path $SourceDir -ChildPath $sub
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) { New-Item -Path $dir -ItemType Directory | Out-Null }
    }
    Copy-Item -LiteralPath $InstallerPath -Destination (Join-Path -Path $SourceDir -ChildPath 'Files') -Force

    $scriptPath = Join-Path -Path $SourceDir -ChildPath $Plan.setupFile
    $content = New-WrapperScript -Plan $Plan
    $utf8Bom = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $true
    [System.IO.File]::WriteAllText($scriptPath, $content, $utf8Bom)

    # Syntax check of the generated wrapper before it goes into a package
    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors) | Out-Null
    if ($errors -and $errors.Count -gt 0) {
        throw ('Generated wrapper has syntax errors: ' + $errors[0].Message)
    }
    return $scriptPath
}

function Invoke-Signing {
    param([string]$ScriptPath)
    $thumb = [string]$script:Config.signingThumbprint
    if ([string]::IsNullOrWhiteSpace($thumb)) { return $false }
    $cert = Get-ChildItem -Path ('Cert:\CurrentUser\My\' + $thumb) -ErrorAction SilentlyContinue
    if (-not $cert) { $cert = Get-ChildItem -Path ('Cert:\LocalMachine\My\' + $thumb) -ErrorAction SilentlyContinue }
    if (-not $cert) { throw ('Signing certificate not found: ' + $thumb) }
    $sig = Set-AuthenticodeSignature -FilePath $ScriptPath -Certificate $cert -HashAlgorithm 'SHA256' -TimestampServer 'http://timestamp.digicert.com'
    if ($sig.Status -ne 'Valid') { throw ('Signing failed: ' + $sig.StatusMessage) }
    return $true
}

function Invoke-IntuneWinAppUtil {
    param([string]$SourceDir, [string]$SetupFile, [string]$OutDir)
    $tool = [string]$script:Config.intuneWinAppUtilPath
    $arguments = @('-c', ('"' + $SourceDir + '"'), '-s', ('"' + $SetupFile + '"'), '-o', ('"' + $OutDir + '"'), '-q')
    $proc = Start-Process -FilePath $tool -ArgumentList $arguments -Wait -PassThru -NoNewWindow
    if ($proc.ExitCode -ne 0) {
        throw ('IntuneWinAppUtil.exe exited with code ' + $proc.ExitCode)
    }
    $produced = Get-ChildItem -LiteralPath $OutDir -Filter '*.intunewin' -File | Select-Object -First 1
    if (-not $produced) { throw 'IntuneWinAppUtil.exe produced no .intunewin file' }
    return $produced.FullName
}

function Send-Artifact {
    param([object]$Plan, [string]$ArtifactPath)
    $fileName = [System.Uri]::EscapeDataString([string]$Plan.artifactFileName)
    $result = Invoke-Api -Method 'PUT' -Path ('/worker/builds/' + $Plan.buildId + '/artifact?fileName=' + $fileName) -InFile $ArtifactPath
    $localHash = (Get-FileHash -LiteralPath $ArtifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($null -eq $result -or $null -eq $result.artifact -or ([string]$result.artifact.sha256).ToLowerInvariant() -ne $localHash) {
        throw 'Artifact upload did not return the expected SHA-256'
    }
}

function Complete-Build {
    param([string]$BuildId, [bool]$Success, [string]$ErrorMessage)
    $body = @{
        success = $Success
        log = ($script:LogLines -join "`n")
        error = $ErrorMessage
    }
    Invoke-Api -Method 'POST' -Path ('/worker/builds/' + $BuildId + '/complete') -Body $body | Out-Null
}

function Invoke-Build {
    param([object]$Plan)
    $script:LogLines.Clear()
    $buildId = [string]$Plan.buildId
    $workRoot = Join-Path -Path ([string]$script:Config.workDir) -ChildPath $buildId
    $downloadDir = Join-Path -Path $workRoot -ChildPath 'download'
    $sourceDir = Join-Path -Path $workRoot -ChildPath 'source'
    $outDir = Join-Path -Path $workRoot -ChildPath 'out'
    $success = $false
    $errorMessage = $null
    try {
        Write-Step -BuildId $buildId -Message ('Build ' + $buildId + ' for ' + $Plan.displayName + ' (' + $Plan.wrapper + ')')
        foreach ($dir in @($downloadDir, $sourceDir, $outDir)) { New-Item -Path $dir -ItemType Directory -Force | Out-Null }

        if ($Plan.installer.fileName -match '\.zip$') {
            throw 'zip installers are not supported by the worker yet; upload the msi or exe'
        }

        Write-Step -BuildId $buildId -Message ('Downloading installer ' + $Plan.installer.fileName + ' (' + [math]::Round([double]$Plan.installer.sizeBytes / 1MB, 1) + ' MB)')
        $installerPath = Get-Installer -Plan $Plan -Folder $downloadDir
        Write-Step -BuildId $buildId -Message 'Installer hash verified'

        if ($Plan.wrapper -eq 'psadt') {
            Write-Step -BuildId $buildId -Message 'Generating PSAppDeployToolkit wrapper'
            $scriptPath = New-PsadtSource -Plan $Plan -InstallerPath $installerPath -SourceDir $sourceDir
            if (Invoke-Signing -ScriptPath $scriptPath) { Write-Step -BuildId $buildId -Message 'Wrapper signed' }
            else { Write-Step -BuildId $buildId -Message 'Wrapper not signed (no signingThumbprint configured)' }
        }
        else {
            Copy-Item -LiteralPath $installerPath -Destination $sourceDir -Force
        }

        Write-Step -BuildId $buildId -Message ('Running IntuneWinAppUtil.exe with setup file ' + $Plan.setupFile)
        $produced = Invoke-IntuneWinAppUtil -SourceDir $sourceDir -SetupFile ([string]$Plan.setupFile) -OutDir $outDir
        $artifactPath = Join-Path -Path $outDir -ChildPath $Plan.artifactFileName
        if ($produced -ne $artifactPath) { Move-Item -LiteralPath $produced -Destination $artifactPath -Force }
        $size = [math]::Round((Get-Item -LiteralPath $artifactPath).Length / 1MB, 1)
        Write-Step -BuildId $buildId -Message ('Package built: ' + $Plan.artifactFileName + ' (' + $size + ' MB)')

        Write-Step -BuildId $buildId -Message 'Uploading artifact'
        Send-Artifact -Plan $Plan -ArtifactPath $artifactPath
        Write-Step -BuildId $buildId -Message 'Artifact uploaded and verified'
        $success = $true
    }
    catch {
        $errorMessage = $_.Exception.Message
        Write-Log -Message ('Build failed: ' + $errorMessage) -Level 'ERROR'
    }
    finally {
        try {
            Complete-Build -BuildId $buildId -Success $success -ErrorMessage $errorMessage
        }
        catch {
            Write-Log -Message ('Could not report build result: ' + $_.Exception.Message) -Level 'ERROR'
        }
        if (-not $script:Config.keepWorkFolders -and (Test-Path -LiteralPath $workRoot)) {
            Remove-Item -LiteralPath $workRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    return $success
}

# ---- main ----

$script:Config = Read-Config -Path $ConfigPath
$script:Token = Read-Token
New-Item -Path $script:Config.workDir -ItemType Directory -Force | Out-Null

$ping = Invoke-Api -Method 'GET' -Path '/worker/ping'
Write-Host ('Connected to ' + $script:Config.apiUrl + ' as worker ' + $ping.workerId)

$idleDelay = [int]$script:Config.pollSeconds
$failures = 0
while ($true) {
    $plan = $null
    try {
        $plan = Invoke-Api -Method 'POST' -Path '/worker/builds/claim'
        $failures = 0
    }
    catch {
        $failures += 1
        $wait = [math]::Min(300, $idleDelay * [math]::Pow(2, [math]::Min($failures, 4)))
        Write-Host ('Claim failed (' + $_.Exception.Message + '); retry in ' + $wait + ' s') -ForegroundColor Yellow
        if ($Once) { exit 2 }
        Start-Sleep -Seconds $wait
        continue
    }
    if ($null -eq $plan) {
        if ($Once) { Write-Host 'No build waiting'; exit 0 }
        Start-Sleep -Seconds $idleDelay
        continue
    }
    $ok = Invoke-Build -Plan $plan
    if ($Once) {
        if ($ok) { exit 0 } else { exit 1 }
    }
}
