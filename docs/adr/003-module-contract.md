# ADR-003: Modul-/Plugin-Contract

**Status:** Vorgeschlagen  
**Datum:** 2026-09-06  
**Entscheider:** Christoph Ramboeck  

## Kontext

ZeroStress Cockpit ist modular aufgebaut. Initiale Module:
- AVD (Azure Virtual Desktop)
- Intune (Device Management)
- Identity (M365 Benutzer/Gruppen/Lizenzen)
- Exchange (Exchange Online)

Zukuenftige Module (ohne Core-Aenderung):
- Defender (Security)
- Copilot Management
- Purview (Compliance)
- Windows 365 (Cloud PCs)

Das Modul-Contract-Interface definiert, wie sich Module registrieren und was sie bereitstellen muessen.

## Anforderungen

1. Neues Modul = neues Verzeichnis + Registry-Eintrag
2. Keine Aenderung an Core-Dateien
3. Deklarative Definition von:
   - Navigation (Menue-Eintraege)
   - Berechtigungen (Graph-Scopes, Azure RBAC)
   - Routen (API-Endpunkte)
   - Jobs (asynchrone Aktionen)
   - Widgets (Dashboard-Komponenten)
4. Typensicherheit (TypeScript strict)
5. Testbarkeit (Mock-faehig)

## Optionen

### Option A: Interface mit statischem Export

Jedes Modul exportiert ein Contract-Objekt, das zur Build-Zeit validiert wird.

| Vorteile | Nachteile |
|----------|-----------|
| Volle Typsicherheit | Alle Module muessen zur Build-Zeit bekannt sein |
| Tree-Shaking moeglich | Kein Runtime-Plugin-Loading |
| Einfaches Testing | |

### Option B: Dynamic Import mit Schema-Validierung

Module werden zur Laufzeit geladen und gegen ein JSON-Schema validiert.

| Vorteile | Nachteile |
|----------|-----------|
| Runtime-Plugin-Loading | Komplexere Validierung |
| Spaeteres Hinzufuegen ohne Rebuild | Weniger Typsicherheit |
| Potentiell externe Plugins | Sicherheitsrisiko bei externen Plugins |

### Option C: Hybrid (statisch + Manifest)

Statischer TypeScript-Contract plus JSON-Manifest fuer deklarative Metadaten.

| Vorteile | Nachteile |
|----------|-----------|
| Typsicherheit fuer Code | Zwei Quellen der Wahrheit |
| Manifest fuer UI-Generierung | Synchronisation noetig |

## Entscheidung

**Option A: Interface mit statischem Export**

Begruendung:
1. TypeScript strict ist Pflicht (CLAUDE.md)
2. Externe Plugins sind kein Ziel in Phase 1
3. Einfachheit > Flexibilitaet bei aktuellem Scope
4. Refactoring zu Option B spaeter moeglich

## Implementierung

### ModuleContract Interface

```typescript
// src/core/registry/module-contract.ts

export interface ModuleContract<TConfig = unknown> {
  /** Eindeutiger Modul-Identifier (kebab-case) */
  readonly id: ModuleId;
  
  /** Anzeigename fuer UI */
  readonly displayName: string;
  
  /** Modul-Version (semver) */
  readonly version: string;
  
  /** Beschreibung fuer Admin-UI */
  readonly description: string;
  
  /** Erforderliche Graph-Permissions */
  readonly graphScopes: ReadonlyArray<GraphScope>;
  
  /** Erforderliche Azure RBAC-Rollen (fuer AVD etc.) */
  readonly azureRoles: ReadonlyArray<AzureRoleDefinition>;
  
  /** Navigationsstruktur */
  readonly navigation: ReadonlyArray<NavigationItem>;
  
  /** API-Routen dieses Moduls */
  readonly routes: ReadonlyArray<RouteDefinition>;
  
  /** Job-Definitionen (asynchrone Aktionen) */
  readonly jobs: ReadonlyArray<JobDefinition>;
  
  /** Dashboard-Widgets */
  readonly widgets: ReadonlyArray<WidgetDefinition>;
  
  /** Optionale Konfiguration */
  readonly defaultConfig?: TConfig;
  
  /** Lifecycle-Hooks */
  readonly hooks?: ModuleHooks;
}

// Typen fuer Subelemente

export type ModuleId = 
  | 'avd' 
  | 'intune' 
  | 'identity' 
  | 'exchange'
  | 'defender'
  | 'copilot'
  | 'purview'
  | 'windows365';

export interface GraphScope {
  readonly scope: string;
  readonly reason: string;
  readonly required: boolean;
}

export interface AzureRoleDefinition {
  readonly roleDefinitionId: string;
  readonly roleDefinitionName: string;
  readonly scope: 'subscription' | 'resourceGroup' | 'resource';
  readonly reason: string;
}

export interface NavigationItem {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly path: string;
  readonly children?: ReadonlyArray<NavigationItem>;
  readonly requiredPermission?: string;
}

export interface RouteDefinition {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly handler: RouteHandler;
  readonly middleware?: ReadonlyArray<MiddlewareId>;
  readonly requiredPermission?: string;
  readonly rateLimit?: RateLimitConfig;
}

export interface JobDefinition {
  readonly type: string;
  readonly displayName: string;
  readonly handler: JobHandler;
  readonly maxRetries: number;
  readonly timeoutSeconds: number;
  readonly concurrencyPerTenant: number;
}

export interface WidgetDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly component: ComponentType<WidgetProps>;
  readonly defaultSize: 'small' | 'medium' | 'large';
  readonly refreshIntervalSeconds?: number;
}

export interface ModuleHooks {
  /** Wird aufgerufen wenn Modul geladen wird */
  onLoad?: () => Promise<void>;
  
  /** Wird aufgerufen wenn Tenant gewechselt wird */
  onTenantSwitch?: (tenantId: string) => Promise<void>;
  
  /** Wird aufgerufen wenn Modul entladen wird */
  onUnload?: () => Promise<void>;
}
```

