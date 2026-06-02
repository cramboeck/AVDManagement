# Quick Start Guide

Schnelleinstieg in 5 Minuten!

## Schritt 1: Azure AD App erstellen

1. Gehe zu [Azure Portal](https://portal.azure.com) → **Azure Active Directory** → **App registrations** → **New registration**
2. Name: `Cloud Management Portal`
3. Redirect URI: `http://localhost:8080/auth/callback`
4. Nach Erstellung: Notiere **Tenant ID** und **Client ID**

## Schritt 2: Client Secret erstellen

1. In deiner App → **Certificates & secrets** → **New client secret**
2. Kopiere den Secret-Wert (wird nur einmal angezeigt!)

## Schritt 3: Permissions hinzufügen

1. **API permissions** → **Add a permission** → **Microsoft Graph** → **Application permissions**
2. Füge hinzu:
   - `User.Read.All`
   - `Group.Read.All`
   - `Directory.Read.All`
   - `DeviceManagementManagedDevices.ReadWrite.All`
   - `DeviceManagementConfiguration.ReadWrite.All`
   - `Organization.Read.All`
3. Klicke **Grant admin consent**

## Schritt 4: AVD RBAC (optional)

Nur wenn du AVD verwenden möchtest:

```bash
az role assignment create \
  --assignee <Client-ID> \
  --role "Desktop Virtualization Power On Off Contributor" \
  --scope "/subscriptions/<Subscription-ID>"
```

## Schritt 5: Docker starten

```bash
# Konfiguration erstellen
cp config/appsettings.example.json config/appsettings.json

# Bearbeite die Datei mit deinen Werten
nano config/appsettings.json

# Container starten
docker-compose up -d

# Portal öffnen
open http://localhost:8080
```

## Fertig!

Das Portal ist jetzt verfügbar unter: **http://localhost:8080**

### Was du jetzt tun kannst:

- **Dashboard**: Übersicht über M365, Intune und AVD
- **Microsoft 365**: Benutzer und Gruppen verwalten
- **Intune Devices**: Geräte überwachen und remote verwalten
- **AVD**: Session Hosts starten/stoppen, Drain Mode
- **AVD Sessions**: Aktive Sessions anzeigen und verwalten

## Probleme?

```bash
# Logs anzeigen
docker-compose logs -f

# Container neu starten
docker-compose restart

# Status prüfen
docker-compose ps
```

Siehe [Installation Guide](INSTALLATION.md) für detaillierte Informationen.
