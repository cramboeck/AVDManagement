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
| 4 | Softwareinventar + winget-Gegencheck | Intune `detectedApps`; Bibliotheksskript `winget-updates` auf dem Geraet | Umgesetzt je Geraet (Tab Software): Inventar aus Intune, winget-Pruefung als Skriptlauf, Markierung der Zeilen. Offen: tenant-uebergreifende Sicht, geschlossene CVEs je Update, Update installieren als Job |
| 5 | Automatische Deployments (Apps-Plan Stufen C/D) | Worker, Paketkatalog, Azure Storage EU | Teilweise umgesetzt: winget-Katalog als Installerquelle, taegliche Versionspruefung, neue Version als Paket auf Knopfdruck. Offen: Ringe, automatischer Rollout per Regel, Verknuepfung des Geraete-Update-Checks mit dem Katalog |
| 6 | Bestands-Cache: Snapshot je Tenant in Postgres, Sync-Worker, "Stand vor n Minuten" | — | Umgesetzt fuer Geraete und Schwachstellen (`inventory_snapshots`, Queue `inventory-sync`). Offen: Benutzer, tenant-uebergreifende Sichten auf dem Snapshot |
| 9 | Admin auf Zeit und Akkuzustand | vorhandene Berechtigungen | Umgesetzt: Jobs `device.temp-admin` und `device.temp-admin-revoke` mit Einmalskripten und Rueckbau-Aufgabe auf dem Geraet; Skript Akkuzustand. Offen: Admin auf Zeit fuer AVD-Hosts ueber Run Command, Verlauf aktiver Gewaehrungen als Liste |
| 7 | Remote-Befehle ohne eigenen Agent: Skriptbibliothek, Intune Remediations auf Abruf, Azure Run Command, Defender Live Response | `DeviceManagementConfiguration.ReadWrite.All`, VM Contributor, Defender `Machine.LiveResponse` | R1 und R2 umgesetzt: sechs Skripte (Update-Stand, Update-Scan, Systeminfo, winget, Netzwerk, Speicher), Jobs `device.run-script` und `avd.run-script`, Tab Skripte und Knopf "Skript" je Session-Host. Offen: R3 Live Response (im Partnertenant aktiviert), R4 Bulk, Signatur der Skripte |
| 10 | Software je Geraet: Katalog-Erkennung und winget-Aktionen | Intune `detectedApps`, Skript `winget-updates`, Job `device.winget-install` | Umgesetzt: Zeilen im Tab Software gegen Basis-Set und eigene Pakete zugeordnet; "Update installieren" und "Aus dem Basis-Set installieren" als Job mit Einmalskript (winget im Maschinenkontext); "Als Paket anlegen" springt mit vorbelegter Id in den Katalog. Offen: vollstaendiges winget-Inventar (Ausgabegrenze 2048 Zeichen der Remediations), Sammelaktion ueber mehrere Geraete |
| 11 | Kommunikation der Clients: Ziele aus Defender Advanced Hunting | Defender for Endpoint Plan 2, `AdvancedQuery.Read.All` | Umgesetzt: Tab Verbindungen je Geraet und Abschnitt "Kommunikation der Clients" (extern/intern) auf der Netzwerkseite, je Ziel Host, Ports, Prozesse, Richtung, Geraetezahl. Defender for Business liefert keine Advanced-Hunting-Daten. Regelvorschlag Firewall (ausgehend) mit Abgleich gegen die M365-Endpunktliste und bekannte Hersteller, CSV-Export. Offen: Zeitverlauf, Import als Windows-Firewall- oder Fortigate-Regelsatz |
| 12 | Azure-VMs aus dem Portal verwalten und aus Vorlagen bereitstellen | ARM/Bicep-Vorlagen, VM Contributor, `Microsoft.Compute` | Roadmap: Start/Stop/Neustart/Groesse aendern als Jobs, Bereitstellung neuer VMs aus versionierten Vorlagen (Bicep im Repo, Parameter je Kunde), Kostenschaetzung vor der Freigabe, Tags und Naming aus dem Manifest; AVD-Sitzungshosts als erster Anwendungsfall |
| 8 | Remotehilfe: TeamViewer-Start aus dem Geraetekopf, spaeter RustDesk hinter demselben Interface | TeamViewer-API-Token (`TEAMVIEWER_API_TOKEN`, spaeter Key Vault) | H1 umgesetzt, mit echtem Token zu testen. Offen: H2 Sitzungscodes (Service-Queue), H3 RustDesk |

## Naechste Module

