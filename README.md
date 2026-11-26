# ZeroStress Cockpit

Multi-Tenant-Managementkonsole fuer Microsoft-Cloud-Umgebungen von MSPs:
Azure Virtual Desktop, Intune, Microsoft 365 (Identitaeten, Lizenzen,
Sicherheit) und Exchange Online ueber alle Kundentenants in einer
Oberflaeche.

Ziel ist die Bedienung, die das Azure- und Intune-Portal nicht bietet:
ein Tenant-Wechsel statt zehn Browserprofile, Bulk-Aktionen mit Vorschau,
jede Aenderung als nachvollziehbarer Job mit Audit-Eintrag.

> **Stand:** in aktiver Entwicklung, Eigenbetrieb beim MSP. Noch nicht fuer
> den Betrieb durch Dritte freigegeben. Offene Punkte stehen unter
> [Stand und Grenzen](#stand-und-grenzen).

---

## Inhalt

- [Funktionen](#funktionen)
- [Grundsaetze](#grundsaetze)
- [Architektur](#architektur)
- [Schnellstart (lokal)](#schnellstart-lokal)
- [Tenant anbinden](#tenant-anbinden)
- [Entwicklung](#entwicklung)
- [Sicherheit](#sicherheit)
- [Dokumentation](#dokumentation)
- [Stand und Grenzen](#stand-und-grenzen)

---

## Funktionen

| Bereich | Was die Konsole kann |
|---|---|
| **Tenants** | Onboarding per Admin-Consent, Verbindungstest mit fehlenden Berechtigungen, Tenant-Sichtbarkeit je Teammitglied, Entfernen und Reaktivieren |
| **Benutzer und Gruppen** | Benutzerliste und Detail mit MFA-Methoden, Anmeldungen, Lizenzen; Deaktivieren, Passwort-Reset, Sitzungen widerrufen, Gruppenmitglieder und -besitzer pflegen |
| **Geraete (Intune)** | Geraeteliste mit Defender-Daten, Sync, Neustart, Neustart mit Vorwarnung und Verschiebung, Defender-Scan, BitLocker- und LAPS-Anzeige mit Begruendung, Admin auf Zeit |
| **Skripte auf Geraeten** | Versionierte Skriptbibliothek als Intune Remediations (`ZSC-*`): Update-Status, Systeminfo, Netzwerk, Speicher, lokale Admins, Akku, winget-Updates und -Inventar; Ergebnisse verschluesselt gespeichert |
| **Software und Apps** | Tenantweites Software-Inventar, winget-Updates je Geraet und als Bulk, Deinstallation auch ohne winget, Intune-Apps mit Zuweisungen, Paketbau zu `.intunewin` (PSADT v4) ueber den Windows-Worker |
| **Azure Virtual Desktop** | Hostpools, Sitzungshosts und Sitzungen mit Aktionen, Skripte auf Sitzungshosts per Run Command |
| **Azure-VMs** | VM-Liste je Abo, Starten, Stoppen, Neustart, Groesse aendern, Bereitstellen aus Vorlagen mit Kostenschaetzung |
| **Exchange Online** | Postfaecher mit Groessen und Kontingenten, Abwesenheit, Posteingangsregeln, Weiterleitungs-Scan; Cmdlet-only-Aufgaben ueber den Exchange-Worker |
| **SharePoint und OneDrive** | Websites mit Speicher, anonymen Links und Gastlinks; je Benutzer extern und intern geteilte Dateien |
| **Sicherheit** | Secure Score, Defender-Alerts, Schwachstellen (CVE) mit optionaler KI-Erklaerung, Anmeldeprotokolle, Best-Practice-Checks fuer Entra, Conditional Access, Exchange und SharePoint |
| **Baselines und Haertung** | Intune-Sicherheitsbaselines und Compliance-Richtlinien mit Geraetestatus; taegliche Haertungspruefung der Windows-Geraete (26 Kontrollen, nur lesend) mit Erfuellungsgrad je Tenant und Geraet |
| **Alerts** | Anmelde-Anomalien und Betriebs-Alerts aus dem Geraete-Monitor (Lebenszeichen, Speicher, Dienste, Ereignisse, Zertifikate, Defender) mit einstellbaren Schwellen |
| **Netzwerk** | Kommunikation der Clients aus Defender Advanced Hunting (setzt Defender for Endpoint P2 voraus) |
| **Nur-Lese-Betrieb** | Je Tenant oder fuer die ganze Konsole: keine schreibenden Jobs, Zuruecknehmen bleibt moeglich, jeder abgelehnte Versuch im Audit |
| **Jobs und Audit** | Jobliste mit Vorschau, Fortschritt, Ergebnis und Retry; Vier-Augen-Freigabe fuer kritische Aktionen; unveraenderliches Audit-Log mit Hash-Kette |
| **MCP-Server** | Zugriff fuer KI-Assistenten mit derselben Anmeldung und Tenant-Isolation; Jobs koennen vorbereitet werden, die Freigabe bleibt beim Engineer |

Die benoetigten Graph- und Defender-Berechtigungen je Funktion stehen in
[docs/setup/local-development.md](docs/setup/local-development.md#api-berechtigungen-application-permissions-microsoft-graph).
Fehlt eine Berechtigung oder Lizenz, zeigt die Konsole an der betroffenen
Stelle "Berechtigung fehlt" bzw. "nicht lizenziert", statt zu scheitern.

## Grundsaetze

Verbindlich festgelegt in [CLAUDE.md](CLAUDE.md):

1. **Provider-Abstraktion:** Jede Microsoft-API liegt hinter einem Provider
   in `packages/core`. Die Oberflaeche kennt Graph nicht.
2. **Jede schreibende Aktion ist ein Job:** Queue-Eintrag, Status, Retry,
   Audit-Eintrag, Ergebnis. Keine synchronen Writes.
3. **Vorschau vor dem Schreiben:** Bulk- und destruktive Aktionen zeigen
   zuerst, was mit welchen Objekten passiert.
4. **Throttling ist Normalbetrieb:** Graph 429 mit Retry-After,
   exponentielles Backoff, Concurrency-Limit je Tenant, `$batch` wo moeglich.
5. **Tenant-Isolation:** Jede Abfrage und jeder Cache-Schluessel traegt die
   Tenant-Id.

## Architektur

```
                 Browser (Techniker, Entra-Login)
                              |
                    apps/web  (Next.js 14, Port 3002)
                              |  Cookie-Sitzung, CSRF-Header
                    apps/api  (Hono, Port 3001)
                     |        |          |
               Postgres     Redis     Microsoft Graph, Defender API,
             (Drizzle,    (BullMQ     Azure Resource Manager
             Audit-Log)    Jobs)      (app-only je Kundentenant)
                              |
          +-------------------+--------------------+
          |                                        |
  apps/worker-windows                     apps/worker-exchange
  (PowerShell 5.1, baut .intunewin)       (Exchange Online PowerShell,
                                           eigenes Zertifikat)
```

| Pfad | Inhalt |
|---|---|
| `apps/api` | REST-API, Authentifizierung, Job-Queue, Audit, Datenbankschema (`src/db/schema.ts`) |
| `apps/web` | Oberflaeche (Next.js App Router, React Query, Tailwind) |
| `apps/worker-windows` | Build-Worker fuer Intune-Pakete, laeuft auf einer Windows-Maschine des MSP ([README](apps/worker-windows/README.md)) |
| `apps/worker-exchange` | Worker fuer Exchange-Cmdlets mit fester Operationsliste ([README](apps/worker-exchange/README.md)) |
| `packages/core` | Provider, Job-Handler, Bewertungslogik (Checks, Alerts, Haertung), Skriptbibliothek (`scripts/*.ps1`) |
| `packages/types` | Gemeinsame Typen fuer API und Oberflaeche |
| `docs` | Architekturentscheidungen, Setup, Plaene, Sicherheitsreview |

Fachliche Logik liegt nur in `packages/core` und `apps/api`, nie in
React-Komponenten. Die Worker holen Auftraege selbst ab (Pull); die API
braucht keine eingehende Verbindung zu ihnen.

## Schnellstart (lokal)

Voraussetzungen: Node.js 20+, npm 10+, Docker, eine App-Registrierung im
Partnertenant (siehe [Tenant anbinden](#tenant-anbinden)).

```powershell
Copy-Item .env.example .env.local      # Werte eintragen, nur im Root
docker-compose up -d                   # Postgres und Redis
npm install
npm run build --workspace=@zerostress/types
npm run build --workspace=@zerostress/core
npm run db:push
npm run db:harden                      # Audit-Log gegen UPDATE/DELETE sperren

npm run dev --workspace=@zerostress/api    # Fenster 1: http://localhost:3001
npm run dev --workspace=@zerostress/web    # Fenster 2: http://localhost:3002
```

Pflichtwerte in `.env.local`: `DATABASE_URL`, `ENTRA_CLIENT_ID`,
`ENTRA_TENANT_ID`, `JWT_SECRET` und ein Zugang zur App (lokal
`ENTRA_CLIENT_SECRET`, produktiv Zertifikat aus Key Vault). Fehlt ein Wert,
bricht die API mit einer klaren Meldung ab.

Nach einem `git pull` mit Schemaaenderung erneut `npm run db:push`. Bietet
drizzle-kit an, eine Tabelle zu leeren, **immer abbrechen**, besonders bei
`audit_entries`; die Loesung steht in der
[Setup-Doku](docs/setup/local-development.md#starten).

## Tenant anbinden

1. Im Partnertenant eine mandantenfaehige App-Registrierung anlegen und die
   Anwendungsberechtigungen aus der Berechtigungstabelle hinzufuegen.
2. In der Konsole unter **Tenants** den Kundentenant hinzufuegen; ein
   globaler Administrator des Kunden erteilt den Admin-Consent.
3. Der Verbindungstest zeigt, welche Berechtigungen fehlen.
4. Fuer AVD und Azure-VMs zusaetzlich Azure-RBAC auf die Abos des Kunden.

Schritt fuer Schritt, inklusive Defender-API und Azure-RBAC:
[docs/setup/local-development.md](docs/setup/local-development.md#app-registrierung-partnertenant).

## Entwicklung

```powershell
npx tsc --noEmit -p packages/core/tsconfig.json     # Typpruefung Core
npx tsc --noEmit -p apps/api/tsconfig.dev.json      # Typpruefung API
npx vitest run --root packages/core                 # Tests Core
npx vitest run --root apps/api                      # Tests API
cd apps/web; npx tsc --noEmit; npx next build       # Oberflaeche
```

Konventionen (Auszug, vollstaendig in [CLAUDE.md](CLAUDE.md)):

- TypeScript strict, kein `any`.
- Kommentare auf Deutsch, Bezeichner und Logs auf Englisch.
- PowerShell 5.1-kompatibel, nur ASCII, keine Aliase.
- Jede Provider-Methode hat einen Test gegen ein Graph-Fixture,
  inklusive Fehlerpfaden (401, 403, 429, 404).
- Jede Aenderung bekommt einen Eintrag im [CHANGELOG](CHANGELOG.md).
- Kein Code und keine Vorlagen aus AGPL-Projekten (z. B. CIPP); Quelle
  ist die oeffentliche Microsoft-Dokumentation.

## Sicherheit

Die Konsole hat effektiv Administratorrechte auf fremden Produktivtenants.
Entsprechend:

- **Anmeldung** nur ueber Entra ID, MFA erzwungen, phishing-resistent als
  Sollzustand; Sitzung als httpOnly-Cookie mit CSRF-Schutz.
- **Secrets** nie in Repo, Datenbank oder Logs: Key Vault und Zertifikat
  statt Client-Secret im Produktivbetrieb.
- **Audit-Log** mit Hash-Kette und Datenbank-Triggern gegen Aenderung; auch
  fehlgeschlagene Versuche werden erfasst.
- **Datenschutz:** keine personenbezogenen Daten in Logs oder Telemetrie;
  Skriptausgaben verschluesselt, Hosting in der EU vorgesehen.
- **Schutz der API:** Sicherheits-Header, CSP, Rate-Limits, Groessenlimits.

Vor einem Betrieb ausserhalb von localhost:
[docs/setup/production-hardening.md](docs/setup/production-hardening.md)
mit Checkliste. Sicherheitsluecken bitte nicht als oeffentliches Issue,
sondern direkt an den Maintainer melden.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [docs/setup/local-development.md](docs/setup/local-development.md) | Einrichtung, Funktionen im Detail, Berechtigungen, haeufige Fehler |
| [docs/setup/production-hardening.md](docs/setup/production-hardening.md) | Entra-Trennung, Conditional Access, Reverse Proxy, Key Vault |
| [docs/setup/netbird-server.md](docs/setup/netbird-server.md) | Betrieb auf eigenem Server, nur ueber NetBird erreichbar |
| [docs/setup/read-only-mode.md](docs/setup/read-only-mode.md) | Nur-Lese-Betrieb je Tenant oder fuer die Konsole, Nur-Lese-App-Registrierung |
| [docs/adr/](docs/adr/) | Architekturentscheidungen (Auth, Exchange, Modul-Contract, Queue, Caching, Secrets, Multi-MSP) |
| [docs/domain/](docs/domain/) | Domaenenmodell |
| [docs/implementation/](docs/implementation/) | Plaene je Modul (AVD, Apps, Exchange, Remote-Aktionen, Azure-VMs) |
| [docs/security/](docs/security/) | Sicherheitsreview |
| [docs/risk-register.md](docs/risk-register.md) | Risiken und Gegenmassnahmen |
| [CHANGELOG.md](CHANGELOG.md) | Aenderungen |

## Stand und Grenzen

Ehrlich festgehalten, damit niemand mehr erwartet, als da ist:

- **Modul-Registry:** Der Modul-Contract ist spezifiziert
  ([docs/contracts](docs/contracts/), [ADR-003](docs/adr/003-module-contract.md)),
  aber im Code noch nicht umgesetzt. Neue Module brauchen heute noch
  Aenderungen an Routen, Navigation und Job-Registrierung.
- **Windows 365:** Cloud PCs werden noch nicht abgefragt; sie erscheinen nur
  als Intune-Geraete.
- **Abhaengigkeiten:** `npm audit` meldet Hinweise, die nur mit
  Hauptversionen (Next.js, drizzle-orm, zod, msal-node) zu beheben sind.
- **Betrieb:** Anleitung fuer den Server hinter NetBird liegt vor, ist aber
  noch nicht auf dem Zielsystem durchgespielt; ein externer Pentest steht aus.
- **Nur-Lese-App je Tenant:** Die Sperre wirkt in der Konsole. Eine
  Nur-Lese-App-Registrierung laeuft heute als eigene Instanz; Umschalten
  der App je Tenant ist nicht gebaut.
- **CIS:** Die Pruefungen leiten sich aus Microsoft-Dokumentation ab und
  enthalten keine CIS-Nummern oder -Texte. Eine formale CIS-Zuordnung setzt
  eine CIS-SecureSuite-Lizenz voraus.
