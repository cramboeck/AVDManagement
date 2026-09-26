# Changelog

Alle nennenswerten Aenderungen an ZeroStress Cockpit. Format angelehnt an
"Keep a Changelog"; bis zur ersten Beta gibt es nur den Abschnitt
"Unreleased". Aeltere Schritte stehen in der Git-Historie.

## Unreleased

### Hinzugefuegt

- Geraete: Skript `winget-inventory` liefert die winget-Ids installierter
  Software; der Tab Software ordnet sie den Zeilen zu und bietet je Zeile
  **Deinstallieren** per winget (Job `device.winget-install`, Modus
  uninstall) mit Vorschau und Audit; nicht zuordenbare Ids stehen in einem
  eigenen Abschnitt mit Deinstallieren-Knopf.
- Azure VMs: Seite mit Bestand aller Subscriptions (Zustand, Groesse,
  Image, AVD-Kennzeichen), Detailseite (Netzwerk, Datentraeger,
  Eigenschaften), Jobs Start, Stop (deallocate), Neustart, Groesse aendern
  mit Kostenvergleich; Bereitstellung aus versionierten ARM-Vorlagen
  (erste Vorlage windows-vm mit Trusted Launch und Entra-Join) mit
  ARM-Validierung und Kostenschaetzung in der Vorschau und versiegeltem
  Administratorpasswort im Ergebnis.
- Exchange: Worker `apps/worker-exchange` (Exchange Online PowerShell,
  app-only mit Zertifikat) sammelt Postfachdaten je Tenant (Kontingente,
  Weiterleitung auf Postfachebene, Vollzugriff, Senden als, Archiv,
  Beweissicherung, Outbound-Spam-Einstellung) und fuehrt Aenderungen als
  Jobs mit Vorschau aus: Kontingent, Weiterleitung, Vollzugriff, Senden
  als, Archiv aktivieren, Postfachtyp, Beweissicherung. Auftraege in
  `exchange_jobs`, Endpunkte `/worker/exchange`, Panel auf der Exchange-
  Seite und Abschnitt im Postfachdetail.
- Geraete: Tab Software ordnet Inventarzeilen dem winget-Katalog zu
  (eigene Pakete, Basis-Set); Job `device.winget-install` installiert oder
  aktualisiert ein Paket per winget auf dem Geraet (Einmalskript mit
  eingebetteter Id, Vorschau, Audit); "Als Paket anlegen" oeffnet den
  Katalog mit vorbelegter Id; Installation aus dem Basis-Set je Geraet.
- Geraete und Netzwerk: Verbindungsanalyse aus Defender Advanced Hunting
  (Tab Verbindungen je Geraet, Kommunikation der Clients extern/intern
  tenantweit) mit Host, Ports, Prozessen, Richtung und Geraetezahl.
- Netzwerk: Regelvorschlag fuer ausgehende Firewall-Regeln aus den externen
  Zielen, abgeglichen gegen die Microsoft-365-Endpunktliste (Kategorie,
  erforderlich) und bekannte Hersteller, mit Geraetezahl, Ports, Prozessen
  und CSV-Export.
- Roadmap: Azure-VMs verwalten und aus Vorlagen bereitstellen.
- Apps: winget als Installerquelle. Pakete vom Typ winget loesen ihr
  Manifest aus microsoft/winget-pkgs auf (Basis-Set, Blaettern nach
  Herausgeber, Id von Hand), der Worker laedt den Installer vom Hersteller,
  prueft den Hash und baut ein Win32-Paket mit PSADT-Wrapper. Taegliche
  Versionspruefung mit Hinweis im Paketdetail und "Neue Version anlegen".
  Neuer Typ store fuer Microsoft-Store-Produkt-Ids (bisheriges Verhalten).
- Exchange: Postfachdetail (Exchange > Postfach) mit Kennzahlen aus dem
  Bericht, Abwesenheit, Zeitzone, Aliassen und Posteingangsregeln live aus
  Graph; Jobs Abwesenheit setzen/ausschalten, Weiterleitungsregel anlegen,
  Regel aktivieren/deaktivieren/loeschen mit Vorschau, Warnung bei
  externen Zielen und Audit; Weiterleitungs-Scan ueber alle Postfaecher
  per $batch. Plan fuer den Exchange-Worker (Kontingente, Berechtigungen,
  Weiterleitung auf Postfachebene) in docs/implementation.
- Apps: Windows-Build-Worker (`apps/worker-windows`) mit Auftragsqueue
  `build_jobs`, Worker-Endpunkten unter `/worker` (Bearer `WORKER_TOKEN`),
  PSAppDeployToolkit-v4-Wrapper aus Manifest und Registry-Marker,
  `IntuneWinAppUtil.exe`, Artefakt-Upload mit Hashpruefung, Build-Liste im
  Paketdetail. PSADT-Pakete behalten den Wrapper als Intune-Kommandozeile,
  auch wenn Installer-Parameter gesetzt sind.
- Apps: Upload-Pipeline fuer Win32-Pakete nach Intune als Job
  `apps.publish` (App anlegen, Content-Version, Blob-Bloecke, Commit,
  Content-Version festschreiben) und Rollout eines Katalogpakets auf
  mehrere Tenants mit Vorschau, Freigabe und Status je Tenant.
