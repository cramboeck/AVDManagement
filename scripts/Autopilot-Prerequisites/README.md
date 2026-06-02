# IntuneWin Autopilot Software Installation & CIS Hardening Package

Complete solution for Windows Autopilot v2 deployment including prerequisites installation and CIS security hardening.

## Features

✅ **Prerequisites Installation**
- .NET Framework 3.5 (Windows Feature activation)
- .NET Framework 4.8 (offline or web installer)
- Visual C++ Redistributable 2015-2022 (x64 and x86)

✅ **CIS Windows 11 Hardening**
- 100+ security settings based on CIS Benchmark
- Level 1 (essential) and Level 2 (high security)
- Password Policy, UAC, Firewall, Defender, SMB, RDP, Audit Policies

✅ **Multiple Deployment Options**
- Win32 App (IntuneWin package)
- Device Preparation Script (early execution)
- Intune Configuration Profiles

✅ **Performance Optimized**
- Azure Blob Storage support for enterprise
- Early detection (skips if already installed)
- Minimal overhead during Autopilot

## Quick Start

### Option 1: Prerequisites Installation (Win32 App)

```powershell
# Create IntuneWin package
cd scripts/IntuneWin-AutopilotSoftware
.\Create-IntuneWinPackage.ps1 -DownloadContentPrepTool

# Upload Output/*.intunewin to Intune
# Install command: powershell.exe -ExecutionPolicy Bypass -File Install-AutopilotSoftware-EN.ps1
# Detection script: Detect-AutopilotSoftware-EN.ps1
```

### Option 2: CIS Hardening (Device Preparation Script)

```powershell
# In Intune: Devices → Enrollment → Device preparation policies
# Add Script: Apply-CISHardening-Win11.ps1

# Level 1 (recommended for most environments)
.\Apply-CISHardening-Win11.ps1 -Level 1

# Level 2 (high security environments)
.\Apply-CISHardening-Win11.ps1 -Level 2

# Skip specific categories
.\Apply-CISHardening-Win11.ps1 -Level 1 -SkipCategories @('Firewall','BitLocker')
```

### Option 3: Combined Approach (Recommended)

```
Device Preparation Phase:
├── Script 1 (Priority 1): Install-Prerequisites-DevicePrep.ps1
└── Script 2 (Priority 2): Apply-CISHardening-Win11.ps1 -Level 1

Win32 Apps (Required):
├── Additional software packages
└── Line-of-business applications

Intune Configuration Profiles:
├── Password Policy
├── BitLocker Encryption
└── Windows Update Rings

Compliance Policies:
└── Monitor and enforce settings
```

## Available Scripts

### Prerequisites Installation

| Script | Purpose | Use Case |
|--------|---------|----------|
| `Install-AutopilotSoftware-EN.ps1` | Standard installation | Win32 App, small environments |
| `Install-AutopilotSoftware-Optimized.ps1` | With Azure Blob Storage | Win32 App, enterprise |
| `Install-Prerequisites-DevicePrep.ps1` | Fast installation with early detection | Device Preparation |
| `Detect-AutopilotSoftware-EN.ps1` | Detection for Win32 Apps | Intune detection rules |

### Security Hardening

| Script | Purpose | Settings |
|--------|---------|----------|
| `Apply-CISHardening-Win11.ps1` | CIS Benchmark implementation | 100+ security settings |

### Utilities

| Script | Purpose |
|--------|---------|
| `Create-IntuneWinPackage.ps1` | Creates .intunewin package |

## Documentation

📖 **[AUTOPILOT_V2_DEPLOYMENT.md](AUTOPILOT_V2_DEPLOYMENT.md)**
- Device Preparation vs Win32 App comparison
- Deployment strategies
- Best practices
- Timing and priorities

📖 **[CIS_HARDENING_GUIDE.md](CIS_HARDENING_GUIDE.md)**
- Complete CIS hardening documentation
- Category breakdown (100+ settings)
- Intune Configuration Profile recommendations
- Verification and troubleshooting
- Compliance integration

📖 **[AZURE_BLOB_SETUP.md](AZURE_BLOB_SETUP.md)**
- Azure Blob Storage setup for enterprise
- Performance optimization
- Cost analysis
- CDN configuration
- Automated updates

📖 **[README-DE.md](README-DE.md)**
- German version with detailed Win32 App setup instructions

## CIS Hardening Categories

The `Apply-CISHardening-Win11.ps1` script implements these security categories:

