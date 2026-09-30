# Changelog

Alle nennenswerten Aenderungen an ZeroStress Cockpit. Format angelehnt an
"Keep a Changelog"; bis zur ersten Beta gibt es nur den Abschnitt
"Unreleased". Aeltere Schritte stehen in der Git-Historie.

## Unreleased

### Hinzugefuegt

- Geraete: Deinstallieren ohne winget (Job `device.app-uninstall`) fuer
  Software ohne winget-Id: Registry-Eintrag mit exaktem Anzeigenamen,
  stille Schalter fuer MSI, QuietUninstallString, Inno Setup, NSIS und
  InstallShield, Store-/MSIX-Pakete per Remove-AppxPackage fuer alle
  Benutzer; unbekannte Deinstaller werden nicht blind gestartet, Argumente
  lassen sich im Dialog nachreichen. Vorschau, Audit, Ergebnis mit
  Methode, Befehl und Exit-Code.

- Anleitung `docs/setup/production-hardening.md`: getrennte
  App-Registrierungen fuer Login und Kundentenants, Zuweisung erforderlich,
  Conditional Access mit phishing-resistenter MFA, Caddy als Reverse Proxy
  unter einem Host, Datenbank und Secrets, Checkliste vor dem Freischalten.
  Optionale eigene Login-Registrierung ueber `ENTRA_LOGIN_CLIENT_ID`,
  `ENTRA_LOGIN_CLIENT_SECRET` und `NEXT_PUBLIC_ENTRA_LOGIN_CLIENT_ID`.

- Audit-Log mit Hash-Kette je MSP (Vorgaenger- und Eintragshash, Sperre je
  MSP beim Schreiben), "Kette pruefen" auf der Audit-Seite fuer Owner;
  `npm run db:harden` legt Trigger gegen UPDATE, DELETE und TRUNCATE auf
  `audit_entries` an. Braucht `npm run db:push`.
- Secrets aus Azure Key Vault ueber Managed Identity (`KEY_VAULT_URL`);
  App-Anmeldung an Entra mit Zertifikat statt Client-Secret
  (`ENTRA_CLIENT_CERTIFICATE_PEM` oder `_PATH`, client_assertion fuer den
  Login, MSAL mit Zertifikat fuer app-only-Tokens).

- Sicherheits-Header und CSP fuer API und Web (HSTS in Produktion),
  Rate-Limits je Minute fuer Login, Worker, MCP, Freigaben und die
  uebrige API mit 429 und Retry-After, Groessenlimits 1 MB fuer JSON und
  4 GB fuer Uploads; `TRUST_PROXY` fuer die Client-IP hinter einem Proxy.

- Weiterleitungs-Scan: nimmt die Postfachliste aus den Daten des
  Exchange-Workers oder aus dem Verzeichnis (Mitglieder mit
  Exchange-Plan), wenn der Nutzungsbericht Namen verbirgt; vorher
  "0 Postfaecher geprueft". Quelle steht im Ergebnis, die Oberflaeche
  nennt die Einstellung im Admin Center.
- winget-Katalog: Aliasse fuer abweichende Anzeigenamen (Adobe Acrobat
  (64-bit), Logi Options+, Store-Paketnamen), neue Eintraege 1Password,
  NanaZip, Logi Options+, Advanced IP Scanner, WhatsApp; kurze Namen wie
  "Git" treffen nur als ganzes Wort, der laengste passende Name gewinnt.
- Software-Tab: Laufzeitkomponenten (Visual C++, .NET, WebView2 und
  aehnliche) aus dem winget-Inventar stehen eingeklappt und ohne
  Deinstallieren-Knopf; im Basis-Set werden sie nicht zum Installieren
  angeboten.
- Jobs im Hintergrund: laufende Jobs lassen sich aus dem Dialog mit "Im
  Hintergrund weiterlaufen" loslassen; eine Leiste oben rechts zeigt
  Laufzeit und Ergebnis mit Link auf den Job, Fehler bleiben stehen,
  Erfolge blenden sich aus. Bei nicht sichtbarem Tab zusaetzlich eine
  Browser-Benachrichtigung (nach Zustimmung). Der Stand ueberlebt
  Seitenwechsel innerhalb des Tabs.
- Skriptergebnis: Zeitkette Anstoss, Meldung des Geraets, Sichtbarkeit in
  Graph (`observedAt`), damit der Verzug der Intune-Berichte messbar ist.
- Betriebs-Alerts (Einstellungen, nur Owner, Standard aus): veraltete
  Software laut winget-Katalog ab N Geraeten, Postfach ab N Prozent der
  Sendesperre (ab 100 Prozent hoch), laufende Azure-VMs ausserhalb der
  Arbeitszeit (Zeitfenster, Zeitzone, Wochenende, Ausnahme fuer
  Sitzungshosts und Tag). Auswertung im Alert-Takt hoechstens stuendlich
  je Tenant, sofort ueber "Jetzt auswerten"; gleiche Liste und Mail wie
  die Anmelde-Alerts.
- Tenant-Sichtbarkeit je Konto: Owner sehen alle Tenants, Engineer und
  Nur-lesen nur zugewiesene (Einstellungen > Team, nur Owner, Audit
  `team.update`). Gilt fuer Tenantliste, Tenantwechsel (fremder Tenant:
  404), Dashboard, MCP-Server und Rollouts. Letzter Owner und eigenes
  Konto geschuetzt. Tabelle `msp_user_tenants`, `npm run db:push`.
