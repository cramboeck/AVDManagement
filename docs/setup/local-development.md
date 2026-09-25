# Lokale Entwicklung und Tenant-Onboarding

## Voraussetzungen

- Node.js >= 20, npm >= 10
- Docker (Postgres + Redis via `docker-compose.yml`)
- Eine App-Registrierung in deinem Partnertenant (siehe unten)

## Umgebungsvariablen

Es gibt genau eine Datei: `.env.local` im Monorepo-Root. API und Web lesen
beide daraus (die API ueber `apps/api/src/env.ts`, Next.js ueber
`apps/web/next.config.js`). Kopien in `apps/api` oder `apps/web` sind
unnoetig und fuehren zu Verwirrung.

```powershell
Copy-Item .env.example .env.local
```

Pflichtwerte fuer die API: `DATABASE_URL`, `ENTRA_CLIENT_ID`,
`ENTRA_CLIENT_SECRET`, `ENTRA_TENANT_ID`, `JWT_SECRET`. Fehlt einer, bricht
der Start mit einer klaren Meldung ab.

`JWT_SECRET` signiert den State des Admin-Consent-Rueckrufs. Lokal reicht
der Beispielwert; fuer alles andere: `openssl rand -base64 32`.

Optional: `ANTHROPIC_API_KEY` schaltet die KI-Erklaerung zu Schwachstellen
frei (ohne Schluessel zeigt die Konsole "nicht eingerichtet"); es werden nur
oeffentliche CVE-Daten gesendet, nie Geraete-, Benutzer- oder Tenantnamen.
`NVD_API_KEY` erhoeht das Ratenlimit der NVD-Anreicherung.

## Starten

```powershell
docker-compose up -d
npm install
npm run build --workspace=@zerostress/types --workspace=@zerostress/core
npm run db:push
npm run dev --workspace=@zerostress/api     # Fenster 1, Port 3001
npm run dev --workspace=@zerostress/web     # Fenster 2, Port 3002
```

Im Dev-Modus laedt die API `@zerostress/core` und `@zerostress/types`
direkt aus `packages/*/src` (`apps/api/tsconfig.dev.json`), Aenderungen an
Core wirken also sofort ohne Build. Der Build-Befehl ist fuer `npm start`
(laeuft gegen `dist/`) und fuer das Web noetig, das `@zerostress/types`
ueber `dist/` aufloest.

Erwartete erste Zeile der API:
`Environment: <pfad>\.env.local (DEV_AUTH_BYPASS active)`

Nach einem `git pull`, das `apps/api/src/db/schema.ts` aendert, einmal
`npm run db:push` ausfuehren, damit neue Tabellen (z. B. `cve_explanations`,
`inventory_snapshots`, `alerts`) angelegt werden.

## Bestands-Snapshot

Geraete und Schwachstellen werden nicht bei jedem Seitenaufruf aus Intune
und Defender geladen, sondern je Tenant als Snapshot in Postgres gehalten
(`inventory_snapshots`). Ein Worker (BullMQ-Queue `inventory-sync`, Redis)
prueft alle fuenf Minuten alle verbundenen Tenants und laedt Geraete nach
15 Minuten, Schwachstellen nach 60 Minuten neu. Die Seiten zeigen "Stand
vor n Minuten" und einen Knopf "Jetzt aktualisieren"; fehlt der Snapshot
noch, wird beim ersten Aufruf einmal direkt geladen. Ein fehlgeschlagener
Abgleich laesst den alten Stand stehen und zeigt den Fehler an.

Live bleiben: Scores, MFA-Report, Alerts, Anmelde- und Auditprotokolle,
Wiederherstellungsschluessel, alle Jobs. `/health` meldet unter `inventory`,
ob der Sync-Worker laeuft.

## Gruppen