| Thema | Datenquelle | Voraussetzung | Notiz |
|---|---|---|---|
| AVD Image-Management A: Gallery-Inventar, "veraltet"-Badge je Host | ARM: Compute Gallery, VM storageProfile | Reader auf Subscription | Offene Fragen: Image-Quelle heute, Update-Methode, Gallery-Topologie |
| AVD Image-Management B: Versions-Lifecycle als Jobs | ARM Gallery Image Versions | Contributor auf Gallery-RG | Preview zwingend |
| AVD Image-Management C: Builds ueber Azure VM Image Builder | ARM Image Templates | Managed Identity im Kundentenant | Statt eigenem Packer-Container: kein Secret verlaesst den Tenant |
| AVD Image-Management D: Rollout auf Host Pool | AVD + Compute | wie oben | Drain -> Sessions -> Reimage -> Validierung -> Undrain, Batches |
| Alerts: Anmelde-Anomalien | Graph signIns (P1) | AuditLog.Read.All, optional Mail.Send im Partnertenant | Umgesetzt: sechs Regeln, Takt 10 Min, Seite Alerts, Dashboard-Kachel, Mail optional. Offen: Teams-Kanal, Schwellwerte je Tenant, Regeln fuer Verzeichnisaenderungen |
| Intune-Geraete | Graph deviceManagement/managedDevices | DeviceManagementManagedDevices.Read.All | Beta-Scope: Sync, Compliance, Neustart, Suche, Wipe/Retire |
| Apps (Application Management) | Graph deviceAppManagement, eigener Paketkatalog, Windows-Build-Worker | DeviceManagementApps.ReadWrite.All, Group.ReadWrite.All, Azure Storage EU | A bis C umgesetzt: Seite Apps, Detail mit Geraetestatus, Jobs assign/unassign/create-deployment-groups, Katalog mit Manifest und Artefaktspeicher, Upload-Pipeline als Job apps.publish, Rollout auf N Tenants. D Build-Worker (PowerShell, PSADT v4, IntuneWinAppUtil) mit Auftragsqueue und Worker-Token umgesetzt; offen: zip-Installer, Transforms, Signierung mit Zertifikat |
| Defender | Graph security/alerts_v2, incidents; Defender for Endpoint API | SecurityAlert.Read.All, eigene Consent fuer MDE | Zweite API-Welt, eigener Consent-Flow |
| Exchange-Postfaecher | Graph reports/getMailboxUsage*, Graph mailboxSettings und messageRules, EXO-Worker fuer den Rest | Reports.Read.All, MailboxSettings.ReadWrite | Umgesetzt: Seite Exchange mit Groesse, Kontingent, Aktivitaet, Archiv (Snapshot 6 h); Postfachdetail mit Abwesenheit, Aliassen, Posteingangsregeln; Jobs Abwesenheit setzen, Weiterleitungsregel anlegen, Regel aktivieren/deaktivieren/loeschen; Weiterleitungs-Scan ueber alle Postfaecher. Offen (Exchange-Worker, Plan): Kontingente, Weiterleitung auf Postfachebene, Vollzugriff/Senden als, Archiv, Umwandlung freigegeben, Aufbewahrung |
| Mail-Statistiken | Graph reports/getEmailActivity* | Reports.Read.All | Umgesetzt: Volumen je Tag und je Postfach (30 Tage). Offen: Trend ueber laengere Zeitraeume, tenant-uebergreifend |
| Hornetsecurity | Hornetsecurity REST-API | API-Key je Kunde im Key Vault | Spam-/Quarantaene-Kennzahlen |
| SharePoint/Teams: extern geteilte Inhalte | Graph reports (SharePoint/OneDrive), spaeter sites/drives permissions | Reports.Read.All (vorhanden); Sites.Read.All fuer Dateiliste | Umgesetzt: Seite SharePoint mit Websites (anonyme Links, Gastlinks, Speicher, Aktivitaet) und extern teilenden Benutzern. Offen: Freigabeliste je Datei, Link widerrufen als Job |
| Teams-/M365-Gruppen | Graph groups, members, owners | Directory.Read.All (vorhanden) | Umgesetzt: Seite Gruppen mit Snapshot, Auffaelligkeiten (ohne Besitzer, ein Besitzer, oeffentliches Team, Gaeste, dynamisch, leer), Detail mit Besitzern und Mitgliedern. Mitglieder und Besitzer als Jobs mit Vorschau und Audit umgesetzt. Offen: Gruppe anlegen/loeschen, Freigaben je Gruppe |
| Security-Baselines | Graph policies (CA, Auth-Methoden), Secure Score, DNS | Policy.Read.All | Umgesetzt als Best-Practice-Checks (18 Checks, Erfuellungsgrad, Belege). Offen: tenant-uebergreifende Sicht, Drift ueber Zeit, Checks als Job mit Behebung |
| Monitoring AVD Ebene 2/3 | Azure Monitor Metrics, Log Analytics | Monitoring Reader | Siehe docs/design/avd-monitoring-concept.md |
| MCP-Server | eigene API | Entra-Login, Job-Modell | Umgesetzt: `POST /mcp` mit 13 Werkzeugen, Preview und Freigabe als getrennte Schritte, Audit. Offen: Server-Streaming (SSE), Ressourcen statt nur Werkzeuge |
