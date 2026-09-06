# Domaenenmodell ZeroStress Cockpit

## Uebersicht

Das Domaenenmodell beschreibt die zentralen Entitaeten, ihre Beziehungen und
das Tenant-Scoping. Alle Entitaeten sind entweder MSP-scoped oder
MSP+Tenant-scoped.

## Entitaeten

### Organisationsebene (MSP-scoped)

**MspOrganization**
Der MSP als Kunde von ZeroStress Cockpit. Container fuer alle weiteren Daten.

| Attribut | Typ | Beschreibung |
|----------|-----|--------------|
| id | UUID | Primaerschluessel |
| name | string | Anzeigename des MSP |
| slug | string | URL-sicherer Identifier (Subdomain) |
| branding | JSON | White-Label-Konfiguration |
| customDomain | string? | Eigene Domain fuer Konsole |
| subscriptionTier | enum | starter, professional, enterprise |
| isActive | boolean | Aktiv/Deaktiviert |
| createdAt | timestamp | Erstellungszeitpunkt |

**MspUser**
Benutzer der Konsole (MSP-Mitarbeiter), NICHT Endkunden.

| Attribut | Typ | Beschreibung |
|----------|-----|--------------|
| id | UUID | Primaerschluessel |
| mspId | UUID | FK zu MspOrganization |
| entraObjectId | string | Entra-ID-Objekt-ID |
| email | string | E-Mail-Adresse |
| displayName | string | Anzeigename |
| role | enum | admin, operator, viewer |
| isActive | boolean | Aktiv/Deaktiviert |
| lastLoginAt | timestamp? | Letzter Login |

### Tenant-Ebene (MSP+Tenant-scoped)

**ManagedTenant**
Ein Microsoft-365-Tenant, der vom MSP verwaltet wird.

| Attribut | Typ | Beschreibung |
|----------|-----|--------------|
| id | UUID | Primaerschluessel |
| mspId | UUID | FK zu MspOrganization |
| microsoftTenantId | string | Microsoft Tenant GUID |
| displayName | string | Anzeigename |
| primaryDomain | string | Primaere Domain |
| authMethod | enum | gdap, app-consent |
| onboardedAt | timestamp | Zeitpunkt des Onboardings |
| lastSyncAt | timestamp? | Letzter erfolgreicher Sync |
| syncStatus | enum | pending, syncing, synced, error |
| isActive | boolean | Aktiv/Deaktiviert |

### Gespiegelte Entitaeten (von Microsoft, MSP+Tenant-scoped)

**SyncedUser**
Gespiegelter Benutzer aus Microsoft Graph. DSGVO-relevant.

| Attribut | Typ | Beschreibung |
|----------|-----|--------------|
| id | UUID | Primaerschluessel |
| mspId | UUID | FK zu MspOrganization |
| tenantId | UUID | FK zu ManagedTenant |
| microsoftId | string | Microsoft User GUID |
| userPrincipalName | string | UPN |
| displayName | string | Anzeigename |
| mail | string? | E-Mail-Adresse |
| accountEnabled | boolean | Konto aktiv |
| syncedAt | timestamp | Letzter Sync |

**SyncedDevice**
Gespiegeltes Geraet aus Intune.

| Attribut | Typ | Beschreibung |
|----------|-----|--------------|
| id | UUID | Primaerschluessel |
| mspId | UUID | FK zu MspOrganization |
| tenantId | UUID | FK zu ManagedTenant |
| microsoftId | string | Microsoft Device GUID |
| deviceName | string | Geraetename |
| operatingSystem | string | Betriebssystem |
| osVersion | string | OS-Version |
| complianceState | enum | compliant, noncompliant, unknown |
| lastSyncDateTime | timestamp | Letzter Intune-Sync |
| syncedAt | timestamp | Letzter ZeroStress-Sync |

**SyncedHostPool**
Gespiegelter AVD Host Pool.

| Attribut | Typ | Beschreibung |
|----------|-----|--------------|
| id | UUID | Primaerschluessel |
| mspId | UUID | FK zu MspOrganization |
| tenantId | UUID | FK zu ManagedTenant |
| azureResourceId | string | Azure Resource ID |
| name | string | Host-Pool-Name |
| resourceGroup | string | Resource Group |
| hostPoolType | enum | personal, pooled |
| loadBalancerType | enum | breadthFirst, depthFirst |
| maxSessionLimit | int | Max Sessions pro Host |
| syncedAt | timestamp | Letzter Sync |

**SyncedSessionHost**
Gespiegelter AVD Session Host.