Die Seite **Gruppen** zeigt Teams, Microsoft 365-, Sicherheits- und
Verteilergruppen mit Besitzern, Mitglieder- und Gastzahlen und
Auffaelligkeiten (ohne Besitzer, ein Besitzer, oeffentliches Team, Gaeste,
dynamisch, leer). Die Liste kommt aus dem Bestands-Snapshot (Intervall 60
Minuten), die Zaehlungen laufen ueber `$batch` mit zwei Anfragen je Gruppe.
`Directory.Read.All` reicht; ob eine M365-Gruppe ein Team ist, steht in
`resourceProvisioningOptions`, ein Teams-Scope ist nicht noetig. Das Detail
laedt Besitzer und Mitglieder live (bis 2000).

## Apps (Intune-Anwendungen)

Die Seite **Apps** zeigt Windows-Apps aus Intune (Win32, winget, MSI,
Microsoft 365 Apps, Edge, Store, Web-Links) mit Zuweisungen und den Zahlen
installiert, fehlgeschlagen, ausstehend aus dem Intune-Bericht
`getAppsInstallSummaryReport`; Snapshot alle 30 Minuten. Das Detail laedt
den Installationsstatus je Geraet live (`getDeviceInstallStatusReport`)
mit Klartext zu bekannten Fehlercodes.

Zuweisungen sind Jobs mit Vorschau: `apps.assign` und `apps.unassign`
lesen die bestehende Liste, fuehren zusammen und schreiben sie komplett
zurueck, weil Intune `/assign` die ganze Liste ersetzt. Die Vorschau zeigt
Vorher und Nachher und warnt bei "erforderlich" fuer grosse Gruppen.
`apps.create-deployment-groups` legt je App drei Sicherheitsgruppen an
(`<Praefix> <App> - Install (Required)`, `- Available`, `- Uninstall`),
verwendet bestehende Gruppen gleichen Namens wieder und weist sie auf
Wunsch sofort zu. Paketkatalog, Upload und Build-Worker (Stufen C/D) sind
im Plan `docs/implementation/apps-module-plan.md` beschrieben und offen.

## MCP-Server

Die API stellt unter `POST /mcp` einen MCP-Server (Model Context Protocol,
Streamable HTTP ohne Server-Streaming) bereit. Er nutzt dieselbe
Authentifizierung (Bearer-Token des angemeldeten Konsolenbenutzers, lokal
der Dev-Bypass), dieselbe Tenant-Isolation und dieselben Dienste wie die
Oberflaeche. Werkzeuge: `list_tenants`, `list_devices`, `get_device`,
`list_groups`, `list_apps`, `security_checks`, `list_alerts`,
`mailbox_usage`, `list_jobs`, `list_job_types`, `create_job`,
`approve_job`, `get_job`. Schreibende Aktionen laufen nur ueber
`create_job` (liefert die Preview, fuehrt nichts aus) und `approve_job`
(Rolle Engineer); beides und jeder Blick in personenbezogene Daten stehen
im Audit als `mcp.<tool>`.

Anbindung an Claude Code lokal:

```powershell
claude mcp add --transport http zerostress http://localhost:3001/mcp
```

Ohne Dev-Bypass zusaetzlich `--header "Authorization: Bearer <Token>"`
mit einem Token aus der Konsolenanmeldung. Der Server ist kein Ersatz fuer
die Freigabe in der Oberflaeche: ein Assistent kann Jobs vorbereiten, die
Freigabe bleibt eine bewusste Aktion mit Engineer-Rolle.

## Alerts (Anmelde-Anomalien)

Ein festes Regelwerk wertet alle zehn Minuten die Anmeldungen der letzten
zwei Stunden je verbundenem Tenant aus (braucht `AuditLog.Read.All` und
Entra ID P1): gehaeufte Fehlversuche je Benutzer, Password Spray ueber
viele Konten, Erfolg nach Fehlversuchen von anderer Adresse, zwei Laender
in kurzer Zeit, erfolgreiche Legacy-Authentifizierung, riskante
Anmeldungen laut Identity Protection. Jeder Vorfall hat einen stabilen
Fingerabdruck je Regel, Benutzer und Tag; Wiederholungen schreiben den
Alert fort statt neue anzulegen. Alerts lassen sich in Bearbeitung nehmen,
schliessen und wieder oeffnen (mit Audit). Die Dashboard-Kachel zaehlt
offene Alerts mit.