- Worker-Token je MSP: Einstellungen > Worker-Token legt Token fuer Build-
  und Exchange-Worker an (Klartext einmalig, Hash in `worker_tokens`,
  Widerruf, letzte Nutzung, Audit `worker-token.create` und
  `worker-token.revoke`). Auftraege sind an den MSP des Tokens gebunden;
  `WORKER_TOKEN` aus der Umgebung gilt nur noch bei genau einem MSP.
  Tabelle `worker_tokens`, `npm run db:push`.
- Vier-Augen-Prinzip: MSP-Einstellungen (Seite Einstellungen, nur Owner)
  mit Schwelle an betroffenen Objekten und Liste von Jobtypen; betroffene
  Jobs brauchen eine zweite Freigabe durch eine andere Person (Status
  "Zweite Freigabe noetig", Vorschau vier Stunden gueltig, beide
  Freigaben im Audit). Standard aus.
- Software (neue Seite): alle von Intune erkannten Programme des Tenants
  mit Versionen und Geraetezahl (Snapshot `software`), Abgleich mit dem
  winget-Katalog (eigene Pakete, Basis-Set, Versionscache) mit Stand
  aktuell/veraltet, Sammelaktion Aktualisieren/Deinstallieren auf bis zu
  25 Geraete je Job (`device.winget-bulk`, Vorschau je Geraet, Ergebnis je
  Geraet), Sperrliste je MSP mit Alert "Gesperrte Software" nach jedem
  Sync.
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

- Anmeldung: die API tauscht den Authorization Code, prueft das ID-Token
  gegen den Partnertenant und setzt ein httpOnly-Sitzungscookie
  (SameSite=Lax, Secure in Produktion); im Browser liegen keine
  Entra-Tokens mehr. Sitzungen liegen serverseitig in `user_sessions`
  (nur Hash, Laufzeit 12 h, Leerlauf 2 h, `npm run db:push`), Abmelden
  widerruft sie, Anmelden und Abmelden stehen im Audit. Schreibende
  Anfragen brauchen den Header `X-Requested-With` und einen erlaubten
  Origin (CSRF-Schutz). Deaktivierte Konten werden auch mit gueltigem
  Entra-Token abgewiesen. Bearer-Tokens bleiben fuer MCP und andere
  Clients; `/auth/refresh` entfaellt, Sitzungsinfo unter `/auth/me`.
  Web und API muessen same-site laufen (gleicher Host oder Subdomains
  derselben Domain).

- Login-Callback: im Dev-Modus lief der Abschluss durch React StrictMode
  doppelt; der zweite Lauf fand den Code-Verifier nicht mehr und meldete
  "Invalid state or missing code verifier", obwohl die Anmeldung
  durchging. Der Callback laeuft jetzt genau einmal, die Konsolenmeldung
  nennt Origin und Ursache.

- API-Protokoll: Verbindungsfehler zu Redis und Postgres nennen den Code
  (ECONNREFUSED) statt einer leeren Meldung und erscheinen je Quelle
  hoechstens einmal pro Minute statt alle paar Sekunden.

- Vorschau gilt 15 statt 5 Minuten. Laeuft sie vor der Freigabe ab,
  erzeugt die API sie neu und bittet um erneute Pruefung, statt den Job
  mit "Preview has expired" liegen zu lassen; Dialog und Jobs-Seite
  laden den Job dann automatisch nach.

- Build- und Exchange-Protokolle: Zeilen, die der Worker waehrend des Laufs
  gemeldet hat, stehen nach dem Abschluss nicht mehr doppelt; die
  Groessenangabe beim Download entfaellt, wenn sie unbekannt ist.

- Build-Worker: der PSADT-Wrapper wird nach dem Wrapper-Feld des Bauplans
  erzeugt, nicht nach dem Installertyp; winget-Pakete scheiterten mit
  "Install block is only generated for psadt packages".

- Build-Worker: SHA-256 ueber .NET statt `Get-FileHash`; das Cmdlet fehlt
  auf Systemen, die keine Skriptmodule laden. Abschnitt Fehlersuche in
  der README.

- Jobs: "Zielobjekte" zaehlt Geraete, Tenants und Rollout-Groesse aus der
  Nutzlast statt immer 1; der Freigabe-Block heisst nur bei zweiter
  Freigabe "Vier-Augen-Prinzip".

- Worker: Beispielkonfiguration ohne `/api` (die API hat keinen Pfadpraefix),
  Startmeldung mit Konfigpfad und API-Adresse, verstaendlicher Fehler bei
  `/api` am Ende; `allowInsecureHttp` erlaubt plain http zu einer fremden
  Adresse fuer ein Labor ohne TLS, mit Warnung beim Start.

- Worker: `Set-WorkerToken.ps1` und das Einlesen von `worker.token` nutzen
  DPAPI direkt ueber .NET statt `ConvertFrom-SecureString`; auf Systemen,
  auf denen sich das Modul Microsoft.PowerShell.Security nicht laden
  laesst, brach die Einrichtung ab. Bestehende `worker.token`-Dateien
  einmal neu anlegen.

- winget-Skripte: bei genau einer Ausgabezeile oder genau einem Update
  wurde die Liste zum Einzelwert und der Lauf endete mit "[System.String]
  keine Methode GetRange"; die Deinstallation war trotzdem durch, der Job
  meldete aber Fehler.

- Eingabefehler der API (Zod) kommen jetzt als Problem-Details mit Titel
  und Beschreibung; vorher zeigte die Oberflaeche eine leere Fehlerbox.
  Der API-Client zeigt ausserdem nie mehr eine leere Meldung.
- Skript-Ids fuer `device.run-script` und `avd.run-script` werden gegen die
  Bibliothek geprueft statt gegen eine feste Liste; `winget-inventory`
  liess sich deshalb aus dem Tab Skripte nicht starten.

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
