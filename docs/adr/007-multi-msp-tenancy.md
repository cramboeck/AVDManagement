# ADR-007: Mandantenfaehigkeit der Konsole selbst

**Status:** Vorgeschlagen  
**Datum:** 2026-09-06  
**Entscheider:** Christoph Ramboeck  

## Kontext

ZeroStress Cockpit soll zunaechst vom Solo-MSP selbst genutzt und spaeter an andere MSPs verkauft werden. Zwei Dimensionen der Mandantenfaehigkeit:

1. **Kundentenants:** Microsoft-365-Tenants, die ein MSP verwaltet (bereits in ADR-001)
2. **MSP-Mandanten:** Verschiedene MSPs als Kunden von ZeroStress Cockpit

## Anforderungen

- Vollstaendige Datentrennung zwischen MSPs
- Optionales White-Labeling (Logo, Farben, Domain)
- Separate Abrechnung pro MSP
- Unabhaengige Benutzer und Rollen
- Eigene Key-Vault-Instanz pro MSP (siehe ADR-006)

## Optionen

### Option A: Single-Tenant mit Namespace-Isolation

Eine Deployment-Instanz, Daten durch Namespace/Prefix getrennt.

| Vorteile | Nachteile |
|----------|-----------|
| Einfaches Deployment | Risiko bei Bugs (Daten-Leak) |
| Zentrale Updates | Noisy-Neighbor-Probleme |
| Kosteneffizient | Kein echtes Self-Hosting |

### Option B: Multi-Instance (ein Deployment pro MSP)

Separate Instanz fuer jeden MSP-Kunden.

| Vorteile | Nachteile |
|----------|-----------|
| Vollstaendige Isolation | Hoher Betriebsaufwand |
| Self-Hosting moeglich | Langsame Updates |
| Individuelle Skalierung | Kosten skalieren linear |

### Option C: Hybrid (SaaS-Multi-Tenant + Self-Hosted-Option)

SaaS mit Namespace-Isolation fuer Kleinere, Self-Hosted fuer Enterprise.

| Vorteile | Nachteile |
|----------|-----------|
| Flexibles Geschaeftsmodell | Zwei Deployment-Modi zu pflegen |
| Balance aus Effizienz und Isolation | Komplexere Architektur |
| Upselling-Pfad | |

## Entscheidung

**Option C: Hybrid (SaaS-Multi-Tenant + Self-Hosted-Option)**

Begruendung:
1. Solo-MSP startet mit SaaS (eigene Nutzung = erster Tenant)
2. Kleine MSPs koennen guenstig SaaS nutzen
3. Grosse MSPs oder Compliance-Anforderungen erhalten Self-Hosted
4. Architektur muss von Anfang an beide Modi unterstuetzen

## Implementierung

### Architektur-Ueberblick

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           SaaS-Deployment                                │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      Shared Infrastructure                       │    │
│  │  Load Balancer ──► API Gateway ──► Auth Service                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                    │                                     │
│                                    ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    MSP-Namespace Isolation                       │    │
│  │                                                                  │    │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐        │    │
│  │  │ MSP Alpha     │  │ MSP Beta      │  │ MSP Gamma     │        │    │
│  │  │               │  │               │  │               │        │    │
│  │  │ - Users       │  │ - Users       │  │ - Users       │        │    │
│  │  │ - Tenants     │  │ - Tenants     │  │ - Tenants     │        │    │
│  │  │ - Jobs        │  │ - Jobs        │  │ - Jobs        │        │    │
│  │  │ - Audit       │  │ - Audit       │  │ - Audit       │        │    │
│  │  │ - Config      │  │ - Config      │  │ - Config      │        │    │
│  │  │               │  │               │  │               │        │    │
│  │  │ Key Vault:    │  │ Key Vault:    │  │ Key Vault:    │        │    │
│  │  │ kv-alpha      │  │ kv-beta       │  │ kv-gamma      │        │    │
│  │  └───────────────┘  └───────────────┘  └───────────────┘        │    │
│  │                                                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                      Shared Database                             │    │
│  │  PostgreSQL mit Row-Level Security (MSP-ID in jeder Zeile)      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                      Self-Hosted Deployment                              │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                    Single-MSP Instance                           │    │
│  │                                                                  │    │
│  │  - Eigene Infrastruktur                                         │    │
│  │  - Eigene Datenbank                                             │    │
│  │  - Eigener Key Vault                                            │    │
│  │  - Kein MSP-Namespace (implizit Single-MSP)                     │    │
│  │                                                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Datenbank-Schema mit Row-Level Security

