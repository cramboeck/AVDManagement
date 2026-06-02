# Cloud Management Portal - Installation Guide

## Inhaltsverzeichnis

- [Systemvoraussetzungen](#systemvoraussetzungen)
- [Azure AD App Registration](#azure-ad-app-registration)
- [Installation mit Docker (Empfohlen)](#installation-mit-docker-empfohlen)
- [Lokale Installation](#lokale-installation)
- [Konfiguration](#konfiguration)
- [Erste Schritte](#erste-schritte)
- [Troubleshooting](#troubleshooting)

## Systemvoraussetzungen

### Für Docker Installation
- Docker Engine 20.10 oder höher
- Docker Compose 2.0 oder höher
- 2 GB RAM (mindestens)
- 1 GB freier Festplattenspeicher

### Für Lokale Installation
- PowerShell 7.4 oder höher
- Windows 10/11, Linux, oder macOS
- 2 GB RAM (mindestens)
- Internetzugang für API-Aufrufe

## Azure AD App Registration

Bevor du das Portal verwenden kannst, musst du eine App-Registrierung in Azure AD erstellen:

### 1. App Registration erstellen

1. Melde dich im [Azure Portal](https://portal.azure.com) an
2. Navigiere zu **Azure Active Directory** > **App registrations**
3. Klicke auf **New registration**
4. Konfiguriere die App:
   - **Name**: `Cloud Management Portal`
   - **Supported account types**: Accounts in this organizational directory only
   - **Redirect URI**: Web - `http://localhost:8080/auth/callback`
5. Klicke auf **Register**

### 2. Client Secret erstellen

1. In deiner neuen App, gehe zu **Certificates & secrets**
2. Klicke auf **New client secret**
3. Beschreibung: `Portal Secret`
4. Ablaufdatum: Wähle entsprechend deiner Sicherheitsrichtlinien
5. Klicke auf **Add**
6. **WICHTIG**: Kopiere den Secret-Wert sofort! Er wird nur einmal angezeigt.

### 3. API Permissions konfigurieren

1. Gehe zu **API permissions**
2. Klicke auf **Add a permission**
3. Wähle **Microsoft Graph** > **Application permissions**
4. Füge folgende Permissions hinzu:

   **Für Microsoft 365 / Intune:**
   - `User.Read.All` - Benutzer lesen
   - `Group.Read.All` - Gruppen lesen
   - `Directory.Read.All` - Verzeichnis lesen
   - `DeviceManagementManagedDevices.ReadWrite.All` - Intune Geräte verwalten
   - `DeviceManagementConfiguration.ReadWrite.All` - Intune Konfiguration
   - `DeviceManagementApps.ReadWrite.All` - Intune Apps
   - `Organization.Read.All` - Lizenzinformationen

   **Für Azure Virtual Desktop:**
   - Diese benötigen Azure Resource Manager Permissions (siehe unten)

5. Klicke auf **Grant admin consent** für deine Organisation

### 4. Azure RBAC für AVD

Für Azure Virtual Desktop benötigt die App zusätzliche RBAC-Rollen:

```bash
# Mit Azure CLI
az login

# Rolle zuweisen (auf Subscription oder Resource Group Level)
az role assignment create \
  --assignee <App-Client-ID> \
  --role "Desktop Virtualization Power On Off Contributor" \
  --scope "/subscriptions/<Subscription-ID>"

# Optional: Weitere Rollen für erweiterte Funktionen
az role assignment create \
  --assignee <App-Client-ID> \
  --role "Virtual Machine Contributor" \
  --scope "/subscriptions/<Subscription-ID>"
```

### 5. Informationen notieren

Notiere folgende Werte für die Konfiguration:
- **Tenant ID**: Übersicht-Seite der App
- **Client ID**: Übersicht-Seite der App
- **Client Secret**: Der zuvor kopierte Secret-Wert
- **Subscription ID**: Für AVD (zu finden unter Subscriptions)
- **Resource Group**: Wo deine AVD Resources sind

## Installation mit Docker (Empfohlen)

### 1. Repository klonen

```bash
git clone <repository-url>
cd PowerShell_Repo
```

### 2. Konfiguration erstellen

```bash
# Konfigurationsdatei erstellen
cp config/appsettings.example.json config/appsettings.json

# Mit deinem bevorzugten Editor bearbeiten
nano config/appsettings.json  # oder vim, code, etc.
```

Fülle die Werte aus der App Registration ein:

```json
{
  "Azure": {
    "TenantId": "deine-tenant-id",
    "ClientId": "deine-client-id",
    "ClientSecret": "dein-client-secret",
    "RedirectUri": "http://localhost:8080/auth/callback"
  },
  "AVD": {
    "SubscriptionId": "deine-subscription-id",
    "ResourceGroup": "deine-avd-resource-group",
    "DefaultHostPool": "dein-hostpool-name"
  }
}
```

### 3. Docker Container starten

```bash
# Container bauen und starten
docker-compose up -d

# Logs anzeigen
docker-compose logs -f

# Status prüfen
docker-compose ps
```

### 4. Portal öffnen

Öffne deinen Browser und navigiere zu:
```
http://localhost:8080
```

### Docker Management

```bash
# Container stoppen
docker-compose stop

# Container starten
docker-compose start

# Container neu starten
docker-compose restart

# Container und Volumes löschen
docker-compose down -v

# Logs anzeigen
docker-compose logs -f cloud-portal

# In Container Shell einloggen (Debugging)
docker exec -it cloud-management-portal pwsh
```

## Lokale Installation

### 1. PowerShell 7 installieren

Wenn nicht bereits installiert:

**Windows:**
```powershell
winget install Microsoft.PowerShell
```

**Linux (Ubuntu/Debian):**
```bash
wget https://github.com/PowerShell/PowerShell/releases/download/v7.4.0/powershell_7.4.0-1.deb_amd64.deb
sudo dpkg -i powershell_7.4.0-1.deb_amd64.deb
```

**macOS:**
```bash
brew install --cask powershell
```

### 2. Repository klonen

```bash
git clone <repository-url>
cd PowerShell_Repo
```

### 3. Dependencies installieren

```powershell
./scripts/Install-Dependencies.ps1
```

### 4. Konfiguration erstellen

```powershell
# Konfigurationsdatei erstellen
Copy-Item config/appsettings.example.json config/appsettings.json

# Mit Editor öffnen
code config/appsettings.json  # oder notepad, vim, etc.
```

Fülle die Werte aus der App Registration ein (siehe oben).

### 5. Server starten

```powershell
./Start-Portal.ps1
```

Das Portal ist nun verfügbar unter: `http://localhost:8080`

## Konfiguration

### appsettings.json Referenz

```json
{
  "Azure": {
    "TenantId": "Azure AD Tenant ID",
    "ClientId": "App Registration Client ID",
    "ClientSecret": "App Registration Secret",
    "RedirectUri": "OAuth Redirect URI"
  },
  "Server": {
    "Port": 8080,                    // Server Port
    "Host": "localhost",             // Server Host
    "EnableHttps": false,            // HTTPS aktivieren
    "CertificatePath": "",           // Pfad zu SSL Zertifikat
    "CertificatePassword": ""        // Zertifikat Passwort
  },
  "Cache": {
    "EnableCaching": true,           // Caching aktivieren
    "DefaultTTLMinutes": 5,          // Standard Cache-Zeit
    "UserCacheTTLMinutes": 15,       // User Cache-Zeit
    "DeviceCacheTTLMinutes": 10      // Device Cache-Zeit
  },
  "Logging": {
    "LogLevel": "Information",       // Verbose, Information, Warning, Error
    "LogPath": "logs/portal.log",    // Log-Datei Pfad
    "EnableAuditLog": true,          // Audit-Logging aktivieren
    "AuditLogPath": "logs/audit.log" // Audit-Log Pfad
  },
  "Features": {
    "EnableIntune": true,            // Intune Features
    "EnableAVD": true,               // AVD Features
    "EnableOffice365": true,         // M365 Features
    "EnableAutomation": true         // Automation Features
  },
  "AVD": {
    "SubscriptionId": "Azure Subscription ID",
    "ResourceGroup": "AVD Resource Group",
    "DefaultHostPool": "Standard Host Pool Name"
  }
}
```

### HTTPS konfigurieren (Produktion)

Für Produktionsumgebungen solltest du HTTPS verwenden:

1. **Zertifikat erstellen/erhalten:**

```powershell
# Self-Signed Zertifikat (nur für Testing!)
$cert = New-SelfSignedCertificate -DnsName "portal.yourdomain.com" -CertStoreLocation "cert:\LocalMachine\My"
$password = ConvertTo-SecureString -String "YourPassword" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath ".\cert\portal.pfx" -Password $password
```

2. **Konfiguration anpassen:**

```json
{
  "Server": {
    "EnableHttps": true,
    "CertificatePath": "./cert/portal.pfx",
    "CertificatePassword": "YourPassword"
  }
}
```

## Erste Schritte

### 1. Dashboard

Nach dem ersten Login siehst du das Dashboard mit:
- Anzahl der M365 Users
- Anzahl der Intune Devices
- AVD Session Hosts Status
- Aktive AVD Sessions

### 2. Microsoft 365 Management

Navigiere zu **Microsoft 365**:
- Benutzer anzeigen und verwalten
- Gruppen erstellen und verwalten
- Lizenzen zuweisen

### 3. Intune Device Management

Navigiere zu **Intune Devices**:
- Alle verwalteten Geräte anzeigen
- Geräte synchronisieren
- Remote-Aktionen (Restart, Lock, Wipe)
- Compliance-Status prüfen

### 4. Azure Virtual Desktop

Navigiere zu **Azure Virtual Desktop**:
- Host Pools anzeigen
- Session Hosts starten/stoppen/neustarten
- Drain Mode aktivieren/deaktivieren
- Session Hosts überwachen

### 5. AVD Sessions

Navigiere zu **AVD Sessions**:
- Aktive Benutzersessions anzeigen
- Sessions trennen
- Benutzer abmelden (Logoff)
- Session-Details anzeigen

## Troubleshooting

### Problem: "Authentication failed"

**Lösung:**
1. Überprüfe Tenant ID, Client ID und Secret in `appsettings.json`
2. Stelle sicher, dass Admin Consent für alle Permissions erteilt wurde
3. Prüfe, ob der Client Secret noch gültig ist

### Problem: "Failed to load AVD data"

**Lösung:**
1. Überprüfe die Subscription ID und Resource Group
2. Stelle sicher, dass die App die richtigen RBAC-Rollen hat
3. Prüfe, ob die AVD-Ressourcen in der angegebenen Resource Group existieren

### Problem: Port 8080 bereits belegt

**Lösung:**
1. Ändere den Port in `appsettings.json`:
   ```json
   "Server": { "Port": 8081 }
   ```
2. Bei Docker: Ändere auch `docker-compose.yml`:
   ```yaml
   ports:
     - "8081:8080"
   ```

### Problem: Module nicht gefunden

**Lösung:**
```powershell
# Dependencies neu installieren
./scripts/Install-Dependencies.ps1 -Scope CurrentUser

# Oder manuell
Install-Module -Name Pode -MinimumVersion 2.10.0 -Force
```

### Logs prüfen

```powershell
# Lokale Installation
Get-Content ./logs/portal.log -Tail 50 -Wait

# Docker
docker-compose logs -f cloud-portal
```

## Support

Bei Problemen oder Fragen:
1. Prüfe die [Troubleshooting](#troubleshooting) Sektion
2. Schaue in die Logs
3. Erstelle ein Issue im GitHub Repository

## Sicherheitshinweise

- **Niemals** `appsettings.json` mit Secrets in Git committen
- Verwende in Produktion immer HTTPS
- Rotiere Client Secrets regelmäßig
- Verwende Firewalls und Netzwerksegmentierung
- Aktiviere Audit Logging für Compliance
- Implementiere Rate Limiting bei öffentlichem Zugang

## Nächste Schritte

- [API Dokumentation](API.md)
- [Entwickler Guide](DEVELOPMENT.md)
- [Erweiterte Konfiguration](ADVANCED.md)