Mail optional: `ALERT_MAIL_FROM` (Postfach im eigenen Partnertenant) und
`ALERT_MAIL_TO` (Kommaliste). Die App-Registrierung braucht dafuer im
Partnertenant `Mail.Send`; sinnvoll ist eine Exchange Application Access
Policy, die den Versand auf dieses eine Postfach begrenzt. Die Mail enthaelt
Kontonamen und geht deshalb nur an interne Adressen.

## Best-Practice-Checks (Sicherheit > Best Practices)

Ein eigener Katalog aus oeffentlichen Microsoft-Empfehlungen, keine
Vorlagen aus Fremdprojekten. Geprueft werden MFA fuer alle und fuer
Administratoren, blockierte Legacy-Authentifizierung, risikobasierte
Richtlinien, konformes Geraet, Nur-Bericht-Richtlinien, SMS/Sprachanruf,
FIDO2, Nummernabgleich, App-Registrierung und Benutzer-Consent,
Gasteinladungen und Gastrechte, Anzahl globaler Administratoren,
Passwortablauf, Intune-Compliance-Richtlinien sowie SPF, DKIM und DMARC der
primaeren Domaene per DNS. Jeder Check hat Befund, Empfehlung und Belege;
Quellen ohne Berechtigung werden als "nicht pruefbar" gefuehrt, nie als
Fehler. Der Erfuellungsgrad gewichtet wesentliche Checks dreifach.

## Exchange Online

Die Seite **Exchange** liest vier Nutzungsberichte aus Graph
(`getMailboxUsageDetail`, `getEmailActivityUserDetail`,
`getEmailActivityCounts`, `getMailboxUsageStorage`, jeweils 30 Tage) und
haelt sie sechs Stunden im Snapshot. Die Berichte laufen etwa 48 Stunden
nach. Verbirgt der Tenant Namen in Berichten (Microsoft 365 Admin Center >
Einstellungen > Organisationseinstellungen > Berichte), erscheinen UPNs als
Hash; die Seite weist darauf hin. Jeder Abruf der Postfachliste steht im
Audit (`mail.usage.view`), weil sie personenbezogen ist. Weiterleitungen,
Delegierungen und Regeln brauchen Exchange-PowerShell und sind noch offen.

## Skriptbibliothek (Geraet > Skripte)

Befehle auf Geraeten laufen ohne eigenen Agenten ueber Intune Remediations
auf Abruf. Die Skripte liegen als Dateien unter `packages/core/scripts`
(PowerShell 5.1, ASCII, keine Aliase) und sind die einzige Quelle; Freitext
gibt es nicht. Beim ersten Lauf legt die Konsole das Remediation-Objekt
`ZSC-<skript>` im Kundentenant an, spaeter aktualisiert sie es, sobald der
Hash in der Beschreibung nicht mehr zur Bibliothek passt. Jeder Lauf ist ein
Job mit Preview; Name, Version und Hash stehen im Audit.

| Skript | Wirkung | Ergebnis |
|---|---|---|
| Update-Stand | nur lesend, Update-Cache des Geraets | ausstehende Updates, Neustartbedarf, letzte Suche/Installation |
| Update-Scan starten | Online-Scan gegen die konfigurierte Quelle, installiert nichts | Ergebnis des frischen Scans |
| Systeminfo | nur lesend | OS, Laufzeit, Systemlaufwerk, TPM, Secure Boot, BitLocker, Defender |
| Software-Updates mit winget pruefen | nur lesend, `winget upgrade` im Maschinenkontext, Quelle winget | verfuegbare Updates mit Id, installierter und neuer Version; markiert die Zeilen im Tab Software |
| Netzwerkinfo | nur lesend | aktive Adapter mit IPv4, Praefix, Gateway, DNS, DHCP, MAC, Verbindungsart, SSID; Domaene, Proxy |
| Speicherinfo | nur lesend | alle festen Laufwerke mit Belegung und Zustand, physische Datentraeger mit SSD/HDD, Bus, Groesse, Zustand, Firmware |
| Lokale Administratoren | nur lesend, **personenbezogen** | Mitglieder der Gruppe Administratoren mit Herkunft, Klasse, SID, Status; Entra-Konten verlinkt |

