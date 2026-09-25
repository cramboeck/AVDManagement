# Plan: Remote-Aktionen auf Geraeten und Bestands-Cache

Status: Planung, nicht freigegeben. Antwort auf die Frage, wie Remotehilfe,
Windows-Update-Scan und PowerShell-Befehle aus der Konsole heraus moeglich
sind, ob dafuer ein eigener Agent noetig ist und wie ein Cache aussieht.

## Kernaussage

Ein eigener Agent ist fuer Phase 1 weder noetig noch wuenschenswert. Auf jedem
verwalteten Geraet laufen bereits drei Agenten, die Befehle entgegennehmen
und deren API wir schon nutzen: der Intune Management Extension, der
Defender-Sensor und auf AVD-Hosts der Azure VM Agent. Ein eigener Agent
waere Code, der als SYSTEM auf fremden Produktivgeraeten laeuft, und damit
das attraktivste Angriffsziel im ganzen Produkt (Supply Chain). Eine "freie
Bibliothek", die ohne Gegenstelle auf dem Geraet Befehle ausfuehrt, gibt es
nicht: WinRM und PowerShell-Remoting brauchen Netzwerksicht auf das Geraet
und sind fuer eine SaaS-Konsole ueber das Internet nicht tragbar.

Remotehilfe mit Bildschirm ist ein anderes Thema: hier bleibt der Client des
jeweiligen Anbieters auf dem Technikerrechner, die Konsole startet nur die
Sitzung und protokolliert sie.

## Teil A: Befehle ausfuehren ohne eigenen Agent

| Weg | Was geht | Voraussetzung | Grenzen |
|---|---|---|---|
| Intune Remediations (Graph `deviceManagement/deviceHealthScripts`, Beta: `managedDevices/{id}/initiateOnDemandProactiveRemediation`) | PowerShell-Skript mit Erkennung + Behebung auf einem Geraet **auf Abruf** ausfuehren, Ausgabe (stdout, Exit-Code) wird zurueckgemeldet | `DeviceManagementConfiguration.ReadWrite.All`, `DeviceManagementManagedDevices.PrivilegedOperations.All`; Lizenz Business Premium, E3/E5 oder Windows E3/E5; Geraet Entra-joined oder hybrid | Skript muss vorher als Remediation im Tenant angelegt sein; Laufzeit einige Minuten; Ausgabe auf 2048 Zeichen begrenzt; Beta-Endpunkt |
| Defender Live Response (`POST /api/machines/{id}/runliveresponse`, `RunScript`, `GetFile`) | Skript aus der Live-Response-Bibliothek ausfuehren, Ergebnis als Datei abholen | Defender-Rolle `Machine.LiveResponse`; im Portal "Live Response" und ggf. "Unsignierte Skripte" aktiviert; Skript ueber `POST /api/libraryfiles` hochgeladen | Ob Live Response im jeweiligen Defender-for-Business-Tenant freigeschaltet ist, prueft die Konsole am Endpunkt (403/Feature-Fehler wird als Capability-Karte angezeigt); Rate-Limit 10 Aufrufe/Minute |
| Azure Run Command (ARM `virtualMachines/{vm}/runCommand`, `RunPowerShellScript`) | Beliebiges PowerShell auf AVD-Session-Hosts und Azure-VMs, Ausgabe kommt synchron zurueck | Rolle `Virtual Machine Contributor` auf der Ressourcengruppe | Nur Azure-VMs (und Arc-Server); Skript laeuft als SYSTEM; max. 90 Minuten |
| Intune Geraeteaktionen (bereits gebaut) | Sync, Neustart, Defender-Scan; zusaetzlich `windowsDefenderUpdateSignatures`, `rotateLocalAdminPassword`, `locateDevice` | wie heute | Feste Aktionen, kein eigener Code |

### Windows-Update-Scan konkret

Graph kennt keine Aktion "nach Updates suchen". Der Weg ist ein
Remediation-Skript aus unserer Bibliothek, das auf dem Geraet den
Update-Agent anstoesst und den Stand meldet:

