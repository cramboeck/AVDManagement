# Risikoregister ZeroStress Cockpit

## Risiko-Bewertung

- **Wahrscheinlichkeit:** Niedrig (N), Mittel (M), Hoch (H)
- **Auswirkung:** Niedrig (N), Mittel (M), Hoch (H), Kritisch (K)
- **Risiko-Level:** Wahrscheinlichkeit x Auswirkung

---

## Technische Risiken

### TECH-001: Graph-API-Aenderungen brechen Integration

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | Microsoft aendert Graph-API-Verhalten oder depreciert Endpunkte ohne ausreichende Vorwarnung |
| **Wahrscheinlichkeit** | Mittel |
| **Auswirkung** | Hoch |
| **Risiko-Level** | Hoch |
| **Fruehwarnindikator** | Microsoft 365 Roadmap, Graph-Changelog, Breaking-Change-Announcements |
| **Gegenmassnahme** | API-Versionierung nutzen, Integrationstest-Suite gegen Live-Graph, Monitoring auf 4xx-Fehlerraten |

### TECH-002: GDAP-Aenderungen durch Microsoft

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | Microsoft aendert GDAP-Anforderungen, neue Zustimmungsprozesse, Rollen-Mapping aendert sich |
| **Wahrscheinlichkeit** | Mittel |
| **Auswirkung** | Hoch |
| **Risiko-Level** | Hoch |
| **Fruehwarnindikator** | Partner Center Announcements, CSP-Newsletter, MVP-Community |
| **Gegenmassnahme** | Fallback auf App-Consent, regelmaessige Partner-Center-Pruefung |

### TECH-003: EXO-PowerShell-Modul-Inkompatibilitaet

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | Exchange Online PowerShell V3+ Modul hat Breaking Changes, Container-Image veraltet |
| **Wahrscheinlichkeit** | Mittel |
| **Auswirkung** | Mittel |
| **Risiko-Level** | Mittel |
| **Fruehwarnindikator** | EXO-Modul-Releases auf PSGallery, Microsoft Tech Community |
| **Gegenmassnahme** | Automatisierte Container-Image-Updates, Pinning auf getestete Version, Graph-Migration wo moeglich |

### TECH-004: Throttling-Limits ueberschritten

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | Zu viele API-Calls fuehren zu 429-Errors, Tenants werden temporaer blockiert |
| **Wahrscheinlichkeit** | Hoch |
| **Auswirkung** | Mittel |
| **Risiko-Level** | Hoch |
| **Fruehwarnindikator** | Steigende 429-Rate in Monitoring, Retry-Queue-Laenge |
| **Gegenmassnahme** | Batch-Requests, Delta-Queries, adaptive Throttling, per-Tenant-Concurrency-Limits |

### TECH-005: Key-Vault-Ausfall blockiert Authentifizierung

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | Azure Key Vault nicht erreichbar, keine Token-Akquisition moeglich |
| **Wahrscheinlichkeit** | Niedrig |
| **Auswirkung** | Kritisch |
| **Risiko-Level** | Hoch |
| **Fruehwarnindikator** | Azure-Status-Page, Key-Vault-Latenz-Metriken |
| **Gegenmassnahme** | Local Secret Cache (kurze TTL), Multi-Region Key Vault, Degraded-Mode ohne Schreiboperationen |

### TECH-006: Daten-Inkonsistenz durch Delta-Sync-Fehler

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | Delta-Token ungueltig, Sync verpasst Aenderungen, lokale Daten veraltet |
| **Wahrscheinlichkeit** | Mittel |
| **Auswirkung** | Mittel |
| **Risiko-Level** | Mittel |
| **Fruehwarnindikator** | Delta-Token-Expiry-Warnungen, Sync-Fehler-Rate, Benutzer-Feedback zu veralteten Daten |
| **Gegenmassnahme** | Full-Sync als Fallback, TTL-basierte Revalidierung, Sync-Status-Dashboard |

---

## Lizenzrechtliche Risiken

