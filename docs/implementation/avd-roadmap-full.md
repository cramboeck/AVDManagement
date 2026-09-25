# AVD-Modul: Vollstaendige Roadmap

## Uebersicht

Dieses Dokument beschreibt die vollstaendige Roadmap fuer das AVD-Modul,
von der Beta bis zur Feature-Paritaet mit Nerdio/Hydra.

---

## Phase 1: Beta (ABGESCHLOSSEN)

### Backend
- [x] ARM-Client fuer Azure Resource Manager API
- [x] AVD-Provider mit Host-Pool/Session-Host-Operationen
- [x] Job-Handler fuer alle Beta-Aktionen
- [x] API-Routen
- [x] Datenbank-Schema

### Implementierte Aktionen
| Aktion | Job-Typ | Status |
|--------|---------|--------|
| Session-Host starten | `avd.start-session-host` | Done |
| Session-Host stoppen | `avd.stop-session-host` | Done |
| Drain-Mode setzen | `avd.set-drain-mode` | Done |
| Session trennen | `avd.disconnect-session` | Done |
| Session abmelden | `avd.logoff-session` | Done |
| Nachricht senden | `avd.send-message` | Done |

---

## Phase 2: Frontend & Dashboard (AKTUELL)

### 2.1 Host-Pool-Dashboard
- [ ] Host-Pool-Karten mit Status-Zusammenfassung
- [ ] Auslastungs-Indikator (Sessions/MaxSessions)
- [ ] Schnellaktionen pro Host Pool
- [ ] Filter nach Tenant

### 2.2 Session-Host-Liste
- [ ] Tabelle mit allen Session Hosts
- [ ] Status-Badges (Available, Unavailable, Shutdown, Drain)
- [ ] Session-Zaehler
- [ ] Bulk-Aktionen (mehrere Hosts starten/stoppen)

### 2.3 Session-Management
- [ ] Liste aktiver Sessions pro Host
- [ ] Benutzer-Info (UPN, Session-Typ)
- [ ] Disconnect/Logoff-Buttons
- [ ] Nachricht-senden-Dialog

### 2.4 Job-Integration
- [ ] Preview-Dialog vor destruktiven Aktionen
- [ ] Job-Status in UI anzeigen
- [ ] Benachrichtigungen bei Abschluss

---

## Phase 3: Autoscaling (Zeitgesteuert)

### Konzept
Zeitbasiertes Scaling ohne komplexe Metriken-Integration.
MSPs brauchen vorhersagbare Kosten, nicht reaktives Scaling.

### 3.1 Schedule-Definitionen
```typescript
interface ScalingSchedule {
  id: string;
  hostPoolId: string;
  name: string;
  timezone: string;
  rules: ScheduleRule[];
}

interface ScheduleRule {
  daysOfWeek: number[];  // 0-6 (So-Sa)
  startTime: string;     // "08:00"
  endTime: string;       // "18:00"
  minHosts: number;
  maxHosts: number;
  rampUpMinutes: number;
  rampDownMinutes: number;
}
```

### 3.2 Implementierung
- [ ] Schedule-Tabelle in DB
- [ ] Cron-Job fuer Schedule-Evaluation
- [ ] Ramp-Up: Hosts sequentiell starten
- [ ] Ramp-Down: Drain-Mode setzen, warten, dann stoppen
- [ ] UI: Schedule-Editor mit Wochenansicht

### 3.3 Kostenoptimierung
- [ ] Berechnung: "Hosts aus = X EUR gespart"
- [ ] Empfehlung basierend auf Nutzungsdaten

---

## Phase 4: Image Management

### Optionen (Entscheidung ausstehend)

#### Option A: Azure Image Builder Integration
**Vorteile:**
- Native Azure-Loesung
- ARM-Templates/Bicep-Integration
- Automatische Verteilung in Shared Image Gallery

**Nachteile:**
- Weniger flexibel als Packer
- Azure-Lock-in

#### Option B: Packer-Orchestrierung
**Vorteile:**
- Bereits im Einsatz
- Multi-Cloud-faehig
- Grosse Community

**Nachteile:**
- Erfordert Packer-Installation
- Komplexere Pipeline