| Category | CIS Section | Count | Examples |
|----------|-------------|-------|----------|
| Password Policy | 1.1 | 5+ | History, complexity, length |
| Account Lockout | 1.2 | 3 | Threshold, duration, reset timer |
| Security Options | 2.3 | 30+ | UAC, SMB signing, NTLM |
| Windows Firewall | 9.1-9.3 | 12 | All profiles, logging |
| Microsoft Defender | 18.9.39 | 10+ | Real-time, cloud protection, ASR |
| Windows Update | 18.9.102 | 3 | Automatic updates, preview builds |
| Admin Templates | 18.x | 25+ | SMB, RDP, Autoplay, Error Reporting |
| BitLocker | 18.9.6 | 5 | Encryption (Level 2) |
| Audit Policies | 17.x | 17 | Advanced audit configuration |

**Total: 100+ security settings**

## Usage Examples

### Scenario 1: Standard Company Laptop

```powershell
# Device Preparation:
1. Install-Prerequisites-DevicePrep.ps1
2. Apply-CISHardening-Win11.ps1 -Level 1

# Result: Secure baseline, all prerequisites installed before apps
```

### Scenario 2: High Security Environment

```powershell
# Device Preparation:
1. Install-Prerequisites-DevicePrep.ps1
2. Apply-CISHardening-Win11.ps1 -Level 2

# Intune Configuration Profiles:
- BitLocker (256-bit AES, TPM + PIN)
- Password Policy (16 chars, 90 days max age)
- Windows Defender ATP integration

# Compliance Policy:
- BitLocker enabled
- Firewall enabled
- Antivirus up to date
- Secure Boot enabled

# Conditional Access:
- Block if non-compliant
```

### Scenario 3: Development Workstation

```powershell
# Device Preparation:
1. Install-Prerequisites-DevicePrep.ps1
2. Apply-CISHardening-Win11.ps1 -Level 1 -SkipCategories @('Firewall')

# Skip Firewall to allow Docker, WSL2, and local development servers
# Still apply UAC, SMB, RDP, and other security settings
```

## Prerequisites

- PowerShell 5.1 or higher
- Windows 10 1607+ (target devices)
- Windows 11 23H2+ (for CIS hardening)
- Microsoft Intune license
- Internet access during deployment
- Azure Blob Storage (optional, for enterprise performance)

## Deployment to Intune

### Win32 App Deployment

1. **Create Package:**
   ```powershell
   .\Create-IntuneWinPackage.ps1 -DownloadContentPrepTool
   ```

2. **Upload to Intune:**
   - Navigate to: Apps → Windows → Add → Windows app (Win32)
   - Upload: `Output/*.intunewin`

3. **Configure:**
   - Install command: `powershell.exe -ExecutionPolicy Bypass -File Install-AutopilotSoftware-EN.ps1`
   - Uninstall command: `cmd.exe /c echo No uninstall required`
   - Detection: Use custom script `Detect-AutopilotSoftware-EN.ps1`

4. **Assign:**
   - Required: Autopilot device group
   - Available for enrolled devices: No
   - Filter: `(device.enrollmentProfileName -eq "AutopilotV2")`

### Device Preparation Script

1. **Navigate:**
   Intune Admin Center → Devices → Enrollment → Device preparation policies

2. **Select Profile:**
   Choose your Autopilot v2 profile

3. **Add Scripts:**
   - Scripts → Add → Windows
   - Upload: `Install-Prerequisites-DevicePrep.ps1` (Priority 1)
   - Upload: `Apply-CISHardening-Win11.ps1` (Priority 2)

4. **Configure:**
   - Run in 64-bit PowerShell: Yes
   - Run as user: No (SYSTEM)
   - Signature check: No
   - Timeout: 30 minutes

5. **Script Parameters (for CIS script):**
   ```powershell
   -Level 1
   # or
   -Level 2
   # or with exclusions
   -Level 1 -SkipCategories @('Firewall','BitLocker')
   ```

## Verification

### Check Prerequisites Installation

```powershell
# .NET Framework 3.5
Get-WindowsOptionalFeature -Online -FeatureName NetFx3

# .NET Framework 4.8+
Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full'

# Visual C++ Redistributable
Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*' |
    Where-Object { $_.DisplayName -like "*Visual C++ 2015-2022*" } |
    Select-Object DisplayName, DisplayVersion
```

### Check CIS Hardening

