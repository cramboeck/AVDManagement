# Backlog

Reihenfolge: ein Modul komplett nach dem Modul-Standard, dann das naechste.
Jeder Eintrag nennt Datenquelle und Voraussetzung, damit Aufwand und Risiko
vor dem Bau klar sind.

## Modul-Standard (gilt fuer jedes Modul)

1. Objektliste: Suche, Filter, Statusspalte, Mehrfachauswahl, Zeile oeffnet Detail; optional ueber alle Tenants.
2. Objekt-Detail: Kopf mit Identitaet, Status, primaeren Aktionen; Tabs Uebersicht / Beziehungen / Sicherheit / Verlauf / Jobs.
3. Aktions-Workflow: Aktion -> Preview -> Bestaetigen -> Job mit Live-Status -> Ergebnis. Einzeln und Bulk identisch.
4. Berechtigungs- und Lizenz-Zustaende (P1 fehlt, Scope fehlt) als eigene Karten mit naechstem Schritt, nie als Fehler.
5. Cmd+K erreicht jedes Objekt und jede Aktion.
6. Audit fuer jede Aktion und jeden Blick in personenbezogene Protokolle.

## In Arbeit: Identity (Referenzmodul)

- Benutzerdetail mit Profil, Lizenzen, Gruppen, MFA-Methoden, Anmeldungen, Entra-Audit
- Aktionen: deaktivieren/aktivieren, Sitzungen widerrufen, Passwort zuruecksetzen, Lizenz zuweisen/entziehen
- Sicherheitsseite: fehlgeschlagene Anmeldungen, Herkunft, Risiko, Legacy-Auth
- Offen: temporaeres Passwort liegt im Job-Ergebnis (DB). Folgeaufgabe: Einmal-Secret ueber Key Vault.

## In Arbeit: Geraete (Intune + Defender for Business)

- Bestand beider Quellen zusammengefuehrt ueber Entra-Geraete-ID, Detail mit Schwachstellen und fehlenden KBs
- Aktionen als Jobs: Sync, Neustart, Defender-Schnellscan
- Bestand liegt als Snapshot je Tenant vor (15 Min Geraete, 60 Min Schwachstellen), Detail und Sicherheitslage lesen daraus
- Offen: Isolieren/Freigeben ueber Defender (`Machine.Isolate`), Retire/Wipe mit verschaerfter Preview, Softwareinventar, tenant-uebergreifende Sicht "kritische Luecken aelter als 30 Tage" auf dem Snapshot

## Naechste Schritte (Reihenfolge vorgeschlagen)

| # | Thema | Voraussetzung | Notiz |
|---|---|---|---|
| 1 | Tabellen-Standard `DataTable`: Sortieren, Suche, Spaltenfilter, Seitengroesse, CSV, Spaltenauswahl, Einstellungen je Benutzer | — | Ausrollen auf Benutzer, Geraete, Jobs, Anmeldungen, Schwachstellen, Audit |
| 2 | Gesamtstatus mit Grafiken: Secure Score, Exposure Score, MFA-Abdeckung, Incidents; Verteilungen Compliance/Exposure/OS/CVE-Schwere/Anmeldungen | `SecurityEvents.Read.All`, `SecurityAlert.Read.All`, Defender `Score.Read.All` | Tenant-uebergreifend mit Mini-Trends |
| 3 | LAPS + BitLocker im Geraetedetail (Tab Wiederherstellung) | `DeviceLocalCredential.Read.All`, `BitLockerKey.Read.All`, LAPS mit Entra-Sicherung | Anzeige nur mit Begruendung, Engineer-Rolle, Audit, 60 s sichtbar; nie in Listen oder Logs |
| 4 | Softwareinventar + winget-Gegencheck | Defender `Software.Read.All`; Windows-Build-Worker mit winget; Zuordnung Produkt -> winget-ID | Installiert vs. aktuell, geschlossene CVEs je Update |
| 5 | Automatische Deployments (Apps-Plan Stufen C/D) | Worker, Paketkatalog, Azure Storage EU | Update -> Paket -> Preview -> Freigabe -> Ringe; Auto nur per Regel |
| 6 | Bestands-Cache: Snapshot je Tenant in Postgres, Sync-Worker, "Stand vor n Minuten" | — | Umgesetzt fuer Geraete und Schwachstellen (`inventory_snapshots`, Queue `inventory-sync`). Offen: Benutzer, tenant-uebergreifende Sichten auf dem Snapshot |
| 7 | Remote-Befehle ohne eigenen Agent: Skriptbibliothek, Intune Remediations auf Abruf, Azure Run Command, Defender Live Response | `DeviceManagementConfiguration.ReadWrite.All`, VM Contributor, Defender `Machine.LiveResponse` | R1 umgesetzt: drei Skripte, Job `device.run-script`, Tab Skripte. Offen: R2 Run Command fuer AVD-Hosts, R3 Live Response (im Partnertenant aktiviert), R4 Bulk, Signatur der Skripte |
| 8 | Remotehilfe: TeamViewer-Start aus dem Geraetekopf, spaeter RustDesk hinter demselben Interface | TeamViewer-API-Token im Key Vault | Plan Teil B; Konsole startet und protokolliert nur, kein eigener Sitzungsbroker |

