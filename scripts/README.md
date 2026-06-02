# PowerShell Automation Scripts

Professional PowerShell scripts for Microsoft 365, Azure, and Windows management.

## 📁 Repository Structure

```
scripts/
├── Autopilot-Prerequisites/           # Autopilot deployment prerequisites & security
│   ├── Installation-Scripts/          # .NET, VC++, runtime installations
│   ├── Security-Hardening/            # CIS Windows 11 hardening
│   ├── Package-Tools/                 # IntuneWin package creation
│   ├── Documentation/                 # Comprehensive guides
│   └── README.md                      # Prerequisites documentation
├── Autopilot-Monitoring/              # Real-time Autopilot monitoring tools
│   ├── Watch-AutopilotDeployment.ps1  # Local real-time monitoring
│   ├── Monitor-AutopilotDevices.ps1   # Remote multi-device monitoring
│   ├── Get-AutopilotStatus.ps1        # Quick status check
│   └── README.md                      # Monitoring documentation
├── Install-Dependencies.ps1           # Cloud Management Portal dependencies
└── README.md                          # This file
```

## 🚀 Quick Start

### 1. Autopilot Prerequisites Installation

Install .NET Framework, Visual C++ Redistributable, and apply CIS security hardening:

```powershell
cd Autopilot-Prerequisites

# Create IntuneWin package
.\Package-Tools\Create-IntuneWinPackage.ps1 -DownloadContentPrepTool

# Or run directly during device preparation
.\Installation-Scripts\Install-Prerequisites-DevicePrep.ps1

# Apply CIS Windows 11 hardening
.\Security-Hardening\Apply-CISHardening-Win11.ps1 -Level 1
```

**See:** [Autopilot-Prerequisites/README.md](Autopilot-Prerequisites/README.md)

### 2. Autopilot Monitoring

Monitor deployments in real-time - much faster than Intune Portal!

```powershell
cd Autopilot-Monitoring

# Local monitoring (on device during deployment)
.\Watch-AutopilotDeployment.ps1

# Remote monitoring (from admin workstation)
.\Monitor-AutopilotDevices.ps1

# Quick status check
.\Get-AutopilotStatus.ps1 -ExportHTML
```

**See:** [Autopilot-Monitoring/README.md](Autopilot-Monitoring/README.md)

## 📦 Components

### Autopilot Prerequisites (Deployment & Security)

**Purpose:** Automate software installation and security hardening during Windows Autopilot v2

**Features:**
- ✅ .NET Framework 3.5 & 4.8 installation
- ✅ Visual C++ Redistributable (2015-2022)
- ✅ CIS Windows 11 Benchmark hardening (100+ settings)
- ✅ Windows 11 localization (26+ countries)
- ✅ Computer renaming with flexible patterns
- ✅ Network drive & printer mapping
- ✅ Windows 11 24H2 bloatware removal
- ✅ IntuneWin package creation
- ✅ Azure Blob Storage support (enterprise)
- ✅ Multiple deployment methods (Win32 App, Device Prep, Intune Config)

**Components:**

| Script | Purpose |
|--------|---------|
| `Install-AutopilotSoftware.ps1` | Standard installation (Win32 App) |
| `Install-AutopilotSoftware-Optimized.ps1` | With Azure Blob Storage support |
| `Install-Prerequisites-DevicePrep.ps1` | Optimized for Device Preparation |
| `Detect-AutopilotSoftware.ps1` | Detection script for Intune |
| `Apply-CISHardening-Win11.ps1` | CIS Benchmark security hardening |
| `Create-IntuneWinPackage.ps1` | Create .intunewin packages |
| `Set-Win11Localization.ps1` | Configure regional settings by country code |
| `Rename-Computer.ps1` | Rename computers during Autopilot v2 |
| `Map-NetworkDrives.ps1` | Automated network drive mapping |
| `Map-Printers.ps1` | Automated network printer mapping |
| `Remove-Win11Bloatware.ps1` | Remove bloatware and consumer apps |

**Documentation:**
- [README.md](Autopilot-Prerequisites/README.md) - Main guide
- [CIS_HARDENING_GUIDE.md](Autopilot-Prerequisites/Documentation/CIS_HARDENING_GUIDE.md) - Complete CIS documentation
- [AUTOPILOT_V2_DEPLOYMENT.md](Autopilot-Prerequisites/Documentation/AUTOPILOT_V2_DEPLOYMENT.md) - Deployment strategies
- [AZURE_BLOB_SETUP.md](Autopilot-Prerequisites/Documentation/AZURE_BLOB_SETUP.md) - Azure Blob Storage setup

