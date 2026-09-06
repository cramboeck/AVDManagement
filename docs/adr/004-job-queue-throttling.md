# ADR-004: Job-, Queue- und Throttling-Architektur

**Status:** Vorgeschlagen  
**Datum:** 2026-09-06  
**Entscheider:** Christoph Ramboeck  

## Kontext

Laut CLAUDE.md Architekturprinzip 3: "Jede schreibende Aktion ist ein Job."

Anforderungen:
- Queue-Eintrag mit Statusverfolgung
- Retry-Mechanismus
- Audit-Eintrag vor und nach Ausfuehrung
- Graph-Throttling (429) als Normalbetrieb
- Per-Tenant-Concurrency-Limits
- Preview/Diff vor destruktiven Aktionen

## Optionen

### Option A: In-Memory Queue (Bull/BullMQ mit Redis)

Node.js-native Queue mit Redis als Backend.

| Vorteile | Nachteile |
|----------|-----------|
| Bewaeährte Loesung | Redis-Abhaengigkeit |
| Gute TypeScript-Unterstuetzung | Kein nativer Workflow-Support |
| Dashboard verfuegbar | Clustering erfordert Redis Cluster |

### Option B: Azure Service Bus + Durable Functions

Azure-native Loesung mit Durable Functions fuer Orchestrierung.

| Vorteile | Nachteile |
|----------|-----------|
| Serverless-Skalierung | Azure-Lock-in |
| Built-in Retry-Policies | Komplexes Debugging |
| Durable Workflows | Kosten bei hohem Volumen |

### Option C: PostgreSQL als Queue (SKIP LOCKED)

Datenbank-basierte Queue ohne zusaetzliche Infrastruktur.

| Vorteile | Nachteile |
|----------|-----------|
| Keine zusaetzliche Infrastruktur | Polling-basiert |
| Transaktionale Konsistenz | Weniger performant bei hoher Last |
| Audit und Jobs in einer DB | Kein natives Pub/Sub |

## Entscheidung

**Option A: BullMQ mit Redis**

Begruendung:
1. 15 Tenants mit moderater Last = BullMQ reicht
2. Einfaches Deployment (Redis Managed Service verfuegbar)
3. Gute Developer Experience
4. Dashboard fuer Debugging
5. Spaeterer Wechsel zu Azure Service Bus moeglich

## Implementierung

### Job-Struktur

```typescript
// src/core/jobs/types.ts

export interface Job<TPayload = unknown, TResult = unknown> {
  readonly id: JobId;
  readonly type: JobType;
  readonly tenantId: TenantId;
  readonly payload: TPayload;
  readonly status: JobStatus;
  readonly priority: JobPriority;
  readonly createdAt: Date;
  readonly createdBy: UserId;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  readonly result?: TResult;
  readonly error?: JobError;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly correlationId: CorrelationId;
  readonly parentJobId?: JobId;
  readonly preview?: PreviewResult;
}

export type JobStatus = 
  | 'pending'
  | 'preview-pending'    // Warte auf Preview-Generierung
  | 'preview-ready'      // Preview bereit, warte auf Bestaetigung
  | 'approved'           // Benutzer hat bestaetigt
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type JobPriority = 'low' | 'normal' | 'high' | 'critical';

export interface PreviewResult {
  readonly changes: ReadonlyArray<PlannedChange>;
  readonly warnings: ReadonlyArray<string>;
  readonly estimatedDuration: number;
  readonly expiresAt: Date;
}

export interface PlannedChange {
  readonly objectType: string;
  readonly objectId: string;
  readonly objectDisplayName: string;
  readonly action: 'create' | 'update' | 'delete';
  readonly before?: Record<string, unknown>;
  readonly after?: Record<string, unknown>;
}
```

### Queue-Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                        API Layer                             │
│  POST /jobs ──► JobService.create()                         │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                     Job Service                              │
│                                                              │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐        │
│  │ Validation  │──►│ Preview Gen │──►│ Queue Push  │        │
│  └─────────────┘   └─────────────┘   └─────────────┘        │
│                                                              │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    BullMQ Queues                             │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ jobs:{tenantId}  (eine Queue pro Tenant)            │    │
│  │                                                      │    │
│  │  Concurrency: 3 (Graph-Throttling-Schutz)           │    │
│  │  Rate Limit: 100 jobs/minute                        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ jobs:priority  (tenant-uebergreifend, kritisch)     │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                    Job Workers                               │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ Graph Worker     │  │ PowerShell Worker│                 │
│  │ (Node.js)        │  │ (Container)      │                 │
│  └──────────────────┘  └──────────────────┘                 │
│                                                              │
│  Retry-Strategie:                                            │
│  - 429: Retry-After Header respektieren                     │
│  - 5xx: Exponential Backoff (1s, 2s, 4s, 8s, 16s)          │
│  - 401/403: Kein Retry, sofort Failed                       │
│  - Timeout: Nach 5 Min abbrechen                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Throttling-Handler

