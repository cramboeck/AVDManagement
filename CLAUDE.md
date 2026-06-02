# CLAUDE.md - Developer Guidelines for Cloud Management Portal

This file serves as the core instruction set and architectural blueprint for **Claude Code** (acting as the primary AI agent developer) and **Manus AI** (acting as the system architect and reviewer). All code modifications, features, and refactorings must strictly adhere to the guidelines laid out in this document.

---

## 1. System Role & Development Model

* **Claude Code (AI Agent Developer)**: You are the primary developer. Your role is to implement features, fix bugs, write tests, and optimize performance. You operate autonomously based on GitHub Issues or Pull Request comments where you are tagged with `@claude`.
* **Manus AI (Architect & Reviewer)**: Manus designs the system architecture, manages high-level configurations, conducts final code reviews, and coordinates the release cycle.
* **Development Philosophy**:
  * Prioritize security and least privilege access models (Azure Multi-Tenant OAuth 2.0 and Graph API Delegated permissions).
  * Write clean, idiomatic PowerShell Core 7.4 code for backend modules.
  * Write modern, responsive, and vanilla ES6+ JavaScript for the frontend.
  * Always use existing, robust frameworks (Pode for web server) rather than reinventing wheels.

---

## 2. Technology Stack & Frameworks

The platform is built on a highly performant and lightweight PowerShell-native web stack:

* **Web Server Framework**: [Pode (v2.10.0+)](https://badgerati.github.io/Pode/) - a cross-platform, multi-threaded web server for PowerShell Core.
* **Backend Runtime**: PowerShell Core 7.4+ (running on Ubuntu-based Docker containers).
* **Frontend**: Vanilla ES6+ JavaScript, HTML5, CSS3 (TailwindCSS-like custom styling, highly optimized for performance and mobile responsiveness).
* **Database / State**: File-based caching for performance, transitioning to a relational DB (PostgreSQL/SQLite) or Azure Table Storage for persistent configuration if required.
* **APIs**:
  * **Microsoft Graph API** (M365, Entra ID, Intune)
  * **Azure Resource Manager (ARM) REST API** (AVD, VM Operations)

---

## 3. Directory Structure

You must respect and maintain the following project layout:

```
AVDManagement/
├── .github/
│   └── workflows/          # GitHub Actions (including Claude Code integration)
├── config/
│   ├── appsettings.json    # Local configuration (Git-ignored)
│   └── appsettings.example.json
├── docs/                   # System and API documentation
├── scripts/                # Utility and deployment scripts
├── src/
│   ├── API/
│   │   └── Server.ps1      # Pode Web Server (Routes, Endpoints, Initialization)
│   ├── Modules/            # Custom PowerShell Modules
│   │   ├── Authentication/ # Token acquisition and management
│   │   ├── AVDManagement/  # AVD & VM operations (including SSD ➔ HDD scaling)
│   │   └── M365Management/ # Users, groups, and Intune devices
│   └── Public/             # Static Frontend Assets
│       ├── css/
│       ├── js/
│       │   └── app.js      # Main Frontend Logic
│       └── index.html      # Single Page Application (SPA)
├── Dockerfile              # Production container build
└── docker-compose.yml      # Multi-container orchestration
```

---

## 4. Coding Standards & Guidelines

### 4.1 PowerShell Core (Backend)
* **Strict Mode**: Always enable strict mode at the top of scripts/modules: `Set-StrictMode -Version Latest`.
* **Error Handling**: Use `try/catch` blocks for all API calls and critical system operations. Avoid silent failures.
* **API Invocations**: Use `Invoke-RestMethod` or custom wrapper functions. Always include proper headers (Authorization, Content-Type, Accept).
* **Module Structure**: Keep functions modular. One function, one responsibility. Export functions explicitly using `Export-ModuleMember`.
* **Naming Conventions**: Use standard PowerShell `Verb-Noun` syntax (e.g., `Get-AVDHostPool`, `Restart-AVDSessionHost`).

### 4.2 Frontend (Vanilla JavaScript & UI)
* **No Bulky Frameworks**: Do not introduce React, Vue, or Angular unless explicitly instructed. Stick to highly optimized Vanilla ES6+ JavaScript.
* **State Management**: Manage application state globally in a clean, centralized object (e.g., `window.AppState`).
* **Asynchronous Operations**: Use `async/await` for all API calls. Always show visual loading indicators (spinners/skeletons) during network requests.
* **Error Reporting**: Implement a global toast notification system to inform users of success, warning, or error states.
* **Responsive Design**: Ensure the layout is fully responsive, looking exceptional on both ultra-wide monitors and mobile screens.

### 4.3 Security & API Consent
* **Multi-Tenancy**: The application must be prepared to support Multi-Tenant App Registrations.
* **Secrets**: Never hardcode credentials, client secrets, or subscription IDs. Read them from `config/appsettings.json` or environment variables (`$env:AZURE_CLIENT_SECRET`).
* **Tokens**: Short-lived access tokens must be stored in memory (or Pode state) and refreshed automatically. Never persist raw access tokens to disk.

---

## 5. Development & Verification Commands

To verify your changes and ensure code quality, use the following commands:

* **Start Portal (Local Dev)**: `./Start-Portal.ps1`
* **Run in Docker**: `docker compose up --build`
* **PowerShell Linting**: `Invoke-ScriptAnalyzer -Path ./src/` (Ensure PSScriptAnalyzer is installed)
* **Test API Endpoints**: Run local integration tests via PowerShell:
  ```powershell
  Invoke-RestMethod -Uri "http://localhost:8080/api/health" -Method Get
  ```

---

## 6. How to Implement Features (Workflow for Claude)

When you are assigned an issue or tagged to implement a feature:
1. **Analyze the Scope**: Identify which backend module (Authentication, AVD, M365) and frontend view need modifications.
2. **Draft the Backend Route**: Add corresponding REST endpoints in `src/API/Server.ps1` and implement the business logic in the appropriate module under `src/Modules/`.
3. **Update the Frontend**: Modify `src/Public/index.html` to add necessary UI elements and `src/Public/js/app.js` to handle user interaction and fetch the new API endpoints.
4. **Local Verification**: Test the full flow. Ensure error handling is robust (e.g., handling expired tokens or missing permissions gracefully).
5. **Commit & PR**: Commit your changes with clear, descriptive commit messages (e.g., `feat(avd): Add session host drain-mode toggle endpoint`).

Always keep this `CLAUDE.md` up-to-date if you introduce new architectural patterns or global dependencies.
