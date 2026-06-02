# CIS Windows 11 Benchmark Hardening Guide

This guide explains how to apply CIS (Center for Internet Security) Benchmark hardening to Windows 11 devices during the Autopilot v2 deployment process.

## Overview

The CIS Microsoft Windows 11 Enterprise Benchmark provides prescriptive guidance for establishing a secure configuration posture for Windows 11 systems. This script implements Level 1 and Level 2 recommendations.

### CIS Benchmark Levels

**Level 1 (L1) - Essential Security**
- Recommended for all environments
- Minimal impact on functionality
- Provides essential security baseline
- Suitable for most organizations

**Level 2 (L2) - High Security**
- Recommended for high-security environments
- May impact some functionality or user experience
- Provides defense-in-depth
- Suitable for sensitive data environments

## Categories Covered

| Category | CIS Section | Settings Count | Description |
|----------|-------------|----------------|-------------|
| **Password Policy** | 1.1 | 5+ | Password complexity, length, history |
| **Account Lockout** | 1.2 | 3 | Lockout threshold, duration, reset timer |
| **Security Options** | 2.3 | 30+ | UAC, SMB signing, NTLM, network security |
| **Windows Firewall** | 9.1-9.3 | 12 | Domain, Private, Public profile settings |
| **Microsoft Defender** | 18.9.39 | 10+ | Antivirus, real-time protection, cloud protection |
| **Windows Update** | 18.9.102 | 3 | Automatic updates, preview builds |
| **Admin Templates** | 18.x | 25+ | SMB, RDP, Autoplay, Error Reporting |
| **BitLocker** | 18.9.6 | 5 | Drive encryption (Level 2 only) |
| **Audit Policies** | 17.x | 17 | Advanced audit policy configuration |

**Total: 100+ security settings**

## Quick Start

### Option 1: Device Preparation Script (Recommended)

Run during Autopilot Device Preparation phase for earliest application:

```powershell
# Level 1 (Essential Security)
.\Apply-CISHardening-Win11.ps1 -Level 1

# Level 2 (High Security)
.\Apply-CISHardening-Win11.ps1 -Level 2

# Level 1, Skip Firewall category
.\Apply-CISHardening-Win11.ps1 -Level 1 -SkipCategories @('Firewall')

# Level 2, Skip BitLocker and Defender
.\Apply-CISHardening-Win11.ps1 -Level 2 -SkipCategories @('BitLocker', 'Defender')
```

### Option 2: Win32 App

Package as IntuneWin and deploy as Win32 app for better monitoring.

### Option 3: Intune Configuration Profiles

Use Intune's built-in configuration profiles for ongoing management and compliance monitoring.

## Deployment Strategy

### Recommended Approach: Hybrid

Combine multiple methods for comprehensive coverage:

```
┌─────────────────────────────────────────────────────────┐
│ 1. Autopilot Device Preparation (Early Stage)          │
│    - Apply-CISHardening-Win11.ps1 (Level 1)           │
│    - Critical registry settings                         │
│    - Firewall configuration                             │
│    - Defender settings                                   │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Intune Configuration Profiles (Continuous)          │
│    - Password Policy                                     │
│    - BitLocker Encryption                                │
│    - Windows Update Rings                                │
│    - Endpoint Security Policies                          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Intune Compliance Policies (Monitoring)             │
│    - Check security settings                             │
│    - Report non-compliant devices                        │
│    - Conditional Access integration                      │
└─────────────────────────────────────────────────────────┘
```

## Detailed Configuration

### 1. Setup in Intune (Device Preparation)

**Navigate to:**
```
Intune Admin Center → Devices → Enrollment → Device preparation policies
→ Select your Autopilot v2 profile → Scripts → Add
```

**Script Configuration:**

| Setting | Value |
|---------|-------|
| Name | CIS Windows 11 Hardening (Level 1) |
| Description | Applies CIS Benchmark Level 1 security settings |
| Script file | `Apply-CISHardening-Win11.ps1` |
| Run script in 64-bit PowerShell | Yes |
| Run this script using logged-on credentials | No (run as SYSTEM) |
| Enforce script signature check | No |
| Timeout | 30 minutes |

**Script Arguments:**
```powershell
# For Level 1
-Level 1

# For Level 2
-Level 2

# Skip specific categories
-Level 1 -SkipCategories @('Firewall','BitLocker')
```

### 2. Complementary Intune Configuration Profiles

#### Password Policy

**Create:** `Endpoint Security → Account protection → Account protection (Windows 10 and later)`

Settings:
- Enforce password history: `24 passwords remembered`
- Maximum password age: `60 days`
- Minimum password age: `1 day`
- Minimum password length: `14 characters`
- Password must meet complexity requirements: `Enabled`

