# PowerShell Automation & Management Tools

Professional PowerShell scripts and tools for Microsoft 365, Intune, Azure Virtual Desktop, and Windows Autopilot deployments.

## 📦 Repository Contents

This repository contains **two independent tools**:

---

### 🚀 Tool 1: Windows Autopilot v2 Scripts
**Status:** ✅ **Production-Ready**
**Location:** `scripts/`
**Deployment:** Direct PowerShell execution (no Docker required)

Professional PowerShell scripts for Windows Autopilot v2 deployment, device management, and security hardening.

**Features:**
- ✅ Windows Autopilot v2 deployment automation
- ✅ CIS Windows 11 Benchmark hardening (100+ settings)
- ✅ Real-time Autopilot monitoring tools (10-30x faster than Intune Portal)
- ✅ Enterprise printer management with intelligent driver strategies
- ✅ Windows 11 localization (26+ countries, English display)
- ✅ Device configuration automation (rename, drives, printers)
- ✅ Windows 11 24H2 bloatware removal (3 levels)
- ✅ .NET Framework & Visual C++ installation
- ✅ IntuneWin package creation tools

**Quick Start:**
```powershell
cd PowerShell_Repo/scripts/Autopilot-Prerequisites
.\Security-Hardening\Apply-CISHardening-Win11.ps1 -Level 1
.\Installation-Scripts\Set-Win11Localization.ps1 -CountryCode "IN"
```

**📚 [Complete Scripts Documentation →](scripts/README.md)**

---

### 🌐 Tool 2: Cloud Management Portal
**Status:** 🚧 **In Development**
**Location:** `src/`, `Dockerfile`, `docker-compose.yml`
**Deployment:** Docker-based (isolated container)

Docker-based web portal for Microsoft 365, Intune, and Azure Virtual Desktop management.

**Planned Features:**
- 🖥️ Azure Virtual Desktop management (Sessions, Drain Mode, Images)
- 📱 Intune device and app management
- 👥 User and group administration
- 📊 Dashboards and analytics
- ⚡ Performance optimized with caching

**Status:** Core PowerShell modules currently being implemented.