1. Erkennung: `Microsoft.Update.Session` (COM) fragt `IsInstalled=0`
   ab und gibt Anzahl, KB-Nummern und Titel der ausstehenden Updates als
   JSON auf stdout aus.
2. Behebung (optional, eigener Job-Typ): `UsoClient.exe StartScan`
   beziehungsweise `StartDownload`/`StartInstall`.
3. Die Konsole zeigt das Ergebnis im Geraetedetail unter Sicherheit neben
   den fehlenden KBs aus Defender an, mit Zeitstempel "Stand vom Geraet".

Fuer die gezielte Installation eines einzelnen Updates gibt es zusaetzlich
die Expedite-Richtlinie (`windowsQualityUpdateProfiles`) und den Windows
Update for Business Deployment Service (`admin/windows/updates`,
`WindowsUpdates.ReadWrite.All`). Beides ist Richtlinie, kein Sofortbefehl,
und passt in den Apps-Plan Stufe D (Ringe).

### Sicherheitsmodell fuer Remote-Befehle

- **Skriptbibliothek statt Freitext.** Skripte liegen versioniert im Repo
  unter `packages/scripts/` (PowerShell 5.1, ASCII, keine Aliase), jedes mit
  Zweck, Parametern und Hash. Der Job traegt Skriptname, Version und Hash im
  Audit. Freitext-PowerShell nur fuer Rolle `engineer`, mit vollstaendiger
  Preview des Skripts, und der Text landet im Audit-Eintrag.
- **Jeder Befehl ist ein Job.** Preview zeigt Geraet, Skript, Parameter,
  erwartete Laufzeit; Bulk zeigt die Zielliste. Retry nur bei
  Transportfehlern, nie bei Skriptfehlern.
- **Ausgaben enthalten potenziell personenbezogene Daten.** Ausgabe wird
  verschluesselt im Job-Ergebnis gespeichert (Schluessel aus Key Vault),
  nach 30 Tagen geloescht, nie geloggt. Fuer die Anzeige gilt Audit wie beim
  Blick in Anmeldeprotokolle.
- **Remediation-Objekte im Kundentenant** bekommen ein festes Praefix
  (`ZSC-`) und werden nur von der Konsole angelegt und aktualisiert; eine
  Drift-Pruefung vergleicht den Hash im Tenant mit dem Repo.

### Reihenfolge

| Stufe | Inhalt | Aufwand |
|---|---|---|
| R1 | Skriptbibliothek mit drei Skripten (Update-Stand, Update-Scan starten, Systeminfo), Remediation-Sync in den Tenant, Job "Skript ausfuehren" auf Einzelgeraet mit Ergebnisanzeige | 3 Tage |
| R2 | Azure Run Command fuer AVD-Hosts mit derselben Bibliothek und derselben Oberflaeche | 1 Tag |
| R3 | Defender Live Response als dritter Transport, automatische Wahl des schnellsten verfuegbaren Wegs je Geraet | 2 Tage |
| R4 | Bulk auf Geraetegruppen, Ausgabe als Tabelle ueber alle Geraete | 1 Tag |

## Teil B: Remotehilfe mit Bildschirm

Die Konsole steuert keine Sitzung selbst. Sie kennt je Geraet die Kennung
des Remote-Tools, startet die Sitzung ueber die Anbieter-API oder ein
URI-Schema auf dem Technikerrechner und schreibt Start, Ziel, Techniker und
Begruendung ins Audit.

