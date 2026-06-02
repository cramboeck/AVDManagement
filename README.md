# Cloud Management Portal (M365, Intune, AVD) & PowerShell Automation

This repository houses a comprehensive suite of enterprise-grade IT management solutions, divided into two independent, powerful tools: a modern Docker-based web portal and production-ready Windows Autopilot v2 deployment automation.

---

## 📦 Repository Contents

### 🌐 Tool 1: Cloud Management Portal (In Development / Scaffold Ready)
**Location:** `src/`, `Dockerfile`, `docker-compose.yml`  
**Deployment:** Docker-based (isolated container running on PowerShell Pode web framework)

A unified single-pane management dashboard for Microsoft 365, Intune, and Azure Virtual Desktop. 

* **Unified Dashboard**: Manage users, licenses, devices, and virtual desktops from one interface.
* **Kostenbewusste AVD-Auto-Skalierung**: Dynamic power management of session hosts. Automatically converts OS disks from **Premium SSD to Standard HDD** when VMs are powered off, saving up to 70% in storage costs.
* **Intune Device Actions**: Trigger sync, restart, or deploy WinGet-based applications directly to endpoints.
* **Multi-Tenant Ready**: Designed to utilize Entra ID Multi-Tenant App Registrations with secure Admin Consent.

### 🚀 Tool 2: Windows Autopilot v2 Scripts (Production-Ready)
**Location:** `scripts/`  
**Deployment:** Direct PowerShell execution (no Docker required)

Professional PowerShell scripts for Windows Autopilot v2 deployment, device management, and security hardening.

* **CIS Windows 11 Hardening**: Benchmark Level 1 & 2 security hardening (100+ settings).
* **Real-time Autopilot Monitoring**: Tools that monitor deployment status 10-30x faster than the Intune Portal.
* **Enterprise Printer Portal**: Intelligent driver management and deployment.
* **Localization & Bloatware Removal**: Country-specific localization and clean Windows 11 24H2 bloatware removal.

---

## 🤖 The AI-Agent-First Development Model

This repository is actively developed and maintained using a collaborative AI-agent workflow:

* **Claude Code (Primary Developer)**: Handles feature implementation, bug fixing, and test automation. Claude is integrated via GitHub Actions and can be triggered directly in Issues or PR comments (e.g., `@claude implement this feature`).
* **Manus AI (Architect & Reviewer)**: Manages high-level system architecture, initial configurations, and final code reviews.

For detailed developer guidelines, coding standards, and directory structures, please refer to [**CLAUDE.md**](CLAUDE.md).

---

## 🚀 Getting Started (Cloud Portal Local Development)

### Prerequisites
* PowerShell Core 7.4+
* Docker & Docker Compose

### 1. Configure the Application
Copy the example configuration file and fill in your Azure AD / Entra ID App Registration details:
```bash
cp config/appsettings.example.json config/appsettings.json
```

### 2. Start the Server
Run the local startup script:
```powershell
./Start-Portal.ps1
```
The portal will be available at `http://localhost:8080`.

### 3. Run via Docker Compose
To spin up the containerized environment:
```bash
docker compose up --build
```

---

## 🛠️ Technology Stack
* **Web Framework**: Pode (PowerShell Core Web Server)
* **Backend**: PowerShell Core 7.4
* **Frontend**: Vanilla ES6+ JavaScript, HTML5, CSS3
* **APIs**: Microsoft Graph API & Azure Resource Manager REST API

---

## 📄 License
MIT License - See [LICENSE](LICENSE) file for details.

---

**Made with ❤️ for modern IT Administrators and DevOps Engineers.**
