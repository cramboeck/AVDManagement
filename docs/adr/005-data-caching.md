# ADR-005: Datenhaltung und Caching

**Status:** Vorgeschlagen  
**Datum:** 2026-09-06  
**Entscheider:** Christoph Ramboeck  

## Kontext

ZeroStress Cockpit arbeitet mit Daten aus Microsoft Graph und Azure ARM. Entscheidungen:
1. Was wird lokal gespiegelt vs. live abgefragt?
2. Wie werden Daten aktuell gehalten (Polling vs. Delta-Queries vs. Webhooks)?
3. Welche DSGVO-Konsequenzen hat die Speicherung?

## Daten-Klassifikation

### Kategorie A: Immer Live

Daten, die sich staendig aendern oder sicherheitskritisch sind.

| Entitaet | Grund |
|----------|-------|
| Session-Status (AVD) | Echtzeit-Relevanz |
| Anmeldestatus | Sicherheitskritisch |
| Audit-Logs (Quelle) | Unveraenderlichkeit |
| Passwort-Reset-Status | Sicherheitskritisch |

### Kategorie B: Gespiegelt mit kurzer TTL

Daten, die sich selten aendern aber haeufig abgefragt werden.

| Entitaet | TTL | Delta-Query | DSGVO-Kategorie |
|----------|-----|-------------|-----------------|
| Benutzer (displayName, UPN, ID) | 15 min | Ja | Personenbezogen |
| Gruppen | 30 min | Ja | Organisationsdaten |
| Lizenzen (SKU-Zuweisungen) | 15 min | Nein | Organisationsdaten |
| Geraete (Intune) | 30 min | Ja | Geraetedaten |
| Host Pools (AVD) | 5 min | Nein | Infrastruktur |
| Session Hosts (AVD) | 5 min | Nein | Infrastruktur |

### Kategorie C: Langzeit-Cache

Selten aendernde Referenzdaten.

| Entitaet | TTL | DSGVO-Kategorie |
|----------|-----|-----------------|
| Lizenz-SKU-Definitionen | 24h | Keine |
| Azure-Regionen | 7d | Keine |
| Graph-Schema | 24h | Keine |

## Optionen

### Option A: Nur Live-Queries

Alle Daten werden bei Bedarf von Graph abgerufen.

| Vorteile | Nachteile |
|----------|-----------|
| Immer aktuell | Hohe Latenz |
| Keine DSGVO-Speicherung | Throttling bei vielen Anfragen |
| Einfache Architektur | Schlechte UX bei Listen |

### Option B: Full Sync (alle Daten lokal)

Alle Daten werden regelmaessig synchronisiert.

| Vorteile | Nachteile |
|----------|-----------|
| Schnelle Abfragen | Hoher Speicherbedarf |
| Offline-faehig | DSGVO-Dokumentation fuer alles |
| Komplexe Suche moeglich | Stale Data moeglich |

### Option C: Selektive Spiegelung (Hybrid)

Nur Kategorie B und C lokal, Kategorie A immer live.

| Vorteile | Nachteile |
|----------|-----------|
| Balance aus Performance und Aktualitaet | Zwei Datenpfade |
| Reduzierter DSGVO-Scope | Komplexere Invalidierung |
| Delta-Queries minimieren Sync-Last | |

## Entscheidung

**Option C: Selektive Spiegelung (Hybrid)**

Begruendung:
1. 15 Tenants mit je ~100-500 Usern = handhabbare Datenmenge
2. Schnelle Suche/Filterung ist MSP-Kernfunktion
3. Delta-Queries reduzieren Graph-Last erheblich
4. DSGVO-Scope ist ueberschaubar und dokumentierbar

## Implementierung

### Datenbank-Schema

```sql
-- Tenant-Metadaten (keine PII)
CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  microsoft_tenant_id VARCHAR(36) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  auth_method VARCHAR(20) NOT NULL, -- 'gdap' | 'app-consent'
  onboarded_at TIMESTAMPTZ NOT NULL,
  last_sync_at TIMESTAMPTZ,
  sync_status VARCHAR(20) NOT NULL DEFAULT 'pending'
);

-- Gespiegelte Benutzer (PII - DSGVO-relevant)
CREATE TABLE synced_users (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  microsoft_id VARCHAR(36) NOT NULL,
  user_principal_name VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  mail VARCHAR(255),
  account_enabled BOOLEAN,
  created_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL,
  delta_token TEXT,
  
  UNIQUE(tenant_id, microsoft_id)
);

-- Index fuer Tenant-Isolation
CREATE INDEX idx_synced_users_tenant ON synced_users(tenant_id);

-- Gespiegelte Geraete (Geraetedaten)
CREATE TABLE synced_devices (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  microsoft_id VARCHAR(36) NOT NULL,
  device_name VARCHAR(255),
  os_version VARCHAR(100),
  compliance_state VARCHAR(50),
  last_sync_datetime TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL,
  
  UNIQUE(tenant_id, microsoft_id)
);

-- AVD Host Pools (Infrastruktur, keine PII)
CREATE TABLE synced_host_pools (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  azure_resource_id TEXT NOT NULL,
  name VARCHAR(255) NOT NULL,
  host_pool_type VARCHAR(50),
  load_balancer_type VARCHAR(50),
  max_session_limit INT,
  synced_at TIMESTAMPTZ NOT NULL,
  
  UNIQUE(tenant_id, azure_resource_id)
);
```

### Delta-Sync Service

