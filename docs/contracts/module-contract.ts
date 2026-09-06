/**
 * ZeroStress Cockpit - Modul-Contract
 *
 * Dieses Interface definiert den Vertrag, den jedes Fachmodul erfuellen muss.
 * Ein neues Modul besteht aus:
 * 1. Einem Verzeichnis unter src/modules/{modul-name}/
 * 2. Einem Contract-Objekt, das dieses Interface implementiert
 * 3. Registrierung in der Modul-Registry
 *
 * KEINE Aenderungen an Core-Dateien erforderlich.
 */

// ============================================
// Basis-Typen
// ============================================

/** Eindeutiger Modul-Identifier (kebab-case) */
export type ModuleId =
  | 'avd'
  | 'intune'
  | 'identity'
  | 'exchange'
  | 'defender'
  | 'copilot'
  | 'purview'
  | 'windows365';

/** Icon-Namen (Lucide Icons) */
export type IconName =
  | 'desktop'
  | 'monitor'
  | 'server'
  | 'users'
  | 'user'
  | 'shield'
  | 'mail'
  | 'hard-drive'
  | 'smartphone'
  | 'lock'
  | 'key'
  | 'settings'
  | 'activity'
  | 'alert-triangle'
  | 'check-circle'
  | 'x-circle'
  | 'cloud'
  | 'database'
  | 'folder'
  | 'file'
  | 'image'
  | 'layers'
  | 'layout'
  | 'list'
  | 'grid'
  | 'search'
  | 'filter'
  | 'refresh-cw'
  | 'download'
  | 'upload'
  | 'trash'
  | 'edit'
  | 'plus'
  | 'minus'
  | 'copy'
  | 'clipboard'
  | 'external-link'
  | 'link'
  | 'calendar'
  | 'clock'
  | 'bell'
  | 'message-square'
  | 'info'
  | 'help-circle'
  | 'bot'
  | 'sparkles';

// ============================================
// Graph-Permissions
// ============================================

export interface GraphScope {
  /** Graph-Permission (z.B. "User.Read.All") */
  readonly scope: string;

  /** Begruendung, warum diese Permission benoetigt wird */
  readonly reason: string;

  /** true = Modul funktioniert nicht ohne; false = optionale Erweiterung */
  readonly required: boolean;

  /** Permission-Typ */
  readonly type: 'application' | 'delegated';
}

// ============================================
// Azure RBAC-Rollen
// ============================================

export interface AzureRoleDefinition {
  /** Azure Role Definition ID (GUID) */
  readonly roleDefinitionId: string;

  /** Menschenlesbarer Name der Rolle */
  readonly roleDefinitionName: string;

  /** Scope-Ebene fuer die Rollenzuweisung */
  readonly scope: 'subscription' | 'resourceGroup' | 'resource';

  /** Begruendung fuer diese Rolle */
  readonly reason: string;
}

// ============================================
// Navigation
// ============================================

export interface NavigationItem {
  /** Eindeutige ID innerhalb des Moduls */
  readonly id: string;

  /** Anzeigetext im Menue */
  readonly label: string;

  /** Icon (Lucide) */
  readonly icon: IconName;

  /** Route-Pfad (relativ zum Modul-Prefix) */
  readonly path: string;

  /** Untermenue-Eintraege */
  readonly children?: ReadonlyArray<NavigationItem>;

  /** Erforderliche Permission (z.B. "avd.hostpools.read") */
  readonly requiredPermission?: string;

  /** Badge-Zaehler (z.B. "alerts" fuer Anzahl offener Alerts) */
  readonly badge?: NavigationBadge;
}

export interface NavigationBadge {
  /** Datenquelle fuer den Badge-Wert */
  readonly source: 'static' | 'api' | 'websocket';

  /** API-Endpunkt oder WebSocket-Channel */
  readonly endpoint?: string;

  /** Variante (Farbe) */
  readonly variant: 'default' | 'warning' | 'error';
}

// ============================================
// API-Routen
// ============================================