```typescript
// src/core/jobs/throttling.ts

export interface ThrottlingConfig {
  readonly maxConcurrentPerTenant: number;
  readonly maxRequestsPerMinute: number;
  readonly backoffBaseMs: number;
  readonly backoffMaxMs: number;
}

export const DEFAULT_THROTTLING: ThrottlingConfig = {
  maxConcurrentPerTenant: 3,
  maxRequestsPerMinute: 100,
  backoffBaseMs: 1000,
  backoffMaxMs: 60000,
};

export class ThrottlingHandler {
  private retryAfterMap = new Map<TenantId, Date>();
  
  async handleResponse(
    tenantId: TenantId,
    response: Response,
    attempt: number
  ): Promise<ThrottlingDecision> {
    if (response.status === 429) {
      const retryAfter = this.parseRetryAfter(response);
      this.retryAfterMap.set(tenantId, retryAfter);
      
      return {
        action: 'retry',
        delayMs: retryAfter.getTime() - Date.now(),
        reason: 'graph-throttled',
      };
    }
    
    if (response.status >= 500) {
      const delay = Math.min(
        DEFAULT_THROTTLING.backoffBaseMs * Math.pow(2, attempt),
        DEFAULT_THROTTLING.backoffMaxMs
      );
      
      return {
        action: 'retry',
        delayMs: delay,
        reason: 'server-error',
      };
    }
    
    if (response.status === 401 || response.status === 403) {
      return {
        action: 'fail',
        reason: 'auth-error',
      };
    }
    
    return { action: 'continue' };
  }
  
  canExecute(tenantId: TenantId): boolean {
    const retryAfter = this.retryAfterMap.get(tenantId);
    if (!retryAfter) return true;
    
    if (new Date() > retryAfter) {
      this.retryAfterMap.delete(tenantId);
      return true;
    }
    
    return false;
  }
  
  private parseRetryAfter(response: Response): Date {
    const header = response.headers.get('Retry-After');
    if (!header) {
      return new Date(Date.now() + 60000); // Default: 1 Minute
    }
    
    const seconds = parseInt(header, 10);
    if (!isNaN(seconds)) {
      return new Date(Date.now() + seconds * 1000);
    }
    
    return new Date(header);
  }
}
```

### Preview-Flow

```typescript
// src/core/jobs/preview.ts

export interface PreviewGenerator<TPayload, TPreview> {
  generate(
    tenantId: TenantId,
    payload: TPayload
  ): Promise<TPreview>;
}

export class JobService {
  async createWithPreview<TPayload>(
    type: JobType,
    tenantId: TenantId,
    payload: TPayload,
    userId: UserId
  ): Promise<Job<TPayload>> {
    const job = await this.createJob(type, tenantId, payload, userId, 'preview-pending');
    
    // Preview asynchron generieren
    await this.previewQueue.add({
      jobId: job.id,
      type,
      tenantId,
      payload,
    });
    
    return job;
  }
  
  async approvePreview(jobId: JobId, userId: UserId): Promise<void> {
    const job = await this.getJob(jobId);
    
    if (job.status !== 'preview-ready') {
      throw new InvalidJobStateError(jobId, job.status, 'preview-ready');
    }
    
    if (job.preview?.expiresAt && new Date() > job.preview.expiresAt) {
      throw new PreviewExpiredError(jobId);
    }
    
    await this.auditService.log({
      action: 'job.approved',
      tenantId: job.tenantId,
      userId,
      targetId: jobId,
      correlationId: job.correlationId,
    });
    
    await this.updateJobStatus(jobId, 'approved');
    await this.executionQueue.add({ jobId });
  }
}
```

## Konsequenzen

### Positiv
- Klare Trennung von Job-Erstellung und -Ausfuehrung
- Preview-Flow verhindert ungewollte Aenderungen
- Per-Tenant-Throttling schuetzt vor API-Limits
- Audit-Trail fuer jeden Job-Schritt

### Negativ
- Redis-Abhaengigkeit (Managed Service empfohlen)
- Asynchronitaet erfordert Polling/WebSocket fuer UI-Updates
- Preview-Generierung verzoegert Ausfuehrung

### Risiken
- Redis-Ausfall blockiert alle Jobs (Mitigation: Redis Sentinel/Cluster)
- Preview kann bei grossen Bulk-Operationen langsam sein

## Revidierbarkeit

**Mittel.** Queue-Backend ist austauschbar (Interface-Abstraktion). Job-Struktur ist stabiler und schwerer zu aendern.