---

### Device Management & Configuration (Autopilot v2)

**Purpose:** Automate device configuration tasks during Autopilot v2 deployment

**Features:**
- ✅ Windows 11 localization (26+ countries supported)
- ✅ Computer renaming with flexible patterns
- ✅ Network drive mapping
- ✅ Network printer mapping
- ✅ Windows 11 24H2 bloatware removal
- ✅ Display language in English with regional settings

**Components:**

| Script | Purpose | Example |
|--------|---------|---------|
| `Set-Win11Localization.ps1` | Configure regional settings | India: English display + INR currency |
| `Rename-Computer.ps1` | Automated computer naming | -Prefix "IND-WKS" → IND-WKS-12345678 |
| `Map-NetworkDrives.ps1` | Network drive mapping | H: = \\server\home |
| `Map-Printers.ps1` | Network printer mapping | Location-based assignment |
| `Remove-Win11Bloatware.ps1` | Remove bloatware | Conservative/Standard/Aggressive |

**Localization Countries Supported:**
- 🌍 Europe: DE, GB, FR, NL, BE, CH, AT, IT, ES, SE, NO, DK, FI, PL, CZ, IE, PT
- 🌏 Asia-Pacific: IN, JP, SG, CN, AU, NZ
- 🌎 Americas: US, CA, BR, MX

**Computer Naming:**
- Simple pattern: `Prefix + "-" + Serial Number`
- Example: `-Prefix "WKS"` → `WKS-1A2B3C4D5E`
- Example: `-Prefix "IND-LAPTOP"` → `IND-LAPTOP-1A2B3C4D`
- Optional suffix: `-Suffix "MUC"` → `WKS-1A2B3C4D-MUC`
- Automatic truncation to 15 characters (Windows limit)

**Bloatware Removal Levels:**
- **Conservative**: Gaming, social media, entertainment apps only
- **Standard**: Most consumer apps, keeps core Microsoft apps
- **Aggressive**: All non-essential apps (test carefully!)

---

### Autopilot Monitoring (Real-Time Visibility)

**Purpose:** Real-time monitoring of Autopilot deployments - 5-30 seconds vs 5-15 minutes in Intune Portal

**Features:**
- ✅ Real-time ESP phase tracking
- ✅ Device Preparation script status
- ✅ Win32 app installation progress
- ✅ Multi-device dashboard
- ✅ Error detection and highlighting
- ✅ JSON/HTML export
- ✅ Works during OOBE (SHIFT+F10)

**Components:**

| Tool | Purpose | Location |
|------|---------|----------|
| `Watch-AutopilotDeployment.ps1` | Real-time local monitoring | On deploying device |
| `Monitor-AutopilotDevices.ps1` | Remote multi-device monitoring | Admin workstation |
| `Get-AutopilotStatus.ps1` | Quick status snapshot | On device |

**Use Cases:**
1. **Troubleshooting:** See exactly what's stuck during deployment
2. **Batch Monitoring:** Monitor 50+ devices from one screen
3. **End-User Support:** Generate professional HTML reports
4. **Compliance Verification:** Confirm CIS hardening applied

**Documentation:**
- [README.md](Autopilot-Monitoring/README.md) - Complete monitoring guide

---

### Cloud Management Portal Dependencies

**Purpose:** Install dependencies for the Cloud Management Portal web application

```powershell
.\Install-Dependencies.ps1
```

## 💼 Enterprise Features

### Performance Optimization

**Small Environment (<100 devices):**
- Use standard scripts
- Deploy as Win32 App
- CIS Level 1

**Medium Environment (100-500 devices):**
- Azure Blob Storage for prerequisites
- Device Prep for CIS hardening
- CIS Level 1 baseline

**Large Environment (500+ devices):**
- Azure Blob Storage + CDN
- Automated software updates
- Hybrid deployment approach
- CIS Level 1 + selective Level 2

### Security Baseline

**CIS Windows 11 Benchmark Coverage:**

| Category | Settings | Examples |
|----------|----------|----------|
| Password Policy | 5+ | History, complexity, length |
| Account Lockout | 3 | Threshold, duration, reset |
| Security Options | 30+ | UAC, SMB signing, NTLM |
| Windows Firewall | 12 | All profiles, logging |
| Microsoft Defender | 10+ | Real-time, cloud, ASR |
| Admin Templates | 25+ | SMB, RDP, Autoplay |
| BitLocker | 5 | Encryption (Level 2) |
| Audit Policies | 17 | Advanced audit config |