### Modul-Registry

```typescript
// src/core/registry/registry.ts

export class ModuleRegistry {
  private modules = new Map<ModuleId, ModuleContract>();
  
  register(contract: ModuleContract): void {
    this.validateContract(contract);
    this.modules.set(contract.id, contract);
  }
  
  get(id: ModuleId): ModuleContract | undefined {
    return this.modules.get(id);
  }
  
  getAll(): ReadonlyArray<ModuleContract> {
    return Array.from(this.modules.values());
  }
  
  getRequiredScopes(): ReadonlyArray<GraphScope> {
    return this.getAll().flatMap(m => m.graphScopes);
  }
  
  getNavigation(): ReadonlyArray<NavigationItem> {
    return this.getAll().flatMap(m => m.navigation);
  }
  
  private validateContract(contract: ModuleContract): void {
    // Validierung: keine doppelten IDs, Pfade, etc.
  }
}

// Singleton-Export
export const moduleRegistry = new ModuleRegistry();
```

### Modul-Registrierung (Beispiel)

```typescript
// src/modules/avd/index.ts

import { ModuleContract, moduleRegistry } from '../../core/registry';
import { avdRoutes } from './routes';
import { avdJobs } from './jobs';
import { avdWidgets } from './widgets';

export const avdModule: ModuleContract = {
  id: 'avd',
  displayName: 'Azure Virtual Desktop',
  version: '1.0.0',
  description: 'Verwaltung von AVD Host Pools, Session Hosts und Benutzerzuweisungen',
  
  graphScopes: [
    { scope: 'User.Read.All', reason: 'Benutzerliste fuer Zuweisungen', required: true },
    { scope: 'Group.Read.All', reason: 'Gruppenzuweisungen', required: true },
  ],
  
  azureRoles: [
    {
      roleDefinitionId: '21efdde3-836f-432b-bf3d-3e8e734d4b2b',
      roleDefinitionName: 'Desktop Virtualization Contributor',
      scope: 'resourceGroup',
      reason: 'Vollzugriff auf AVD-Ressourcen',
    },
  ],
  
  navigation: [
    {
      id: 'avd',
      label: 'Virtual Desktop',
      icon: 'desktop',
      path: '/avd',
      children: [
        { id: 'avd-hostpools', label: 'Host Pools', icon: 'server', path: '/avd/hostpools' },
        { id: 'avd-sessions', label: 'Sessions', icon: 'users', path: '/avd/sessions' },
        { id: 'avd-images', label: 'Images', icon: 'image', path: '/avd/images' },
      ],
    },
  ],
  
  routes: avdRoutes,
  jobs: avdJobs,
  widgets: avdWidgets,
};

// Selbst-Registrierung
moduleRegistry.register(avdModule);
```

## Konsequenzen

### Positiv
- Klare Schnittstelle fuer alle Module
- Volle Typsicherheit bei Entwicklung
- Automatische Scope-Aggregation
- Navigation wird aus Modulen generiert

### Negativ
- Module muessen zur Build-Zeit bekannt sein
- Kein Hot-Reload von Modulen

### Risiken
- Interface-Aenderungen brechen alle Module (Versionierung noetig)

## Revidierbarkeit

**Hoch.** Interface kann erweitert werden (neue optionale Felder). Migration zu Dynamic Import spaeter moeglich.
