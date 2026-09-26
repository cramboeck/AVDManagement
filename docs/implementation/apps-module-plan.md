# Modul "Apps" (Application Management) — Plan

Status: Stufen A, B und C umgesetzt (Bestand, Installationsstatus,
Zuweisungen als Jobs, Bereitstellungsgruppen, Paketkatalog mit Manifest
und Artefaktspeicher, Upload-Pipeline als Job `apps.publish`, Rollout auf
N Tenants) sowie Stufe D (Windows-Build-Worker in `apps/worker-windows`,
Auftraege in `build_jobs`, Endpunkte unter `/worker` mit `WORKER_TOKEN`,
PSADT-v4-Wrapper aus `templates/`, Bauplan `BuildPlan` aus dem Manifest).
Offen aus D: zip-Installer, Transforms, Signierung ist vorgesehen, aber
ohne Zertifikat inaktiv. Grundlage:
Modul-Standard (`docs/backlog.md`) und die Analyse von PackageFactory und
CloudManagementPortal (beide MIT, eigener Code des Auftraggebers).

Entscheidungen (freigegeben): Reihenfolge A -> B -> C -> D; erst fertige
`.intunewin` hochladen, dann Worker; Ablage Cockpit-DB plus Azure Blob EU
(lokal: Ordner); Detection-Praefix pro MSP; Portal-Apps nur anzeigen;
winget als Katalogtyp; Code-Signierung spaeter.

Umgesetzt in C2: `.intunewin`-Leser (ZIP-Zentralverzeichnis + inflateRaw)
liest `Detection.xml` und die innere `Contents/IntunePackage.intunewin`;
`publishWin32App` faehrt den Automaten unten mit Fortschrittsmeldung je
Schritt; `apps.publish` ueberspringt bereits veroeffentlichte Tenants und
schreibt Status/Fehler nach `app_deployments`; `POST /packages/:id/rollout`
legt je Tenant einen Job an (optional sofort freigegeben).

## Aus der zweiten Durchsicht der Repos (Stand Umsetzung A/B)

Uebernommen in A/B:
- Zuweisung als "lesen, zusammenfuehren, ersetzen" (`mergeAssignments`),
  weil `/assign` die komplette Liste ersetzt; PackageFactory schickte die
  bestehenden Ziele unveraendert mit.
- Drei Bereitstellungsgruppen je App mit Namensvorschau; anders als in
  PackageFactory mit Duplikatpruefung ueber den Anzeigenamen und als Job
  mit Preview statt Sofortaktion.
- Fehlercode-Tabelle fuer den Installationsstatus, erweitert und auf Deutsch.