```typescript
// src/core/sync/delta-sync.ts

export interface DeltaSyncState {
  tenantId: TenantId;
  entityType: SyncableEntity;
  deltaToken: string | null;
  lastSyncAt: Date;
  lastSyncStatus: 'success' | 'partial' | 'failed';
}

export class DeltaSyncService {
  async syncUsers(tenantId: TenantId): Promise<SyncResult> {
    const state = await this.getSyncState(tenantId, 'users');
    const graphClient = await this.getGraphClient(tenantId);
    
    let url = '/users';
    const params = new URLSearchParams({
      '$select': 'id,userPrincipalName,displayName,mail,accountEnabled,createdDateTime',
    });
    
    if (state.deltaToken) {
      // Delta-Query: nur Aenderungen seit letztem Sync
      url = state.deltaToken;
    } else {
      // Initial-Sync: alle Benutzer
      params.set('$top', '999');
    }
    
    const changes: UserChange[] = [];
    let nextLink: string | undefined = `${url}?${params}`;
    let newDeltaToken: string | undefined;
    
    while (nextLink) {
      const response = await graphClient.get(nextLink);
      
      for (const user of response.value) {
        if (user['@removed']) {
          changes.push({ type: 'deleted', userId: user.id });
        } else {
          changes.push({ type: 'upsert', user });
        }
      }
      
      nextLink = response['@odata.nextLink'];
      newDeltaToken = response['@odata.deltaLink'];
    }
    
    // Aenderungen in DB schreiben
    await this.applyUserChanges(tenantId, changes);
    
    // Sync-State aktualisieren
    await this.updateSyncState(tenantId, 'users', {
      deltaToken: newDeltaToken ?? state.deltaToken,
      lastSyncAt: new Date(),
      lastSyncStatus: 'success',
    });
    
    return {
      entityType: 'users',
      added: changes.filter(c => c.type === 'upsert').length,
      deleted: changes.filter(c => c.type === 'deleted').length,
    };
  }
}
```

### TTL-basierter Cache

```typescript
// src/core/cache/tenant-cache.ts

export interface CacheConfig {
  readonly entity: string;
  readonly ttlSeconds: number;
  readonly refreshOnAccess: boolean;
}

export const CACHE_CONFIG: Record<string, CacheConfig> = {
  'users': { entity: 'users', ttlSeconds: 900, refreshOnAccess: false },
  'groups': { entity: 'groups', ttlSeconds: 1800, refreshOnAccess: false },
  'devices': { entity: 'devices', ttlSeconds: 1800, refreshOnAccess: false },
  'hostPools': { entity: 'hostPools', ttlSeconds: 300, refreshOnAccess: true },
  'sessionHosts': { entity: 'sessionHosts', ttlSeconds: 300, refreshOnAccess: true },
  'skuDefinitions': { entity: 'skuDefinitions', ttlSeconds: 86400, refreshOnAccess: false },
};

export class TenantCache {
  constructor(
    private readonly tenantId: TenantId,
    private readonly redis: Redis
  ) {}
  
  private key(entity: string): string {
    // Tenant-Isolation: TenantId immer im Key
    return `cache:${this.tenantId}:${entity}`;
  }
  
  async get<T>(entity: string): Promise<T | null> {
    const config = CACHE_CONFIG[entity];
    if (!config) throw new UnknownCacheEntityError(entity);
    
    const data = await this.redis.get(this.key(entity));
    if (!data) return null;
    
    if (config.refreshOnAccess) {
      // TTL erneuern bei Zugriff
      await this.redis.expire(this.key(entity), config.ttlSeconds);
    }
    
    return JSON.parse(data) as T;
  }
  
  async set<T>(entity: string, data: T): Promise<void> {
    const config = CACHE_CONFIG[entity];
    if (!config) throw new UnknownCacheEntityError(entity);
    
    await this.redis.setex(
      this.key(entity),
      config.ttlSeconds,
      JSON.stringify(data)
    );
  }
  
  async invalidate(entity: string): Promise<void> {
    await this.redis.del(this.key(entity));
  }
  
  async invalidateAll(): Promise<void> {
    const keys = await this.redis.keys(`cache:${this.tenantId}:*`);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
}
```

### DSGVO-Dokumentation

| Entitaet | Personenbezug | Rechtsgrundlage | Loeschfrist | Auskunft |
|----------|---------------|-----------------|-------------|----------|
| synced_users.display_name | Ja | Berechtigtes Interesse (Art. 6 Abs. 1 lit. f) | Bei Tenant-Offboarding | Ja |
| synced_users.mail | Ja | Berechtigtes Interesse | Bei Tenant-Offboarding | Ja |
| synced_users.user_principal_name | Ja | Berechtigtes Interesse | Bei Tenant-Offboarding | Ja |
| synced_devices.device_name | Indirekt | Berechtigtes Interesse | Bei Tenant-Offboarding | Ja |
| audit_entries.user_id | Ja (Referenz) | Gesetzliche Pflicht | 10 Jahre | Ja |

## Konsequenzen

### Positiv
- Schnelle Listen und Suche
- Reduzierte Graph-API-Last durch Delta-Queries
- Klare DSGVO-Dokumentation

### Negativ
- Daten koennen bis zu TTL veraltet sein
- DSGVO-Auskunfts- und Loeschpflichten
- Speicherkosten fuer gespiegelte Daten

### Risiken
- Delta-Query-Fehler fuehren zu inkonsistenten Daten
- Tenant-Offboarding muss alle Daten zuverlaessig loeschen

## Revidierbarkeit

**Mittel.** TTL-Werte sind leicht anpassbar. Entscheidung, was gespiegelt wird, erfordert Schema-Migration.