| Attribut | Typ | Beschreibung |
|----------|-----|--------------|
| id | UUID | Primaerschluessel |
| mspId | UUID | FK zu MspOrganization |
| tenantId | UUID | FK zu ManagedTenant |
| hostPoolId | UUID | FK zu SyncedHostPool |
| azureResourceId | string | Azure Resource ID |
| name | string | VM-Name |
| status | enum | available, unavailable, shutdown |
| sessions | int | Aktive Sessions |
| lastHeartbeat | timestamp | Letzter Heartbeat |
| syncedAt | timestamp | Letzter Sync |

### Job-System (MSP+Tenant-scoped)

**Job**
Asynchrone Aktion im System.

| Attribut | Typ | Beschreibung |
|----------|-----|--------------|
| id | UUID | Primaerschluessel |
| mspId | UUID | FK zu MspOrganization |
| tenantId | UUID | FK zu ManagedTenant |
| type | string | Job-Typ (z.B. "avd.start-session-host") |
| payload | JSON | Job-spezifische Daten |
| status | enum | pending, preview-ready, approved, running, completed, failed, cancelled |
| priority | enum | low, normal, high, critical |
| createdBy | UUID | FK zu MspUser |
| createdAt | timestamp | Erstellungszeitpunkt |
| startedAt | timestamp? | Startzeitpunkt |
| completedAt | timestamp? | Abschlusszeitpunkt |
| result | JSON? | Ergebnis bei Erfolg |
| error | JSON? | Fehlerdetails bei Fehlschlag |
| retryCount | int | Anzahl Retry-Versuche |
| maxRetries | int | Maximale Retries |
| correlationId | UUID | Verkettungs-ID fuer Audit |
| parentJobId | UUID? | FK zu uebergeordnetem Job |
| preview | JSON? | Preview/Diff vor Ausfuehrung |

### Audit (MSP+Tenant-scoped, unveraenderlich)

**AuditEntry**
Unveraenderlicher Audit-Eintrag fuer jede Aktion.

| Attribut | Typ | Beschreibung |
|----------|-----|--------------|
| id | UUID | Primaerschluessel |
| mspId | UUID | FK zu MspOrganization |
| tenantId | UUID? | FK zu ManagedTenant (optional fuer MSP-Aktionen) |
| timestamp | timestamp | Zeitpunkt der Aktion |
| userId | UUID | FK zu MspUser (Ausfuehrender) |
| action | string | Aktions-Identifier (z.B. "user.disable") |
| targetType | string | Ziel-Entitaetstyp (z.B. "user") |
| targetId | string | Ziel-ID |
| targetDisplayName | string | Ziel-Anzeigename (zum Zeitpunkt der Aktion) |
| beforeState | JSON? | Zustand vor Aenderung |
| afterState | JSON? | Zustand nach Aenderung |
| result | enum | success, failure, partial |
| errorMessage | string? | Fehlermeldung bei Fehlschlag |
| correlationId | UUID | Verkettungs-ID |
| ipAddress | string | IP-Adresse des Clients |
| userAgent | string | Browser/Client |

## Beziehungen

```
MspOrganization
    │
    ├──< MspUser (1:n)
    │
    ├──< ManagedTenant (1:n)
    │       │
    │       ├──< SyncedUser (1:n)
    │       ├──< SyncedDevice (1:n)
    │       ├──< SyncedHostPool (1:n)
    │       │       └──< SyncedSessionHost (1:n)
    │       ├──< Job (1:n)
    │       └──< AuditEntry (1:n)
    │
    └──< AuditEntry (1:n, MSP-level)
```

## Tenant-Scoping

Jede Datenbankabfrage MUSS durch Row-Level Security oder explizite WHERE-Klausel
auf den aktuellen MSP-Kontext eingeschraenkt sein.

```sql
-- Beispiel: Alle Benutzer eines Tenants
SELECT * FROM synced_users
WHERE msp_id = current_setting('app.current_msp_id')::uuid
  AND tenant_id = :tenantId;
```

## Audit-Struktur

Jeder Audit-Eintrag ist unveraenderlich (INSERT-only, kein UPDATE/DELETE).

### Pflichtfelder

- `mspId`: Immer gesetzt
- `timestamp`: Server-Zeitstempel, nicht Client
- `userId`: Immer der ausfuehrende Benutzer
- `action`: Strukturierter Identifier (modul.aktion)
- `correlationId`: Verkettet zusammengehoerige Eintraege

### Vorher-/Nachher-Werte

Fuer aendernde Aktionen werden nur die geaenderten Felder gespeichert:

```json
{
  "beforeState": {
    "accountEnabled": true,
    "displayName": "Max Mustermann"
  },
  "afterState": {
    "accountEnabled": false,
    "displayName": "Max Mustermann"
  }
}
```

### Keine PII in Logs

Personenbezogene Daten werden durch IDs referenziert, nicht dupliziert:

```json
{
  "action": "user.disable",
  "targetType": "user",
  "targetId": "a1b2c3d4-...",
  "targetDisplayName": "Max M."  // Gekuerzt
}
```