**Total: 100+ security settings**

### Deployment Methods

**Three complementary approaches:**

1. **Device Preparation Script**
   - Very early execution (before apps)
   - Prerequisites guaranteed available
   - Ideal for CIS hardening

2. **Win32 App (IntuneWin)**
   - Better monitoring and management
   - Detection rules prevent re-installation
   - Retry mechanism on failures

3. **Intune Configuration Profiles**
   - Ongoing compliance monitoring
   - Built-in reporting and remediation
   - Conditional Access integration

**Recommended:** Use all three (hybrid approach)

## 📊 Monitoring Dashboard Example

```
═══════════════════════════════════════════════════════════════════
    AUTOPILOT V2 DEPLOYMENT MONITOR - REAL-TIME
═══════════════════════════════════════════════════════════════════

Device: LAPTOP001
Started: 2025-10-25 09:00:00
Elapsed: 0h 15m 30s

╔═══ ENROLLMENT STATUS PAGE (ESP) ═══
║ Current Phase: Device Setup
║ Progress: [████████████████████░░░░░░░░░░░░░░░░░░░░] 60%
╚═══════════════════════════════════════════════════════

╔═══ DEVICE PREPARATION SCRIPTS ═══
║ ✓ Install-Prerequisites-DevicePrep.ps1 [09:05:23]
║ ✓ Apply-CISHardening-Win11.ps1 [09:10:45]
╚═══════════════════════════════════════════════════════

╔═══ WIN32 APPLICATIONS ═══
║ ✓ Microsoft Office 365 [09:12:10]
║ ⟳ Company VPN Client [09:14:25]
╚═══════════════════════════════════════════════════════
```

## 🛠️ Prerequisites

**General:**
- PowerShell 5.1+ (PowerShell 7+ for Portal dependencies)
- Windows 10 1607+ (target devices)
- Windows 11 23H2+ (for CIS hardening)

**For Remote Monitoring:**
- Microsoft.Graph PowerShell module
- Graph API permissions: `DeviceManagementManagedDevices.Read.All`

**For Intune Deployment:**
- Microsoft Intune license
- Access to Intune Admin Center
- IntuneWin Content Prep Tool (auto-downloaded)

## 🎯 Common Workflows

### Scenario 1: New Autopilot Deployment Setup

```powershell
# 1. Create prerequisites package
cd Autopilot-Prerequisites
.\Package-Tools\Create-IntuneWinPackage.ps1 -DownloadContentPrepTool

# 2. Upload to Intune as Win32 App or use as Device Prep Script
# 3. Apply CIS hardening via Device Preparation
.\Security-Hardening\Apply-CISHardening-Win11.ps1 -Level 1

# 4. Monitor deployment
cd ../Autopilot-Monitoring
.\Watch-AutopilotDeployment.ps1 -ExportReport
```

### Scenario 2: Troubleshoot Stuck Deployment

```powershell
# During OOBE: SHIFT+F10 → PowerShell
cd D:\AutopilotTools  # USB stick

# Start real-time monitoring
.\Watch-AutopilotDeployment.ps1 -ShowLogs

# See exactly which script/app is stuck
# Export report for troubleshooting
```

### Scenario 3: Batch Deployment Monitoring

```powershell
# From admin workstation
cd Autopilot-Monitoring

# Monitor specific batch
.\Monitor-AutopilotDevices.ps1 -GroupTag "Batch-2025-Q1" -ExportReport

# Leave running, check all devices on one screen
```

### Scenario 4: Compliance Verification

```powershell
# After deployment
cd Autopilot-Monitoring
.\Get-AutopilotStatus.ps1 -Detailed

# Verify:
# ✓ .NET Framework 4.8+ installed
# ✓ Windows Firewall enabled (all profiles)
# ✓ Windows Defender Real-Time Protection enabled
```

### Scenario 5: Complete Device Setup for India Office

```powershell
# Configure device for Indian office with English display
cd Autopilot-Prerequisites/Installation-Scripts

# 1. Set localization (English display, Indian regional settings)
.\Set-Win11Localization.ps1 -CountryCode "IN"

# 2. Rename computer (Prefix + Serial Number)
.\Rename-Computer.ps1 -Prefix "IND-WKS"
# Result: IND-WKS-1A2B3C4D5E

# 3. Remove bloatware
.\Remove-Win11Bloatware.ps1 -RemovalLevel Standard -DisableConsumerFeatures

# 4. Map network resources (after domain join)
.\Map-NetworkDrives.ps1 -DriveLetter "H" -UNCPath "\\fileserver\home\%username%"
.\Map-Printers.ps1 -PrinterPath "\\printserver\HP-Office-Floor2" -SetAsDefault

# Result: Clean, configured device with Indian regional settings and English interface
```