- Apps: `.intunewin`-Leser fuer `Detection.xml` und die innere Nutzlast.
- API: Schema-Pruefung beim Start und in `GET /health`; fehlende Tabellen
  oder Spalten werden als Problemtyp `schema-outdated` mit Hinweis auf
  `npm run db:push` gemeldet statt als roher Postgres-Fehler.
- Gruppen: Jobs zum Hinzufuegen und Entfernen von Mitgliedern und
  Besitzern mit Vorschau und Audit; Entfernen direkt aus der Benutzerseite.
- Apps: Paketkatalog mit typisiertem Manifest, Artefaktspeicher (lokal
  oder Azure Blob EU) und Katalog-UI (Stufe C1).
- Lokale Adminrechte auf Zeit (Vergabe und Entzug als Jobs) und
  Batteriezustand-Skript.
- SharePoint- und OneDrive-Freigabeuebersicht, Alerts-Spalte im Dashboard.
- TeamViewer: Remote-Sitzung aus dem Geraetedetail mit Begruendung und
  Audit.
- MCP-Server ueber die Konsolen-Dienste.
- Anmelde-Anomalien als Alerts mit festem Regelsatz, Liste in der App und
  optionaler Mail.
- Skript fuer lokale Administratoren mit versiegeltem, auditiertem Ergebnis.
- Apps-Modul Stufen A und B: Intune-App-Bestand, Installationsstatus,
  Zuweisungen als Jobs, Bereitstellungsgruppen.
- Best-Practice-Pruefungen je Tenant inklusive SPF/DKIM/DMARC per DNS.
- Exchange-Seite mit Postfachnutzung, Kontingenten und Mailvolumen.
- Gruppenmodul mit Besitzer- und Gastkennzeichen.
- Tenant-Entfernung mit getippter Bestaetigung.
- Skriptbibliothek mit Intune-Remediation-Laeufen (R1) und Azure Run
  Command fuer AVD-Sitzungshosts (R2); Skripte fuer Updatestatus,
  Systeminfo, winget-Updates, Netzwerk, Speicher.
- Bestands-Snapshot je Tenant mit Hintergrundabgleich.
- BitLocker- und LAPS-Wiederherstellung mit begruendetem, auditiertem
  Aufdecken.
- Sicherheitsuebersicht, CVE-Detail mit oeffentlicher Anreicherung und
  KI-Erklaerung, Geraetemodul aus Intune und Defender.

### Geaendert

- Audit: `target_id` und `target_display_name` sind jetzt Text statt
  varchar(100/255); Jobs auf Azure-VMs scheiterten am zu langen
  Ressourcenpfad ("value too long for type character varying(100)").
  Braucht `npm run db:push`.
- BitLocker: das Aufdecken sendet die von Graph verlangten Client-Header
  mit; fehlt der Schluessel trotzdem, nennt die Meldung die noetige
  Berechtigung BitLockerKey.Read.All.

- Graph-Client: leere 200-Antworten (z. B. LAPS ohne Eintrag) fuehren nicht
  mehr zu "Unexpected end of JSON input"; der Tab Wiederherstellung zeigt
  dann eine Karte mit Erklaerung statt eines Fehlers.

- Apps: winget-Pakete aus der Zeit vor dem Umbau tragen nicht mehr "Bereit"
  ohne .intunewin; der Rollout lehnt ungebaute Pakete mit klarer Meldung
  ab. Fehlt im winget-Manifest der Apps-und-Features-Eintrag, nutzt der
  Wrapper den Paketnamen als Namensteil fuer die Deinstallation.

- Exchange: verbirgt der Tenant Namen in Berichten (UPN als Hash ohne @),
  bleibt die Postfachzeile ohne Link und die API erklaert statt "UPN
  ungueltig", wo die Einstellung "Anzeigenamen verbergen" sitzt.

- Geraete: das Softwareinventar aus Intune wird ueber Graph beta gelesen
  (v1.0 kennt `detectedApps` nicht; Fehler "Resource not found for the
  segment 'detectedApps'"). Faellt eine Quelle aus, bleibt die andere im
  Tab Software sichtbar, die Karte nennt den Fehler.

- Skripte mit personenbezogener Ausgabe (Lokale Administratoren) werden
  ohne `RESULT_ENCRYPTION_KEY` schon in der Vorschau abgelehnt statt erst
  nach dem Lauf verworfen.

- Apps: Community-winget-Ids werden nicht mehr als Store-App nach Intune
  geschickt (das scheiterte dort); sie brauchen jetzt den Typ winget mit
  Katalogaufloesung. Bestehende winget-Pakete bitte bearbeiten und "Aus
  Katalog laden".

- Geraeteuebersicht: Netzwerkkarte zeigt nur aktive Adapter, Rest
  ausklappbar; Skriptergebnisse in Ausklappbereichen.
- Remediation-Ergebnisse werden per Basislinienvergleich erkannt, mit
  Rueckfall auf den letzten bekannten Zustand.