| Anbieter | Anbindung | Lizenz | Bewertung |
|---|---|---|---|
| **TeamViewer** (Lizenz vorhanden) | Web-API mit Skript-Token je MSP (Key Vault). Verbindung zu verwalteten Geraeten ueber `teamviewer10://control?device=<id>`; Geraeteliste ueber `GET /api/v1/devices`; Sitzungscodes fuer Ad-hoc-Hilfe ueber `POST /api/v1/sessions` | Sitzungscodes setzen die Service-Queue voraus (ab Premium/Corporate; im Konto pruefen). Der Intune-TeamViewer-Connector ist ein zweiter Weg, dessen Verfuegbarkeit im Intune Admin Center zu pruefen ist | **Empfehlung fuer Stufe 1.** Vorhanden, API dokumentiert, kein neuer Agent. Zuordnung Geraet zu TeamViewer-ID ueber Alias-Abgleich mit dem Hostnamen |
| **RustDesk** | Client per Intune als Win32-App mit eigener Serveradresse (hbbs/hbbr in der EU). ID wird per Remediation-Skript aus `%ProgramData%\RustDesk\config` gelesen und im Bestand gespeichert. Start ueber `rustdesk://connection/new/<id>` | Client und OSS-Server sind AGPL-3.0. Die Konsole ruft nur eine URI auf und uebernimmt keinen Code, das ist lizenzrechtlich unkritisch; das Verbot aus CLAUDE.md gilt fuer Code, nicht fuer die Benutzung eines getrennten Programms | Guenstig und selbst gehostet, aber unbeaufsichtigter Zugriff braucht ein festes Passwort je Geraet. Das darf nicht in unserer DB liegen; Loesung ist das Adressbuch des Technikers oder RustDesk Server Pro (kostenpflichtig, mit HTTP-API und Rollen) |
| **Intune Remote Help** | Start aus dem Intune Admin Center, keine oeffentliche API zum Sitzungsstart; Audit ueber `remoteActionAudits` | Add-on-Lizenz je Benutzer | Nur als Deep-Link ins Portal sinnvoll |
| **MeshCentral** | Apache-2.0, selbst gehostet, eigener Agent, komplette API (Desktop, Terminal, Dateien, PowerShell) | frei | Die einzige "freie und als sicher geltende" Komplettloesung. Bedeutet aber einen weiteren Agenten auf jedem Geraet und einen eigenen Server, den wir absichern und patchen. Erst wenn Teil A nicht reicht |
| AnyDesk, Quick Assist | AnyDesk: URI `anydesk:<id>`, API nur in hoeheren Tarifen. Quick Assist: keine API, Code-basiert | — | Nur als Link |

### Reihenfolge

| Stufe | Inhalt | Aufwand |
|---|---|---|
| H1 | TeamViewer: Token je MSP im Key Vault, Geraeteabgleich, Button "Remote-Sitzung starten" im Geraetekopf mit Begruendung und Audit, Capability-Karte wenn kein Treffer | 2 Tage |
| H2 | Ad-hoc-Sitzungscode fuer Benutzer ohne verwaltetes Geraet (Service-Queue), Code per Mail aus der Konsole | 1 Tag |
| H3 | RustDesk als zweiter Anbieter hinter demselben Interface `RemoteSupportProvider` | 2 Tage |

