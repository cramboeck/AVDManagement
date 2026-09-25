# AVD Monitoring: Design-Konzept

## Das Problem mit nativen Azure-Tools

### Azure Portal Pain Points
1. **Fragmentierung**: Session-Status hier, Host-Metriken da, Logs woanders
2. **Keine Multi-Tenant-Sicht**: Pro Tenant einloggen, Subscription wechseln
3. **Log Analytics Dependency**: Alles landet in KQL, braucht Expertise
4. **Verzoegerung**: Logs haben 5-15 Min Delay
5. **Keine Aktionen**: Sehen und Handeln sind getrennt

### Was MSPs wirklich brauchen
- "Ist alles OK?" in 2 Sekunden beantworten
- "Was ist kaputt?" sofort sehen
- "Wie behebe ich es?" direkt handeln
- Ueber alle Tenants hinweg

---

## Unsere Loesung: Drei Ebenen

### Ebene 1: Real-Time Status (ARM API)
**Quelle:** Azure Resource Manager API (bereits implementiert)
**Latenz:** Echtzeit
**Daten:**
- Session-Host-Status (Available/Unavailable/Shutdown)
- Aktive Session-Anzahl pro Host
- Drain-Mode Status
- Last Heartbeat

**UI-Element:** Status-Dashboard mit Live-Updates

### Ebene 2: Performance-Metriken (Azure Monitor API)
**Quelle:** Azure Monitor Metrics API
**Latenz:** 1-5 Minuten
**Daten:**
- CPU-Auslastung pro VM
- Memory-Verbrauch
- Disk I/O
- Network-Durchsatz

**UI-Element:** Sparklines in Host-Liste, Detail-View mit Graphen

### Ebene 3: Session-Analyse (Log Analytics, gecached)
**Quelle:** Log Analytics API (WVDConnections, WVDCheckpoints)
**Latenz:** 15-30 Minuten (akzeptabel fuer Analyse)
**Daten:**
- Login-Dauer (Zeit bis Desktop)
- Profil-Ladezeit (FSLogix)
- Connection-Qualitaet (Round-Trip-Time)
- Session-Dauer-Statistiken
- Fehler-Muster

**UI-Element:** Analytics-Dashboard, Trend-Grafiken

---

## Dashboard-Design

### Haupt-Dashboard (Cross-Tenant)

```
+----------------------------------------------------------+
|  AVD Overview                              [Alle Tenants v]|
+----------------------------------------------------------+
|                                                          |
|  +----------------+  +----------------+  +----------------+
|  |   12 / 15     |  |   85 / 120    |  |   3 Probleme  |
|  |  Host Pools   |  |   Sessions    |  |               |
|  |  [OK: 12]     |  |  [Kapazitaet  |  |  [2 Hosts     |
|  |               |  |   71%]        |  |   unavailable]|
|  +----------------+  +----------------+  +----------------+
|                                                          |
|  Host Pools mit Problemen:                              |
|  +------------------------------------------------------+
|  | Kunde A - Production  |  1 Host unavailable  | [Fix] |
|  | Kunde B - Dev         |  FSLogix Fehler      | [Fix] |
|  +------------------------------------------------------+
|                                                          |
|  Alle Host Pools:                                        |
|  +------------------------------------------------------+
|  | Pool          | Hosts | Sessions | Status | Actions  |
|  |---------------|-------|----------|--------|----------|
|  | Kunde A Prod  | 5/5   | 23/50    | OK     | [...]    |
|  | Kunde A Dev   | 2/3   | 5/30     | WARN   | [...]    |
|  | Kunde B Prod  | 8/8   | 67/80    | OK     | [...]    |
|  +------------------------------------------------------+
+----------------------------------------------------------+
```

### Host-Pool-Detail

```
+----------------------------------------------------------+
|  < Zurueck   Kunde A - Production Pool                   |
+----------------------------------------------------------+
|                                                          |
|  Kapazitaet: [==================----] 85%   (42/50)     |
|                                                          |
|  Session Hosts:                                          |
|  +------------------------------------------------------+
|  | Host     | Status    | Sessions | CPU | Mem | Actions|
|  |----------|-----------|----------|-----|-----|--------|
|  | avd-01   | Available | 12/10    | 78% | 65% | [...]  |
|  | avd-02   | Available | 10/10    | 45% | 52% | [...]  |
|  | avd-03   | Available | 10/10    | 62% | 71% | [...]  |
|  | avd-04   | Drain     | 8/10     | 32% | 45% | [...]  |
|  | avd-05   | Shutdown  | 0/10     | -   | -   | [Start]|
|  +------------------------------------------------------+
|                                                          |
|  Performance (letzte 24h):                               |
|  [Graph: Sessions ueber Zeit]                            |
|  [Graph: Avg CPU/Memory]                                 |
|                                                          |
+----------------------------------------------------------+
```

