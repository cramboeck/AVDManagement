# ZeroStress Cockpit - Windows hardening check (detection only, meant for a daily schedule)
# Checks a fixed set of hardening controls derived from the Microsoft security
# baseline documentation: SMB, legacy name resolution, credential protection,
# NTLM, UAC, firewall, RDP, PowerShell logging, event log size, BitLocker,
# Secure Boot, Defender settings and built-in accounts. Reads only; changes
# nothing. Output: one JSON line with the ids of failed, not applicable and
# unreadable controls (passed = all others), under 2000 characters.
# Exit 1 = at least one control failed, exit 0 = all passed.
# PowerShell 5.1, ASCII, no aliases. No personal data.

$ErrorActionPreference = 'SilentlyContinue'

$failed = New-Object System.Collections.ArrayList
$notApplicable = New-Object System.Collections.ArrayList
$unreadable = New-Object System.Collections.ArrayList
$passedCount = 0

function Get-RegValue {
    param([string]$Path, [string]$Name)
    $item = Get-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $item) { return $null }
    return $item.$Name
}

# Records one control: $State is 'pass', 'fail', 'na' or 'error'
function Set-Control {
    param([string]$Id, [string]$State)
    if ($State -eq 'pass') { $script:passedCount = $script:passedCount + 1 }
    elseif ($State -eq 'fail') { [void]$script:failed.Add($Id) }
    elseif ($State -eq 'na') { [void]$script:notApplicable.Add($Id) }
    else { [void]$script:unreadable.Add($Id) }
}

function Test-Control {
    param([string]$Id, [scriptblock]$Check)
    try {
        $state = & $Check
        if ($state -is [bool]) {
            if ($state) { $state = 'pass' } else { $state = 'fail' }
        }
        Set-Control -Id $Id -State ([string]$state)
    } catch {
        Set-Control -Id $Id -State 'error'
    }
}

$lsa = 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa'
$systemPolicies = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'