export interface RouteDefinition {
  /** HTTP-Methode */
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

  /** Pfad (relativ zum Modul-Prefix, z.B. "/host-pools/:id") */
  readonly path: string;

  /** Route-Handler-Referenz */
  readonly handler: RouteHandler;

  /** Middleware-IDs (z.B. ["rateLimit", "audit"]) */
  readonly middleware?: ReadonlyArray<MiddlewareId>;

  /** Erforderliche Permission */
  readonly requiredPermission?: string;

  /** Rate-Limiting-Konfiguration */
  readonly rateLimit?: RateLimitConfig;

  /** OpenAPI-Dokumentation */
  readonly openApi?: OpenApiRouteConfig;
}

export type RouteHandler = (ctx: RouteContext) => Promise<RouteResponse>;

export type MiddlewareId = 'rateLimit' | 'audit' | 'preview' | 'jobify';

export interface RateLimitConfig {
  /** Requests pro Fenster */
  readonly limit: number;

  /** Fenstergroesse in Sekunden */
  readonly windowSeconds: number;

  /** Rate-Limit pro Tenant statt global */
  readonly perTenant?: boolean;
}

export interface RouteContext {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  readonly mspId: MspId;
  readonly correlationId: CorrelationId;
  readonly params: Record<string, string>;
  readonly query: Record<string, string>;
  readonly body: unknown;
  readonly resolve: <T>(token: ServiceToken<T>) => T;
}

export interface RouteResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

export interface OpenApiRouteConfig {
  readonly summary: string;
  readonly description?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly requestBody?: unknown;
  readonly responses?: Record<string, unknown>;
}

// ============================================
// Jobs
// ============================================

export interface JobDefinition {
  /** Job-Typ-Identifier (z.B. "avd.start-session-host") */
  readonly type: string;

  /** Menschenlesbarer Name */
  readonly displayName: string;

  /** Job-Handler-Referenz */
  readonly handler: JobHandler;

  /** Maximale Retry-Versuche */
  readonly maxRetries: number;

  /** Timeout in Sekunden */
  readonly timeoutSeconds: number;

  /** Max gleichzeitige Jobs dieses Typs pro Tenant */
  readonly concurrencyPerTenant: number;

  /** Erfordert Preview/Bestaetigung vor Ausfuehrung */
  readonly requiresPreview: boolean;

  /** Preview-Generator (falls requiresPreview = true) */
  readonly previewGenerator?: PreviewGenerator;
}

export type JobHandler = (ctx: JobContext) => Promise<JobResult>;

export interface JobContext {
  readonly jobId: JobId;
  readonly tenantId: TenantId;
  readonly mspId: MspId;
  readonly userId: UserId;
  readonly correlationId: CorrelationId;
  readonly payload: unknown;
  readonly attempt: number;
  readonly resolve: <T>(token: ServiceToken<T>) => T;
  readonly progress: (percent: number, message?: string) => Promise<void>;
  readonly log: (level: LogLevel, message: string) => void;
}

export interface JobResult {
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: JobError;
}

export interface JobError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: unknown;
}

export type PreviewGenerator = (
  ctx: PreviewContext
) => Promise<PreviewResult>;

export interface PreviewContext {
  readonly tenantId: TenantId;
  readonly mspId: MspId;
  readonly payload: unknown;
  readonly resolve: <T>(token: ServiceToken<T>) => T;
}

export interface PreviewResult {
  readonly changes: ReadonlyArray<PlannedChange>;
  readonly warnings: ReadonlyArray<string>;
  readonly estimatedDurationSeconds: number;
  readonly expiresInSeconds: number;
}

export interface PlannedChange {
  readonly objectType: string;
  readonly objectId: string;
  readonly objectDisplayName: string;
  readonly action: 'create' | 'update' | 'delete';
  readonly before?: Record<string, unknown>;
  readonly after?: Record<string, unknown>;
}

// ============================================
// Widgets (Dashboard)
// ============================================