### Session-Host-Detail

```
+----------------------------------------------------------+
|  < Zurueck   avd-01.domain.local                         |
+----------------------------------------------------------+
|                                                          |
|  Status: Available | Sessions: 12/10 | Uptime: 14d 3h   |
|                                                          |
|  [Drain Mode] [Restart] [Stop] [Send Message to All]    |
|                                                          |
|  Aktive Sessions:                                        |
|  +------------------------------------------------------+
|  | Benutzer           | Seit     | Typ     | Actions   |
|  |--------------------|----------|---------|-----------|
|  | max@contoso.com    | 08:15    | Desktop | [x] [msg] |
|  | anna@contoso.com   | 09:30    | Desktop | [x] [msg] |
|  | ...                |          |         |           |
|  +------------------------------------------------------+
|                                                          |
|  Performance:                                            |
|  CPU:    [==============------] 72%                     |
|  Memory: [============--------] 65%                     |
|  Disk:   [====----------------] 23%                     |
|                                                          |
|  Letzte Events:                                          |
|  - 10:15 Session connected: peter@contoso.com           |
|  - 09:45 FSLogix profile loaded: anna@contoso.com       |
|  - 09:30 Session connected: anna@contoso.com            |
|                                                          |
+----------------------------------------------------------+
```

---

## Technische Implementierung

### API-Endpunkte (neu)

```typescript
// Performance-Metriken
GET /tenants/:id/avd/host-pools/:poolId/metrics
  ?timeRange=1h|6h|24h|7d
  &metrics=cpu,memory,disk,network

// Session-Statistiken
GET /tenants/:id/avd/analytics/sessions
  ?timeRange=24h|7d|30d
  
// Alerts/Probleme
GET /tenants/:id/avd/alerts
  ?status=active|resolved
```

### Caching-Strategie

| Daten | Cache-TTL | Quelle |
|-------|-----------|--------|
| Host-Status | 30 Sek | ARM API |
| Session-Liste | 30 Sek | ARM API |
| CPU/Memory | 5 Min | Azure Monitor |
| Login-Zeiten | 1 Stunde | Log Analytics |
| Trend-Daten | 1 Stunde | Log Analytics |

### Azure Monitor Integration

```typescript
// Beispiel: CPU-Metriken abrufen
const metrics = await monitorClient.metrics.list(
  vmResourceId,
  {
    timespan: 'PT1H',
    interval: 'PT5M',
    metricnames: 'Percentage CPU',
    aggregation: 'Average'
  }
);
```

### Log Analytics Integration

```kusto
// Login-Dauer-Analyse
WVDConnections
| where TimeGenerated > ago(24h)
| where State == "Connected"
| summarize 
    AvgLoginTime = avg(DurationMs),
    P95LoginTime = percentile(DurationMs, 95)
  by HostPool, bin(TimeGenerated, 1h)
```

---

## Differenzierung zu Nerdio/Hydra

### Was sie gut machen
- Pre-built Dashboards (kein KQL noetig)
- Drill-down von Uebersicht zu Detail
- Alerts ohne Azure Monitor Konfiguration
- Historische Trends

### Was wir BESSER machen koennen
1. **Multi-Tenant-First**: Alle Kunden auf einen Blick
2. **Action-Oriented**: Problem sehen → loesen im selben View
3. **Keine Zusatzkosten**: Kein separates Log Analytics Workspace noetig (optional)
4. **Schneller**: Echtzeit-Status statt Log-basiert wo moeglich
5. **Keyboard-First**: Power-User koennen ohne Maus arbeiten

---

## Implementierungs-Reihenfolge

1. **Status-Dashboard** (Ebene 1) - 2 Tage
   - Host-Pool-Uebersicht
   - Session-Host-Liste
   - Real-time Status

2. **Performance-Sparklines** (Ebene 2) - 2 Tage
   - Azure Monitor Integration
   - CPU/Memory in Host-Liste
   - Mini-Graphen

3. **Detail-Views mit Graphen** - 2 Tage
   - Host-Pool-Detail
   - Session-Host-Detail
   - Performance-Graphen

4. **Analytics** (Ebene 3) - 3 Tage
   - Log Analytics Integration (optional)
   - Login-Zeit-Analyse
   - Trend-Dashboards

5. **Alerting** - 2 Tage
   - Alert-Regeln definieren
   - Benachrichtigungen
   - Alert-Historie