# Network protocols
Test-Control 'smb1-disabled' {
    $cfg = Get-SmbServerConfiguration -ErrorAction Stop
    -not $cfg.EnableSMB1Protocol
}
Test-Control 'smb-server-signing' {
    $cfg = Get-SmbServerConfiguration -ErrorAction Stop
    [bool]$cfg.RequireSecuritySignature
}
Test-Control 'smb-client-signing' {
    (Get-RegValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters' -Name 'RequireSecuritySignature') -eq 1
}
Test-Control 'llmnr-disabled' {
    (Get-RegValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\DNSClient' -Name 'EnableMulticast') -eq 0
}

# Credential protection and authentication
Test-Control 'wdigest-disabled' {
    $value = Get-RegValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\SecurityProviders\WDigest' -Name 'UseLogonCredential'
    ($null -eq $value) -or ($value -eq 0)
}
Test-Control 'lsa-protection' {
    $value = Get-RegValue -Path $lsa -Name 'RunAsPPL'
    ($value -eq 1) -or ($value -eq 2)
}
Test-Control 'credential-guard' {
    $dg = Get-CimInstance -Namespace 'root\Microsoft\Windows\DeviceGuard' -ClassName 'Win32_DeviceGuard' -ErrorAction Stop
    if ($null -eq $dg) { return 'error' }
    (@($dg.SecurityServicesRunning) -contains 1)
}
Test-Control 'ntlmv2-only' {
    $value = Get-RegValue -Path $lsa -Name 'LmCompatibilityLevel'
    ($null -ne $value) -and ([int]$value -ge 5)
}
Test-Control 'no-lm-hash' {
    $value = Get-RegValue -Path $lsa -Name 'NoLMHash'
    ($null -eq $value) -or ($value -eq 1)
}
Test-Control 'anonymous-restricted' {
    ((Get-RegValue -Path $lsa -Name 'RestrictAnonymousSAM') -eq 1) -and ((Get-RegValue -Path $lsa -Name 'RestrictAnonymous') -eq 1)
}

# Local system
Test-Control 'uac-secure-desktop' {
    ((Get-RegValue -Path $systemPolicies -Name 'EnableLUA') -eq 1) -and ((Get-RegValue -Path $systemPolicies -Name 'PromptOnSecureDesktop') -ne 0)
}
Test-Control 'autorun-disabled' {
    $explorer = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer'
    ((Get-RegValue -Path $explorer -Name 'NoDriveTypeAutoRun') -eq 255) -or ((Get-RegValue -Path $explorer -Name 'NoAutorun') -eq 1)
}
Test-Control 'firewall-all-profiles' {
    $profiles = @(Get-NetFirewallProfile -ErrorAction Stop)
    if ($profiles.Count -eq 0) { return 'error' }
    @($profiles | Where-Object { -not $_.Enabled }).Count -eq 0
}
Test-Control 'rdp-nla' {
    $deny = Get-RegValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' -Name 'fDenyTSConnections'
    if ($deny -ne 0) { return 'na' }
    (Get-RegValue -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name 'UserAuthentication') -eq 1
}
Test-Control 'remote-registry-off' {
    $svc = Get-CimInstance -ClassName Win32_Service -Filter "Name = 'RemoteRegistry'" -ErrorAction Stop
    if ($null -eq $svc) { return 'na' }
    ($svc.State -ne 'Running') -and ($svc.StartMode -ne 'Auto')
}

# Logging
Test-Control 'ps-scriptblock-logging' {
    (Get-RegValue -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging' -Name 'EnableScriptBlockLogging') -eq 1
}
Test-Control 'process-cmdline-audit' {
    (Get-RegValue -Path ($systemPolicies + '\Audit') -Name 'ProcessCreationIncludeCmdLine_Enabled') -eq 1
}
Test-Control 'security-log-size' {
    $log = Get-WinEvent -ListLog 'Security' -ErrorAction Stop
    [int64]$log.MaximumSizeInBytes -ge (196608 * 1024)
}
Test-Control 'ps-v2-removed' {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName 'MicrosoftWindowsPowerShellV2Root' -ErrorAction Stop
    if ($null -eq $feature) { return 'na' }
    $feature.State -ne 'Enabled'
}

# Encryption and boot
Test-Control 'bitlocker-os' {
    $volume = Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop
    [string]$volume.ProtectionStatus -eq 'On'
}
Test-Control 'secure-boot' {
    [bool](Confirm-SecureBootUEFI -ErrorAction Stop)
}

# Defender (absent when another antivirus is in charge)
$mpStatus = $null
$mpPreference = $null
if (Get-Command -Name 'Get-MpComputerStatus') {
    $mpStatus = Get-MpComputerStatus
    $mpPreference = Get-MpPreference
}
Test-Control 'defender-tamper-protection' {
    if ($null -eq $mpStatus) { return 'na' }
    [bool]$mpStatus.IsTamperProtected
}
Test-Control 'defender-pua' {
    if ($null -eq $mpPreference) { return 'na' }
    [int]$mpPreference.PUAProtection -eq 1
}
Test-Control 'defender-asr' {
    if ($null -eq $mpPreference) { return 'na' }
    @($mpPreference.AttackSurfaceReductionRules_Actions | Where-Object { [int]$_ -eq 1 }).Count -gt 0
}

# Built-in accounts (checked by SID, no account names are read or reported)
$localAccounts = @(Get-CimInstance -ClassName Win32_UserAccount -Filter 'LocalAccount = True')
Test-Control 'builtin-admin-disabled' {
    $account = $localAccounts | Where-Object { $_.SID -like 'S-1-5-21-*-500' } | Select-Object -First 1
    if ($null -eq $account) { return 'error' }
    [bool]$account.Disabled
}
Test-Control 'guest-disabled' {
    $account = $localAccounts | Where-Object { $_.SID -like 'S-1-5-21-*-501' } | Select-Object -First 1
    if ($null -eq $account) { return 'na' }
    [bool]$account.Disabled
}

$os = Get-CimInstance -ClassName Win32_OperatingSystem
$result = [ordered]@{
    schema = 'zsc.hardening/1'
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
    osBuild = [string]$os.BuildNumber
    passed = $passedCount
    failed = @($failed)
    notApplicable = @($notApplicable)
    unreadable = @($unreadable)
}

Write-Output (ConvertTo-Json -InputObject $result -Compress -Depth 3)
if ($failed.Count -gt 0) { exit 1 }
exit 0