```powershell
# UAC
Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' |
    Select-Object EnableLUA, ConsentPromptBehaviorAdmin

# Firewall
Get-NetFirewallProfile | Select-Object Name, Enabled, DefaultInboundAction

# Defender
Get-MpPreference | Select-Object DisableRealtimeMonitoring, DisableBehaviorMonitoring

# SMBv1
Get-SmbServerConfiguration | Select-Object EnableSMB1Protocol

# View detailed log
Get-Content "$env:ProgramData\Microsoft\IntuneManagementExtension\Logs\CISHardening_Win11_*.log"
```

## Troubleshooting

### Issue: Script fails during Autopilot

**Check logs:**
```powershell
# Intune Management Extension logs
Get-Content "C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\IntuneManagementExtension.log" | Select-String "ERROR"

# Device Preparation logs
Get-Content "C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\DevicePrep*.log"

# Script-specific logs
Get-Content "C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\*Autopilot*.log"
Get-Content "C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\CISHardening*.log"
```

### Issue: CIS settings not applying

**Verify execution:**
- Check script ran: Intune Portal → Devices → Device → Device preparation → Scripts
- Check exit code: Should be 0 for success
- Review log file for specific failures
- Check for conflicting Group Policies: `gpresult /H gpresult.html`

### Issue: User experience degraded

**Review Level 2 settings:**
- Level 2 is designed for high-security environments
- May impact: Store apps, some network features, user prompts
- Consider: Use Level 1 for standard users, Level 2 for privileged accounts
- Or: Use `-SkipCategories` to exclude specific categories

## Performance Optimization

### Small Environment (<100 devices)
- Use standard scripts (no Azure Blob Storage)
- Deploy as Win32 App for monitoring
- CIS Level 1

### Medium Environment (100-500 devices)
- Use Azure Blob Storage for prerequisites
- Deploy CIS as Device Prep Script
- CIS Level 1, selective Level 2 for privileged devices

### Large Environment (500+ devices)
- Azure Blob Storage + CDN
- Device Prep for both prerequisites and CIS
- Automated software updates in Blob Storage
- Hybrid approach with Intune Config Profiles
- CIS Level 1 baseline, Level 2 for high-security groups

## Security Baseline Comparison

| Method | Timing | Compliance Monitoring | Remediation | Best For |
|--------|--------|----------------------|-------------|----------|
| **CIS Hardening Script** | Device Prep (early) | Manual via logs | Re-run script | Initial baseline |
| **Intune Config Profiles** | After enrollment | Built-in reporting | Automatic | Ongoing compliance |
| **Group Policy** | Domain join | Limited in Intune | GPO refresh | Hybrid environments |
| **Compliance Policies** | After enrollment | Built-in + CA integration | Block access | Enforcement |

**Recommendation:** Use combination of all methods for defense-in-depth.

## Support

### Logs Location
```
C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\
├── AutopilotSoftwareInstall_<timestamp>.log
├── CISHardening_Win11_<timestamp>.log
├── DevicePrep_Prerequisites_<timestamp>.log
├── IntuneManagementExtension.log
└── AgentExecutor.log
```

### Resources
- CIS Benchmarks: https://www.cisecurity.org/cis-benchmarks
- Microsoft Security Baselines: https://aka.ms/securitybaselines
- Intune Documentation: https://docs.microsoft.com/mem/intune

### Community
- GitHub Issues: [Report issues here](../../issues)
- Microsoft Tech Community: https://techcommunity.microsoft.com/t5/intune/bd-p/Microsoft-Intune

## License

This project is licensed under the MIT License - see the [LICENSE](../../LICENSE) file for details.

## Changelog

### Version 2.0 (2025-10-25)
- ✨ Added CIS Windows 11 Benchmark hardening (100+ settings)
- ✨ Added English versions of all scripts
- ✨ Added Azure Blob Storage support for enterprise
- ✨ Added Device Preparation optimized scripts
- ✨ Added comprehensive documentation guides
- ✨ Added .NET Framework 3.5 installation
- 📝 Complete documentation overhaul
- 🚀 Performance optimizations
- 🔒 Security enhancements

### Version 1.0 (2025-10-25)
- Initial release
- Prerequisites installation (.NET 4.8, VC++ Redist)
- IntuneWin package creation
- German documentation

---

**Note:** Always test in a pilot environment before production deployment. CIS Benchmark settings should be reviewed and adjusted according to your organization's security requirements.