Fuer Stufe C vorgemerkt (mit den in PackageFactory gefundenen Fehlern korrigiert):
- Registry-Erkennung: `keyPath` muss mit `HKEY_LOCAL_MACHINE\` beginnen,
  nicht mit `SOFTWARE\`; Erkennung auf den Wert `Installed = Y` statt
  "Schluessel existiert", sonst gilt eine deinstallierte App als installiert.
- Der Erkennungsschluessel muss aus demselben Bezeichner entstehen wie im
  Installationsskript (kein Parsen von Ordnernamen).
- Commit-Aufruf ohne `@odata.type` in `fileEncryptionInfo`; die innere Datei
  `Contents/IntunePackage.intunewin` hochladen, nicht das aeussere Zip.
- Upload als Job mit Zustandsautomat, nicht in einem HTTP-Request.
- CloudManagementPortal: Token-Cache je Scope uebernommen, aber mit
  TenantId im Schluessel (bereits so in `TokenProvider`).

Nicht uebernommen: eigene Datei-Endpunkte ohne Authentifizierung,
Gruppenloeschen ohne Bestaetigung, Supersedence bleibt Roadmap.

## Ziel

Ein MSP verwaltet Anwendungen nicht pro Tenant im Intune-Portal, sondern
einmal im Cockpit: Bestand und Installationsstatus ueber alle Tenants,
Zuweisungen als nachvollziehbare Jobs, ein Paketkatalog mit typisiertem
Manifest und der Rollout "ein Paket -> N Tenants" mit Fortschritt je Tenant.

## Aus PackageFactory uebernommen (Konzepte, kein Code)

- Install- und Detection-Logik entstehen aus **einem** Manifest, nie
  getrennt gepflegt. Detection-Schluessel
  `HKLM\SOFTWARE\<Prefix>_IntuneAppInstall\Apps\<Vendor-Name-Version-Lang-Rev-Arch>`.
- Intune-Upload als Zustandsautomat: App anlegen -> Content-Version ->
  Datei anlegen -> auf `azureStorageUriRequestSuccess` warten -> Blob in
  6-MB-Bloecken -> Blockliste -> Commit mit `fileEncryptionInfo` aus
  `Detection.xml` -> auf `commitFileSuccess` warten -> `committedContentVersion`.
- Zuweisung als "lesen -> zusammenfuehren -> ersetzen", weil `/assign`
  die komplette Liste ersetzt.
- Explizite Return-Code-Zuordnung (Erfolg, Neustart, Wiederholen) als Standard.

Nicht uebernommen: Manifest aus Ordnernamen parsen, Secrets im Klartext,
ungeschuetzte API, fehlende Versionslogik.

## Stufen

### A. Inventar (lesend)

- Graph: `deviceAppManagement/mobileApps` mit `$filter=isof(...)` fuer
  `win32LobApp`, `windowsMobileMSI`, `winGetApp`, `officeSuiteApp`,
  `microsoftStoreForBusinessApp`; `installSummary`; `deviceStatuses` und
  `userStatuses` pro App; `assignments` mit Zielgruppe und Intent.
- Berechtigung: `DeviceManagementApps.Read.All`, fuer Gruppennamen
  `Group.Read.All`.
- UI: Liste (Name, Typ, Version, Zuweisungen, installiert/fehlgeschlagen/
  ausstehend), Detail mit Tabs Uebersicht / Geraete / Zuweisungen /
  Verlauf / Jobs. Tenant-uebergreifend: Matrix App x Tenant x Version.
- Cache: Bestand je Tenant fuer 5 Minuten, damit Detailaufrufe nicht den
  gesamten Katalog neu laden (gleiche Loesung dann fuer Geraete).

### B. Zuweisungen als Jobs

- `apps.assign`, `apps.unassign` mit Payload {appId, groupId, intent,
  settings}. Preview zeigt die vollstaendige Zuweisungsliste vorher/nachher
  und warnt bei "erforderlich" fuer grosse Gruppen.
- Berechtigung: `DeviceManagementApps.ReadWrite.All`.

### C. Paketkatalog und Upload

- Tabelle `app_packages` (pro MSP): Manifest als typisiertes JSON
  (Schema versioniert), Artefakt-Referenz (Blob-URL, SHA-256, Groesse),
  Erstellt von/wann, Quelle (manuell/Worker).
- Tabelle `app_deployments`: Paket x Tenant x Intune-App-Id, Status,
  Content-Version, Zeitpunkte. Basis fuer die Matrix und fuer Updates.
- Manifest-Felder: vendor, name, version, architecture, language,
  revision, installerType (msi/exe/psadt), installCommand, uninstallCommand,
  detection (registry/msi/file/script), requirements (OS-Build, Arch,
  Disk, RAM), returnCodes, restartBehavior, icon, description, publisher,
  informationUrl, privacyUrl, owner, notes.
- Upload-Pipeline in Node nach dem Automaten oben; Jobs
  `apps.publish` (ein Tenant) und `apps.rollout` (N Tenants, Kette mit
  Fortschritt und Abbruch je Tenant).
- Ablage: Azure Blob Storage in der EU, Zugriff ueber Managed Identity,
  keine SAS-Schluessel im Repo.

### D. Build-Worker (Windows)

- Eigener Dienst, PowerShell 5.1-kompatibel, ASCII-only, ohne Aliase.
- Vertrag: `POST /builds` mit Manifest und Installer-Referenz ->
  Worker erzeugt PSADT-Wrapper und Detection aus demselben Template-
  Woerterbuch, ruft `IntuneWinAppUtil.exe` auf, laedt das Artefakt in die
  Ablage, meldet SHA-256 und Detection-Info zurueck. Die API fuehrt die
  Job-Kette fort (Upload, Zuweisung).
- Option: PackageFactory bekommt diesen Vertrag und wird der Worker.

### Spaeter

Versionserkennung (Evergreen, winget als Quellen), Supersedence,
Rollout in Ringen (Pilot -> Breit), automatische Aktualisierung bei
neuer Version mit Preview der betroffenen Tenants.

## Entschieden

1. Reihenfolge A -> B -> C -> D.
2. Zuerst fertige `.intunewin`-Dateien hochladen (C), dann der Worker (D).
   PackageFactory wird nicht angebunden; der Worker entsteht im Monorepo.
3. Paketablage: Cockpit-DB plus Azure Blob Storage (EU), lokal ein Ordner.
4. Detection-Praefix pro MSP (`APP_DETECTION_PREFIX`).
5. Im Portal angelegte Apps werden nur angezeigt, nicht importiert.
6. winget ist ein Katalogtyp ohne Artefakt.
7. Code-Signierung der PSADT-Skripte kommt spaeter (Worker sieht den
   Haken vor, Zertifikat bleibt ausserhalb des Repos).
