<#
.SYNOPSIS
    Removes bloatware and unnecessary apps from Windows 11 24H2.

.DESCRIPTION
    This script removes pre-installed consumer apps, promotional content, and bloatware
    from Windows 11 24H2 Enterprise/Pro deployments. Designed for clean business
    environments during Autopilot v2 deployment.

    Removes apps like:
    - Gaming apps (Xbox, Gaming Services, etc.)
    - Social media apps (TikTok, Instagram, Facebook, etc.)
    - Entertainment apps (Netflix, Disney+, Spotify, etc.)
    - Consumer Microsoft apps (Mail, Calendar when not needed, etc.)
    - OEM bloatware (manufacturer-specific apps)
    - Cortana
    - News, Weather, etc.

.PARAMETER RemovalLevel
    Defines how aggressively to remove apps:
    - Conservative: Removes obvious bloatware only (gaming, social media, entertainment)
    - Standard: Removes most consumer apps, keeps core Microsoft apps
    - Aggressive: Removes all non-essential apps including Microsoft consumer apps

.PARAMETER KeepApps
    Array of app names to keep (partial match supported).
    Example: @("Calculator", "Notepad", "Photos")

.PARAMETER RemoveOneDrive
    If specified, uninstalls OneDrive. Default: $false
    CAUTION: Recommended to keep OneDrive for business use.

.PARAMETER RemoveEdge
    If specified, attempts to remove Microsoft Edge. Default: $false
    CAUTION: Edge is deeply integrated and removal may cause issues.

.PARAMETER DisableTelemetry
    If specified, disables Windows telemetry and diagnostic data collection.

.PARAMETER DisableConsumerFeatures
    If specified, disables Windows consumer features and suggestions.

.PARAMETER LogPath
    Path to log file. Defaults to C:\ProgramData\Intune\Logs\BloatwareRemoval.log

.EXAMPLE
    .\Remove-Win11Bloatware.ps1 -RemovalLevel Standard

    Removes standard bloatware, keeps essential Microsoft apps.

.EXAMPLE
    .\Remove-Win11Bloatware.ps1 -RemovalLevel Aggressive -DisableConsumerFeatures

    Aggressive removal with consumer features disabled.

.EXAMPLE
    .\Remove-Win11Bloatware.ps1 -RemovalLevel Conservative -KeepApps @("Calculator", "Photos")

    Conservative removal, explicitly keeps Calculator and Photos.

.NOTES
    Version:        1.0
    Author:         Autopilot Deployment Team
    Creation Date:  2025-10-26

    Requirements:
    - Windows 11 24H2
    - Administrator privileges
    - PowerShell 5.1 or later

    Intune Deployment:
    - Deploy as Win32 app or Device Configuration Script
    - Run in SYSTEM context
    - Recommended: Deploy during Device Preparation phase in Autopilot v2
    - No reboot required for most app removals

    Testing:
    - Always test in non-production environment first
    - Some apps may return after Feature Updates
    - Consider creating a custom Windows 11 image for consistent deployments

    WARNING:
    - Aggressive removal may remove apps users expect
    - Test thoroughly before production deployment
    - Some apps are difficult to remove completely (Edge, OneDrive)
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [ValidateSet('Conservative', 'Standard', 'Aggressive')]
    [string]$RemovalLevel = 'Standard',

    [Parameter(Mandatory = $false)]
    [string[]]$KeepApps = @(),

    [Parameter(Mandatory = $false)]
    [switch]$RemoveOneDrive,

    [Parameter(Mandatory = $false)]
    [switch]$RemoveEdge,

    [Parameter(Mandatory = $false)]
    [switch]$DisableTelemetry,

    [Parameter(Mandatory = $false)]
    [switch]$DisableConsumerFeatures,

    [Parameter(Mandatory = $false)]
    [string]$LogPath = "C:\ProgramData\Intune\Logs\BloatwareRemoval.log"
)

#region Functions

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet('Info', 'Warning', 'Error', 'Success', 'Section')]
        [string]$Level = 'Info'
    )

    $LogDir = Split-Path -Path $LogPath -Parent
    if (-not (Test-Path $LogDir)) {
        New-Item -Path $LogDir -ItemType Directory -Force | Out-Null
    }

    $Timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $LogMessage = "[$Timestamp] [$Level] $Message"

    Add-Content -Path $LogPath -Value $LogMessage

    switch ($Level) {
        'Info'    { Write-Host $LogMessage -ForegroundColor Cyan }
        'Warning' { Write-Host $LogMessage -ForegroundColor Yellow }
        'Error'   { Write-Host $LogMessage -ForegroundColor Red }
        'Success' { Write-Host $LogMessage -ForegroundColor Green }
        'Section' { Write-Host "`n$LogMessage`n" -ForegroundColor Magenta }
    }
}