export interface WidgetDefinition {
  /** Eindeutige Widget-ID */
  readonly id: string;

  /** Anzeigename */
  readonly displayName: string;

  /** React-Komponente */
  readonly component: WidgetComponent;

  /** Standard-Groesse */
  readonly defaultSize: 'small' | 'medium' | 'large' | 'full';

  /** Automatische Aktualisierung (Sekunden, 0 = keine) */
  readonly refreshIntervalSeconds: number;

  /** Erforderliche Permission */
  readonly requiredPermission?: string;

  /** Widget ist tenant-spezifisch vs. MSP-uebergreifend */
  readonly scope: 'tenant' | 'msp';
}

export type WidgetComponent = React.ComponentType<WidgetProps>;

export interface WidgetProps {
  readonly tenantId?: TenantId;
  readonly mspId: MspId;
  readonly isLoading: boolean;
  readonly error?: Error;
  readonly onRefresh: () => void;
}

// ============================================
// Lifecycle-Hooks
// ============================================

export interface ModuleHooks {
  /** Wird aufgerufen, wenn das Modul geladen wird (App-Start) */
  onLoad?: () => Promise<void>;

  /** Wird aufgerufen, wenn der aktive Tenant wechselt */
  onTenantSwitch?: (tenantId: TenantId) => Promise<void>;

  /** Wird aufgerufen, wenn das Modul entladen wird */
  onUnload?: () => Promise<void>;

  /** Wird aufgerufen, wenn ein Sync fuer dieses Modul startet */
  onSyncStart?: (tenantId: TenantId) => Promise<void>;

  /** Wird aufgerufen, wenn ein Sync abgeschlossen ist */
  onSyncComplete?: (tenantId: TenantId, result: SyncResult) => Promise<void>;
}

export interface SyncResult {
  readonly success: boolean;
  readonly entitiesUpdated: number;
  readonly entitiesDeleted: number;
  readonly errors: ReadonlyArray<string>;
}

// ============================================
// Haupt-Interface: ModuleContract
// ============================================

export interface ModuleContract<TConfig = unknown> {
  /** Eindeutiger Modul-Identifier */
  readonly id: ModuleId;

  /** Anzeigename fuer UI */
  readonly displayName: string;

  /** Modul-Version (semver) */
  readonly version: string;

  /** Kurze Beschreibung */
  readonly description: string;

  /** Erforderliche Graph-Permissions */
  readonly graphScopes: ReadonlyArray<GraphScope>;

  /** Erforderliche Azure RBAC-Rollen (fuer AVD, ARM-Ressourcen) */
  readonly azureRoles: ReadonlyArray<AzureRoleDefinition>;

  /** Navigationsstruktur */
  readonly navigation: ReadonlyArray<NavigationItem>;

  /** API-Routen */
  readonly routes: ReadonlyArray<RouteDefinition>;

  /** Job-Definitionen */
  readonly jobs: ReadonlyArray<JobDefinition>;

  /** Dashboard-Widgets */
  readonly widgets: ReadonlyArray<WidgetDefinition>;

  /** Modul-spezifische Standardkonfiguration */
  readonly defaultConfig?: TConfig;

  /** Lifecycle-Hooks */
  readonly hooks?: ModuleHooks;

  /** Abhaengigkeiten zu anderen Modulen */
  readonly dependencies?: ReadonlyArray<ModuleId>;
}

// ============================================
// Hilfstypen (Branded Types fuer Typsicherheit)
// ============================================

declare const brand: unique symbol;

type Brand<T, B> = T & { readonly [brand]: B };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type MspId = Brand<string, 'MspId'>;
export type JobId = Brand<string, 'JobId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ServiceToken<T> {
  readonly name: string;
  readonly _type?: T;
}

// ============================================
// Beispiel-Import fuer React (Platzhalter)
// ============================================

declare namespace React {
  type ComponentType<P = object> = (props: P) => JSX.Element | null;
}

declare namespace JSX {
  interface Element {}
}