### Scenario 6: International Deployment (Multiple Countries)

```powershell
# Create JSON configs for different countries
cd Autopilot-Prerequisites/Installation-Scripts

# Germany: .\Set-Win11Localization.ps1 -CountryCode "DE"
# UK:      .\Set-Win11Localization.ps1 -CountryCode "GB"
# USA:     .\Set-Win11Localization.ps1 -CountryCode "US"
# India:   .\Set-Win11Localization.ps1 -CountryCode "IN"

# Deploy via Intune with dynamic country assignment based on:
# - Azure AD Site
# - Group Tags
# - Location attributes
```

## 📚 Documentation

| Topic | Document | Location |
|-------|----------|----------|
| **Prerequisites Installation** | README.md | [Autopilot-Prerequisites/](Autopilot-Prerequisites/) |
| **CIS Hardening Guide** | CIS_HARDENING_GUIDE.md | [Documentation/](Autopilot-Prerequisites/Documentation/) |
| **Deployment Strategies** | AUTOPILOT_V2_DEPLOYMENT.md | [Documentation/](Autopilot-Prerequisites/Documentation/) |
| **Azure Blob Storage** | AZURE_BLOB_SETUP.md | [Documentation/](Autopilot-Prerequisites/Documentation/) |
| **Monitoring Tools** | README.md | [Autopilot-Monitoring/](Autopilot-Monitoring/) |

## 🔒 Security

All scripts implement security best practices:

- ✅ **SMBv1 disabled** (CIS 18.3.2, 18.3.3)
- ✅ **NTLMv2 only** (CIS 2.3.11.5)
- ✅ **SMB signing required** (CIS 2.3.8.2, 2.3.9.2)
- ✅ **UAC enabled** (CIS 2.3.17.x)
- ✅ **Firewall enabled** (CIS 9.x)
- ✅ **Defender real-time protection** (CIS 18.9.39.8.2)
- ✅ **RDP encryption enforced** (CIS 18.9.65.3.9.1)
- ✅ **Advanced audit policies** (CIS 17.x)

## 🚀 Performance

| Feature | Intune Portal | Our Tools |
|---------|--------------|-----------|
| **Update Speed** | 5-15 minutes | 5-30 seconds |
| **Real-Time** | ❌ No | ✅ Yes |
| **Multi-Device** | Manual refresh | Auto-refresh |
| **Script Visibility** | Limited | Detailed |
| **Error Details** | Basic | Complete |
| **Export** | Limited | JSON/HTML |
| **Offline** | ❌ No | ✅ Yes (local) |

## 🤝 Contributing

1. Follow PowerShell best practices
2. Use English for all comments and documentation
3. Test scripts in lab environment before production
4. Update documentation with changes
5. Add examples for new features

## 📄 License

See [LICENSE](../LICENSE) file for details.

## 📞 Support

- **Issues:** [GitHub Issues](../../issues)
- **Documentation:** See README files in each folder
- **Community:** [Microsoft Tech Community](https://techcommunity.microsoft.com)

---

**Note:** Always test in a pilot environment before production deployment. Review and adjust settings according to your organization's requirements.

## Changelog

### Version 3.0 (2025-10-26)
- ✨ Added Windows 11 localization script (26+ countries)
- ✨ Added computer rename script for Autopilot v2
- ✨ Added network drive mapping automation
- ✨ Added network printer mapping automation
- ✨ Added Windows 11 24H2 bloatware removal (Conservative/Standard/Aggressive)
- ✨ Fixed $StartTime initialization in CIS hardening script
- 🌍 International deployment support (multi-country)
- 🧹 Clean enterprise deployments without consumer apps
- 📋 Complete device configuration automation

### Version 2.0 (2025-10-25)
- ✨ Repository reorganization with clear structure
- ✨ All scripts converted to English
- ✨ Added CIS Windows 11 Benchmark hardening (100+ settings)
- ✨ Added real-time Autopilot monitoring tools
- ✨ Added Azure Blob Storage support
- ✨ Comprehensive documentation
- 🔒 Security enhancements
- 🚀 Performance optimizations

### Version 1.0 (2025-10-25)
- Initial release
- Prerequisites installation
- German documentation