**📚 [Portal Setup Guide →](#cloud-management-portal-docker)**

---

## 🎯 Quick Start - Autopilot Scripts (Production-Ready)

```powershell
# 1. Clone repository
git clone https://github.com/cramboeck/PowerShell_Repo.git
cd PowerShell_Repo/scripts/Autopilot-Prerequisites

# 2. Apply CIS Windows 11 security hardening
.\Security-Hardening\Apply-CISHardening-Win11.ps1 -Level 1

# 3. Configure localization (English display with regional settings)
.\Installation-Scripts\Set-Win11Localization.ps1 -CountryCode "IN"

# 4. Rename computer with prefix + serial number
.\Installation-Scripts\Rename-Computer.ps1 -Prefix "IND-WKS"

# 5. Install enterprise printer portal
.\Installation-Scripts\Install-PrintersPortal.ps1 -ConfigPath ".\PrinterConfig.json"

# 6. Monitor Autopilot deployment (real-time)
cd ../Autopilot-Monitoring
.\Watch-AutopilotDeployment.ps1
```

**📚 Complete documentation:** [scripts/README.md](scripts/README.md) | [REPOSITORY_STRUCTURE.md](REPOSITORY_STRUCTURE.md)

---

## 📁 Repository Structure

**📖 For complete documentation:** [REPOSITORY_STRUCTURE.md](REPOSITORY_STRUCTURE.md)

```
PowerShell_Repo/
│
├─── 🚀 TOOL 1: AUTOPILOT V2 SCRIPTS (Production-Ready)
│    └── scripts/
│        ├── Autopilot-Prerequisites/           # Deployment & configuration
│        │   ├── Installation-Scripts/          # 11 production scripts
│        │   ├── Security-Hardening/            # CIS Windows 11 (100+ settings)
│        │   ├── Package-Tools/                 # IntuneWin creation
│        │   └── Documentation/                 # Guides & best practices
│        ├── Autopilot-Monitoring/              # 3 monitoring tools
│        └── README.md                          # Complete scripts guide
│
├─── 🌐 TOOL 2: CLOUD MANAGEMENT PORTAL (In Development)
│    ├── src/                                   # Portal source code
│    │   ├── API/Server.ps1                    # Pode REST API server
│    │   ├── Modules/                          # PowerShell modules (in dev)
│    │   └── Public/                           # Web UI (planned)
│    ├── config/appsettings.json                # Azure AD configuration
│    ├── Dockerfile                             # Container image
│    ├── docker-compose.yml                     # Docker orchestration
│    ├── Setup-CloudPortal.ps1                  # Automated Azure setup
│    ├── DOCKER_SETUP.md                        # Docker guide
│    └── docs/                                  # Portal documentation
│
└─── 📚 DOCUMENTATION
     ├── README.md                              # This file
     ├── REPOSITORY_STRUCTURE.md                # Detailed structure
     └── CONTRIBUTING.md                        # Contribution guide
```

**Key Points:**
- **Autopilot Scripts**: Direct PowerShell, no Docker needed
- **Cloud Portal**: Docker-based, separate from Autopilot
- Each tool is completely independent

---

## 🔧 PowerShell Automation Scripts - Use Cases

### Scenario 1: Autopilot v2 Deployment (International Company)

```powershell
# India office - English display with Indian regional settings
.\Set-Win11Localization.ps1 -CountryCode "IN"
.\Rename-Computer.ps1 -Prefix "IND-WKS"
# Result: IND-WKS-1A2B3C4D5E
.\Remove-Win11Bloatware.ps1 -RemovalLevel Standard

# Germany office - English display with German regional settings
.\Set-Win11Localization.ps1 -CountryCode "DE"
.\Rename-Computer.ps1 -Prefix "DE-WKS"
# Result: DE-WKS-1A2B3C4D5E

# UK office - English display with UK regional settings
.\Set-Win11Localization.ps1 -CountryCode "GB"
.\Rename-Computer.ps1 -Prefix "UK-WKS"
# Result: UK-WKS-1A2B3C4D5E
```

### Scenario 2: Security Hardening

```powershell
# Apply CIS Windows 11 Benchmark Level 1
.\Apply-CISHardening-Win11.ps1 -Level 1

# Apply Level 2 (stricter) for high-security environments
.\Apply-CISHardening-Win11.ps1 -Level 2 -SkipCategories @("BitLocker")
```

### Scenario 3: Real-Time Deployment Monitoring

```powershell
# Monitor deployment locally (on device during Autopilot)
.\Watch-AutopilotDeployment.ps1

# Monitor multiple devices remotely (from admin workstation)
.\Monitor-AutopilotDevices.ps1 -GroupTag "Q1-2025-Rollout"
```

### Scenario 4: Clean Enterprise Deployment

```powershell
# Remove bloatware, map resources, configure settings
.\Remove-Win11Bloatware.ps1 -RemovalLevel Standard -DisableConsumerFeatures
.\Map-NetworkDrives.ps1 -DriveLetter "H" -UNCPath "\\fileserver\home\%username%"
.\Map-Printers.ps1 -PrinterPath "\\printserver\HP-Floor2" -SetAsDefault
```

**📚 More examples:** [scripts/README.md](scripts/README.md)

---

## 🌐 Cloud Management Portal (Docker)

**⚠️ STATUS: In Development - Core modules being implemented**

This is a Docker-based web portal separate from the Autopilot scripts.

### Prerequisites

- Docker Desktop or Docker Engine
- Docker Compose v2.0+
- Azure AD App Registration (can be automated with `Setup-CloudPortal.ps1`)

### Quick Start

```bash
# 1. Clone repository
git clone https://github.com/cramboeck/PowerShell_Repo.git
cd PowerShell_Repo

# 2. Create configuration
cp config/appsettings.example.json config/appsettings.json
# Edit with your Azure AD credentials

# 3. Start Docker container
docker-compose up -d

# 4. Access portal
# http://localhost:8081 (Port 8081 to avoid conflicts)
```

### Azure AD App Setup (Automated)

```powershell
# Run automated Azure AD app registration
pwsh -File Setup-CloudPortal.ps1

# This creates:
# - Azure AD App Registration
# - Microsoft Graph API permissions
# - Client secret
# - appsettings.json configuration
```

**📚 Complete Docker guide:** [DOCKER_SETUP.md](DOCKER_SETUP.md)

### Planned Portal Features (In Development)

#### Office 365 / Intune Management
- User and group administration
- Device management and compliance
- Policy and configuration profiles
- App deployment and management
- Reports and analytics

#### Azure Virtual Desktop Management
- Session management (view, disconnect, logoff)
- Drain mode for maintenance
- Host pool management (start/stop/restart)
- Automated image captures
- Dynamic host scaling

#### Security Features
- OAuth 2.0 authentication with Azure AD
- HTTPS/TLS encryption
- Role-Based Access Control (RBAC)
- Comprehensive audit logging
- Token-based authentication (no password storage)

**Current Status:** API endpoints defined, PowerShell modules being implemented.

---

## 📊 Performance Comparison - Autopilot Monitoring

| Feature | Intune Portal | Our Monitoring Tools |
|---------|--------------|---------------------|
| **Update Speed** | 5-15 minutes | 5-30 seconds |
| **Real-Time** | ❌ No | ✅ Yes |
| **Multi-Device** | Manual refresh | Auto-refresh |
| **Script Visibility** | Limited | Detailed |
| **Error Details** | Basic | Complete |
| **Export** | Limited | JSON/HTML |
| **Offline** | ❌ No | ✅ Yes (local) |

---

## 🔒 Security Features

### PowerShell Scripts (CIS Hardening)

All scripts implement security best practices:

- ✅ **SMBv1 disabled** (CIS 18.3.2, 18.3.3)
- ✅ **NTLMv2 only** (CIS 2.3.11.5)
- ✅ **SMB signing required** (CIS 2.3.8.2, 2.3.9.2)
- ✅ **UAC enabled** (CIS 2.3.17.x)
- ✅ **Firewall enabled** (CIS 9.x)
- ✅ **Defender real-time protection** (CIS 18.9.39.8.2)
- ✅ **RDP encryption enforced** (CIS 18.9.65.3.9.1)
- ✅ **Advanced audit policies** (CIS 17.x)

### Portal

- OAuth 2.0 with Azure AD
- Token-based authentication
- RBAC enforcement
- Comprehensive audit logging

---

## 📚 Documentation

### Repository Overview
| Topic | Document |
|-------|----------|
| **Complete Repository Structure** | [REPOSITORY_STRUCTURE.md](REPOSITORY_STRUCTURE.md) |

### PowerShell Scripts
| Topic | Document | Location |
|-------|----------|----------|
| **Main Scripts Guide** | README.md | [scripts/](scripts/) |
| **Prerequisites Installation** | README.md | [Autopilot-Prerequisites/](scripts/Autopilot-Prerequisites/) |
| **CIS Hardening** | CIS_HARDENING_GUIDE.md | [Documentation/](scripts/Autopilot-Prerequisites/Documentation/) |
| **Deployment Strategies** | AUTOPILOT_V2_DEPLOYMENT.md | [Documentation/](scripts/Autopilot-Prerequisites/Documentation/) |
| **Monitoring Tools** | README.md | [Autopilot-Monitoring/](scripts/Autopilot-Monitoring/) |
| **Printer Management Portal** | PRINTER_PORTAL_README.md | [Installation-Scripts/](scripts/Autopilot-Prerequisites/Installation-Scripts/) |

### Cloud Management Portal
| Topic | Document |
|-------|----------|
| **Automated Setup** | [Setup-CloudPortal.ps1](Setup-CloudPortal.ps1) |
| **Installation** | [docs/INSTALLATION.md](docs/INSTALLATION.md) |
| **Configuration** | [docs/CONFIGURATION.md](docs/CONFIGURATION.md) |
| **API Reference** | [docs/API.md](docs/API.md) |

---

## 🤝 Contributing

We welcome contributions!

1. Follow PowerShell best practices
2. Use English for all comments and documentation
3. Test scripts in lab environment before production
4. Update documentation with changes
5. Add examples for new features

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

---

## 📞 Support

- **Issues**: [GitHub Issues](../../issues)
- **Discussions**: [GitHub Discussions](../../discussions)
- **Documentation**: See README files in each folder
- **Community**: [Microsoft Tech Community](https://techcommunity.microsoft.com)

---

## 🎓 Inspiration & Credits

**PowerShell Scripts inspired by:**
- Microsoft Intune community best practices
- CIS Benchmarks
- PowerShell community

**Portal inspired by:**
- [CIPP](https://github.com/KelvinTegelaar/CIPP) - CyberDrain Improved Partner Portal
- Windows Admin Center
- PatchMyPC

---

## 📈 Changelog

### Version 3.1 (2025-10-26) - Documentation & Portal Automation
- ✨ Added automated Cloud Portal setup script (Setup-CloudPortal.ps1)
- 📖 Added complete repository structure documentation (REPOSITORY_STRUCTURE.md)
- 🖨️ Added enterprise printer management portal with intelligent driver management
- 📚 Enhanced documentation with deployment scenarios and security best practices
- 🔧 Automated Azure AD app registration and Graph API permissions
- 🎯 Comprehensive finding guide for navigating the repository

### Version 3.0 (2025-10-26) - Device Management & Localization
- ✨ Added Windows 11 localization script (26+ countries)
- ✨ Added computer rename script for Autopilot v2
- ✨ Added network drive mapping automation
- ✨ Added network printer mapping automation
- ✨ Added Windows 11 24H2 bloatware removal
- ✨ Fixed $StartTime initialization in CIS hardening script
- 🌍 International deployment support (multi-country)
- 🧹 Clean enterprise deployments without consumer apps
- 📋 Complete device configuration automation

### Version 2.0 (2025-10-25) - Repository Reorganization
- ✨ Repository reorganization with clear structure
- ✨ All scripts converted to English
- ✨ Added CIS Windows 11 Benchmark hardening (100+ settings)
- ✨ Added real-time Autopilot monitoring tools
- ✨ Added Azure Blob Storage support
- ✨ Comprehensive documentation
- 🔒 Security enhancements
- 🚀 Performance optimizations

### Version 1.0 (2025-10-25) - Initial Release
- Initial release with Cloud Management Portal
- Basic PowerShell automation scripts
- German documentation

---

## ⚠️ Important Notes

- **Scripts**: Always test in pilot environment before production deployment
- **Portal**: Configure proper Azure AD app permissions and security
- **Security**: Review and adjust CIS hardening settings for your organization
- **Compliance**: Ensure scripts comply with your organizational policies

---

## 🚀 Project Status

| Component | Status | Deployment Method | Documentation |
|-----------|--------|------------------|---------------|
| **Autopilot v2 Scripts** | ✅ Production-Ready | Direct PowerShell | [scripts/README.md](scripts/README.md) |
| **Cloud Management Portal** | 🚧 In Development | Docker Container | [DOCKER_SETUP.md](DOCKER_SETUP.md) |

### What's Production-Ready?
All Autopilot v2 scripts are fully functional and tested:
- CIS Windows 11 Hardening
- Autopilot Monitoring Tools
- Enterprise Printer Portal
- Localization & Device Configuration
- Bloatware Removal

### What's In Development?
Cloud Management Portal core modules:
- Authentication module
- Microsoft Graph integration
- M365/Intune management functions
- AVD management functions

---

**Made with ❤️ for IT Administrators and DevOps Engineers**
