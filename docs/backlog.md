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
- Offen: Inventar-Cache (jeder Detailaufruf laedt heute den ganzen Bestand), Isolieren/Freigeben ueber Defender (`Machine.Isolate`), Retire/Wipe mit verschaerfter Preview, Softwareinventar, tenant-uebergreifende Sicht "kritische Luecken aelter als 30 Tage"

## Naechste Module

| Thema | Datenquelle | Voraussetzung | Notiz |
|---|---|---|---|
| AVD Image-Management A: Gallery-Inventar, "veraltet"-Badge je Host | ARM: Compute Gallery, VM storageProfile | Reader auf Subscription | Offene Fragen: Image-Quelle heute, Update-Methode, Gallery-Topologie |
| AVD Image-Management B: Versions-Lifecycle als Jobs | ARM Gallery Image Versions | Contributor auf Gallery-RG | Preview zwingend |
| AVD Image-Management C: Builds ueber Azure VM Image Builder | ARM Image Templates | Managed Identity im Kundentenant | Statt eigenem Packer-Container: kein Secret verlaesst den Tenant |
| AVD Image-Management D: Rollout auf Host Pool | AVD + Compute | wie oben | Drain -> Sessions -> Reimage -> Validierung -> Undrain, Batches |
| Alerts: Anmelde-Anomalien | Graph signIns (P1) | AuditLog.Read.All | Regeln: n Fehlversuche/Benutzer/Zeitfenster, neues Land, Legacy-Auth, Risiko. Kanal: E-Mail/Teams. Regel-Engine als Job |
| Intune-Geraete | Graph deviceManagement/managedDevices | DeviceManagementManagedDevices.Read.All | Beta-Scope: Sync, Compliance, Neustart, Suche, Wipe/Retire |
| Intune-Apps | Graph deviceAppManagement | DeviceManagementApps.Read.All | Zuordnung, Installationsstatus; kein Paketieren (PatchMyPC/RoboPack) |
| Defender | Graph security/alerts_v2, incidents; Defender for Endpoint API | SecurityAlert.Read.All, eigene Consent fuer MDE | Zweite API-Welt, eigener Consent-Flow |
| Exchange-Postfaecher | Graph reports/getMailboxUsage*, EXO PowerShell fuer Einstellungen | Reports.Read.All | Postfachgroesse, Weiterleitungen, Delegierungen |
| Mail-Statistiken | Graph reports/getEmailActivity* | Reports.Read.All | Volumen pro Tenant/Benutzer, Trend |
| Hornetsecurity | Hornetsecurity REST-API | API-Key je Kunde im Key Vault | Spam-/Quarantaene-Kennzahlen |
| SharePoint/Teams: extern geteilte Inhalte | Graph sites, drives permissions; sharing reports | Sites.Read.All | Anonyme Links, externe Gaeste je Site/Team |
| Security-Baselines | Graph policies (CA, Auth-Methoden), Secure Score | Policy.Read.All, SecurityEvents.Read.All | Soll/Ist-Abgleich je Tenant, Drift-Anzeige; keine CIPP-Vorlagen |
| Monitoring AVD Ebene 2/3 | Azure Monitor Metrics, Log Analytics | Monitoring Reader | Siehe docs/design/avd-monitoring-concept.md |
| MCP-Server | eigene API | Entra-Login, Job-Modell | Duenne Schicht ueber denselben Endpunkten inkl. Preview und Audit |