Entschieden: die Service-Queue ist im vorhandenen TeamViewer-Tarif enthalten,
H2 (Ad-hoc-Sitzungscodes) ist damit moeglich. Offen: sollen Kunden-Geraete
in einer TeamViewer-Gruppe je Tenant liegen? Live Response ist im
Partnertenant (Defender for Business) verfuegbar, das Geraetemenue im Portal
bietet "Initiate Live Response Session" an; R3 bleibt damit im Plan. Fuer die
API braucht die App-Registrierung zusaetzlich die WindowsDefenderATP-Rolle
`Machine.LiveResponse`, und die Skripte muessen vorher in die Live-Response-
Bibliothek geladen werden (signiert, sonst muss "Ausfuehrung nicht signierter
Skripts" aktiviert sein).

## Teil C: Bestands-Cache

### Ist-Zustand

Serverseitig gibt es keinen Cache fuer Bestandsdaten. Vorhanden sind nur der
Token-Cache je Tenant und Ressource, die Aufloesung der Microsoft-Tenant-ID
und die 24-Stunden-Caches fuer oeffentliche CVE-Daten (KEV, EPSS, NVD) sowie
die gespeicherten KI-Erklaerungen. Das Web haelt Antworten zwei bis zehn
Minuten im Browser (React Query). Jeder Aufruf eines Geraetedetails laedt den
gesamten Bestand aus Intune und Defender neu; bei 300 Geraeten sind das zwei
bis vier Sekunden und unnoetige Graph-Last.

### Umgesetzt (Stufe 1: Geraete und Schwachstellen)

Ein Bestands-Snapshot in Postgres je Tenant und Bestandsart, den ein
Worker fuellt. Lesende Seiten lesen den Snapshot und zeigen "Stand vor n
Minuten" mit Knopf "Jetzt aktualisieren". Schreibende Aktionen und
Geheimnisse (Schluessel, Passwoerter, Anmeldeprotokolle) gehen weiterhin
live an Graph.

| Element | Umsetzung |
|---|---|
| Tabelle | `inventory_snapshots` mit Primaerschluessel `(tenant_id, kind)`, `payload jsonb` (der ganze Stand inkl. Capability-Zustand der Quellen), `status`, `synced_at`, `started_at`, `duration_ms`, `error`; `ON DELETE CASCADE` zum Tenant. Ein Datensatz je Paar statt Zeilen je Objekt: atomar, ein Lesezugriff, kein Teilstand. Zeilen je Objekt kommen erst, wenn eine tenant-uebergreifende SQL-Abfrage sie wirklich braucht |
| Sync | `InventorySyncEngine` (Core, ohne Queue, getestet) plus `InventorySyncService` (BullMQ-Queue `inventory-sync`). Takt alle 5 Minuten ueber `upsertJobScheduler`, faellig sind Geraete nach 15 und Schwachstellen nach 60 Minuten; haengende Syncs nach 10 Minuten, Fehler nach 5 Minuten erneut |
| Erster Aufruf | Ohne Snapshot laedt die Seite einmal direkt und legt ihn an; parallele Aufrufe teilen sich den Ladevorgang |
| Fehler | Ein fehlgeschlagener Abgleich laesst den alten Stand stehen; Status und Fehlertext erscheinen an der Anzeige, nicht als Seitenfehler |
| Manuell | `POST /tenants/:id/inventory/refresh` reiht mit hoher Prioritaet ein; Job-Id `sync_<tenant>_<kind>` legt Doppelte zusammen. Das Web pollt den Stand alle 3 Sekunden und laedt die Seitenabfragen neu, sobald `synced_at` wechselt |
| Tenant-Isolation | Jede Abfrage filtert auf `tenant_id`; Core-Test mit zwei Tenants und Integrationstest gegen Postgres (`TEST_DATABASE_URL`) inkl. Fehler- und Loeschfall |
| Leser | Geraeteliste, Geraetedetail (mit einmaligem Direktabgleich bei unbekannter Geraete-Id), Schwachstellenliste, Sicherheitslage (Verteilungen) |

### Offen

- Benutzer-Snapshot (heute serverseitig paginiert ueber Graph, schnell genug)
- Tenant-uebergreifende Sichten auf dem Snapshot ("kritische Luecken aelter als 30 Tage")
- Delta-Erkennung ueber Payload-Hash, um unveraenderte Staende nicht neu zu schreiben
- Kurzfrist-Cache in Redis fuer identische Live-GETs innerhalb einer Seite

Gewinn: Listen und Sicherheitslage antworten aus Postgres statt aus zwei
Microsoft-APIs, Graph-Last sinkt auf einen Abgleich je Intervall, und der
Softwareinventar-Abgleich mit winget aus Schritt 4 hat seine Grundlage.

## Empfohlene Gesamtreihenfolge

1. Teil C Cache: umgesetzt fuer Geraete und Schwachstellen
2. Teil A Stufe R1 und R2 (Update-Stand und Skripte auf Intune-Geraeten und AVD-Hosts)
3. Teil B Stufe H1 (TeamViewer-Start aus dem Geraetekopf)
4. Rest nach Bedarf