### LIC-001: AGPL-Kontamination aus CIPP

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | Versehentliche Uebernahme von Code/Konfiguration aus CIPP (AGPL-3.0), rechtliche Konsequenzen |
| **Wahrscheinlichkeit** | Niedrig |
| **Auswirkung** | Kritisch |
| **Risiko-Level** | Hoch |
| **Fruehwarnindikator** | Code-Review, CLAUDE.md-Anweisung beachtet |
| **Gegenmassnahme** | Klare Anweisung in CLAUDE.md, nur Microsoft-Doku als Quelle, Review bei Unsicherheit |

### LIC-002: Microsoft-API-Nutzungsbedingungen

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | Verstoss gegen Microsoft Graph ToS (z.B. Caching-Limits, Datenextraktion) |
| **Wahrscheinlichkeit** | Niedrig |
| **Auswirkung** | Hoch |
| **Risiko-Level** | Mittel |
| **Fruehwarnindikator** | Microsoft-Kontakt, ToS-Updates |
| **Gegenmassnahme** | ToS regelmaessig pruefen, Caching-Policies dokumentieren, Legal-Review |

### LIC-003: CSP-Distributor-Vertragsverletzung

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | API-Nutzung von ADN/Ingram verstoesst gegen Nutzungsbedingungen |
| **Wahrscheinlichkeit** | Niedrig |
| **Auswirkung** | Mittel |
| **Risiko-Level** | Niedrig |
| **Fruehwarnindikator** | Distributor-Kommunikation |
| **Gegenmassnahme** | Vor Integration Freigabe einholen, API-Dokumentation beachten |

---

## Microsoft-Partner-Risiken

### MSP-001: Publisher Verification scheitert

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | App kann nicht verifiziert werden, Consent-UX fuer Kunden schlecht |
| **Wahrscheinlichkeit** | Mittel |
| **Auswirkung** | Mittel |
| **Risiko-Level** | Mittel |
| **Fruehwarnindikator** | Verification-Anforderungen, MPN-Status |
| **Gegenmassnahme** | MPN-ID aktuell halten, Domain-Verification frueh starten, Dokumentation bereithalten |

### MSP-002: CSP-Partnerschaft Aenderungen

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | Microsoft aendert CSP-Programm-Anforderungen, hoeherer Aufwand fuer Compliance |
| **Wahrscheinlichkeit** | Mittel |
| **Auswirkung** | Mittel |
| **Risiko-Level** | Mittel |
| **Fruehwarnindikator** | Partner Center Announcements, CSP-Newsletter |
| **Gegenmassnahme** | CSP-Anforderungen regelmaessig pruefen, Compliance-Dokumentation bereithalten |

### MSP-003: App-Consent wird von Kunden-IT blockiert

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | Kundenadmins verweigern App-Consent wegen fehlender Publisher Verification |
| **Wahrscheinlichkeit** | Mittel |
| **Auswirkung** | Mittel |
| **Risiko-Level** | Mittel |
| **Fruehwarnindikator** | Onboarding-Abbrueche, Kundenfeedback |
| **Gegenmassnahme** | Publisher Verification priorisieren, GDAP als Alternative anbieten, Vertrauensdokumentation |

---

## Sicherheitsrisiken

### SEC-001: Credential-Leak

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | Zertifikate oder Secrets werden kompromittiert, Angreifer hat Admin-Zugriff auf Kundentenants |
| **Wahrscheinlichkeit** | Niedrig |
| **Auswirkung** | Kritisch |
| **Risiko-Level** | Hoch |
| **Fruehwarnindikator** | Unbekannte Sign-Ins, Audit-Log-Anomalien, Secret-Scan-Alerts |
| **Gegenmassnahme** | Key Vault mit Managed Identity, keine Secrets in Code/Logs, Rotation-Policy, MFA-Pflicht |

