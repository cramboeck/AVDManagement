# Spezifikations-Zusammenfassung

## Erstellte Dokumente

| Dokument | Pfad | Inhalt |
|----------|------|--------|
| ADR-001 | docs/adr/001-authentication-model.md | GDAP + App-Consent Hybrid |
| ADR-002 | docs/adr/002-exchange-online-access.md | Graph + Container-PowerShell-Runner |
| ADR-003 | docs/adr/003-module-contract.md | ModuleContract-Interface |
| ADR-004 | docs/adr/004-job-queue-throttling.md | BullMQ + Redis, Preview-Flow |
| ADR-005 | docs/adr/005-data-caching.md | Selektive Spiegelung, Delta-Sync |
| ADR-006 | docs/adr/006-secrets-lifecycle.md | Key Vault pro Deployment |
| ADR-007 | docs/adr/007-multi-msp-tenancy.md | SaaS + Self-Hosted, RLS |
| Domaenenmodell | docs/domain/domain-model.md | Entitaeten, Beziehungen, Audit |
| DBML-Schema | docs/domain/domain-model.dbml | Datenbankschema |
| OpenAPI | docs/api/openapi.yaml | API-Vertrag (RFC 9457) |
| ModuleContract | docs/contracts/module-contract.ts | TypeScript-Interface |
| Defender-Beispiel | docs/contracts/defender-module-example.ts | Vollstaendiges Modul-Beispiel |
| Beta-Scope | docs/beta-scope.md | 25 Aktionen ueber 5 Module |
| Risikoregister | docs/risk-register.md | 17 Risiken mit Gegenmassnahmen |

---

## Drei Entscheidungen mit hoechster Unsicherheit

### 1. Container-basierter PowerShell-Runner (ADR-002)

**Unsicherheit:** Die Container-Isolation ist sicher, aber die Latenz (~2-5s pro Job-Start) koennte die UX beeintraechtigen. Ein Runspace-Pool waere schneller, aber riskanter.

**Offene Frage:** Ist die Latenz fuer MSP-Admins akzeptabel, wenn sie auf das Ergebnis warten muessen? Oder brauchen wir einen hybriden Ansatz (Runspace-Pool fuer low-risk-Cmdlets, Container fuer high-risk)?

**Empfehlung:** Mit Containern starten, Latenz messen, bei Bedarf Runspace-Pool fuer sichere Read-Only-Cmdlets ergaenzen.

---

### 2. Row-Level Security fuer Multi-MSP (ADR-007)

**Unsicherheit:** RLS in PostgreSQL ist solide, aber erfordert disziplinierte Implementierung. Ein einziger Codepfad ohne `SET app.current_msp_id` koennte Daten exponieren.

**Offene Frage:** Ist RLS ausreichend, oder sollte es fuer maximale Sicherheit doch separate Datenbanken pro MSP geben?

**Empfehlung:** RLS mit automatischer Middleware, die den MSP-Context setzt. Zusaetzlich ein Integration-Test, der versucht, Cross-MSP-Zugriff zu bekommen. Separate Datenbanken als Upgrade-Pfad fuer Enterprise-Kunden anbieten.

---

### 3. Distributor-API-Integration fuer Lizenzbestellung (Beta-Scope)

**Unsicherheit:** ADN hat eine API, aber Dokumentation und Stabilitaet sind nicht bekannt. Integration koennte aufwaendiger sein als gedacht.

**Offene Frage:** Soll die ADN-Integration in die Beta, oder ist manuelles Portal-Bestellen akzeptabel, waehrend die API-Integration in Phase 2 kommt?

**Empfehlung:** ADN-API frueh evaluieren. Wenn stabil, in Beta aufnehmen. Wenn nicht, als "coming soon" markieren und Lizenz-Anzeige/-Zuweisung ohne Bestellung launchen.

---

## Naechster Schritt

Freigabe der Spezifikation abwarten, dann mit der Implementierung der Core-Infrastruktur beginnen:

1. Projekt-Setup (package.json, tsconfig.json, .gitignore)
2. Core-Module: Registry, Provider-Interface, Job-Queue
3. Erstes Fachmodul: Identity (am wenigsten externe Abhaengigkeiten)