**Personenbezogene Ergebnisse:** Skripte mit Kontonamen (Lokale
Administratoren) speichern ihre Ausgabe nur verschluesselt
(AES-256-GCM, Schluessel aus `RESULT_ENCRYPTION_KEY`, 32 Bytes Base64,
`openssl rand -base64 32`). Ohne Schluessel verwirft der Job das Ergebnis
mit klarer Meldung. Anzeige nur mit Begruendung ab zehn Zeichen und Rolle
Engineer, jeder Blick steht im Audit (`job.result.reveal`), der Klartext
erlischt nach zehn Minuten in der Oberflaeche und wird nach 30 Tagen aus
der Datenbank geloescht. In Produktion kommt der Schluessel aus dem Key
Vault in die Prozessumgebung, nie in eine Datei im Repo.

**AVD-Session-Hosts:** dieselbe Bibliothek laeuft dort ueber Azure Run
Command (`RunPowerShellScript`), Knopf "Skript" in der Host-Liste. Ein
Rahmenskript fuehrt Erkennung, bei Exit 1 Behebung und danach erneut die
Erkennung aus, wie Intune. Die VM muss laufen; der Service Principal braucht
`Microsoft.Compute/virtualMachines/runCommand/action`, enthalten in
**Virtual Machine Contributor** auf der Ressourcengruppe der Hosts. Die
Compute-API begrenzt die Ausgabe auf die letzten 4096 Bytes.

Ohne Skript zeigt das Geraetedetail bereits Hersteller, Modell, Seriennummer,
Arbeitsspeicher, WLAN-MAC und die Belegung des Systemspeichers (Intune)
sowie letzte interne und oeffentliche IP und die Schnittstellen laut
Defender-Sensor. Die Seite **Netzwerk** leitet daraus je Tenant Standorte
(gleiche oeffentliche IP) und Subnetze (/24) ab; sie braucht Defender, weil
Intune keine Adressen meldet.

Der Tab **Software** zeigt das Intune-Inventar (`detectedApps`, vom Client
etwa woechentlich gemeldet) und die letzte winget-Pruefung. winget im
Maschinenkontext sieht nur maschinenweit installierte Software; Apps, die
nur im Benutzerprofil liegen (z. B. per-user Teams), fehlen. Braucht den App
Installer (`Microsoft.DesktopAppInstaller`) auf dem Geraet; fehlt er, meldet
das Skript das im Ergebnis.

Voraussetzungen im Kundentenant: Windows 10/11 Pro oder Enterprise mit
Intune Management Extension, Entra-joined oder hybrid, Lizenz Business
Premium, E3/E5 oder Windows E3/E5 (Remediations). Das Ergebnis kommt, sobald
das Geraet online ist; der Job wartet bis zu zehn Minuten, danach meldet er
"kein Ergebnis" und das Ergebnis erscheint spaeter im Intune-Portal unter
Geraet > Remediations. Intune begrenzt die Skriptausgabe auf 2048 Zeichen,
die Skripte liefern deshalb kompaktes JSON.

Integrationstest der Tenant-Isolation des Snapshot-Speichers:

```powershell
$env:TEST_DATABASE_URL = "postgresql://zerostress:dev_password_only@localhost:5432/zerostress"
npm test --workspace=@zerostress/api
```

## DEV_AUTH_BYPASS