function Set-RegistryValue {
    param(
        [string]$Path,
        [string]$Name,
        [object]$Value,
        [string]$Type = 'DWord',
        [string]$Description = ''
    )

    try {
        if (-not (Test-Path $Path)) {
            New-Item -Path $Path -Force | Out-Null
        }

        Set-ItemProperty -Path $Path -Name $Name -Value $Value -Type $Type -Force

        if ($Description) {
            Write-Log "$Description" -Level Success
        }
        return $true
    }
    catch {
        Write-Log "Failed to set $Path\$Name : $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Remove-AppxPackageWithProvisioningPackage {
    param(
        [string]$AppName,
        [bool]$IsProtected = $false
    )

    try {
        # Check if app should be kept
        foreach ($KeepPattern in $KeepApps) {
            if ($AppName -like "*$KeepPattern*") {
                Write-Log "Keeping app (user specified): $AppName" -Level Warning
                return $false
            }
        }

        $Removed = $false

        # Remove AppX package for current user
        $AppPackages = Get-AppxPackage -Name $AppName -ErrorAction SilentlyContinue
        if ($AppPackages) {
            foreach ($Package in $AppPackages) {
                Write-Log "Removing AppX package: $($Package.Name)" -Level Info
                Remove-AppxPackage -Package $Package.PackageFullName -ErrorAction SilentlyContinue
                $Removed = $true
            }
        }

        # Remove provisioning package (prevents reinstall for new users)
        $ProvisionedPackages = Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -like $AppName }
        if ($ProvisionedPackages) {
            foreach ($Package in $ProvisionedPackages) {
                Write-Log "Removing provisioned package: $($Package.DisplayName)" -Level Info
                Remove-AppxProvisionedPackage -Online -PackageName $Package.PackageName -ErrorAction SilentlyContinue
                $Removed = $true
            }
        }

        if ($Removed) {
            Write-Log "Successfully removed: $AppName" -Level Success
            return $true
        }
        else {
            Write-Log "App not found or already removed: $AppName" -Level Info
            return $false
        }
    }
    catch {
        Write-Log "Error removing $AppName : $($_.Exception.Message)" -Level Error
        return $false
    }
}

#endregion

#region App Lists

# Conservative: Obvious bloatware (gaming, social media, entertainment)
$ConservativeApps = @(
    # Gaming
    "Microsoft.GamingApp",
    "Microsoft.XboxApp",
    "Microsoft.XboxGameOverlay",
    "Microsoft.XboxGamingOverlay",
    "Microsoft.XboxIdentityProvider",
    "Microsoft.XboxSpeechToTextOverlay",
    "Microsoft.Xbox.TCUI",

    # Social Media & Entertainment
    "BytedancePte.Ltd.TikTok",
    "Facebook.Facebook",
    "Facebook.Instagram",
    "5319275A.WhatsAppDesktop",
    "SpotifyAB.SpotifyMusic",
    "*.Netflix",
    "*.DisneyPlus",
    "*.Prime Video",

    # Consumer Apps
    "Microsoft.GetHelp",
    "Microsoft.Getstarted",
    "Microsoft.BingNews",
    "Microsoft.BingWeather",
    "MicrosoftCorporationII.QuickAssist",

    # OEM Bloatware (common patterns)
    "*.McAfee*",
    "*.WildTangent*",
    "*.CandyCrush*",
    "king.com.*",
    "*.BubbleWitch*"
)

# Standard: Most consumer apps, keeps core Microsoft apps
$StandardApps = @(
    # All Conservative apps
    $ConservativeApps

    # Additional Microsoft Consumer Apps
    "Microsoft.MicrosoftSolitaireCollection",
    "Microsoft.MicrosoftOfficeHub",
    "Microsoft.Todos",
    "Microsoft.PowerAutomateDesktop",
    "Microsoft.People",
    "MicrosoftTeams",  # Consumer Teams, not Business
    "Clipchamp.Clipchamp",

    # Windows Apps
    "Microsoft.WindowsMaps",
    "Microsoft.WindowsFeedbackHub",
    "Microsoft.WindowsAlarms",
    "Microsoft.windowscommunicationsapps"  # Mail & Calendar
)

