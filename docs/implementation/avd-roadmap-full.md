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

### Empfehlung: Azure Image Builder (AIB)

Nach Recherche empfehle ich **Azure Image Builder** als primaere Loesung:

**Gruende:**
- Native Azure-Loesung, keine externen Abhaengigkeiten
- Volle REST-API fuer Automatisierung
- Direkte Integration mit Azure Compute Gallery
- Managed-Identity-Support (keine Secrets noetig!)
- Packer bleibt Option fuer bestehende Templates

**Wichtige Ueberlegungen:**
- Ab Maerz 2026: Neue VNets haben default private Subnets (AIB outbound brechen)
- Gallery-Sharing-Limit: 30 Subscriptions, 5 Tenants pro Gallery
- API 2024-02-01+: Feldnamen sind case-sensitive

### API-Endpunkte fuer Image Builder

| Operation | Endpoint |
|-----------|----------|
| Image Templates | `Microsoft.VirtualMachineImages/imageTemplates` |
| Build starten | `POST .../imageTemplates/{name}/run` |
| Build-Status | `GET .../imageTemplates/{name}/runOutputs` |
| Gallery-Sharing | `POST .../galleries/{name}/share` |
| Image-Versionen | `Microsoft.Compute/galleries/.../imageVersions` |

### Nerdio-Pattern nachbauen

Nerdio's Staerke: "Set as Image" in einem Klick:
1. VM einschalten
2. Updates installieren
3. Sysprep
4. Capture
5. In Gallery veroeffentlichen
6. Auf Host Pool anwenden

Wir abstrahieren diese 6 Schritte in **einen Job** mit Live-Status.

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

### 6.3 Monitoring & Alerting (Differenzierung zu Nerdio/Hydra)

**Was wir BESSER machen:**
1. Multi-Tenant-First: Alle Kunden auf einen Blick
2. Action-Oriented: Problem sehen → loesen im selben View
3. Keine Zusatzkosten: Optional ohne Log Analytics nutzbar
4. Echtzeit: ARM-API statt Log-basiert wo moeglich
5. Keyboard-First: Power-User koennen ohne Maus arbeiten

**Metriken nach Quelle:**
| Daten | Quelle | Cache-TTL |
|-------|--------|-----------|
| Host-Status | ARM API | 30 Sek |
| Session-Anzahl | ARM API | 30 Sek |
| CPU/Memory | Azure Monitor | 1-2 Min |
| Login-Zeiten | Log Analytics | 5 Min |
| RTT/Input Delay | Log Analytics | 5 Min |

**Alert-Schwellenwerte:**
- RTT > 200ms = Warnung
- Input Delay > 500ms = Kritisch
- FSLogix Mount > 10s = Warnung
- CPU > 90% (sustained) = Warnung

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
