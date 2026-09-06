# ADR-006: Secrets- und Credential-Lifecycle

**Status:** Vorgeschlagen  
**Datum:** 2026-09-06  
**Entscheider:** Christoph Ramboeck  

## Kontext

ZeroStress Cockpit hat Admin-Zugriff auf Kundentenants. Laut CLAUDE.md:
- Keine Client-Secrets oder Zertifikate in DB, Repo, ENV-Dateien oder Logs
- Ausschliesslich Azure Key Vault / Managed Identity

Credential-Typen im System:
1. **App-Zertifikate:** Fuer Graph-API-Authentifizierung (app-only)
2. **Tenant-Credentials:** Pro Kundentenant (bei App-Consent-Modell)
3. **Distributor-API-Keys:** Fuer ADN/Ingram CSP-Integration
4. **Infrastruktur-Secrets:** Redis, PostgreSQL, etc.

## Optionen

### Option A: Alles in Azure Key Vault

Zentrale Key-Vault-Instanz fuer alle Secrets.

| Vorteile | Nachteile |
|----------|-----------|
| Einheitliches Management | Single Point of Failure |
| Rotation ueber Key Vault | Latenz bei jedem Secret-Zugriff |
| Audit-Log integriert | Cross-Region-Replikation noetig |

### Option B: Key Vault + lokaler Secret-Cache

Key Vault als Source of Truth, Secrets werden kurzfristig gecacht.

| Vorteile | Nachteile |
|----------|-----------|
| Reduzierte Latenz | Gecachte Secrets bei Rotation |
| Weniger Key-Vault-Requests | Cache-Invalidierung noetig |
| Ausfalltoleranz | Secrets temporaer im Speicher |

### Option C: Key Vault pro Deployment

Separate Key Vault fuer SaaS-Instanz und Self-Hosted.

| Vorteile | Nachteile |
|----------|-----------|
| Tenant-Isolation | Komplexeres Setup |
| Self-Hosted kontrolliert eigene Secrets | Mehr Infrastruktur |
| Compliance-freundlich | |

## Entscheidung

**Option C: Key Vault pro Deployment + lokaler Cache**

Begruendung:
1. Multi-MSP-Faehigkeit erfordert Secret-Isolation
2. Self-Hosted-Kunden muessen eigene Secrets kontrollieren
3. Cache reduziert Latenz ohne Sicherheitsrisiko (kurze TTL)

## Implementierung

### Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                    ZeroStress Cockpit                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                  Secret Manager                      │    │
│  │                                                      │    │
│  │  ┌─────────────┐    ┌─────────────────────────────┐ │    │
│  │  │ Local Cache │◄───│ Azure Key Vault Provider    │ │    │
│  │  │ (In-Memory) │    │                             │ │    │
│  │  │ TTL: 5 min  │    │ - Managed Identity Auth     │ │    │
│  │  └─────────────┘    │ - Certificate Retrieval     │ │    │
│  │                     │ - Secret Rotation Events    │ │    │
│  │                     └─────────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────┘    │
│                              │                               │
│                              ▼                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Azure Key Vault (per Deployment)        │    │
│  │                                                      │    │
│  │  Secrets:                                            │    │
│  │  - tenant/{tenantId}/certificate                    │    │
│  │  - tenant/{tenantId}/client-secret (falls noetig)   │    │
│  │  - distributor/adn/api-key                          │    │
│  │  - infra/redis/connection-string                    │    │
│  │  - infra/postgres/connection-string                 │    │
│  │                                                      │    │
│  │  Certificates:                                       │    │
│  │  - app/graph-api/certificate                        │    │
│  │                                                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Secret-Namenskonvention

```
tenant/{tenantId}/certificate        # Tenant-spezifisches App-Zertifikat
tenant/{tenantId}/client-secret      # Fallback, falls kein Zertifikat
distributor/{name}/api-key           # z.B. distributor/adn/api-key
infra/{service}/connection-string    # z.B. infra/redis/connection-string
app/{component}/certificate          # z.B. app/graph-api/certificate
```

### Secret Manager Interface