# Aggressive: All non-essential apps
$AggressiveApps = @(
    # All Standard apps
    $StandardApps

    # Additional Core Apps (use with caution)
    "Microsoft.WindowsCamera",
    "Microsoft.ScreenSketch",
    "Microsoft.Paint",
    "Microsoft.MSPaint",
    "Microsoft.YourPhone",
    "Microsoft.ZuneMusic",
    "Microsoft.ZuneVideo",
    "Microsoft.MixedReality.Portal",
    "Microsoft.549981C3F5F10"  # Cortana
)

#endregion

#region Main Execution

$StartTime = Get-Date
Write-Log "=== Windows 11 24H2 Bloatware Removal ===" -Level Section
Write-Log "Removal Level: $RemovalLevel" -Level Info
Write-Log "Windows Version: $(Get-ComputerInfo | Select-Object -ExpandProperty OsVersion)" -Level Info
Write-Log "Execution Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Level Info

if ($KeepApps.Count -gt 0) {
    Write-Log "Protected apps (will not remove): $($KeepApps -join ', ')" -Level Warning
}

$Stats = @{
    TotalApps = 0
    RemovedApps = 0
    FailedApps = 0
    KeptApps = 0
}

# Select app list based on removal level
$AppsToRemove = switch ($RemovalLevel) {
    'Conservative' { $ConservativeApps }
    'Standard' { $StandardApps | Select-Object -Unique }
    'Aggressive' { $AggressiveApps | Select-Object -Unique }
}

Write-Log "`nApps to remove: $($AppsToRemove.Count)" -Level Info

# Remove AppX packages
Write-Log "`n--- Removing AppX Packages ---" -Level Section
foreach ($AppName in $AppsToRemove) {
    $Stats.TotalApps++

    if (Remove-AppxPackageWithProvisioningPackage -AppName $AppName) {
        $Stats.RemovedApps++
    }
    else {
        # Check if it was kept due to user preference
        $WasKept = $false
        foreach ($KeepPattern in $KeepApps) {
            if ($AppName -like "*$KeepPattern*") {
                $Stats.KeptApps++
                $WasKept = $true
                break
            }
        }

        if (-not $WasKept) {
            # App not found or already removed (not an error)
        }
    }
}

# Remove OneDrive if requested
if ($RemoveOneDrive) {
    Write-Log "`n--- Removing OneDrive ---" -Level Section
    Write-Log "Attempting to uninstall OneDrive..." -Level Warning

    try {
        $OneDriveSetup = "$env:SystemRoot\SysWOW64\OneDriveSetup.exe"
        if (Test-Path $OneDriveSetup) {
            Write-Log "Running OneDrive uninstaller..." -Level Info
            Start-Process -FilePath $OneDriveSetup -ArgumentList "/uninstall" -Wait -NoNewWindow
            Write-Log "OneDrive uninstalled" -Level Success
        }
        else {
            Write-Log "OneDrive setup not found" -Level Warning
        }
    }
    catch {
        Write-Log "Failed to uninstall OneDrive: $($_.Exception.Message)" -Level Error
    }
}

# Remove Microsoft Edge (if requested - NOT recommended)
if ($RemoveEdge) {
    Write-Log "`n--- Attempting to Remove Microsoft Edge ---" -Level Section
    Write-Log "WARNING: Removing Edge is NOT recommended and may cause issues" -Level Warning

    try {
        $EdgePath = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application"
        $EdgeSetup = Get-ChildItem -Path $EdgePath -Filter "setup.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1

        if ($EdgeSetup) {
            Write-Log "Running Edge uninstaller..." -Level Warning
            Start-Process -FilePath $EdgeSetup.FullName -ArgumentList "--uninstall --force-uninstall --system-level" -Wait -NoNewWindow
            Write-Log "Edge uninstall attempted" -Level Info
        }
    }
    catch {
        Write-Log "Failed to uninstall Edge: $($_.Exception.Message)" -Level Error
    }
}