#### BitLocker Encryption

**Create:** `Endpoint Security → Disk encryption → BitLocker (Windows 10 and later)`

Settings:
- Require device encryption: `Yes`
- Require storage cards to be encrypted: `Yes`
- Hide prompt about third-party encryption: `Yes`
- Allow standard users to enable encryption: `Yes`
- Configure recovery password rotation: `Enabled`
- BitLocker recovery information: `Backup recovery password and key package`

#### Windows Firewall

**Create:** `Endpoint Security → Firewall → Microsoft Defender Firewall (Windows 10 and later)`

Settings:
- Enable firewall: `Yes` (all profiles)
- Stealth mode: `Block` (all profiles)
- Inbound connections: `Block` (all profiles)
- Outbound connections: `Allow` (all profiles)
- Unicast responses to multicast broadcasts: `Block` (all profiles)

#### Microsoft Defender Antivirus

**Create:** `Endpoint Security → Antivirus → Microsoft Defender Antivirus (Windows 10 and later)`

Settings:
- Real-time monitoring: `Enable`
- Behavior monitoring: `Enable`
- Network protection: `Enable (block mode)`
- Scan all downloaded files: `Enable`
- Scan scripts loaded in Microsoft web browsers: `Enable`
- Cloud protection: `Enable`
- Cloud protection level: `High`
- Cloud extended timeout: `50 seconds`

### 3. Compliance Policies

**Create:** `Devices → Compliance policies → Create Policy → Windows 10 and later`

**Check compliance for:**
- BitLocker enabled
- Firewall enabled
- Antivirus enabled and up to date
- Windows Defender enabled
- Secure Boot enabled
- TPM enabled

**Actions for noncompliance:**
1. Send email to end user (Day 0)
2. Mark device non-compliant (Day 1)
3. Block access (Day 3) - via Conditional Access

## Settings Reference

### Critical Security Settings

#### Account Policies

```powershell
# CIS 1.1.1 - Password history: 24 passwords
# Managed via Intune Password Policy

# CIS 1.2.1 - Account lockout duration: 15 minutes
net accounts /lockoutduration:15

# CIS 1.2.2 - Account lockout threshold: 5 attempts
net accounts /lockoutthreshold:5
```

#### User Account Control (UAC)

```powershell
# CIS 2.3.17.2 - UAC elevation prompt for admins
# Registry: HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System
# Name: ConsentPromptBehaviorAdmin
# Value: 2 (Prompt for consent on the secure desktop)

# CIS 2.3.17.3 - UAC elevation prompt for standard users
# Value: 0 (Automatically deny elevation requests)

# CIS 2.3.17.7 - UAC Admin Approval Mode
# Name: EnableLUA
# Value: 1 (Enabled)
```

#### Network Security

```powershell
# CIS 2.3.8.2 - SMB client signing
# Registry: HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters
# Name: RequireSecuritySignature
# Value: 1 (Enabled)

# CIS 2.3.11.5 - LAN Manager authentication level
# Registry: HKLM:\SYSTEM\CurrentControlSet\Control\Lsa
# Name: LmCompatibilityLevel
# Value: 5 (Send NTLMv2 response only, refuse LM & NTLM)

# CIS 2.3.11.7/8 - NTLM session security
# Name: NTLMMinClientSec / NTLMMinServerSec
# Value: 537395200 (Require NTLMv2 and 128-bit encryption)
```

#### SMBv1 Disable

```powershell
# CIS 18.3.2 - Disable SMBv1 client
# Registry: HKLM:\SYSTEM\CurrentControlSet\Services\mrxsmb10
# Name: Start
# Value: 4 (Disabled)

# CIS 18.3.3 - Disable SMBv1 server
# Registry: HKLM:\SYSTEM\CurrentControlSet\Services\LanmanServer\Parameters
# Name: SMB1
# Value: 0 (Disabled)
```

#### Remote Desktop (RDP) Security

```powershell
# CIS 18.9.65.2.2 - Disable password saving
# Registry: HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services
# Name: DisablePasswordSaving
# Value: 1

# CIS 18.9.65.3.9.1 - RDP encryption level
# Name: MinEncryptionLevel
# Value: 3 (High - 128-bit)

# CIS 18.9.65.3.3.1 - Always prompt for password
# Name: fPromptForPassword
# Value: 1
```

#### Windows Defender