```sql
-- MSP-Stammdaten
CREATE TABLE msp_organizations (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,  -- fuer Subdomain/URL
  branding JSONB,                      -- Logo, Farben
  custom_domain VARCHAR(255),
  subscription_tier VARCHAR(50) NOT NULL DEFAULT 'starter',
  created_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Alle Tabellen haben msp_id
ALTER TABLE tenants ADD COLUMN msp_id UUID NOT NULL REFERENCES msp_organizations(id);
ALTER TABLE synced_users ADD COLUMN msp_id UUID NOT NULL REFERENCES msp_organizations(id);
ALTER TABLE jobs ADD COLUMN msp_id UUID NOT NULL REFERENCES msp_organizations(id);
ALTER TABLE audit_entries ADD COLUMN msp_id UUID NOT NULL REFERENCES msp_organizations(id);

-- Row-Level Security
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE synced_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_entries ENABLE ROW LEVEL SECURITY;

-- Policy: Nur eigene MSP-Daten sichtbar
CREATE POLICY tenant_isolation ON tenants
  USING (msp_id = current_setting('app.current_msp_id')::uuid);

CREATE POLICY user_isolation ON synced_users
  USING (msp_id = current_setting('app.current_msp_id')::uuid);

CREATE POLICY job_isolation ON jobs
  USING (msp_id = current_setting('app.current_msp_id')::uuid);

CREATE POLICY audit_isolation ON audit_entries
  USING (msp_id = current_setting('app.current_msp_id')::uuid);

-- Self-Hosted: RLS deaktiviert, msp_id = konstant
```

### MSP-Context-Middleware

```typescript
// src/core/multi-tenancy/msp-context.ts

export interface MspContext {
  readonly mspId: MspId;
  readonly mspSlug: string;
  readonly branding: MspBranding;
  readonly subscriptionTier: SubscriptionTier;
}

export class MspContextMiddleware {
  async handle(req: Request, next: NextFunction): Promise<Response> {
    const mspId = await this.resolveMspId(req);
    
    if (!mspId) {
      throw new UnauthorizedError('MSP context not found');
    }
    
    const msp = await this.mspRepository.findById(mspId);
    if (!msp || !msp.isActive) {
      throw new ForbiddenError('MSP not active');
    }
    
    // Context fuer Request setzen
    req.mspContext = {
      mspId: msp.id,
      mspSlug: msp.slug,
      branding: msp.branding,
      subscriptionTier: msp.subscriptionTier,
    };
    
    // PostgreSQL Session-Variable fuer RLS
    await this.db.query(`SET app.current_msp_id = '${msp.id}'`);
    
    return next(req);
  }
  
  private async resolveMspId(req: Request): Promise<MspId | null> {
    // 1. Aus JWT-Token (nach Login)
    if (req.user?.mspId) {
      return req.user.mspId;
    }
    
    // 2. Aus Subdomain (msp-slug.zerostress.io)
    const host = req.headers.get('host');
    if (host) {
      const match = host.match(/^([a-z0-9-]+)\.zerostress\.io$/);
      if (match) {
        const msp = await this.mspRepository.findBySlug(match[1]);
        return msp?.id ?? null;
      }
    }
    
    // 3. Aus Custom Domain
    if (host) {
      const msp = await this.mspRepository.findByCustomDomain(host);
      return msp?.id ?? null;
    }
    
    // Self-Hosted: Fallback auf Default-MSP
    if (this.config.deploymentMode === 'self-hosted') {
      return this.config.defaultMspId;
    }
    
    return null;
  }
}
```

### White-Labeling

```typescript
// src/core/multi-tenancy/branding.ts

export interface MspBranding {
  readonly logoUrl?: string;
  readonly faviconUrl?: string;
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly productName: string;
  readonly supportEmail: string;
  readonly customCss?: string;
}

export const DEFAULT_BRANDING: MspBranding = {
  primaryColor: '#0066CC',
  secondaryColor: '#004499',
  productName: 'ZeroStress Cockpit',
  supportEmail: 'support@zerostress.io',
};

// Frontend laedt Branding beim Start
// GET /api/branding -> MspBranding
```

### Deployment-Mode Konfiguration

```typescript
// src/core/config/deployment.ts

export type DeploymentMode = 'saas' | 'self-hosted';

export interface DeploymentConfig {
  readonly mode: DeploymentMode;
  readonly defaultMspId?: MspId;  // Nur Self-Hosted
  readonly enableRls: boolean;
  readonly keyVaultUri: string;
}

export function loadDeploymentConfig(): DeploymentConfig {
  const mode = process.env.DEPLOYMENT_MODE as DeploymentMode ?? 'saas';
  
  return {
    mode,
    defaultMspId: mode === 'self-hosted' 
      ? (process.env.DEFAULT_MSP_ID as MspId)
      : undefined,
    enableRls: mode === 'saas',
    keyVaultUri: process.env.KEY_VAULT_URI!,
  };
}
```

## Konsequenzen

### Positiv
- Flexibles Geschaeftsmodell (SaaS + Self-Hosted)
- Vollstaendige Datentrennung durch RLS
- White-Labeling fuer MSP-Branding
- Upselling-Pfad von SaaS zu Self-Hosted

### Negativ
- Komplexere Architektur (zwei Modi)
- RLS-Overhead bei jeder Query
- Branding-Varianten zu testen

### Risiken
- RLS-Bypass bei SQL-Injection (Mitigation: prepared statements, kein raw SQL)
- Custom-Domain-Setup erfordert SSL-Zertifikate
- Self-Hosted-Support aufwaendiger

## Revidierbarkeit

**Niedrig.** MSP-Isolation ist fundamental. Migration zwischen Modi (SaaS ↔ Self-Hosted) ist moeglich, erfordert aber Datenexport/-import.