### SEC-002: SQL-Injection umgeht RLS

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | SQL-Injection erlaubt Zugriff auf Daten anderer MSPs trotz Row-Level Security |
| **Wahrscheinlichkeit** | Niedrig |
| **Auswirkung** | Kritisch |
| **Risiko-Level** | Hoch |
| **Fruehwarnindikator** | Security-Audit, Penetrationstest |
| **Gegenmassnahme** | Prepared Statements, ORM, kein Raw SQL, regelmaessige Security-Audits |

### SEC-003: Insider-Threat durch MSP-Mitarbeiter

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | MSP-Admin missbraucht Zugriff auf Kundentenants |
| **Wahrscheinlichkeit** | Niedrig |
| **Auswirkung** | Hoch |
| **Risiko-Level** | Mittel |
| **Fruehwarnindikator** | Ungewoehnliche Aktivitaeten im Audit-Log |
| **Gegenmassnahme** | Vollstaendiges Audit-Log, 4-Augen-Prinzip fuer kritische Aktionen, regelmaessige Log-Review |

---

## Geschaeftliche Risiken

### BIZ-001: Keine Kunden fuer SaaS-Modell

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | Andere MSPs kaufen das Produkt nicht, nur interne Nutzung |
| **Wahrscheinlichkeit** | Mittel |
| **Auswirkung** | Mittel |
| **Risiko-Level** | Mittel |
| **Fruehwarnindikator** | Wenig Interesse nach Launch, keine Demos-Anfragen |
| **Gegenmassnahme** | Produkt zuerst selbst produktiv nutzen, Problem-Fit validieren, Feedback einholen |

### BIZ-002: Wettbewerber (Nerdio, CIPP) ziehen Features vor

| Aspekt | Bewertung |
|--------|-----------|
| **Beschreibung** | Etablierte Wettbewerber implementieren dieselben Features schneller |
| **Wahrscheinlichkeit** | Hoch |
| **Auswirkung** | Mittel |
| **Risiko-Level** | Hoch |
| **Fruehwarnindikator** | Wettbewerber-Release-Notes, Community-Feedback |
| **Gegenmassnahme** | UX-Fokus als Differenzierung, Nischen-Features, schnelle Iterationen |

---

## Risiko-Matrix

| Risiko-ID | Risiko | W | A | Level |
|-----------|--------|---|---|-------|
| SEC-001 | Credential-Leak | N | K | Hoch |
| SEC-002 | SQL-Injection umgeht RLS | N | K | Hoch |
| LIC-001 | AGPL-Kontamination | N | K | Hoch |
| TECH-001 | Graph-API-Aenderungen | M | H | Hoch |
| TECH-002 | GDAP-Aenderungen | M | H | Hoch |
| TECH-004 | Throttling-Limits | H | M | Hoch |
| TECH-005 | Key-Vault-Ausfall | N | K | Hoch |
| BIZ-002 | Wettbewerber | H | M | Hoch |
| TECH-003 | EXO-PowerShell-Inkompatibilitaet | M | M | Mittel |
| TECH-006 | Delta-Sync-Fehler | M | M | Mittel |
| MSP-001 | Publisher Verification | M | M | Mittel |
| MSP-002 | CSP-Aenderungen | M | M | Mittel |
| MSP-003 | Consent blockiert | M | M | Mittel |
| SEC-003 | Insider-Threat | N | H | Mittel |
| LIC-002 | API-ToS | N | H | Mittel |
| BIZ-001 | Keine Kunden | M | M | Mittel |
| LIC-003 | Distributor-Vertrag | N | M | Niedrig |

---

## Monitoring-Empfehlungen

1. **API-Fehlerraten:** Alerts bei >5% 4xx/5xx
2. **Throttling:** Dashboard fuer 429-Rate pro Tenant
3. **Sync-Status:** Warnung bei Sync-Alter >1h
4. **Key-Vault-Latenz:** Alert bei >500ms P99
5. **Audit-Anomalien:** Ungewoehnliche Zugriffszeiten, Geo-Anomalien
6. **Credential-Expiry:** 30/7/1-Tage-Warnungen
7. **Graph-Changelog:** Woechentliche Pruefung auf Breaking Changes