Mit `DEV_AUTH_BYPASS=true` und `NEXT_PUBLIC_DEV_AUTH_BYPASS=true` entfaellt
der Entra-Login. Die API legt dafuer einen persistenten Benutzer
`dev@localhost` (Rolle `owner`) in der Default-MSP an, damit Jobs und
Audit-Eintraege gueltige Fremdschluessel haben. In Production verweigert die
API den Start, wenn der Bypass aktiv ist.

## App-Registrierung (Partnertenant)

Entra ID > App-Registrierungen > Neue Registrierung:

| Einstellung | Wert |
|---|---|
| Unterstuetzte Kontotypen | Konten in einem beliebigen Organisationsverzeichnis (mandantenfaehig) |
| Plattform | **Web** (nicht SPA, nicht Mobile/Desktop) |
| Redirect-URIs | `http://localhost:3002/auth/callback` (Login), `http://localhost:3001/auth/consent-callback` (Admin-Consent) |
| Oeffentliche Clientflows | Nein |
| Zertifikate & Geheimnisse | Client-Secret erstellen, Wert in `ENTRA_CLIENT_SECRET` |

Warum Web: Der Browser holt den Authorization Code mit PKCE, das Backend
tauscht ihn mit dem Client-Secret. Bei der Plattform SPA lehnt Entra das
Secret ab (`AADSTS700025`).

### API-Berechtigungen (Application Permissions, Microsoft Graph)

| Berechtigung | Wofuer | Fehlt sie |
|---|---|---|
| `Organization.Read.All` | Verbindungstest | Tenant bleibt `permissions-insufficient` |
| `User.Read.All`, `Directory.Read.All` | Benutzerliste, Detail, Gruppen | Benutzer-Seite 403 |
| `User.ReadWrite.All` | Deaktivieren/Aktivieren, Passwort-Reset, Sitzungen widerrufen, Lizenzen | Jobs schlagen fehl |
| `UserAuthenticationMethod.Read.All` | MFA-Methoden im Benutzerdetail | Karte "Berechtigung fehlt" |
| `AuditLog.Read.All` | Anmeldungen, Verzeichnisaudit, letzte Anmeldung | Karte "Berechtigung fehlt" |
| `DeviceManagementManagedDevices.Read.All` | Geraeteliste (Intune) | Karte "Berechtigung fehlt", Defender-Geraete bleiben sichtbar |
| `DeviceManagementManagedDevices.PrivilegedOperations.All` | Sync, Neustart, Defender-Scan | Geraete-Jobs schlagen fehl |
| `SecurityEvents.Read.All` | Secure Score und Verbesserungsmassnahmen (Sicherheit > Ueberblick) | Karte "Berechtigung fehlt" |
| `SecurityAlert.Read.All` | Offene Defender-Alerts | Karte "Berechtigung fehlt" |
| `BitLockerKey.Read.All` | BitLocker-Wiederherstellungsschluessel (Geraet > Wiederherstellung) | Karte "Berechtigung fehlt" |
| `DeviceLocalCredential.Read.All` | Windows-LAPS-Passwoerter; setzt LAPS mit Entra-Sicherung in der Intune-Richtlinie voraus | Karte "Berechtigung fehlt" |
| `DeviceManagementConfiguration.ReadWrite.All` | Skriptbibliothek als Intune Remediations im Tenant anlegen und aktuell halten (Geraet > Skripte) | Karte "Berechtigung fehlt" im Tab Skripte |
| `Reports.Read.All` | Exchange-Nutzungsberichte: Postfachgroessen, Kontingente, Mailvolumen (Seite Exchange) | Karte "Berechtigung fehlt" |
| `DeviceManagementApps.ReadWrite.All` | Apps: Bestand, Installationsstatus, Zuweisungen als Jobs (Seite Apps) | Karte "Berechtigung fehlt" |
| `Group.ReadWrite.All` | Bereitstellungsgruppen je App anlegen (Apps > Bereitstellungsgruppen anlegen) | Job schlaegt mit 403 fehl |
| `Policy.Read.All` | Best-Practice-Checks: Conditional Access, Sicherheitsstandards, Authentifizierungsmethoden, Autorisierungsrichtlinie (Sicherheit > Best Practices) | Betroffene Checks "nicht pruefbar" |