## Naechste Module

| Thema | Datenquelle | Voraussetzung | Notiz |
|---|---|---|---|
| AVD Image-Management A: Gallery-Inventar, "veraltet"-Badge je Host | ARM: Compute Gallery, VM storageProfile | Reader auf Subscription | Offene Fragen: Image-Quelle heute, Update-Methode, Gallery-Topologie |
| AVD Image-Management B: Versions-Lifecycle als Jobs | ARM Gallery Image Versions | Contributor auf Gallery-RG | Preview zwingend |
| AVD Image-Management C: Builds ueber Azure VM Image Builder | ARM Image Templates | Managed Identity im Kundentenant | Statt eigenem Packer-Container: kein Secret verlaesst den Tenant |
| AVD Image-Management D: Rollout auf Host Pool | AVD + Compute | wie oben | Drain -> Sessions -> Reimage -> Validierung -> Undrain, Batches |
| Alerts: Anmelde-Anomalien | Graph signIns (P1) | AuditLog.Read.All | Regeln: n Fehlversuche/Benutzer/Zeitfenster, neues Land, Legacy-Auth, Risiko. Kanal: E-Mail/Teams. Regel-Engine als Job |
| Intune-Geraete | Graph deviceManagement/managedDevices | DeviceManagementManagedDevices.Read.All | Beta-Scope: Sync, Compliance, Neustart, Suche, Wipe/Retire |
| Apps (Application Management) | Graph deviceAppManagement, eigener Paketkatalog, Windows-Build-Worker | DeviceManagementApps.Read/ReadWrite.All, Azure Storage EU | Plan in docs/implementation/apps-module-plan.md; Stufen A Inventar, B Zuweisungen, C Katalog + Upload, D Build-Worker |
| Defender | Graph security/alerts_v2, incidents; Defender for Endpoint API | SecurityAlert.Read.All, eigene Consent fuer MDE | Zweite API-Welt, eigener Consent-Flow |
| Exchange-Postfaecher | Graph reports/getMailboxUsage*, EXO PowerShell fuer Einstellungen | Reports.Read.All | Postfachgroesse, Weiterleitungen, Delegierungen |
| Mail-Statistiken | Graph reports/getEmailActivity* | Reports.Read.All | Volumen pro Tenant/Benutzer, Trend |
| Hornetsecurity | Hornetsecurity REST-API | API-Key je Kunde im Key Vault | Spam-/Quarantaene-Kennzahlen |
| SharePoint/Teams: extern geteilte Inhalte | Graph sites, drives permissions; sharing reports | Sites.Read.All | Anonyme Links, externe Gaeste je Site/Team |
| Teams-/M365-Gruppen | Graph groups, teams, members, owners | Group.Read.All, Team.ReadBasic.All | Besitzerlose Gruppen, Gastanteil, oeffentliche Teams, externe Freigaben je Gruppe |
| Security-Baselines | Graph policies (CA, Auth-Methoden), Secure Score | Policy.Read.All, SecurityEvents.Read.All | Soll/Ist-Abgleich je Tenant, Drift-Anzeige; keine CIPP-Vorlagen |
| Monitoring AVD Ebene 2/3 | Azure Monitor Metrics, Log Analytics | Monitoring Reader | Siehe docs/design/avd-monitoring-concept.md |
| MCP-Server | eigene API | Entra-Login, Job-Modell | Duenne Schicht ueber denselben Endpunkten inkl. Preview und Audit |
