# Contributing to Cloud Management Portal

Vielen Dank für dein Interesse, zum Cloud Management Portal beizutragen!

## Projektstruktur

```
PowerShell_Repo/
├── src/
│   ├── API/
│   │   └── Server.ps1                 # Pode Web Server (Hauptanwendung)
│   ├── Modules/
│   │   ├── Authentication/
│   │   │   └── Authentication.psm1    # OAuth & Token Management
│   │   ├── M365Management/
│   │   │   ├── M365Management.psm1    # User, Group, License Management
│   │   │   └── IntuneManagement.psm1  # Intune Device Management
│   │   └── AVDManagement/
│   │       └── AVDManagement.psm1     # Azure Virtual Desktop Management
│   └── Public/
│       ├── index.html                  # Haupt-UI
│       ├── css/
│       │   └── styles.css              # Styling (Dark Theme)
│       └── js/
│           └── app.js                  # Frontend JavaScript
├── config/
│   └── appsettings.example.json        # Konfigurationsvorlage
├── docs/
│   ├── INSTALLATION.md                 # Installationsanleitung
│   ├── QUICKSTART.md                   # Quick Start Guide
│   └── FEATURES.md                     # Feature-Übersicht
├── scripts/
│   └── Install-Dependencies.ps1        # Dependency Installation
├── docker/
├── logs/                               # Log-Dateien (nicht in Git)
├── cache/                              # Cache-Dateien (nicht in Git)
├── Dockerfile                          # Docker Image Definition
├── docker-compose.yml                  # Docker Compose Config
├── Start-Portal.ps1                    # Lokaler Server-Start
└── README.md                           # Projekt-Übersicht

```

## Entwicklungsumgebung einrichten

### 1. Voraussetzungen

- PowerShell 7.4+
- Git
- VS Code oder bevorzugter Editor
- Docker (optional, für Container-Tests)

### 2. Repository forken & klonen

```bash
# Forke das Repository auf GitHub
# Dann klonen:
git clone https://github.com/dein-username/PowerShell_Repo.git
cd PowerShell_Repo
```

### 3. Dependencies installieren

```powershell
./scripts/Install-Dependencies.ps1
```

### 4. Konfiguration erstellen

```powershell
Copy-Item config/appsettings.example.json config/appsettings.json
# Bearbeite appsettings.json mit deinen Test-Credentials
```

### 5. Development Server starten

```powershell
./Start-Portal.ps1
```

## Code-Stil

### PowerShell

- Verwende Verb-Noun Konvention (`Get-User`, nicht `GetUser`)
- Kommentare auf Deutsch für Dokumentation
- Verwende `[CmdletBinding()]` für erweiterte Funktionen
- Parameter mit `[Parameter()]` Attribut dokumentieren
- Error Handling mit `try/catch`

```powershell
function Get-MyResource {
    <#
    .SYNOPSIS
    Kurze Beschreibung

    .PARAMETER Name
    Parameter-Beschreibung
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    try {
        # Implementation
    }
    catch {
        Write-Error "Fehler: $_"
        throw
    }
}
```

### JavaScript

- Verwende `async/await` für asynchrone Calls
- Aussagekräftige Funktionsnamen
- Error Handling in try/catch
- Kommentare für komplexe Logik

```javascript
async function loadData() {
    try {
        const response = await fetch('/api/endpoint');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Load error:', error);
        showToast('Error', 'Failed to load data', 'error');
    }
}
```

## Pull Request Prozess

1. **Branch erstellen**
   ```bash
   git checkout -b feature/mein-feature
   # oder
   git checkout -b fix/bug-beschreibung
   ```

2. **Änderungen durchführen**
   - Folge dem Code-Stil
   - Teste deine Änderungen
   - Aktualisiere Dokumentation wenn nötig

3. **Commit**
   ```bash
   git add .
   git commit -m "feat: Kurze Beschreibung der Änderung"
   ```

   Commit-Message Format:
   - `feat:` Neues Feature
   - `fix:` Bug Fix
   - `docs:` Dokumentation
   - `style:` Formatierung
   - `refactor:` Code-Refactoring
   - `test:` Tests hinzufügen
   - `chore:` Maintenance

4. **Push & Pull Request**
   ```bash
   git push origin feature/mein-feature
   ```
   Erstelle dann einen Pull Request auf GitHub

## Testing

### Manuelle Tests

Teste folgende Szenarien vor dem PR:

- [ ] Server startet ohne Fehler
- [ ] Dashboard lädt korrekt
- [ ] API Endpoints antworten
- [ ] UI ist responsive
- [ ] Error Handling funktioniert

### API Testing

```powershell
# Health Check
Invoke-RestMethod http://localhost:8080/api/health

# Users
Invoke-RestMethod http://localhost:8080/api/m365/users

# Devices
Invoke-RestMethod http://localhost:8080/api/intune/devices
```

## Neue Features hinzufügen

### Neuer API Endpoint

1. **PowerShell-Funktion schreiben** (in entsprechendem Modul)
   ```powershell
   # src/Modules/M365Management/M365Management.psm1
   function Get-MyNewFeature {
       # Implementation
   }
   Export-ModuleMember -Function 'Get-MyNewFeature'
   ```

2. **API Route hinzufügen** (Server.ps1)
   ```powershell
   # src/API/Server.ps1
   Add-PodeRoute -Method Get -Path '/api/m365/myfeature' -ScriptBlock {
       try {
           $result = Get-MyNewFeature
           Write-PodeJsonResponse -Value $result
       }
       catch {
           Write-PodeJsonResponse -Value @{ error = $_.Exception.Message } -StatusCode 500
       }
   }
   ```

3. **Frontend-Integration** (app.js)
   ```javascript
   async function loadMyFeature() {
       try {
           const response = await fetch('/api/m365/myfeature');
           const data = await response.json();
           // Update UI
       } catch (error) {
           showToast('Error', 'Failed to load feature', 'error');
       }
   }
   ```

4. **UI hinzufügen** (index.html)
   ```html
   <div id="myfeature-page" class="page">
       <!-- UI Content -->
   </div>
   ```

### Neue UI-Seite hinzufügen

1. HTML in `index.html`
2. Navigation in Sidebar erweitern
3. Page-Loading in `app.js` implementieren
4. Styling in `styles.css` hinzufügen

## Dokumentation aktualisieren

Wenn du Features hinzufügst/änderst, aktualisiere:

- `README.md` - Hauptübersicht
- `docs/FEATURES.md` - Feature-Liste
- `docs/INSTALLATION.md` - Wenn Installation betroffen
- Code-Kommentare

## Bug Reports

Bug Reports sollten enthalten:

- Beschreibung des Problems
- Schritte zur Reproduktion
- Erwartetes Verhalten
- Aktuelles Verhalten
- Screenshots (wenn relevant)
- Log-Dateien (aus `logs/`)
- Systeminfo (OS, PowerShell Version)

## Feature Requests

Feature Requests sollten enthalten:

- Beschreibung des Features
- Use Case / Problem das gelöst wird
- Vorgeschlagene Lösung
- Alternativen (wenn vorhanden)

## Fragen?

- Erstelle ein Issue auf GitHub
- Diskussionen sind willkommen!

## Lizenz

Durch deine Beiträge stimmst du zu, dass deine Arbeit unter der gleichen Lizenz wie das Projekt veröffentlicht wird.