```powershell
# CIS 18.9.39.8.2 - Real-time protection
# Registry: HKLM:\SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection
# Name: DisableRealtimeMonitoring
# Value: 0 (Enabled)

# CIS 18.9.39.8.3 - Behavior monitoring
# Name: DisableBehaviorMonitoring
# Value: 0 (Enabled)

# CIS 18.9.39.8.4 - Script scanning
# Name: DisableScriptScanning
# Value: 0 (Enabled)
```

## Verification

### Method 1: Check Applied Settings

```powershell
# Check UAC status
Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' | Select-Object EnableLUA, ConsentPromptBehaviorAdmin

# Check SMB signing
Get-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Services\LanmanWorkstation\Parameters' | Select-Object RequireSecuritySignature

# Check Firewall status
Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction

# Check Defender status
Get-MpPreference | Select-Object DisableRealtimeMonitoring, DisableBehaviorMonitoring, DisableScriptScanning

# Check SMBv1 status
Get-SmbServerConfiguration | Select-Object EnableSMB1Protocol
Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol
```

### Method 2: CIS-CAT Pro Lite (Free Tool)

1. Download: https://www.cisecurity.org/cybersecurity-tools/cis-cat-lite
2. Run assessment against Windows 11 Benchmark
3. Review HTML report for compliance percentage

### Method 3: Microsoft Security Compliance Toolkit

1. Download: https://www.microsoft.com/en-us/download/details.aspx?id=55319
2. Import CIS baseline into Local Group Policy
3. Use Policy Analyzer to compare current settings

### Method 4: PowerShell Audit Script

```powershell
# Quick audit of critical settings
$AuditResults = @()

# UAC
$UAC = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
$AuditResults += [PSCustomObject]@{
    Setting = 'UAC Enabled'
    Expected = '1'
    Actual = $UAC.EnableLUA
    Compliant = ($UAC.EnableLUA -eq 1)
}

# Firewall
$Firewall = Get-NetFirewallProfile -Profile Domain
$AuditResults += [PSCustomObject]@{
    Setting = 'Domain Firewall Enabled'
    Expected = 'True'
    Actual = $Firewall.Enabled
    Compliant = ($Firewall.Enabled -eq $true)
}

# SMBv1
$SMB1 = Get-SmbServerConfiguration | Select-Object -ExpandProperty EnableSMB1Protocol
$AuditResults += [PSCustomObject]@{
    Setting = 'SMBv1 Disabled'
    Expected = 'False'
    Actual = $SMB1
    Compliant = ($SMB1 -eq $false)
}

# Display results
$AuditResults | Format-Table -AutoSize
$ComplianceRate = ($AuditResults | Where-Object Compliant -eq $true).Count / $AuditResults.Count * 100
Write-Host "`nCompliance Rate: $([Math]::Round($ComplianceRate, 2))%" -ForegroundColor $(if ($ComplianceRate -ge 90) { 'Green' } else { 'Yellow' })
```

## Troubleshooting

### Common Issues

#### Issue: Script fails with "Access Denied"

**Solution:**
- Ensure script runs as SYSTEM
- Check if Device Preparation script execution is enabled
- Verify no conflicting Group Policies

#### Issue: Some settings don't apply

**Solution:**
```powershell
# Check log file
Get-Content "$env:ProgramData\Microsoft\IntuneManagementExtension\Logs\CISHardening_Win11_*.log" | Select-String "Failed"

# Check for conflicting policies
gpresult /H gpresult.html
```

#### Issue: BitLocker settings not applying

**Solution:**
- BitLocker requires TPM 2.0
- Check TPM status: `Get-Tpm`
- Use Intune Disk Encryption profile instead of script

#### Issue: User experience degraded after Level 2

**Solution:**
- Review Level 2 settings that may impact UX:
  - Disabled Store app integration
  - Stricter firewall rules
  - More aggressive audit policies
- Consider using Level 1 for standard users, Level 2 for privileged accounts only

### Logs and Monitoring

**Script Logs:**
```
C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\CISHardening_Win11_<timestamp>.log
```

**Event Logs:**
```powershell
# Security events
Get-WinEvent -LogName Security -MaxEvents 100

# Audit policy changes
Get-WinEvent -FilterHashtable @{LogName='Security'; ID=4719}

