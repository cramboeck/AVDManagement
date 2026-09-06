# ADR-002: Exchange-Online-Zugriff

**Status:** Vorgeschlagen  
**Datum:** 2026-09-06  
**Entscheider:** Christoph Ramboeck  

## Kontext

Exchange Online bietet zwei Zugangswege:
1. **Microsoft Graph API:** REST-basiert, moderne Authentifizierung
2. **Exchange Online PowerShell (EXO PS):** Vollstaendiger Funktionsumfang

Graph deckt ca. 60-70% der Admin-Szenarien ab. Kritische Funktionen fehlen.

## Graph-Abdeckung vs. PowerShell-Pflicht

| Funktion | Graph | EXO PS |
|----------|-------|--------|
| Mailbox-Eigenschaften lesen | Ja | Ja |
| Mailbox erstellen/loeschen | Ja | Ja |
| Shared Mailbox Permissions | Nein | Ja |
| Send-As / Send-on-Behalf | Nein | Ja |
| Transport Rules | Nein | Ja |
| Mailbox Quota setzen | Nein | Ja |
| Mail Flow Tracking | Nein | Ja |
| Address Book Policies | Nein | Ja |
| Retention Policies (granular) | Teilweise | Ja |
| Mailbox Forwarding | Ja | Ja |
| Out-of-Office | Ja | Ja |
| Distribution Groups | Ja | Ja |

## Optionen

### Option A: Graph-Only

Nur Graph-unterstuetzte Funktionen anbieten.

| Vorteile | Nachteile |
|----------|-----------|
| Einfache Architektur | Feature-Luecken bei Kernfunktionen |
| Kein PowerShell-Runtime | Shared Mailbox Permissions fehlen |
| Einheitliches Auth-Modell | Transport Rules nicht verwaltbar |

### Option B: PowerShell-Runner (Container-basiert)

Isolierte Container fuehren EXO-PS-Befehle aus.

| Vorteile | Nachteile |
|----------|-----------|
| Voller EXO-Funktionsumfang | Komplexere Infrastruktur |
| Sichere Isolation pro Tenant | Container-Orchestrierung noetig |
| Kein Credential-Leak zwischen Tenants | Latenz durch Container-Start |
| Skalierbar | PowerShell-Modul-Updates |

### Option C: Shared Runspace Pool

Ein Pool von PowerShell-Runspaces, Credentials werden pro Job injiziert.

| Vorteile | Nachteile |
|----------|-----------|
| Schnellere Ausfuehrung | Risiko bei Runspace-Wiederverwendung |
| Weniger Infrastruktur | Memory-Leaks moeglich |
| Einfacheres Deployment | Keine echte Isolation |

## Entscheidung

**Option B: PowerShell-Runner (Container-basiert)**

Begruendung:
1. Sicherheitsanforderung: Tool hat Admin-Rechte auf Produktivtenants
2. Tenant-Isolation ist harte Anforderung (CLAUDE.md Prinzip 6)
3. Shared Mailbox Permissions ist MSP-Kernfunktion

## Implementierung

### Architektur

```
┌─────────────────────────────────────────────────────┐
│                   ZeroStress API                     │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────┐    ┌─────────────────────────────┐ │
│  │ Graph       │    │ PowerShell Job Queue        │ │
│  │ Provider    │    │                             │ │
│  └─────────────┘    │  Job ──► Container Pool     │ │
│                     │         ┌───────────────┐   │ │
│                     │         │ PS Container  │   │ │
│                     │         │ - EXO Module  │   │ │
│                     │         │ - Tenant Cred │   │ │
│                     │         │ - Timeout     │   │ │
│                     │         └───────────────┘   │ │
│                     └─────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Container-Spezifikation

```dockerfile
FROM mcr.microsoft.com/powershell:7.4-alpine

RUN pwsh -Command "Install-Module -Name ExchangeOnlineManagement -Force -Scope AllUsers"

COPY scripts/exo-runner.ps1 /app/
WORKDIR /app

# Kein persistenter State
# Credentials via Environment (aus Key Vault)
# Timeout: 5 Minuten max

ENTRYPOINT ["pwsh", "-File", "/app/exo-runner.ps1"]
```

### Job-Ablauf

1. API empfaengt EXO-Aktion (z.B. "Add-MailboxPermission")
2. Job wird in Queue eingereiht mit:
   - TenantId
   - Cmdlet + Parameter (validiert gegen Allowlist)
   - Correlation-Id fuer Audit
3. Container-Orchestrator startet Container
4. Container:
   - Laedt Credentials aus Key Vault (Managed Identity)
   - Verbindet zu EXO (`Connect-ExchangeOnline -CertificateThumbprint`)
   - Fuehrt Cmdlet aus
   - Schreibt Ergebnis in Job-Result-Store
   - Terminiert (kein Cleanup noetig)
5. API pollt/empfaengt Ergebnis
6. Audit-Eintrag wird geschrieben

### Cmdlet-Allowlist

Nur explizit freigegebene Cmdlets sind ausfuehrbar:

```typescript
const EXO_CMDLET_ALLOWLIST = [
  'Get-Mailbox',
  'Set-Mailbox',
  'Add-MailboxPermission',
  'Remove-MailboxPermission',
  'Get-MailboxPermission',
  'Add-RecipientPermission',      // Send-As
  'Remove-RecipientPermission',
  'Get-TransportRule',
  'New-TransportRule',
  'Set-TransportRule',
  'Remove-TransportRule',
  'Get-MailboxStatistics',
  // ... weitere nach Bedarf
] as const;
```

### Skalierung

- **Kubernetes:** Horizontal Pod Autoscaler basierend auf Queue-Laenge
- **Azure Container Instances:** Serverless, Pay-per-Use
- **Concurrency-Limit:** Max 3 Container pro Tenant (Throttling-Schutz)

## Konsequenzen

### Positiv
- Voller EXO-Funktionsumfang verfuegbar
- Sichere Tenant-Isolation
- Unabhaengig von Graph-Roadmap

### Negativ
- Container-Infrastruktur erforderlich
- ~2-5 Sekunden Latenz fuer Container-Start
- EXO-Modul-Updates muessen in Container-Image gepflegt werden

### Risiken
- Microsoft deprecates Certificate-based Auth fuer EXO (unwahrscheinlich kurzfristig)
- Container-Image-Groesse (~500MB mit PowerShell + EXO)

## Revidierbarkeit

**Hoch.** Graph-Provider und PS-Runner sind unabhaengig. Falls Graph EXO-Luecken schliesst, kann PS-Runner schrittweise zurueckgebaut werden.