```typescript
// src/core/secrets/secret-manager.ts

export interface SecretManager {
  getCertificate(name: string): Promise<X509Certificate>;
  getSecret(name: string): Promise<string>;
  getTenantCredential(tenantId: TenantId): Promise<TenantCredential>;
  rotateTenantCredential(tenantId: TenantId): Promise<void>;
}

export interface TenantCredential {
  readonly tenantId: TenantId;
  readonly type: 'certificate' | 'client-secret';
  readonly value: X509Certificate | string;
  readonly expiresAt: Date;
}

export class AzureKeyVaultSecretManager implements SecretManager {
  private cache = new Map<string, CachedSecret>();
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 Minuten
  
  constructor(
    private readonly client: SecretClient,
    private readonly certClient: CertificateClient
  ) {}
  
  async getCertificate(name: string): Promise<X509Certificate> {
    const cached = this.getFromCache(name);
    if (cached) return cached as X509Certificate;
    
    const cert = await this.certClient.getCertificate(name);
    const x509 = new X509Certificate(cert.cer!);
    
    this.setCache(name, x509);
    return x509;
  }
  
  async getSecret(name: string): Promise<string> {
    const cached = this.getFromCache(name);
    if (cached) return cached as string;
    
    const secret = await this.client.getSecret(name);
    
    this.setCache(name, secret.value!);
    return secret.value!;
  }
  
  async getTenantCredential(tenantId: TenantId): Promise<TenantCredential> {
    // Zuerst Zertifikat versuchen
    try {
      const cert = await this.getCertificate(`tenant/${tenantId}/certificate`);
      return {
        tenantId,
        type: 'certificate',
        value: cert,
        expiresAt: new Date(cert.validTo),
      };
    } catch (e) {
      if (!(e instanceof RestError) || e.statusCode !== 404) throw e;
    }
    
    // Fallback: Client Secret
    const secret = await this.getSecret(`tenant/${tenantId}/client-secret`);
    return {
      tenantId,
      type: 'client-secret',
      value: secret,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Unbekannt
    };
  }
  
  private getFromCache(name: string): unknown | null {
    const cached = this.cache.get(name);
    if (!cached) return null;
    
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(name);
      return null;
    }
    
    return cached.value;
  }
  
  private setCache(name: string, value: unknown): void {
    this.cache.set(name, {
      value,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }
}
```

### Credential-Rotation

```typescript
// src/core/secrets/rotation.ts

export class CredentialRotationService {
  async checkExpiringCredentials(): Promise<ExpiringCredential[]> {
    const tenants = await this.tenantRepository.getAll();
    const expiring: ExpiringCredential[] = [];
    
    for (const tenant of tenants) {
      const cred = await this.secretManager.getTenantCredential(tenant.id);
      const daysUntilExpiry = this.daysUntil(cred.expiresAt);
      
      if (daysUntilExpiry <= 30) {
        expiring.push({
          tenantId: tenant.id,
          tenantName: tenant.displayName,
          credentialType: cred.type,
          expiresAt: cred.expiresAt,
          daysUntilExpiry,
          severity: daysUntilExpiry <= 7 ? 'critical' : 'warning',
        });
      }
    }
    
    return expiring;
  }
  
  async rotateCertificate(tenantId: TenantId): Promise<void> {
    // 1. Neues Zertifikat generieren
    const newCert = await this.generateCertificate(tenantId);
    
    // 2. In Key Vault speichern (neue Version)
    await this.certClient.importCertificate(
      `tenant/${tenantId}/certificate`,
      newCert.pfx,
      { enabled: true }
    );
    
    // 3. Cache invalidieren
    this.secretManager.invalidateCache(`tenant/${tenantId}/certificate`);
    
    // 4. Altes Zertifikat in Entra ID registrieren (parallel, fuer Uebergang)
    // 5. Nach Bestaetigung: altes Zertifikat aus Entra ID entfernen
    
    await this.auditService.log({
      action: 'credential.rotated',
      tenantId,
      details: { credentialType: 'certificate' },
    });
  }
  
  private daysUntil(date: Date): number {
    return Math.floor((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  }
}
```

### Rotation-Alert-Job

```typescript
// src/jobs/credential-rotation-check.ts

export const credentialRotationCheckJob: JobDefinition = {
  type: 'system.credential-rotation-check',
  displayName: 'Credential-Ablauf pruefen',
  handler: async (ctx) => {
    const rotationService = ctx.resolve(CredentialRotationService);
    const expiring = await rotationService.checkExpiringCredentials();
    
    for (const cred of expiring) {
      if (cred.severity === 'critical') {
        await ctx.alertService.sendCritical({
          title: `Credential laeuft ab: ${cred.tenantName}`,
          message: `${cred.credentialType} laeuft in ${cred.daysUntilExpiry} Tagen ab`,
          tenantId: cred.tenantId,
        });
      }
    }
    
    return { expiringCount: expiring.length };
  },
  maxRetries: 3,
  timeoutSeconds: 300,
  concurrencyPerTenant: 1,
};

// Scheduled: taeglich um 08:00 UTC
```

## Konsequenzen

### Positiv
- Keine Secrets in Code, DB oder Logs
- Zentrale Rotation und Audit
- Isolation zwischen Deployments

### Negativ
- Azure-Abhaengigkeit (Key Vault)
- Latenz bei Cache-Miss
- Komplexitaet bei Self-Hosted-Setup

### Risiken
- Key-Vault-Ausfall blockiert Authentifizierung
- Cache-Inkonsistenz bei Rotation (Mitigation: kurze TTL)

## Revidierbarkeit

**Niedrig.** Secret-Management ist fundamental. Migration zu anderem Vault-System erfordert erheblichen Aufwand.
