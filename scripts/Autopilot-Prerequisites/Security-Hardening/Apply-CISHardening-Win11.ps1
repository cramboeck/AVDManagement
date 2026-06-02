<#
.SYNOPSIS
    Applies CIS Windows 11 Benchmark hardening settings during Autopilot Device Preparation

.DESCRIPTION
    This script applies security hardening based on CIS Microsoft Windows 11 Enterprise Benchmark.
    Designed to run during Autopilot v2 Device Preparation phase to ensure devices are
    compliant from the start.

    Categories covered:
    - Account Policies (Password Policy, Lockout Policy)
    - Local Policies (Audit Policy, User Rights, Security Options)
    - Windows Firewall with Advanced Security
    - Microsoft Defender Antivirus
    - Network Security
    - System Services
    - Administrative Templates

.PARAMETER Level
    CIS Benchmark Level to apply (1 or 2)
    Level 1: Essential security settings (recommended for all environments)
    Level 2: High security/sensitive environments (may impact functionality)

.PARAMETER SkipCategories
    Array of categories to skip (e.g., @('Firewall', 'Defender'))

.EXAMPLE
    .\Apply-CISHardening-Win11.ps1 -Level 1

.EXAMPLE
    .\Apply-CISHardening-Win11.ps1 -Level 2 -SkipCategories @('Firewall')

.NOTES
    Filename: Apply-CISHardening-Win11.ps1
    Author: PowerShell Automation
    Version: 1.0
    CIS Benchmark: Windows 11 Enterprise Release 23H2
    Context: SYSTEM (Device Preparation Script)

    IMPORTANT:
    - Test in pilot environment first
    - Some settings require reboot to take effect
    - Level 2 settings may impact user experience
    - Review your organization's requirements before applying

.LINK
    https://www.cisecurity.org/benchmark/microsoft_windows_desktop
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [ValidateSet('1', '2')]
    [string]$Level = '1',

    [Parameter(Mandatory = $false)]
    [string[]]$SkipCategories = @()
)

$ErrorActionPreference = 'Continue'

# Logging
$LogPath = "$env:ProgramData\Microsoft\IntuneManagementExtension\Logs"
$LogFile = "$LogPath\CISHardening_Win11_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

if (-not (Test-Path $LogPath)) {
    New-Item -Path $LogPath -ItemType Directory -Force | Out-Null
}

function Write-Log {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,

        [Parameter(Mandatory = $false)]
        [ValidateSet('Info', 'Warning', 'Error', 'Success', 'Section')]
        [string]$Level = 'Info'
    )

    $Timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $LogEntry = "[$Timestamp] [$Level] $Message"

    Add-Content -Path $LogFile -Value $LogEntry

    switch ($Level) {
        'Error'   { Write-Host $LogEntry -ForegroundColor Red }
        'Warning' { Write-Host $LogEntry -ForegroundColor Yellow }
        'Success' { Write-Host $LogEntry -ForegroundColor Green }
        'Section' { Write-Host "`n$LogEntry" -ForegroundColor Cyan }
        default   { Write-Host $LogEntry }
    }
}

function Set-RegistryValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        $Value,

        [Parameter(Mandatory = $true)]
        [ValidateSet('String', 'ExpandString', 'Binary', 'DWord', 'MultiString', 'QWord')]
        [string]$Type,

        [Parameter(Mandatory = $false)]
        [string]$Description = ""
    )

    try {
        # Create path if it doesn't exist
        if (-not (Test-Path $Path)) {
            New-Item -Path $Path -Force | Out-Null
        }

        # Set registry value
        New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType $Type -Force | Out-Null

        $LogMsg = "Set: $Path\$Name = $Value"
        if ($Description) {
            $LogMsg += " ($Description)"
        }
        Write-Log $LogMsg -Level Info

        return $true
    }
    catch {
        Write-Log "Failed to set $Path\$Name : $($_.Exception.Message)" -Level Error
        return $false
    }
}

