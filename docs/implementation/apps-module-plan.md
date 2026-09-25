# Modul "Apps" (Application Management) — Plan

Status: Entwurf, noch nicht freigegeben. Grundlage: Modul-Standard
(`docs/backlog.md`) und die Analyse von PackageFactory (MIT, eigener Code).

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

## Offene Entscheidungen

1. Reihenfolge A -> B -> C -> D freigeben?
2. PackageFactory als Build-Worker ausbauen oder zunaechst nur fertige
   `.intunewin`-Dateien hochladen?
3. Paketablage: Cockpit-DB + Azure Storage (EU), oder bestehende
   Infrastruktur?
4. Detection-Praefix pro MSP (`CompanyPrefix`) oder pro Kunde?
5. Umgang mit Apps, die nicht aus dem Katalog stammen (im Portal
   angelegt): nur anzeigen oder in den Katalog importieren?