Schluessel und Passwoerter werden nie gelistet oder exportiert: Anzeige nur
nach Begruendung (mindestens 10 Zeichen), Rolle Engineer, Audit-Eintrag mit
Begruendung, automatisches Erloeschen nach 60 Sekunden.

Fuer den Exposure Score braucht die Defender-API zusaetzlich `Score.Read.All`
(WindowsDefenderATP, Anwendungsberechtigung). Der MFA-Registrierungsreport
laeuft ueber `AuditLog.Read.All` und setzt Entra ID P1 voraus.

### Defender-for-Endpoint-API (WindowsDefenderATP)

Exposure, Risiko, Schwachstellen und fehlende Sicherheitsupdates kommen aus
der Defender-API, nicht aus Graph. In der App-Registrierung unter
**API-Berechtigungen > Berechtigung hinzufuegen > APIs, die meine
Organisation verwendet > "WindowsDefenderATP"** (im Suchfeld die
Anwendungs-ID `fc780465-2017-40d4-a0c5-307022471b92` eingeben) als
Anwendungsberechtigungen: `Machine.Read.All`, `Vulnerability.Read.All`,
`Software.Read.All` (fehlende KBs). Danach Consent erneuern. Fehlt eine
Rolle, nennt die Konsole die von der Defender-API geforderte Rolle.

Voraussetzung im Kundentenant: Defender for Business (in Microsoft 365
Business Premium) oder Defender for Endpoint P2. Ohne Lizenz existiert die
API-Ressource im Tenant nicht (`AADSTS500011`); die Konsole zeigt dann
"Defender for Endpoint nicht lizenziert" und arbeitet mit Intune-Daten
weiter. Fuer EU-Datenresidenz kann `DEFENDER_API_BASE_URL` auf
`https://api-eu.securitycenter.microsoft.com` gesetzt werden.

Anmelde- und Auditprotokolle setzen zusaetzlich **Entra ID P1** im
Kundentenant voraus (enthalten in Business Premium, E3, E5). Ohne P1 zeigt
die Konsole die Karte "Entra ID P1 erforderlich".

**Passwort-Reset und Deaktivierung per App-Berechtigung:** Graph verlangt
neben `User.ReadWrite.All`, dass der Service Principal der App im
Kundentenant die Entra-Rolle **Benutzeradministrator** (oder
Kennwortadministrator) hat. Ohne Rolle antwortet Graph mit 403
`Authorization_RequestDenied`. Konten mit Administratorrollen koennen so
nicht zurueckgesetzt werden; das ist von Microsoft so vorgesehen.
Zuweisung: Entra ID > Rollen und Administratoren > Benutzeradministrator >
Zuweisung hinzufuegen > die Enterprise-Anwendung auswaehlen.

Nach jeder Aenderung an den Berechtigungen muss der Admin-Consent im
Kundentenant erneut erteilt werden (Tenants > Consent starten).

## Tenant anbinden

1. In der Konsole unter **Tenants** > **Tenant hinzufuegen**: Anzeigename,
   primaere Domain, Microsoft-Tenant-ID (GUID).
2. **Consent starten**: leitet zum Microsoft-Admin-Consent des Kundentenants
   um. Anmeldung als Global Administrator dieses Tenants. Der Link ist 15
   Minuten gueltig und an deinen Benutzer gebunden.
3. Microsoft ruft `/auth/consent-callback` auf. Die API prueft den
   signierten State, vergleicht den gemeldeten Tenant mit dem registrierten,
   fuehrt den Verbindungstest aus und leitet zurueck auf `/tenants`.
4. **Verbindung testen** kann jederzeit wiederholt werden.

Der erste Testtenant kann der eigene Partnertenant sein. Die
App-Registrierung liegt dort bereits; der Consent erteilt ihr nur die
Application Permissions.

### Tenant entfernen