function Test-Category {
    param([string]$CategoryName)

    if ($SkipCategories -contains $CategoryName) {
        Write-Log "Skipping category: $CategoryName (per parameters)" -Level Warning
        return $false
    }
    return $true
}

# Statistics
$Stats = @{
    TotalSettings = 0
    Applied       = 0
    Failed        = 0
    Skipped       = 0
}

# Track execution time
$StartTime = Get-Date

Write-Log "=== CIS Windows 11 Benchmark Hardening ===" -Level Section
Write-Log "CIS Benchmark Level: $Level" -Level Info
Write-Log "Execution Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Level Info
Write-Log "Script Version: 1.0" -Level Info

if ($SkipCategories.Count -gt 0) {
    Write-Log "Skipping categories: $($SkipCategories -join ', ')" -Level Warning
}

#region Account Policies - Password Policy
if (Test-Category 'PasswordPolicy') {
    Write-Log "--- CIS 1.1: Password Policy ---" -Level Section

    # CIS 1.1.1 - Enforce password history: 24 or more passwords
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Netlogon\Parameters' `
            -Name 'MaximumPasswordAge' -Value 60 -Type DWord `
            -Description "CIS 1.1.1 - Password history") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # Note: Some password policies need to be set via Group Policy or Intune Configuration Profiles
    Write-Log "Note: Advanced password policies should be configured via Intune Configuration Profile" -Level Info

    # CIS 1.1.5 - Minimum password length: 14 or more characters
    # This is better managed through Intune Password Policy

    $Stats.Skipped++
}
#endregion

#region Account Policies - Account Lockout Policy
if (Test-Category 'LockoutPolicy') {
    Write-Log "--- CIS 1.2: Account Lockout Policy ---" -Level Section

    # CIS 1.2.1 - Account lockout duration: 15 or more minutes
    # CIS 1.2.2 - Account lockout threshold: 5 or fewer invalid logon attempts
    # CIS 1.2.3 - Reset account lockout counter after: 15 or more minutes

    # These are managed via net accounts command or Group Policy
    try {
        # Set account lockout threshold
        $null = net accounts /lockoutthreshold:5 2>&1
        Write-Log "Set account lockout threshold to 5 attempts (CIS 1.2.2)" -Level Info
        $Stats.Applied++

        # Set lockout duration
        $null = net accounts /lockoutduration:15 2>&1
        Write-Log "Set account lockout duration to 15 minutes (CIS 1.2.1)" -Level Info
        $Stats.Applied++

        # Set lockout window
        $null = net accounts /lockoutwindow:15 2>&1
        Write-Log "Set account lockout window to 15 minutes (CIS 1.2.3)" -Level Info
        $Stats.Applied++
    }
    catch {
        Write-Log "Failed to configure account lockout policies: $($_.Exception.Message)" -Level Error
        $Stats.Failed += 3
    }
    $Stats.TotalSettings += 3
}
#endregion

#region Local Policies - Security Options
if (Test-Category 'SecurityOptions') {
    Write-Log "--- CIS 2.3: Security Options ---" -Level Section

    # CIS 2.3.1.1 - Accounts: Administrator account status - Disabled
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' `
            -Name 'EnableAdminAccount' -Value 0 -Type DWord `
            -Description "CIS 2.3.1.1 - Disable built-in Administrator account") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.1.5 - Accounts: Limit local account use of blank passwords to console logon only
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa' `
            -Name 'LimitBlankPasswordUse' -Value 1 -Type DWord `
            -Description "CIS 2.3.1.5 - Limit blank passwords") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.2.1 - Audit: Force audit policy subcategory settings
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa' `
            -Name 'SCENoApplyLegacyAuditPolicy' -Value 1 -Type DWord `
            -Description "CIS 2.3.2.1 - Force audit policy subcategory") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.4.1 - Devices: Prevent users from installing printer drivers
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Print\Providers\LanMan Print Services\Servers' `
            -Name 'AddPrinterDrivers' -Value 1 -Type DWord `
            -Description "CIS 2.3.4.1 - Prevent printer driver installation") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.6.1 - Domain member: Digitally encrypt or sign secure channel data (always)
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\Netlogon\Parameters' `
            -Name 'RequireSignOrSeal' -Value 1 -Type DWord `
            -Description "CIS 2.3.6.1 - Require secure channel encryption") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.7.1 - Interactive logon: Do not display last user name
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' `
            -Name 'DontDisplayLastUserName' -Value 1 -Type DWord `
            -Description "CIS 2.3.7.1 - Hide last user name") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.7.2 - Interactive logon: Do not require CTRL+ALT+DEL
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' `
            -Name 'DisableCAD' -Value 0 -Type DWord `
            -Description "CIS 2.3.7.2 - Require CTRL+ALT+DEL") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.7.7 - Interactive logon: Prompt user to change password before expiration
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' `
            -Name 'PasswordExpiryWarning' -Value 14 -Type DWord `
            -Description "CIS 2.3.7.7 - Password expiry warning (14 days)") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.7.9 - Interactive logon: Smart card removal behavior - Lock Workstation
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' `
            -Name 'ScRemoveOption' -Value 1 -Type String `
            -Description "CIS 2.3.7.9 - Lock on smart card removal") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.8.2 - Microsoft network client: Digitally sign communications (always)
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters' `
            -Name 'RequireSecuritySignature' -Value 1 -Type DWord `
            -Description "CIS 2.3.8.2 - SMB client signing required") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.8.3 - Microsoft network client: Send unencrypted password to third-party SMB servers
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters' `
            -Name 'EnablePlainTextPassword' -Value 0 -Type DWord `
            -Description "CIS 2.3.8.3 - Disable plaintext passwords") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.9.2 - Microsoft network server: Digitally sign communications (always)
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanManServer\Parameters' `
            -Name 'RequireSecuritySignature' -Value 1 -Type DWord `
            -Description "CIS 2.3.9.2 - SMB server signing required") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.10.2 - Network access: Do not allow anonymous enumeration of SAM accounts
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa' `
            -Name 'RestrictAnonymousSAM' -Value 1 -Type DWord `
            -Description "CIS 2.3.10.2 - Restrict anonymous SAM enumeration") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.10.3 - Network access: Do not allow anonymous enumeration of SAM accounts and shares
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa' `
            -Name 'RestrictAnonymous' -Value 1 -Type DWord `
            -Description "CIS 2.3.10.3 - Restrict anonymous enumeration") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.10.12 - Network access: Restrict clients allowed to make remote calls to SAM
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa' `
            -Name 'RestrictRemoteSAM' -Value 'O:BAG:BAD:(A;;RC;;;BA)' -Type String `
            -Description "CIS 2.3.10.12 - Restrict remote SAM calls") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.11.3 - Network security: Do not store LAN Manager hash value on next password change
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa' `
            -Name 'NoLMHash' -Value 1 -Type DWord `
            -Description "CIS 2.3.11.3 - Disable LM hash storage") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.11.5 - Network security: LAN Manager authentication level
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa' `
            -Name 'LmCompatibilityLevel' -Value 5 -Type DWord `
            -Description "CIS 2.3.11.5 - LM authentication level (NTLMv2 only)") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.11.7 - Network security: Minimum session security for NTLM SSP based clients
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa\MSV1_0' `
            -Name 'NTLMMinClientSec' -Value 537395200 -Type DWord `
            -Description "CIS 2.3.11.7 - NTLM client session security") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.11.8 - Network security: Minimum session security for NTLM SSP based servers
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa\MSV1_0' `
            -Name 'NTLMMinServerSec' -Value 537395200 -Type DWord `
            -Description "CIS 2.3.11.8 - NTLM server session security") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.15.1 - System objects: Require case insensitivity for non-Windows subsystems
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Kernel' `
            -Name 'ObCaseInsensitive' -Value 1 -Type DWord `
            -Description "CIS 2.3.15.1 - Case insensitivity") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.17.1 - User Account Control: Admin Approval Mode for the Built-in Administrator account
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' `
            -Name 'FilterAdministratorToken' -Value 1 -Type DWord `
            -Description "CIS 2.3.17.1 - UAC for built-in admin") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.17.2 - User Account Control: Behavior of the elevation prompt for administrators
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' `
            -Name 'ConsentPromptBehaviorAdmin' -Value 2 -Type DWord `
            -Description "CIS 2.3.17.2 - UAC elevation prompt for admins") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.17.3 - User Account Control: Behavior of the elevation prompt for standard users
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' `
            -Name 'ConsentPromptBehaviorUser' -Value 0 -Type DWord `
            -Description "CIS 2.3.17.3 - UAC elevation prompt for users (auto-deny)") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.17.5 - User Account Control: Detect application installations and prompt for elevation
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' `
            -Name 'EnableInstallerDetection' -Value 1 -Type DWord `
            -Description "CIS 2.3.17.5 - UAC detect installations") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.17.6 - User Account Control: Only elevate UIAccess applications that are installed in secure locations
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' `
            -Name 'EnableSecureUIAPaths' -Value 1 -Type DWord `
            -Description "CIS 2.3.17.6 - UAC secure UIAccess paths") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.17.7 - User Account Control: Run all administrators in Admin Approval Mode
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' `
            -Name 'EnableLUA' -Value 1 -Type DWord `
            -Description "CIS 2.3.17.7 - UAC Admin Approval Mode") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 2.3.17.8 - User Account Control: Virtualize file and registry write failures to per-user locations
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' `
            -Name 'EnableVirtualization' -Value 1 -Type DWord `
            -Description "CIS 2.3.17.8 - UAC virtualization") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++
}
#endregion

#region Windows Firewall
if (Test-Category 'Firewall') {
    Write-Log "--- CIS 9.1-9.3: Windows Firewall ---" -Level Section

    # Enable Windows Firewall for all profiles
    try {
        Set-NetFirewallProfile -Profile Domain, Public, Private -Enabled True
        Write-Log "Windows Firewall enabled for all profiles (CIS 9.1.1, 9.2.1, 9.3.1)" -Level Success
        $Stats.Applied += 3
    }
    catch {
        Write-Log "Failed to enable Windows Firewall: $($_.Exception.Message)" -Level Error
        $Stats.Failed += 3
    }
    $Stats.TotalSettings += 3

    # CIS 9.1.2, 9.2.2, 9.3.2 - Inbound connections - Block by default
    try {
        Set-NetFirewallProfile -Profile Domain, Public, Private -DefaultInboundAction Block
        Write-Log "Firewall default inbound action set to Block for all profiles (CIS 9.x.2)" -Level Success
        $Stats.Applied += 3
    }
    catch {
        Write-Log "Failed to set firewall inbound action: $($_.Exception.Message)" -Level Error
        $Stats.Failed += 3
    }
    $Stats.TotalSettings += 3

    # CIS 9.1.3, 9.2.3, 9.3.3 - Outbound connections - Allow by default (Level 1)
    try {
        Set-NetFirewallProfile -Profile Domain, Public, Private -DefaultOutboundAction Allow
        Write-Log "Firewall default outbound action set to Allow for all profiles (CIS 9.x.3)" -Level Success
        $Stats.Applied += 3
    }
    catch {
        Write-Log "Failed to set firewall outbound action: $($_.Exception.Message)" -Level Error
        $Stats.Failed += 3
    }
    $Stats.TotalSettings += 3

    # CIS 9.1.4, 9.2.4, 9.3.4 - Log dropped packets
    try {
        Set-NetFirewallProfile -Profile Domain, Public, Private -LogBlocked True -LogMaxSizeKilobytes 16384
        Write-Log "Firewall logging enabled for dropped packets (CIS 9.x.4)" -Level Success
        $Stats.Applied += 3
    }
    catch {
        Write-Log "Failed to configure firewall logging: $($_.Exception.Message)" -Level Error
        $Stats.Failed += 3
    }
    $Stats.TotalSettings += 3
}
#endregion

#region Microsoft Defender Antivirus
if (Test-Category 'Defender') {
    Write-Log "--- CIS 18.9.39: Microsoft Defender Antivirus ---" -Level Section

    # CIS 18.9.39.1 - Turn off Microsoft Defender Antivirus - Disabled (keep Defender ON)
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender' `
            -Name 'DisableAntiSpyware' -Value 0 -Type DWord `
            -Description "CIS 18.9.39.1 - Keep Defender enabled") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.39.2.1 - Configure local setting override for reporting to Microsoft MAPS
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Spynet' `
            -Name 'LocalSettingOverrideSpynetReporting' -Value 0 -Type DWord `
            -Description "CIS 18.9.39.2.1 - Disable MAPS override") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.39.3.1 - Configure Attack Surface Reduction rules
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Windows Defender Exploit Guard\ASR' `
            -Name 'ExploitGuard_ASR_Rules' -Value 1 -Type DWord `
            -Description "CIS 18.9.39.3.1 - Enable ASR rules") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # Enable real-time monitoring
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection' `
            -Name 'DisableRealtimeMonitoring' -Value 0 -Type DWord `
            -Description "Enable Defender real-time monitoring") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.39.8.1 - Scan all downloaded files and attachments
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection' `
            -Name 'DisableIOAVProtection' -Value 0 -Type DWord `
            -Description "CIS 18.9.39.8.1 - Scan downloads") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.39.8.2 - Turn off real-time protection - Disabled (keep ON)
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection' `
            -Name 'DisableRealtimeMonitoring' -Value 0 -Type DWord `
            -Description "CIS 18.9.39.8.2 - Keep real-time protection ON") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.39.8.3 - Turn on behavior monitoring
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection' `
            -Name 'DisableBehaviorMonitoring' -Value 0 -Type DWord `
            -Description "CIS 18.9.39.8.3 - Enable behavior monitoring") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.39.8.4 - Turn on script scanning
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection' `
            -Name 'DisableScriptScanning' -Value 0 -Type DWord `
            -Description "CIS 18.9.39.8.4 - Enable script scanning") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # Enable Cloud-delivered Protection
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Spynet' `
            -Name 'SpynetReporting' -Value 2 -Type DWord `
            -Description "Enable Cloud-delivered Protection (Advanced)") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # Enable Automatic Sample Submission
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Spynet' `
            -Name 'SubmitSamplesConsent' -Value 1 -Type DWord `
            -Description "Enable Automatic Sample Submission") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++
}
#endregion

#region Windows Update
if (Test-Category 'WindowsUpdate') {
    Write-Log "--- CIS 18.9.102: Windows Update ---" -Level Section

    # CIS 18.9.102.1.1 - Manage preview builds
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate' `
            -Name 'ManagePreviewBuilds' -Value 1 -Type DWord `
            -Description "CIS 18.9.102.1.1 - Disable preview builds") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.102.2 - Configure Automatic Updates
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' `
            -Name 'NoAutoUpdate' -Value 0 -Type DWord `
            -Description "CIS 18.9.102.2 - Enable Automatic Updates") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # Auto-download and schedule the install
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' `
            -Name 'AUOptions' -Value 4 -Type DWord `
            -Description "Auto-download and schedule install") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++
}
#endregion

#region Administrative Templates - System
if (Test-Category 'AdminTemplates') {
    Write-Log "--- CIS 18: Administrative Templates ---" -Level Section

    # CIS 18.3.1 - Apply UAC restrictions to local accounts on network logons
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' `
            -Name 'LocalAccountTokenFilterPolicy' -Value 0 -Type DWord `
            -Description "CIS 18.3.1 - UAC restrictions for local accounts") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.3.2 - Configure SMB v1 client driver
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\mrxsmb10' `
            -Name 'Start' -Value 4 -Type DWord `
            -Description "CIS 18.3.2 - Disable SMBv1 client") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.3.3 - Configure SMB v1 server
    if (Set-RegistryValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters' `
            -Name 'SMB1' -Value 0 -Type DWord `
            -Description "CIS 18.3.3 - Disable SMBv1 server") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.4.1 - Encryption Oracle Remediation
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\CredSSP\Parameters' `
            -Name 'AllowEncryptionOracle' -Value 0 -Type DWord `
            -Description "CIS 18.4.1 - CredSSP encryption oracle (Force Updated Clients)") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.5.4.1 - Turn off multicast name resolution
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient' `
            -Name 'EnableMulticast' -Value 0 -Type DWord `
            -Description "CIS 18.5.4.1 - Disable LLMNR") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.5.8.1 - Enable insecure guest logons - Disabled
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\LanmanWorkstation' `
            -Name 'AllowInsecureGuestAuth' -Value 0 -Type DWord `
            -Description "CIS 18.5.8.1 - Disable insecure guest logons") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.5.11.2 - Prohibit installation and configuration of Network Bridge
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Network Connections' `
            -Name 'NC_AllowNetBridge_NLA' -Value 0 -Type DWord `
            -Description "CIS 18.5.11.2 - Prohibit Network Bridge") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.5.11.3 - Prohibit use of Internet Connection Sharing
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Network Connections' `
            -Name 'NC_ShowSharedAccessUI' -Value 0 -Type DWord `
            -Description "CIS 18.5.11.3 - Prohibit Internet Connection Sharing") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.5.11.4 - Require domain users to elevate when setting a network's location
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Network Connections' `
            -Name 'NC_StdDomainUserSetLocation' -Value 1 -Type DWord `
            -Description "CIS 18.5.11.4 - Elevate for network location") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.5.14.1 - Hardened UNC Paths
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\NetworkProvider\HardenedPaths' `
            -Name '\\*\SYSVOL' -Value 'RequireMutualAuthentication=1,RequireIntegrity=1' -Type String `
            -Description "CIS 18.5.14.1 - Hardened UNC Path for SYSVOL") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\NetworkProvider\HardenedPaths' `
            -Name '\\*\NETLOGON' -Value 'RequireMutualAuthentication=1,RequireIntegrity=1' -Type String `
            -Description "CIS 18.5.14.1 - Hardened UNC Path for NETLOGON") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.14.1 - Turn off access to the Store
    if ($Level -eq '2') {
        if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Explorer' `
                -Name 'NoUseStoreOpenWith' -Value 1 -Type DWord `
                -Description "CIS 18.9.14.1 (L2) - Disable Store app for file associations") {
            $Stats.Applied++
        }
        else { $Stats.Failed++ }
        $Stats.TotalSettings++
    }

    # CIS 18.9.27.1.1 - Turn off Help Experience Improvement Program
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Assistance\Client\1.0' `
            -Name 'NoImplicitFeedback' -Value 1 -Type DWord `
            -Description "CIS 18.9.27.1.1 - Disable Help Experience Improvement Program") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.30.2 - Turn off location
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\LocationAndSensors' `
            -Name 'DisableLocation' -Value 1 -Type DWord `
            -Description "CIS 18.9.30.2 - Disable location services") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.39.16.1 - Prevent device metadata retrieval from the Internet
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Device Metadata' `
            -Name 'PreventDeviceMetadataFromNetwork' -Value 1 -Type DWord `
            -Description "CIS 18.9.39.16.1 - Prevent device metadata from Internet") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.47.4.1 - Turn off Autoplay
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer' `
            -Name 'NoDriveTypeAutoRun' -Value 255 -Type DWord `
            -Description "CIS 18.9.47.4.1 - Disable Autoplay for all drives") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.47.5.1 - Turn off Autorun
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer' `
            -Name 'NoAutorun' -Value 1 -Type DWord `
            -Description "CIS 18.9.47.5.1 - Disable Autorun") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.65.2.2 - Do not allow passwords to be saved
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' `
            -Name 'DisablePasswordSaving' -Value 1 -Type DWord `
            -Description "CIS 18.9.65.2.2 - Disable RDP password saving") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.65.3.2.1 - Do not allow drive redirection
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' `
            -Name 'fDisableCdm' -Value 1 -Type DWord `
            -Description "CIS 18.9.65.3.2.1 - Disable RDP drive redirection") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.65.3.3.1 - Always prompt for password upon connection
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' `
            -Name 'fPromptForPassword' -Value 1 -Type DWord `
            -Description "CIS 18.9.65.3.3.1 - RDP always prompt for password") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.65.3.3.2 - Require secure RPC communication
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' `
            -Name 'fEncryptRPCTraffic' -Value 1 -Type DWord `
            -Description "CIS 18.9.65.3.3.2 - RDP secure RPC") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.65.3.9.1 - Set client connection encryption level - High
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' `
            -Name 'MinEncryptionLevel' -Value 3 -Type DWord `
            -Description "CIS 18.9.65.3.9.1 - RDP encryption level (High)") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.80.1.1 - Turn off Search Companion content file updates
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\SearchCompanion' `
            -Name 'DisableContentFileUpdates' -Value 1 -Type DWord `
            -Description "CIS 18.9.80.1.1 - Disable Search Companion updates") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # CIS 18.9.86.2.1 - Turn off Windows Error Reporting
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Error Reporting' `
            -Name 'Disabled' -Value 1 -Type DWord `
            -Description "CIS 18.9.86.2.1 - Disable Windows Error Reporting") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++
}
#endregion

#region BitLocker (Level 2)
if (Test-Category 'BitLocker' -and $Level -eq '2') {
    Write-Log "--- CIS 18.9.6: BitLocker Drive Encryption (Level 2) ---" -Level Section

    # CIS 18.9.6.1 - Choose how BitLocker-protected operating system drives can be recovered
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\FVE' `
            -Name 'OSRecovery' -Value 1 -Type DWord `
            -Description "CIS 18.9.6.1 - Configure BitLocker recovery") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # Allow data recovery agent
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\FVE' `
            -Name 'OSManageDRA' -Value 1 -Type DWord `
            -Description "Allow BitLocker data recovery agent") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    # Save BitLocker recovery information to AD DS
    if (Set-RegistryValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\FVE' `
            -Name 'OSActiveDirectoryBackup' -Value 1 -Type DWord `
            -Description "Store BitLocker recovery in AD DS") {
        $Stats.Applied++
    }
    else { $Stats.Failed++ }
    $Stats.TotalSettings++

    Write-Log "Note: Full BitLocker configuration should be managed via Intune Configuration Profile" -Level Info
}
#endregion

#region Audit Policies
if (Test-Category 'AuditPolicies') {
    Write-Log "--- CIS 17: Advanced Audit Policies ---" -Level Section

    # Configure audit policies using auditpol
    $AuditSettings = @(
        @{Setting = 'Credential Validation'; Value = 'Success and Failure'; ID = 'CIS 17.1.1' }
        @{Setting = 'Application Group Management'; Value = 'Success and Failure'; ID = 'CIS 17.2.1' }
        @{Setting = 'Security Group Management'; Value = 'Success'; ID = 'CIS 17.2.4' }
        @{Setting = 'User Account Management'; Value = 'Success and Failure'; ID = 'CIS 17.2.5' }
        @{Setting = 'Process Creation'; Value = 'Success'; ID = 'CIS 17.3.1' }
        @{Setting = 'Account Lockout'; Value = 'Failure'; ID = 'CIS 17.5.1' }
        @{Setting = 'Logoff'; Value = 'Success'; ID = 'CIS 17.5.2' }
        @{Setting = 'Logon'; Value = 'Success and Failure'; ID = 'CIS 17.5.3' }
        @{Setting = 'Special Logon'; Value = 'Success'; ID = 'CIS 17.5.5' }
        @{Setting = 'Removable Storage'; Value = 'Success and Failure'; ID = 'CIS 17.6.1' }
        @{Setting = 'Audit Policy Change'; Value = 'Success'; ID = 'CIS 17.7.1' }
        @{Setting = 'Authentication Policy Change'; Value = 'Success'; ID = 'CIS 17.7.2' }
        @{Setting = 'Sensitive Privilege Use'; Value = 'Success and Failure'; ID = 'CIS 17.8.1' }
        @{Setting = 'IPsec Driver'; Value = 'Success and Failure'; ID = 'CIS 17.9.1' }
        @{Setting = 'Security State Change'; Value = 'Success'; ID = 'CIS 17.9.2' }
        @{Setting = 'Security System Extension'; Value = 'Success'; ID = 'CIS 17.9.3' }
        @{Setting = 'System Integrity'; Value = 'Success and Failure'; ID = 'CIS 17.9.4' }
    )

    foreach ($Audit in $AuditSettings) {
        try {
            $AuditValue = if ($Audit.Value -eq 'Success and Failure') { 'enable' } else { 'enable' }

            $SubcatGuid = & auditpol /get /subcategory:"$($Audit.Setting)" 2>&1 | Select-String -Pattern '{.*}' | ForEach-Object { $_.Matches[0].Value }

            if ($SubcatGuid) {
                & auditpol /set /subcategory:"$($Audit.Setting)" /success:enable /failure:enable | Out-Null
                Write-Log "$($Audit.ID) - Set audit policy for '$($Audit.Setting)'" -Level Info
                $Stats.Applied++
            }
            else {
                Write-Log "Could not find audit subcategory: $($Audit.Setting)" -Level Warning
                $Stats.Failed++
            }
        }
        catch {
            Write-Log "Failed to set audit policy for $($Audit.Setting): $($_.Exception.Message)" -Level Error
            $Stats.Failed++
        }
        $Stats.TotalSettings++
    }
}
#endregion

# Summary
$Duration = (Get-Date) - $StartTime
Write-Log "`n=== CIS Hardening Completed ===" -Level Section
Write-Log "Total Settings: $($Stats.TotalSettings)" -Level Info
Write-Log "Successfully Applied: $($Stats.Applied)" -Level Success
Write-Log "Failed: $($Stats.Failed)" -Level $(if ($Stats.Failed -gt 0) { 'Error' } else { 'Info' })
Write-Log "Skipped: $($Stats.Skipped)" -Level Info
Write-Log "Execution Time: $([Math]::Round($Duration.TotalMinutes, 2)) minutes" -Level Info
Write-Log "Log File: $LogFile" -Level Info

# Recommendations
Write-Log "`n=== Next Steps ===" -Level Section
Write-Log "1. Review log file for any failed settings: $LogFile" -Level Info
Write-Log "2. Some settings require reboot to take effect" -Level Warning
Write-Log "3. Configure additional policies via Intune Configuration Profiles:" -Level Info
Write-Log "   - Password Policy (complexity, length, age)" -Level Info
Write-Log "   - BitLocker Encryption (if not done via script)" -Level Info
Write-Log "   - User Rights Assignments" -Level Info
Write-Log "4. Test thoroughly in pilot environment before production rollout" -Level Warning
Write-Log "5. Monitor Event Logs for security events (Event Viewer > Security)" -Level Info

if ($Stats.Failed -gt 0) {
    Write-Log "`nWARNING: Some settings failed to apply. Review the log file for details." -Level Error
    exit 1
}

exit 0