# Firewall events
Get-WinEvent -LogName 'Microsoft-Windows-Windows Firewall With Advanced Security/Firewall' -MaxEvents 100
```

**Intune Monitoring:**
```
Intune Admin Center → Devices → All devices → [Select device]
→ Device preparation → Scripts → CIS Windows 11 Hardening
```

## Best Practices

### 1. Pilot Testing

```
Week 1: Test in lab environment (10 devices)
Week 2: Deploy to pilot group (50-100 devices)
Week 3: Monitor for issues, gather feedback
Week 4: Deploy to production (phased rollout)
```

### 2. Phased Rollout

| Phase | Target Group | Duration | Monitoring |
|-------|--------------|----------|------------|
| 1 | IT Department | 1 week | Daily checks |
| 2 | Pilot Users | 2 weeks | Helpdesk tickets |
| 3 | 25% of org | 2 weeks | Compliance reports |
| 4 | 100% of org | Ongoing | Monthly reviews |

### 3. Exception Handling

Some environments may need exceptions:

```powershell
# Create device groups in Azure AD
"CIS-Level1-Standard"      # Most devices
"CIS-Level2-Sensitive"     # High security devices
"CIS-Exceptions-DevOps"    # Developers (some settings exempted)
"CIS-Exceptions-Legacy"    # Legacy app compatibility

# Assign different profiles to each group
```

### 4. Documentation

Document your implementation:

```markdown
## Our CIS Implementation

- **Level:** Level 1
- **Exceptions:** Disabled Autoplay restriction for DevOps team
- **Additional Settings:** Custom EDR integration
- **Review Schedule:** Quarterly
- **Owner:** Security Team
- **Contact:** security@company.com
```

### 5. Regular Reviews

**Quarterly Tasks:**
- Review CIS Benchmark updates
- Check for new Windows 11 versions
- Verify all settings still apply
- Update scripts if needed
- Re-assess risk posture

**Annual Tasks:**
- Full security audit
- Update documentation
- Retrain IT staff
- Review exceptions

## Integration with Other Security Tools

### Microsoft Defender for Endpoint

CIS hardening complements Defender for Endpoint:

```powershell
# Onboard to Defender for Endpoint first
# Then apply CIS hardening
# MDE provides additional protections:
# - Attack Surface Reduction (ASR) rules
# - Controlled Folder Access
# - Network Protection
# - Exploit Protection
```

### Azure AD Conditional Access

Use compliance state in Conditional Access:

```
IF device is NOT compliant (CIS settings not applied)
THEN block access to corporate resources
UNTIL device becomes compliant
```

### Microsoft Sentinel

Forward Windows Security logs to Sentinel:

```powershell
# Configure diagnostic settings
# Monitor for:
# - Failed logon attempts (Event ID 4625)
# - Audit policy changes (Event ID 4719)
# - Firewall rule changes (Event ID 2006/2009)
# - Privilege escalation (Event ID 4672)
```

## FAQ

**Q: Does this script replace Intune Configuration Profiles?**

A: No, it complements them. Use the script for early-stage hardening during Autopilot, and Intune Configuration Profiles for ongoing management and compliance monitoring.

**Q: Can I use this on existing devices?**

A: Yes, but test in a pilot group first. Some settings may require reboot or could impact running applications.

**Q: What's the difference between Level 1 and Level 2?**

A: Level 1 provides essential security with minimal impact. Level 2 adds stricter controls that may affect functionality or user experience, suitable for high-security environments.

**Q: How often should I update the script?**

A: Review quarterly when CIS releases benchmark updates or when Microsoft releases major Windows updates.

**Q: Can I customize the script?**

A: Yes! The script is modular. You can add/remove settings or adjust values to match your organization's requirements.

**Q: Does this guarantee compliance with industry regulations?**

A: CIS Benchmarks align with many compliance frameworks (PCI-DSS, HIPAA, NIST), but additional controls may be needed. Consult your compliance team.

**Q: Will this break any applications?**

A: Level 1 is designed for broad compatibility. Level 2 may impact some legacy applications. Always test in your environment first.

## Additional Resources

### Official Resources
- CIS Benchmarks: https://www.cisecurity.org/cis-benchmarks
- Microsoft Security Baselines: https://docs.microsoft.com/windows/security/threat-protection/windows-security-baselines
- Intune Security Baselines: https://docs.microsoft.com/mem/intune/protect/security-baselines

### Tools
- CIS-CAT Pro Lite: https://www.cisecurity.org/cybersecurity-tools/cis-cat-lite
- Microsoft Security Compliance Toolkit: https://www.microsoft.com/download/details.aspx?id=55319
- PolicyAnalyzer: Included in Security Compliance Toolkit

### Community
- CIS WorkBench: https://workbench.cisecurity.org
- Microsoft Tech Community: https://techcommunity.microsoft.com
- r/Intune: https://reddit.com/r/Intune

## Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-10-25 | Initial release |
|  |  | - 100+ CIS settings |
|  |  | - Level 1 and Level 2 support |
|  |  | - Category skip functionality |
|  |  | - Comprehensive logging |

---

**Note:** This script implements CIS Benchmark recommendations. Always review and adjust according to your organization's security policies and requirements.