**Tenants > Entfernen**, Rolle Owner, Anzeigename muss abgetippt werden.
Der Tenant wird deaktiviert, nicht geloescht: Jobs und Audit-Eintraege
bleiben nachvollziehbar, der Bestands-Snapshot wird geloescht, der Vorgang
steht im Audit. Der Admin-Consent im Kundentenant bleibt bestehen; um ihn
zu widerrufen, dort unter Entra ID > Enterprise-Anwendungen die Anwendung
der Konsole loeschen. Ein erneutes Anlegen desselben Microsoft-Tenants
wird abgelehnt, solange der alte Eintrag existiert (Konflikt); in dem Fall
den Eintrag in `managed_tenants` reaktivieren statt neu anlegen.

### Zweiter Tenant: was pro Tenant noetig ist

Die App-Registrierung ist mandantenfaehig, aber jeder Kundentenant braucht
seinen eigenen Consent, seine eigenen Rollen und seine eigenen Lizenzen.
Die Konsole nutzt ausschliesslich Anwendungsberechtigungen (Application),
delegierte Berechtigungen spielen fuer die Datenzugriffe keine Rolle.

| Was fehlt | Woran man es sieht | Behebung |
|---|---|---|
| Consent aelter als die letzte Berechtigungsaenderung | Karten "Berechtigung fehlt: X" | Tenants > Consent erneuern |
| Entra ID P1 | Karte "Entra ID P1 erforderlich" bei Anmeldungen, Audit, MFA-Report | Lizenz im Kundentenant |
| Defender for Business / Endpoint P2 | Karte "Defender for Endpoint nicht lizenziert", Geraete nur aus Intune | Lizenz im Kundentenant |
| Entra-Rolle Benutzeradministrator fuer den Service Principal | Passwort-Reset und Deaktivieren schlagen mit 403 fehl | Rolle im Kundentenant zuweisen |
| Azure-RBAC (Reader, Desktop Virtualization Contributor, Virtual Machine Contributor) | "0 Azure-Subscription(s) sichtbar", keine Host Pools | Rollen auf Subscription oder Ressourcengruppe |

### Verbindungstest: was geprueft wird

| Pruefung | Beweist | Bei Fehlschlag |
|---|---|---|
| Graph `GET /organization` (app-only) | Admin-Consent und Application Permissions | `consent-required` (kein Consent) oder `permissions-insufficient` (Consent ohne passende Berechtigungen) |
| ARM `GET /subscriptions` | Azure-RBAC fuer den Service Principal | Status bleibt `connected`, Hinweis unter "Eingeschraenkter Zugriff" |

### Azure-RBAC fuer AVD

AVD laeuft ueber Azure Resource Manager, nicht ueber Graph. Im Kundentenant
muss der Service Principal der App-Registrierung (erscheint dort nach dem
Consent unter Enterprise-Anwendungen) auf der AVD-Subscription oder
Ressourcengruppe folgende Rollen erhalten:

- `Reader`
- `Desktop Virtualization Contributor`
- `Virtual Machine Contributor` (Start/Stop/Neustart der Hosts und Skripte ueber Run Command)

Ohne diese Zuweisung sieht die Konsole keine Host Pools; der
Verbindungstest meldet dann `0 Azure-Subscription(s) sichtbar`.

## Haeufige Fehler

| Meldung | Ursache | Loesung |
|---|---|---|
| `AADSTS900144: client_id missing` | ENV nicht geladen | Erste Startzeile pruefen, `.env.local` muss im Root liegen |
| `AADSTS700025: Client is public` | Redirect-URI unter SPA/Mobile registriert | Auf Plattform Web umziehen |
| `AADSTS700016: Application not found in directory` | Kein Consent im Kundentenant | Consent starten |
| Graph 403 bei `/organization` | Consent ohne Application Permissions | `Organization.Read.All` hinzufuegen, Consent wiederholen |
| `invalid input syntax for type uuid` | Alter Dev-Bypass mit Dummy-IDs | `git pull`, API neu starten |
