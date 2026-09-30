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
`npm run db:push` ausfuehren, damit neue Tabellen und Spalten (z. B.
`cve_explanations`, `inventory_snapshots.unavailable`, `alerts`,
`app_packages`, `app_deployments`, `build_jobs`) angelegt werden.
Fehlt etwas, meldet die API es beim Start ("Database schema is behind the
code"), `GET /health` zeigt `schema.missing`, und Aufrufe antworten mit
dem Problemtyp `schema-outdated` statt mit einem rohen Postgres-Fehler
wie `column "unavailable" does not exist`.

**Warnung "data-loss statements" bei `db:push`:** drizzle-kit bietet bei
einer Typaenderung (z. B. `varchar(100)` auf `text`) an, die Tabelle zu
leeren. Immer mit "No, abort" abbrechen, besonders bei `audit_entries`;
das Audit-Log wird nie geleert. Die Aenderung stattdessen von Hand
machen, sie ist in Postgres verlustfrei:

```powershell
docker exec -it zerostress-postgres psql -U zerostress -d zerostress -c "ALTER TABLE audit_entries ALTER COLUMN target_id TYPE text, ALTER COLUMN target_display_name TYPE text;"
npm run db:push
```

Der zweite `db:push` legt dann nur noch die fehlenden Tabellen an.

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
`Directory.Read.All` reicht zum Lesen; ob eine M365-Gruppe ein Team ist,
steht in `resourceProvisioningOptions`, ein Teams-Scope ist nicht noetig.
Das Detail laedt Besitzer und Mitglieder live (bis 2000).

Aenderungen an Mitgliedern und Besitzern sind Jobs (`group.add-member`,
`group.remove-member`, `group.add-owner`, `group.remove-owner`) mit
Vorschau, Freigabe durch Engineer und Audit; sie brauchen
`Group.ReadWrite.All`. Dynamische und aus dem lokalen AD synchronisierte
Gruppen lehnen Aenderungen ab, der letzte Besitzer einer Microsoft
365-Gruppe wird nicht entfernt. Auf der Benutzerseite laesst sich ein
Benutzer im Tab Gruppen direkt aus einer Gruppe entfernen.

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
Wunsch sofort zu.

### Paketkatalog und Rollout

Unter **Apps > Katalog** pflegt der MSP Pakete einmal fuer alle Tenants.
Ein Paket besteht aus einem typisierten Manifest (Hersteller, Name,
Version, Architektur, Sprache, Revision, Installertyp `msi`/`exe`/`psadt`/
`winget`/`store`, Install- und Uninstall-Befehl, Erkennung, Anforderungen,
Return-Codes, Neustartverhalten) und optional zwei Dateien: dem fertigen
`.intunewin` (Artefakt) und dem rohen Installer (fuer den spaeteren
Build-Worker). Dateien gehen per `PUT /packages/:id/artifact|installer
?fileName=` als roher Body in den Artefaktspeicher.

Artefaktspeicher: `ARTIFACT_STORE=local` legt Dateien unter
`ARTIFACT_STORE_PATH` (Standard `./data/artifacts`) ab, `ARTIFACT_STORE=azure`
schreibt per Managed Identity in den Blob-Container
`ARTIFACT_AZURE_ACCOUNT`/`ARTIFACT_AZURE_CONTAINER` (EU-Region waehlen).
Es gibt keine SAS-Schluessel in der Konfiguration. `APP_DETECTION_PREFIX`
(Standard `ZSC`) bildet den Registry-Erkennungsschluessel
`HKLM\SOFTWARE\<Praefix>_IntuneAppInstall\Apps\<Vendor-Name-Version-Lang-Rev-Arch>`
mit dem Wert `Installed = Y`; das Praefix gilt pro MSP und wird nach dem
ersten Upload nicht mehr geaendert, weil es Teil des Bezeichners ist.

**Rollout** (`POST /packages/:id/rollout`, Rolle Engineer) legt je
gewaehltem, verbundenem Tenant einen Job `apps.publish` an. Die Vorschau
zeigt Anzeigename, Typ, Install-/Uninstall-Befehl, Erkennung, Artefakt mit
Groesse und SHA-256 sowie Warnungen (bereits veroeffentlicht, kein
Artefakt). Der Job laeuft dann den Intune-Upload als Zustandsautomat:
App anlegen, Content-Version, Datei anlegen, auf `azureStorageUriRequestSuccess`
warten, Blob in 6-MB-Bloecken hochladen, Blockliste, Commit mit
`fileEncryptionInfo` aus der `Detection.xml` der `.intunewin`, auf
`commitFileSuccess` warten, `committedContentVersion` setzen. Store-Pakete
legen nur das Graph-Objekt `winGetApp` an. Der Job weist niemandem zu;
Zuweisung bleibt der bewusste zweite Schritt unter Apps. Fortschritt,
Intune-App-Id und Fehler je Tenant stehen in `app_deployments` und im
Paketdetail. Benoetigt `DeviceManagementApps.ReadWrite.All`.

**winget als Installerquelle** (Typ `winget`): der Installer kommt aus dem
winget-Community-Katalog, das Paket wird trotzdem ein normales Win32-Paket
mit PSADT-Wrapper und eigener Erkennung. Im Formular Id aus dem Basis-Set
(rund 50 gaengige Programme), per Blaettern nach Herausgeber oder von Hand
waehlen, Version leer (neueste) oder fest, dann "Aus Katalog laden". Die
API liest die Manifeste direkt aus dem oeffentlichen GitHub-Repository
`microsoft/winget-pkgs` (Versionsliste ueber die Contents-API, Manifeste
als Rohdatei), waehlt den passenden Installer (Architektur, Scope machine,
MSI vor EXE; msix/appx/zip/portable fallen raus) und fuellt Hersteller,
Name, Version, Produktcode, stillen Schalter und Installer-URL samt
SHA-256 ins Manifest. Der Worker laedt den Installer beim Bauen direkt vom
Hersteller und prueft den Hash; ein Upload ist nicht noetig. Deinstallation:
Manifest-Befehl, sonst MSI ueber Produktcode, sonst der Eintrag unter Apps
und Features aus dem Katalog. Ohne `GITHUB_TOKEN` (optional, ohne Scopes)
erlaubt GitHub 60 Katalogabfragen je Stunde, mit Token 5000.

Versionen: die API prueft einmal am Tag je winget-Paket die Katalogversion
(`latest_version`, `latest_checked_at`) und zeigt im Paketdetail "Neue
Version im Katalog". "Neue Version anlegen" erzeugt ein neues Paket mit der
neuen Version, loest den Installer neu auf und stellt den Build ein; das
alte Paket bleibt. Ausrollen bleibt eine bewusste Freigabe, nichts laeuft
automatisch auf Tenants. Audit `apps.package.new-version`.

**Microsoft Store** (Typ `store`) ist der Sonderfall: nur fuer Store-
Produkt-Ids (12 Zeichen aus der Store-URL). Intune installiert selbst,
die Version folgt dem Store, es gibt kein Artefakt. Community-Ids wie
`7zip.7zip` funktionieren dort nicht; dafuer den Typ `winget` nehmen.

**Build-Worker** (Stufe D): fuer `msi`, `exe`, `psadt` und `winget` erzeugt ein
Windows-Worker aus Installer und Manifest das `.intunewin`
(`apps/worker-windows`, PowerShell 5.1). "Build starten" im Paketdetail
legt einen Auftrag in `build_jobs` an (Audit `apps.package.build`); der
Worker holt ihn per `POST /worker/builds/claim`, laedt den Installer, baut
bei `psadt` den PSAppDeployToolkit-v4-Wrapper mit dem Registry-Marker aus
`APP_DETECTION_PREFIX`, ruft `IntuneWinAppUtil.exe` auf, laedt das Artefakt
hoch und meldet Protokoll und Ergebnis. Die Worker-Endpunkte unter
`/worker` verlangen ein Worker-Token als Bearer und `X-Worker-Id` (siehe
Abschnitt "Worker-Token"); ohne gueltiges Token antworten sie mit 401 und
das Paketdetail zeigt einen Hinweis, solange fuer den MSP kein Token
existiert. Ein Auftrag ohne Lebenszeichen faellt nach zwei Stunden auf
"fehlgeschlagen". Einrichtung des Workers: `apps/worker-windows/README.md`.

## Azure VMs

Die Seite **Azure VMs** listet alle virtuellen Maschinen der Subscriptions,
auf die die App-Registrierung des Tenants Zugriff hat (ARM, Rolle Reader),
mit Betriebszustand, Groesse, Image und AVD-Kennzeichen. Aktionen sind
Jobs mit Vorschau, Freigabe und Audit: `vm.start`, `vm.stop` (deallocate,
keine Rechenkosten), `vm.restart`, `vm.resize` (Vorschau mit
Kostenvergleich aus der oeffentlichen Azure-Preisliste). Sie brauchen die
Azure-Rolle Virtual Machine Contributor.

**Neue VM aus Vorlage**: Vorlagen liegen versioniert als ARM JSON unter
`packages/core/templates/azure` und sind die einzige Quelle. Das Formular
fragt Subscription, Ressourcengruppe (bestehend oder neu), Subnetz, Name,
Groesse (Liste der Region), Image, Festplatte, Lizenz, Tags und Entra-Join
ab. Die Vorschau des Jobs `vm.deploy` enthaelt die ARM-Validierung und die
Kostenschaetzung; die Ausfuehrung erzeugt das Administratorpasswort,
stellt bereit und legt Benutzer und Passwort versiegelt im Ergebnis ab
(Anzeige nur mit Begruendung, Rolle Engineer, Audit; Loeschung nach 30
Tagen; braucht `RESULT_ENCRYPTION_KEY`). Bereitstellungen brauchen die
Rolle Contributor auf der Ressourcengruppe bzw. Subscription (fuer neue
Gruppen). Die Kostenschaetzung ruft `prices.azure.com` ohne Anmeldung ab;
ohne Netz fehlt sie und die Vorschau sagt das. Plan und offene Stufen:
`docs/implementation/azure-vm-plan.md`.

## Software (tenantweit)

Die Seite **Software** liest alle von Intune erkannten Programme des
Tenants mit Geraetezahl (Graph beta `deviceManagement/detectedApps`,
Snapshot-Art `software`, alle 6 Stunden) und fasst sie je Name und
Hersteller mit allen Versionen zusammen. Jede Zeile wird per Name dem
winget-Katalog zugeordnet (eigene Pakete zuerst, dann das Basis-Set); die
neueste Katalogversion kommt aus dem Paket oder aus einem taeglichen
Versionscache (`winget_versions`, hoechstens acht Nachfragen je Aufruf,
damit das GitHub-Ratenlimit reicht). Daraus entsteht der Stand "aktuell",
"veraltet" (mit Anzahl alter Geraete) oder "unbekannt".

Aktionen je Zeile: **Aktualisieren** und **Deinstallieren** oeffnen die
Sammelaktion: Geraete der Software laut Intune laden, bis zu 25 waehlen,
dann Job `device.winget-bulk` mit einer Vorschau je Geraet, bis zu drei
Geraete gleichzeitig, Ergebnis je Geraet im Job (Teilerfolge werden als
Fehler mit Einzelheiten gemeldet). **Paket** oder **Als Paket** springt in
den Katalog, **Sperren** legt eine Regel an.

**Sperrliste** (unten auf der Seite, MSP-weit): Regeln "Name enthaelt" oder
"winget-Id". Nach jedem Software-Sync wird die Liste gegen das Inventar
geprueft; Treffer erzeugen den Alert "Gesperrte Software" mit Geraetezahl
und Versionen (Regel `blocked-software`, ein Alert je Regel und Programm,
Mail wie bei den Anmelde-Alerts). Zeilen mit Treffer sind in der Tabelle
markiert. Es wird nichts automatisch entfernt; Deinstallieren bleibt eine
Sammelaktion mit Vorschau. Audit `software.blocklist.add` und
`software.blocklist.remove`. Braucht `npm run db:push` (Tabellen
`winget_versions`, `software_blocklist`).

## Software je Geraet: winget-Aktionen

Der Tab **Software** ordnet jede Inventarzeile dem winget-Katalog zu: erst
den eigenen Paketen (Typ winget), dann dem Basis-Set, jeweils ueber den
Anzeigenamen. **Inventar abgleichen** (Skript `winget-inventory`) holt vom
Geraet die Paket-Ids, die winget der Quelle winget zuordnen kann (nur Ids,
weil Intune die Ausgabe auf 2048 Zeichen kuerzt), und ordnet sie den Zeilen
zu; nicht zuordenbare Ids stehen in einem eigenen Abschnitt. **Updates
pruefen** (Skript `winget-updates`) zeigt neuere Versionen. Aktionen je
Zeile: **Update installieren**, **Deinstallieren** (beide Job
`device.winget-install`, Einmalskript mit eingebetteter Id und Modus im
Maschinenkontext, Vorschau und Audit; die Deinstallation warnt, dass ueber
Intune zugewiesene Software zurueckkommt), **Als Paket anlegen** (Katalog
mit vorbelegter Id) oder **Zum Paket**. Der Abschnitt "Aus dem Basis-Set
installieren" installiert gaengige Software direkt auf dem Geraet. Diese
Aktionen gelten nur fuer das eine Geraet und legen keine Intune-App an;
fuer viele Geraete bleibt der Katalog mit Rollout der richtige Weg. Ein
vollstaendiges winget-Inventar je Geraet scheitert an der Ausgabegrenze
der Intune-Remediations (2048 Zeichen); deshalb Namensabgleich plus
Update-Liste.

## Netzwerkverbindungen (Advanced Hunting)

Mit Defender for Endpoint Plan 2 zeigt **Geraet > Verbindungen**, wohin
das Geraet in den letzten 1 bis 30 Tagen gesprochen hat: je Zieladresse
Host, Bereich (privat/oeffentlich), Ports, ausloesende Prozesse, Richtung
und Haeufigkeit (KQL-Vorlage ueber `DeviceNetworkEvents`, nur geprueft
eingesetzte Werte). **Netzwerk > Kommunikation der Clients** fasst das
tenantweit zusammen, extern (oeffentliche Ziele, Grundlage fuer ausgehende
Firewall-Regeln) oder intern (private Ziele: Server, Drucker, Clients
untereinander), mit der Anzahl Geraete je Ziel. Beide Abrufe stehen im
Audit (`device.connections.view`, `network.connections.view`). Braucht die
Defender-Berechtigung `AdvancedQuery.Read.All`; Defender for Business
liefert diese Daten nicht.

**Regelvorschlag Firewall** (Netzwerk > Regelvorschlag): die externen
Ziele werden gegen die oeffentliche Microsoft-365-Endpunktliste
(`endpoints.office.com`, einmal am Tag geladen, Version wird angezeigt)
und eine kurze Liste bekannter Ziele (Windows Update, Defender, Intune,
Google, Adobe, TeamViewer, CDNs) abgeglichen und zu Gruppen zusammengefasst:
Microsoft 365 je Dienst mit Kategorie Optimize/Allow/Default und
"erforderlich", Microsoft-Dienste, bekannte Hersteller, sonstige Domaenen
und nackte IPs. Je Gruppe stehen Ziele, Ports, Geraetezahl und Prozesse als
Beleg; Export als CSV. Es wird nichts konfiguriert. Audit
`network.firewall-proposal.view`. Die API braucht dafuer ausgehenden
Zugriff auf `endpoints.office.com`; ohne ihn fehlt die M365-Zuordnung und
die Seite sagt das.

## Remotehilfe (TeamViewer)

Mit `TEAMVIEWER_API_TOKEN` (Skript-Token aus der TeamViewer Management
Console, Berechtigung "Geraete lesen") zeigt das Geraetedetail den Knopf
**Remote-Sitzung**. Die Konsole sucht das Geraet in der TeamViewer-
Geraeteliste ueber den Alias (muss dem Hostnamen entsprechen, Zusaetze wie
"AOEPC239 (Buero)" sind erlaubt), fragt eine Begruendung ab, schreibt
`remote.session.start` ins Audit und oeffnet `teamviewer10://control`,
worauf der TeamViewer-Client auf dem Technikerrechner die Verbindung
aufbaut. Die Konsole speichert keine Sitzungsdaten und kein Passwort.
Ad-hoc-Sitzungscodes (Service-Queue) und RustDesk als zweiter Anbieter
sind im Plan `docs/implementation/remote-actions-plan.md` beschrieben.

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

## Betriebs-Alerts (Einstellungen)

Drei Regeln ueber Bestandsdaten, alle standardmaessig aus, Schwellen unter
**Einstellungen > Betriebs-Alerts** (nur Owner, Audit `settings.update`):

- **Veraltete Software**: Programme mit Katalogstand "veraltet" auf
  mindestens N Geraeten (Standard 5), Quelle ist der Software-Snapshot mit
  winget-Abgleich. Fingerabdruck je Programm und Katalogversion, ein
  geschlossener Alert kommt erst mit der naechsten Version wieder.
- **Postfach nahe der Sendesperre**: Belegung ab N Prozent (Standard 90,
  ab 100 Prozent Stufe hoch), Quelle ist der Mail-Snapshot aus den
  Graph-Berichten (etwa 48 Stunden Verzug). Tenants mit verborgenen Namen
  in Berichten werden uebersprungen. Fingerabdruck je Postfach und Monat.
- **VM ausserhalb der Arbeitszeit**: laufende Azure-VMs ausserhalb des
  Zeitfensters (Standard 7 bis 19 Uhr Europe/Berlin, Wochenende komplett
  ausserhalb), Sitzungshosts und VMs mit dem Ausnahme-Tag (Standard
  `zsc-always-on`) werden nicht gemeldet. ARM wird nur ausserhalb der
  Arbeitszeit abgefragt. Fingerabdruck je VM und Tag.

Ausgewertet wird im Alert-Takt, aber hoechstens einmal je Stunde und
Tenant; "Jetzt auswerten" auf der Alert-Seite laeuft sofort. Treffer
landen in derselben Liste und derselben Mail wie die Anmelde-Alerts.

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
Audit (`mail.usage.view`), weil sie personenbezogen ist.

**Postfachdetail** (Klick auf ein Postfach, `/mail/<upn>`): Kennzahlen aus
dem Bericht plus live aus Graph Abwesenheit (Status, Zeitraum, Texte),
Zeitzone, Sprache, Aliasse und die Posteingangsregeln mit Bedingungen und
Aktionen. Regeln mit Weiterleitung oder Umleitung an Adressen ausserhalb
der verifizierten Tenant-Domaenen sind rot markiert. Aufruf im Audit
(`mail.mailbox.view`). Braucht `MailboxSettings.ReadWrite` (nach dem
Hinzufuegen Consent erneuern).

Aenderungen sind Jobs mit Vorschau, Freigabe (Engineer) und Audit:
`mailbox.set-auto-reply` (sofort oder geplant, externe Antwort an
niemanden/Kontakte/alle), `mailbox.create-forward-rule` (Posteingangsregel
weiterleiten oder umleiten, warnt bei fremden Domaenen),
`mailbox.enable-rule`, `mailbox.disable-rule`, `mailbox.delete-rule`.
Schreibgeschuetzte Regeln (vom Client verwaltet) werden abgelehnt.

**Weiterleitungs-Scan** (Panel "Weiterleitungen" auf der Exchange-Seite):
liest per `$batch` die Regeln aller Benutzer- und freigegebenen Postfaecher
aus dem Bericht (bis 1000 je Lauf) und listet alle mit Weiterleitung,
externe zuerst. Audit `mail.forwarding.scan`. Hinweis: Exchange stellt
externe Weiterleitungen nur zu, wenn die Outbound-Spam-Richtlinie das
erlaubt; das Cockpit kann diese Richtlinie noch nicht lesen.

**Exchange-Worker** (`apps/worker-exchange`): Kontingente, Weiterleitung
auf Postfachebene, Vollzugriff und Senden als, Archiv, Postfachtyp und
Beweissicherung gehen nur ueber Exchange-PowerShell. Der Worker laeuft auf
einer Maschine des MSP mit dem Modul ExchangeOnlineManagement und meldet
sich app-only mit Zertifikat an (`Exchange.ManageAsApp`, Rolle Exchange
Administrator fuer den Service Principal im Kundentenant); das Zertifikat
bleibt beim Worker. Auf der Exchange-Seite startet "Postfachdaten sammeln"
den Job `exchange.collect-facts`; danach zeigt das Postfachdetail den
Abschnitt "Exchange-Einstellungen" mit Ist-Zustand und Aktionen, jede als
Job mit Vorschau, Freigabe und Audit (`mailbox.set-quota`,
`mailbox.set-forwarding`, `mailbox.set-full-access`, `mailbox.set-send-as`,
`mailbox.enable-archive`, `mailbox.convert`, `mailbox.set-litigation-hold`).
Der Job wartet bis 20 Minuten auf die Rueckmeldung des Workers; ohne Worker
bleibt der Auftrag in `exchange_jobs` stehen und der Job meldet das. Die
Worker-Endpunkte unter `/worker/exchange` nutzen dieselben Worker-Token
wie der Build-Worker. Einrichtung: `apps/worker-exchange/README.md`.

## SharePoint und OneDrive

Die Seite **SharePoint** liest `getSharePointSiteUsageDetail`,
`getSharePointActivityUserDetail` und `getOneDriveActivityUserDetail` (30
Tage, `Reports.Read.All`, Snapshot 6 h): Websites mit Speicher, Dateien,
anonymen Links, Gastlinks und Aktivitaet sowie je Benutzer die Zahl extern
und intern geteilter Dateien. Das ist die Uebersicht "wer teilt extern"
ohne Dateiliste; die Freigabeliste je Datei braucht `Sites.Read.All` und
eine Suche ueber alle Bibliotheken und ist im Backlog. Jeder Abruf steht
im Audit (`sharepoint.usage.view`).

## Skriptbibliothek (Geraet > Skripte)

Befehle auf Geraeten laufen ohne eigenen Agenten ueber Intune Remediations
auf Abruf. Die Skripte liegen als Dateien unter `packages/core/scripts`
(PowerShell 5.1, ASCII, keine Aliase) und sind die einzige Quelle; Freitext
gibt es nicht. Beim ersten Lauf legt die Konsole das Remediation-Objekt
`ZSC-<skript>` im Kundentenant an, spaeter aktualisiert sie es, sobald der
Hash in der Beschreibung nicht mehr zur Bibliothek passt. Jeder Lauf ist ein
Job mit Preview; Name, Version und Hash stehen im Audit.

Im Intune Admin Center stehen die Objekte unter Geraete > Windows >
Skripts und Wiederherstellungen > Wiederherstellungen mit Herausgeber
"ZeroStress Cockpit" und Status "Not deployed" (keine Gruppenzuweisung,
Start nur auf Abruf durch die Konsole). Die Spalten "Without issues" und
"With issues" zaehlen die Laeufe je Geraet; beim Update-Scan ist "With
issues" gewollt, weil die Erkennung ausstehende Updates als Befund
meldet. Der blaue Hinweis "Use of remediations requires Windows license
verification" verlangt eine einmalige Bestaetigung je Tenant
(Mandantenverwaltung > Connectors und Token > Windows-Daten); ohne sie
liefern Laeufe kein Ergebnis. Das gehoert in die Onboarding-Pruefung
jedes Kundentenants.

| Skript | Wirkung | Ergebnis |
|---|---|---|
| Update-Stand | nur lesend, Update-Cache des Geraets | ausstehende Updates, Neustartbedarf, letzte Suche/Installation |
| Update-Scan starten | Online-Scan gegen die konfigurierte Quelle, installiert nichts | Ergebnis des frischen Scans |
| Systeminfo | nur lesend | OS, Laufzeit, Systemlaufwerk, TPM, Secure Boot, BitLocker, Defender |
| Software-Updates mit winget pruefen | nur lesend, `winget upgrade` im Maschinenkontext, Quelle winget | verfuegbare Updates mit Id, installierter und neuer Version; markiert die Zeilen im Tab Software |
| Netzwerkinfo | nur lesend | aktive Adapter mit IPv4, Praefix, Gateway, DNS, DHCP, MAC, Verbindungsart, SSID; Domaene, Proxy |
| Speicherinfo | nur lesend | alle festen Laufwerke mit Belegung und Zustand, physische Datentraeger mit SSD/HDD, Bus, Groesse, Zustand, Firmware |
| Lokale Administratoren | nur lesend, **personenbezogen** | Mitglieder der Gruppe Administratoren mit Herkunft, Klasse, SID, Status; Entra-Konten verlinkt |
| Akkuzustand | nur lesend | Gesundheit (Vollladung zu Auslegung), Zyklen, Ladestand, Status je Akku; Desktops und VMs melden "kein Akku" |

**Deinstallieren ohne winget** (Tab Software, Zeilen ohne winget-Id): Job
`device.app-uninstall` mit Vorschau und Audit. Das Einmalskript sucht den
Eintrag unter den Uninstall-Schluesseln (64 Bit, 32 Bit, geladene
Benutzerprofile) mit genau diesem Anzeigenamen, bei mehreren Treffern mit
der Version, und deinstalliert still: MSI per `msiexec /x /qn`,
`QuietUninstallString`, Inno Setup, NSIS und InstallShield mit ihren
Schaltern (Engine wird an Dateinamen und Signatur im Deinstaller erkannt).
Ein EXE-Deinstaller ohne bekannten stillen Schalter wird nicht gestartet;
der Job meldet den gefundenen Befehl, und im Dialog lassen sich Argumente
nachreichen. Zeitlimit 15 Minuten, danach wird der Deinstaller beendet.
Store-/MSIX-Pakete (Paketnamen wie `5319275A.WhatsAppDesktop`) entfernt
`Remove-AppxPackage -AllUsers` samt Bereitstellung. Exit-Codes 3010 und
1641 gelten als Erfolg mit Neustartbedarf, 1605 als "war nicht
installiert".

### Neustart mit Vorwarnung

Im Geraetekopf plant **Neustart planen** einen Neustart mit Frist (1 bis
24 Stunden), Verschiebungen (0 bis 5, je 15 bis 480 Minuten) und einem
Text fuer den Benutzer; **Neustart abbrechen** nimmt alles zurueck. Beides
sind Jobs mit Vorschau, Begruendung und Audit (`device.restart-prompt`,
`device.restart-cancel`). Das Einmalskript legt auf dem Geraet den Antrag
unter `HKLM\SOFTWARE\ZeroStress\Restart` ab (Benutzer duerfen nur den
Verschiebezaehler aendern), schreibt zwei Skripte nach
`%ProgramData%\ZeroStress\restart` und registriert zwei Aufgaben:
`ZSC-Restart-Prompt` laeuft interaktiv fuer die Gruppe Benutzer bei der
Anmeldung und im Verschiebetakt und zeigt den Dialog mit "Jetzt neu
starten" (`shutdown /r /t 30`) und "Spaeter"; `ZSC-Restart-Deadline`
laeuft als SYSTEM zur Frist, prueft die Startzeit des Geraets und startet
nur neu, wenn seit dem Planen kein Neustart war (`shutdown /r /f /t 120`),
dann raeumt es Aufgaben und Eintrag auf. Ein Dialog, der fuenf Minuten
ohne Antwort bleibt, schliesst sich und zaehlt nicht als Verschiebung. Der
harte **Neu starten** ueber Intune bleibt fuer Faelle ohne Benutzer.

### Admin auf Zeit (Ersatz fuer Endpoint Privilege Management)

Im Geraetekopf gewaehrt **Admin auf Zeit** einem Konto (Entra als
`AzureAD\name@domain`, lokal per Name oder SID) fuer 15 bis 240 Minuten
lokale Administratorrechte; **Admin entziehen** nimmt sie sofort zurueck.
Beides sind Jobs mit Vorschau, Begruendung ab zehn Zeichen und Audit. Die
Konsole fuellt eine geprueftes Vorlage mit Konto und Dauer, legt sie als
Einmalskript in Intune an, fuehrt sie auf Abruf aus und loescht sie danach.
Der Rueckbau laeuft als geplante Aufgabe (`ZSC-TempAdmin-<hash>`) als
SYSTEM auf dem Geraet, auch nach Neustart oder Offline-Phase. Anders als
EPM erhoeht das nicht einzelne Programme, sondern das Konto; danach das
Skript "Lokale Administratoren" zur Kontrolle ausfuehren.

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

## Vier-Augen-Prinzip (Einstellungen)

Unter **Einstellungen** (Speichern nur als Owner, Audit `settings.update`)
laesst sich das Vier-Augen-Prinzip einschalten: Jobs, deren Vorschau die
Schwelle an betroffenen Objekten erreicht (Vorschauzeilen, Geraete einer
Sammelaktion, Tenants eines Rollouts) oder deren Typ gelistet ist, brauchen
nach der ersten Freigabe eine zweite von einer anderen Person. Der Job
steht dann auf "Zweite Freigabe noetig", die Vorschau bleibt vier Stunden
gueltig, danach wird er abgebrochen. Dieselbe Person kann nicht beide
Freigaben erteilen; die API lehnt das ab. Beide Freigaben stehen im Audit
(`job.approve.first`, `job.approve.second`). Standard: aus, weil ein
einzelner Techniker sonst nichts mehr freigeben koennte. Voreingestellte
Typen: Sammelaktionen, Postfachtyp, Beweissicherung, Weiterleitung auf
Postfachebene, VM-Bereitstellung, Benutzer sperren, Passwort zuruecksetzen.
Braucht `npm run db:push` (Spalten `jobs.approvals`, `jobs.second_approval`,
`msp_organizations.settings`).

## Team und Tenant-Sichtbarkeit (Einstellungen)

Owner sehen alle Tenants des MSP. Engineer und Nur-lesen sehen nur die
Tenants, die ihnen unter **Einstellungen > Team** zugewiesen sind (Tabelle
`msp_user_tenants`); ohne Zuweisung ist die Konsole fuer sie leer. Die
Regel greift an einer Stelle fuer alles: Tenantliste, Tenantwechsel
(`X-Tenant-Id` eines fremden Tenants antwortet mit 404, nicht 403, damit
die Existenz nicht verraten wird), MSP-Dashboard, MCP-Server und Rollouts
(Tenants ausserhalb der Sichtbarkeit werden uebersprungen). Aendern kann nur
der Owner (`PUT /settings/team/:userId`, Audit `team.update` mit
Vorher/Nachher): Rolle, Zuweisungen, aktiv/deaktiviert. Der letzte aktive
Owner laesst sich nicht herabstufen, das eigene Konto nicht deaktivieren
oder in der Rolle aendern. Braucht `npm run db:push` (Tabelle
`msp_user_tenants`).

## Worker-Token (Einstellungen)

Build- und Exchange-Worker melden sich mit einem Token an, das unter
**Einstellungen > Worker-Token** angelegt wird (nur Owner, Audit
`worker-token.create`, `worker-token.revoke`). Der Klartext `zsw_...`
erscheint genau einmal in der Antwort; in `worker_tokens` liegt nur der
SHA-256 mit Bezeichnung, Erstelldatum, letzter Nutzung und Widerruf. Ein
Token gehoert zu genau einem MSP, und `claim`, `log`, `artifact` und
`complete` filtern nach diesem MSP: ein geleaktes Token eines MSP erreicht
nie Auftraege eines anderen. Pro Worker-Installation ein eigenes Token,
damit Widerrufen gezielt geht. `WORKER_TOKEN` in der API-Umgebung wird nur
noch als Uebergang akzeptiert und nur, solange genau ein aktiver MSP
existiert; die Einstellungsseite warnt, solange die Variable gesetzt ist.
Braucht `npm run db:push` (Tabelle `worker_tokens`).

## Produktivbetrieb

Entra-Registrierungen trennen, Conditional Access mit phishing-resistenter
MFA, Reverse Proxy mit TLS, Datenbank und Secrets: siehe
`docs/setup/production-hardening.md` mit Checkliste vor dem Freischalten.

## Sicherheits-Header, Rate-Limits, Groessenlimits

Die API setzt auf jeder Antwort Security-Header (CSP `default-src 'none'`,
`frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy:
no-referrer`; HSTS nur mit `NODE_ENV=production`, abschaltbar per
`HSTS_DISABLED=true`, solange TLS fehlt). Das Web setzt in
`next.config.js` eine CSP (Skripte und Styles nur von sich selbst,
Verbindungen nur zur API und zu login.microsoftonline.com, kein Einbetten),
`X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` und in
Produktion HSTS. Im Dev-Modus erlaubt die CSP zusaetzlich `unsafe-eval`
und WebSockets fuer Hot Reload.

Rate-Limits je Minute, im Speicher der API-Instanz (bei mehreren Instanzen
muss der Zaehler nach Redis, siehe Backlog):

| Bereich | Limit | Schluessel |
|---|---|---|
| `/auth/*` | 20 | Client-IP |
| `/worker/*` | 300 | Worker-Token (Hash) |
| `/mcp` | 120 | Bearer-Token (Hash) |
| Job-Freigabe | 30 | Bearer-Token (Hash) |
| uebrige API | 600 | Bearer-Token (Hash), sonst Client-IP |

Ueberschreitung antwortet mit 429, Problemtyp `rate-limited`,
`Retry-After` und `RateLimit-*`-Headern; die Oberflaeche zeigt "Zu viele
Anfragen". Die Client-IP kommt vom Socket; hinter einem Reverse Proxy
`TRUST_PROXY=true` setzen, dann zaehlt `X-Forwarded-For`. Fuer Lasttests
schaltet `RATE_LIMIT_DISABLED=true` alle Limits ab.

Groessenlimits: JSON-Anfragen hoechstens 1 MB (413, Problemtyp
`payload-too-large`); die Upload-Pfade fuer Installer und Artefakte
(`PUT /packages/:id/installer|artifact`, `PUT /worker/builds/:id/artifact`)
erlauben 4 GB.

## Anmeldung und Sitzung

Der Browser holt per Authorization Code mit PKCE nur den Code; die API
tauscht ihn mit dem Client-Secret ein, prueft das ID-Token (Aussteller
und Tenant muessen `ENTRA_TENANT_ID` entsprechen, Zielgruppe
`ENTRA_CLIENT_ID`), legt den Benutzer an oder findet ihn und setzt das
Cookie `zsc_session` (httpOnly, SameSite=Lax, Secure in Produktion). Im
Browser liegen keine Tokens. Serverseitig steht in `user_sessions` nur
der SHA-256 der Sitzungs-Id mit Benutzer, Laufzeiten, IP-Hash und
gekuerztem User-Agent. Laufzeit `SESSION_TTL_HOURS` (12), Leerlauf
`SESSION_IDLE_MINUTES` (120); Abmelden widerruft die Sitzung. Anmelden
und Abmelden stehen im Audit (`auth.login`, `auth.logout`).

Schreibende Anfragen mit Cookie brauchen den Header
`X-Requested-With: ZeroStress` und einen Origin aus der erlaubten Liste
(`NEXT_PUBLIC_APP_URL`, localhost); der API-Client des Web setzt den
Header. Web und API muessen same-site laufen: gleicher Host (Reverse
Proxy mit `/api`) oder Subdomains derselben Domain, sonst schickt der
Browser das Cookie nicht mit. Deaktivierte Konten (Einstellungen > Team)
werden bei jeder Anfrage abgewiesen.

Bearer-Tokens von Entra funktionieren weiterhin fuer MCP-Clients und
Skripte (gleiche Pruefung, ohne Cookie). Braucht `npm run db:push`
(Tabelle `user_sessions`).

## Audit-Log unveraenderlich

Jeder Audit-Eintrag traegt den SHA-256 seines Vorgaengers (je MSP) und
seinen eigenen Hash ueber die fachlichen Felder; die API schreibt ihn in
einer Transaktion mit Sperre je MSP. **Kette pruefen** auf der Audit-Seite
(nur Owner, `GET /tenants/:id/audit/verify`) rechnet alle Eintraege nach
und nennt die erste Stelle, an der etwas nicht passt. Eintraege aus der
Zeit vor der Kette zaehlen als "aeltere ohne Hash". Braucht `npm run
db:push` (Spalten `audit_entries.prev_hash`, `entry_hash`).

Zusaetzlich schuetzt die Datenbank selbst: `npm run db:harden` legt
Trigger an, die UPDATE, DELETE und TRUNCATE auf `audit_entries` ablehnen,
unabhaengig von der Rolle (idempotent, nach jedem `db:push` unschaedlich).
Fuer Produktion steht in `apps/api/db/harden.sql` das Muster fuer eine
eigene API-Rolle ohne UPDATE/DELETE auf dem Audit-Log, damit ein
kompromittierter API-Prozess den Trigger nicht entfernen kann.

## Secrets aus Key Vault, Zertifikat statt Client-Secret

Mit `KEY_VAULT_URL` laedt die API beim Start alle bekannten Secrets, die in
der Umgebung fehlen, ueber Managed Identity (lokal: Azure CLI-Login) aus dem
Vault: `ENTRA-CLIENT-SECRET`, `ENTRA-CLIENT-CERTIFICATE-PEM`, `JWT-SECRET`,
`RESULT-ENCRYPTION-KEY`, `GITHUB-TOKEN`, `ANTHROPIC-API-KEY`, `NVD-API-KEY`,
`TEAMVIEWER-API-TOKEN`, `WORKER-TOKEN` (Namen mit Bindestrich). Die
Umgebung hat Vorrang; fehlt ein Secret in beiden, startet die API nicht
(Anmeldedaten, `JWT_SECRET`) oder die Funktion bleibt aus (optionale).
`DATABASE_URL` bleibt in der Umgebung, weil die Datenbank vor dem Vault
gebraucht wird; in Azure ueber App-Service-Key-Vault-Referenz oder
Managed-Identity-Login an Postgres.

Anmeldung der App-Registrierung an Entra: Zertifikat vor Client-Secret.
`ENTRA_CLIENT_CERTIFICATE_PEM` (Text) oder `_PATH` (Datei) mit Zertifikat
und privatem Schluessel; die API bildet daraus `client_assertion` fuer den
Login-Tausch und uebergibt MSAL Thumbprint und Schluessel fuer die
app-only-Tokens. Selbstsigniertes Zertifikat erzeugen und in der
App-Registrierung unter "Zertifikate & Geheimnisse" den oeffentlichen Teil
hochladen:

```powershell
openssl req -x509 -newkey rsa:3072 -sha256 -days 730 -nodes -subj "/CN=zerostress-cockpit" -keyout zsc.key -out zsc.crt
type zsc.crt zsc.key > zsc.pem      # Wert fuer ENTRA_CLIENT_CERTIFICATE_PEM / Key Vault
```

Der private Schluessel gehoert in den Key Vault, nie ins Repo. In
Produktion warnt die API beim Start, wenn noch ein Client-Secret in
Gebrauch ist.

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
| `Group.ReadWrite.All` | Mitglieder und Besitzer von Gruppen aendern (Gruppe > Mitglied hinzufuegen/entfernen, Benutzer > Gruppen > Entfernen), Bereitstellungsgruppen je App anlegen | Jobs schlagen mit 403 fehl |
| `Policy.Read.All` | Best-Practice-Checks: Conditional Access, Sicherheitsstandards, Authentifizierungsmethoden, Autorisierungsrichtlinie (Sicherheit > Best Practices) | Betroffene Checks "nicht pruefbar" |
| Defender `AdvancedQuery.Read.All` | Netzwerkverbindungen aus Advanced Hunting (Geraet > Verbindungen, Netzwerk > Kommunikation der Clients); braucht Defender for Endpoint Plan 2, Defender for Business hat kein Advanced Hunting | Karte "Berechtigung fehlt" bzw. "nicht lizenziert" |
| `MailboxSettings.ReadWrite` | Postfachdetail: Abwesenheit, Zeitzone, Posteingangsregeln lesen; Jobs Abwesenheit setzen, Weiterleitungsregel anlegen, Regel aktivieren/deaktivieren/loeschen; Weiterleitungs-Scan (Exchange > Postfach) | Karte "Berechtigung fehlt" im Postfachdetail, Jobs schlagen mit 403 fehl |
| `Organization.Read.All` (optional) | Verifizierte Domaenen des Tenants fuer die Einstufung "externe Weiterleitung"; fehlt sie, gelten die Domaenen der Postfaecher als intern | Einstufung etwas grober |

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