# Disable Consumer Features
if ($DisableConsumerFeatures) {
    Write-Log "`n--- Disabling Consumer Features ---" -Level Section

    # Disable consumer account sign-in suggestions
    Set-RegistryValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent" `
        -Name "DisableWindowsConsumerFeatures" -Value 1 `
        -Description "Disabled Windows consumer features"

    # Disable app suggestions
    Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" `
        -Name "ContentDeliveryAllowed" -Value 0 `
        -Description "Disabled content delivery"

    Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" `
        -Name "OemPreInstalledAppsEnabled" -Value 0 `
        -Description "Disabled OEM pre-installed apps"

    Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" `
        -Name "PreInstalledAppsEnabled" -Value 0 `
        -Description "Disabled pre-installed apps"

    Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" `
        -Name "SilentInstalledAppsEnabled" -Value 0 `
        -Description "Disabled silent app installs"

    Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" `
        -Name "SubscribedContent-338387Enabled" -Value 0 `
        -Description "Disabled app suggestions in Start"

    Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" `
        -Name "SubscribedContent-338388Enabled" -Value 0 `
        -Description "Disabled app suggestions"

    Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" `
        -Name "SubscribedContent-338389Enabled" -Value 0 `
        -Description "Disabled tips, tricks, and suggestions"

    Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" `
        -Name "SystemPaneSuggestionsEnabled" -Value 0 `
        -Description "Disabled system pane suggestions"

    # Disable Windows Spotlight
    Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" `
        -Name "RotatingLockScreenEnabled" -Value 0 `
        -Description "Disabled Windows Spotlight lock screen"

    Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager" `
        -Name "RotatingLockScreenOverlayEnabled" -Value 0 `
        -Description "Disabled lock screen overlay"
}

# Disable Telemetry
if ($DisableTelemetry) {
    Write-Log "`n--- Disabling Telemetry ---" -Level Section

    # Set telemetry to Security (Enterprise only) or Basic
    Set-RegistryValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection" `
        -Name "AllowTelemetry" -Value 0 `
        -Description "Set telemetry to minimum"

    # Disable diagnostic data
    Set-RegistryValue -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\DataCollection" `
        -Name "AllowTelemetry" -Value 0 `
        -Description "Disabled diagnostic data collection"

    # Disable feedback notifications
    Set-RegistryValue -Path "HKCU:\Software\Microsoft\Siuf\Rules" `
        -Name "NumberOfSIUFInPeriod" -Value 0 `
        -Description "Disabled feedback notifications"

    # Disable activity history
    Set-RegistryValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" `
        -Name "PublishUserActivities" -Value 0 `
        -Description "Disabled activity history publishing"

    Set-RegistryValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" `
        -Name "UploadUserActivities" -Value 0 `
        -Description "Disabled activity history upload"
}

# Disable Cortana
Write-Log "`n--- Disabling Cortana ---" -Level Section
Set-RegistryValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Search" `
    -Name "AllowCortana" -Value 0 `
    -Description "Disabled Cortana"

# Disable Bing Search in Start Menu
Write-Log "`n--- Disabling Bing Search in Start Menu ---" -Level Section
Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Search" `
    -Name "BingSearchEnabled" -Value 0 `
    -Description "Disabled Bing search in Start Menu"

Set-RegistryValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Search" `
    -Name "CortanaConsent" -Value 0 `
    -Description "Disabled Cortana consent"

# Save configuration marker
$MarkerPath = "HKLM:\SOFTWARE\AutopilotDeployment\BloatwareRemoval"
Set-RegistryValue -Path $MarkerPath -Name "RemovalLevel" -Value $RemovalLevel -Type String
Set-RegistryValue -Path $MarkerPath -Name "RemovalDate" -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') -Type String
Set-RegistryValue -Path $MarkerPath -Name "AppsRemoved" -Value $Stats.RemovedApps
Set-RegistryValue -Path $MarkerPath -Name "WindowsVersion" -Value (Get-ComputerInfo | Select-Object -ExpandProperty OsVersion) -Type String

# Summary
$Duration = (Get-Date) - $StartTime
Write-Log "`n=== Bloatware Removal Completed ===" -Level Section
Write-Log "Removal Level: $RemovalLevel" -Level Info
Write-Log "Apps Processed: $($Stats.TotalApps)" -Level Info
Write-Log "Apps Removed: $($Stats.RemovedApps)" -Level Success
Write-Log "Apps Kept (user protected): $($Stats.KeptApps)" -Level Info
Write-Log "Consumer Features Disabled: $(if ($DisableConsumerFeatures) { 'Yes' } else { 'No' })" -Level Info
Write-Log "Telemetry Disabled: $(if ($DisableTelemetry) { 'Yes' } else { 'No' })" -Level Info
Write-Log "Execution Time: $([Math]::Round($Duration.TotalMinutes, 2)) minutes" -Level Info

Write-Log "`n=== Important Notes ===" -Level Section
Write-Log "1. No reboot required for app removal" -Level Info
Write-Log "2. Some apps may reinstall after Windows Feature Updates" -Level Warning
Write-Log "3. Registry changes take effect immediately" -Level Info
Write-Log "4. Consider creating custom Windows 11 image for consistent deployments" -Level Info
Write-Log "5. Test in non-production environment first" -Level Warning
Write-Log "6. Log file: $LogPath" -Level Info

Write-Log "`nBloatware removal completed successfully!" -Level Success
exit 0

#endregion