#### Option C: Hybrid (Empfohlen)
- Packer fuer Image-Erstellung (bestehende Templates weiternutzen)
- Azure Image Gallery fuer Verteilung
- ZeroStress als Orchestrator:
  - Packer-Build triggern (Azure DevOps/GitHub Actions)
  - Build-Status ueberwachen
  - Image in Gallery registrieren
  - Host Pool mit neuem Image aktualisieren

### 4.1 Image-Katalog
- [ ] Liste aller Images pro Tenant
- [ ] Versionshistorie
- [ ] "Latest" vs. "Pinned" Konzept

### 4.2 Image-Erstellung (Orchestrierung)
- [ ] Packer-Template-Auswahl
- [ ] Build-Parameter (Base Image, Apps, Updates)
- [ ] Build starten (via Azure DevOps/GitHub Actions)
- [ ] Build-Log anzeigen
- [ ] Image in Shared Gallery publizieren

### 4.3 Image-Rollout
- [ ] Host Pool auswaehlen
- [ ] Rollout-Strategie (Rolling, All-at-once)
- [ ] Drain -> Stop -> Update -> Start Workflow
- [ ] Rollback-Option

### 4.4 Update-Workflow (Golden Image Pattern)
```
1. Trigger: Neues Windows Update / App-Update
2. Packer baut neues Image (automatisch oder manuell)
3. Image wird in Shared Gallery veroeffentlicht
4. Admin waehlt Host Pools fuer Rollout
5. Preview zeigt: "X Hosts werden aktualisiert"
6. Rollout mit Drain-Mode und sequentiellem Neustart
```

---

## Phase 5: FSLogix-Profil-Management

### 5.1 Profil-Uebersicht
- [ ] Storage-Account-Integration
- [ ] Profil-Groessen anzeigen
- [ ] Orphaned Profiles erkennen

### 5.2 Profil-Aktionen
- [ ] Profil loeschen (bei Offboarding)
- [ ] Profil kompaktieren
- [ ] Profil-Backup

### 5.3 Troubleshooting
- [ ] Profil-Lock erkennen
- [ ] "Welcher Host hat das Profil gemountet?"

---

## Phase 6: Erweiterte Features

### 6.1 Application Groups
- [ ] App-Gruppen anzeigen
- [ ] Benutzer-Zuweisung
- [ ] RemoteApp vs. Desktop

### 6.2 MSIX App Attach
- [ ] MSIX-Pakete verwalten
- [ ] App-Zuweisung an Host Pools

### 6.3 Monitoring & Alerting
- [ ] Performance-Metriken (CPU, Memory, Disk)
- [ ] Session-Dauer-Analyse
- [ ] Alerting bei Problemen

### 6.4 Cost Management
- [ ] Kostenberechnung pro Host Pool
- [ ] Kostenprognose
- [ ] Optimierungsempfehlungen

---

## Technische Schulden

### Aktuell
- [ ] Tests fuer AVD-Provider
- [ ] Tests fuer Job-Handler
- [ ] Error-Handling verbessern (ARM 401/403/429)
- [ ] Logging/Telemetrie

### Vor Production
- [ ] Azure RBAC-Pruefung vor Aktionen
- [ ] Subscription-Konfiguration pro Tenant
- [ ] Rate-Limiting fuer Azure APIs

---

## Priorisierung (Empfehlung)

| Phase | Aufwand | Business Value | Empfehlung |
|-------|---------|----------------|------------|
| 2. Frontend | 3-4 Tage | Hoch | Sofort |
| 3. Autoscaling | 5-7 Tage | Sehr hoch | Nach Frontend |
| 4. Image Mgmt | 7-10 Tage | Hoch | Nach Autoscaling |
| 5. FSLogix | 3-5 Tage | Mittel | Optional |
| 6. Erweitert | 10+ Tage | Mittel | Spaeter |

---

## Entscheidungen (offen)

1. **Image-Build-Tool**: Packer beibehalten oder Azure Image Builder?
2. **CI/CD-Integration**: Azure DevOps, GitHub Actions, oder beides?
3. **Shared Image Gallery**: Pro MSP oder pro Tenant?
4. **Autoscaling-Granularitaet**: Stunden oder 15-Minuten-Intervalle?
