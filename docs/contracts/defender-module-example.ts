/**
 * ZeroStress Cockpit - Defender-Modul (Beispiel-Implementation)
 *
 * Dieses Modul demonstriert, wie ein neues Fachmodul den ModuleContract
 * implementiert. Es kann als Vorlage fuer weitere Module dienen.
 *
 * HINWEIS: Dies ist ein hypothetisches Beispiel, kein produktionsreifer Code.
 */

import type {
  ModuleContract,
  GraphScope,
  AzureRoleDefinition,
  NavigationItem,
  RouteDefinition,
  JobDefinition,
  WidgetDefinition,
  ModuleHooks,
  RouteContext,
  RouteResponse,
  JobContext,
  JobResult,
  PreviewContext,
  PreviewResult,
  WidgetProps,
  TenantId,
} from './module-contract';

// ============================================
// Modul-Konfiguration
// ============================================

interface DefenderModuleConfig {
  /** Alert-Schweregrade, die im Dashboard angezeigt werden */
  alertSeverities: ('high' | 'medium' | 'low' | 'informational')[];

  /** Automatische Isolation bei kritischen Alerts */
  autoIsolateOnCritical: boolean;

  /** Retention fuer lokale Alert-Kopien (Tage) */
  alertRetentionDays: number;
}

const DEFAULT_CONFIG: DefenderModuleConfig = {
  alertSeverities: ['high', 'medium'],
  autoIsolateOnCritical: false,
  alertRetentionDays: 30,
};

// ============================================
// Graph-Scopes
// ============================================

const graphScopes: ReadonlyArray<GraphScope> = [
  {
    scope: 'SecurityEvents.Read.All',
    reason: 'Lesen von Security-Alerts und -Events',
    required: true,
    type: 'application',
  },
  {
    scope: 'SecurityEvents.ReadWrite.All',
    reason: 'Aendern des Alert-Status (Schliessen, Zuweisen)',
    required: true,
    type: 'application',
  },
  {
    scope: 'SecurityActions.ReadWrite.All',
    reason: 'Ausfuehren von Response-Aktionen (Isolieren, Scan starten)',
    required: true,
    type: 'application',
  },
  {
    scope: 'ThreatIndicators.Read.All',
    reason: 'Lesen von Threat-Intelligence-Indikatoren',
    required: false,
    type: 'application',
  },
  {
    scope: 'Device.Read.All',
    reason: 'Geraeteinformationen fuer Alert-Kontext',
    required: true,
    type: 'application',
  },
];

// ============================================
// Azure RBAC-Rollen
// ============================================

const azureRoles: ReadonlyArray<AzureRoleDefinition> = [
  // Defender benoetigt keine zusaetzlichen Azure RBAC-Rollen,
  // da es vollstaendig ueber Graph API funktioniert
];

// ============================================
// Navigation
// ============================================

const navigation: ReadonlyArray<NavigationItem> = [
  {
    id: 'defender',
    label: 'Security',
    icon: 'shield',
    path: '/defender',
    children: [
      {
        id: 'defender-alerts',
        label: 'Alerts',
        icon: 'alert-triangle',
        path: '/defender/alerts',
        requiredPermission: 'defender.alerts.read',
        badge: {
          source: 'api',
          endpoint: '/api/defender/alerts/count?severity=high',
          variant: 'error',
        },
      },
      {
        id: 'defender-incidents',
        label: 'Incidents',
        icon: 'layers',
        path: '/defender/incidents',
        requiredPermission: 'defender.incidents.read',
      },
      {
        id: 'defender-devices',
        label: 'Device Security',
        icon: 'monitor',
        path: '/defender/devices',
        requiredPermission: 'defender.devices.read',
      },
      {
        id: 'defender-hunting',
        label: 'Threat Hunting',
        icon: 'search',
        path: '/defender/hunting',
        requiredPermission: 'defender.hunting.read',
      },
    ],
  },
];

// ============================================
// API-Routen
// ============================================

// Handler: Alerts auflisten
async function listAlerts(ctx: RouteContext): Promise<RouteResponse> {
  const defenderProvider = ctx.resolve<DefenderProvider>(DEFENDER_PROVIDER);

  const severity = ctx.query.severity as string | undefined;
  const status = ctx.query.status as string | undefined;

  const alerts = await defenderProvider.getAlerts(ctx.tenantId, {
    severity,
    status,
    pageSize: parseInt(ctx.query.pageSize ?? '25', 10),
    pageToken: ctx.query.pageToken,
  });

  return {
    status: 200,
    body: alerts,
  };
}

// Handler: Alert-Details
async function getAlert(ctx: RouteContext): Promise<RouteResponse> {
  const defenderProvider = ctx.resolve<DefenderProvider>(DEFENDER_PROVIDER);
  const alertId = ctx.params.alertId;

  const alert = await defenderProvider.getAlertById(ctx.tenantId, alertId);

  if (!alert) {
    return {
      status: 404,
      body: {
        type: 'https://api.zerostress.io/problems/alert-not-found',
        title: 'Alert not found',
        status: 404,
        detail: `Alert with ID '${alertId}' does not exist`,
      },
    };
  }

  return {
    status: 200,
    body: alert,
  };
}

// Handler: Geraet isolieren (erstellt Job)
async function isolateDevice(ctx: RouteContext): Promise<RouteResponse> {
  const jobService = ctx.resolve<JobService>(JOB_SERVICE);

  const job = await jobService.createWithPreview({
    type: 'defender.isolate-device',
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    payload: {
      deviceId: ctx.params.deviceId,
      comment: (ctx.body as { comment?: string })?.comment ?? 'Isolated via ZeroStress Cockpit',
    },
  });

  return {
    status: 202,
    body: job,
  };
}

const routes: ReadonlyArray<RouteDefinition> = [
  {
    method: 'GET',
    path: '/alerts',
    handler: listAlerts,
    middleware: ['rateLimit'],
    requiredPermission: 'defender.alerts.read',
    rateLimit: { limit: 100, windowSeconds: 60, perTenant: true },
    openApi: {
      summary: 'Security-Alerts auflisten',
      description: 'Listet alle Security-Alerts fuer den Tenant auf',
      tags: ['Defender'],
    },
  },
  {
    method: 'GET',
    path: '/alerts/:alertId',
    handler: getAlert,
    requiredPermission: 'defender.alerts.read',
    openApi: {
      summary: 'Alert-Details abrufen',
      tags: ['Defender'],
    },
  },
  {
    method: 'POST',
    path: '/devices/:deviceId/isolate',
    handler: isolateDevice,
    middleware: ['audit', 'preview'],
    requiredPermission: 'defender.devices.isolate',
    openApi: {
      summary: 'Geraet vom Netzwerk isolieren',
      description: 'Isoliert ein kompromittiertes Geraet ueber Defender for Endpoint',
      tags: ['Defender'],
    },
  },
];

// ============================================
// Jobs
// ============================================

// Job-Handler: Geraet isolieren
async function handleIsolateDevice(ctx: JobContext): Promise<JobResult> {
  const defenderProvider = ctx.resolve<DefenderProvider>(DEFENDER_PROVIDER);
  const payload = ctx.payload as { deviceId: string; comment: string };

  ctx.log('info', `Starting device isolation for device ${payload.deviceId}`);
  ctx.progress(10, 'Initiating isolation request');

  try {
    const result = await defenderProvider.isolateDevice(
      ctx.tenantId,
      payload.deviceId,
      payload.comment
    );

    ctx.progress(100, 'Device isolated successfully');

    return {
      success: true,
      data: {
        deviceId: payload.deviceId,
        isolationStatus: result.status,
        machineActionId: result.machineActionId,
      },
    };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      error: {
        code: 'ISOLATION_FAILED',
        message: err.message,
        retryable: false,
      },
    };
  }
}

// Preview-Generator: Geraet isolieren
async function previewIsolateDevice(ctx: PreviewContext): Promise<PreviewResult> {
  const defenderProvider = ctx.resolve<DefenderProvider>(DEFENDER_PROVIDER);
  const payload = ctx.payload as { deviceId: string };

  const device = await defenderProvider.getDeviceById(ctx.tenantId, payload.deviceId);

  if (!device) {
    return {
      changes: [],
      warnings: [`Geraet mit ID ${payload.deviceId} nicht gefunden`],
      estimatedDurationSeconds: 0,
      expiresInSeconds: 0,
    };
  }

  const warnings: string[] = [];

  if (device.isAzureAdJoined) {
    warnings.push('Geraet ist Azure-AD-joined. Isolation kann Benutzer aussperren.');
  }

  if (device.onboardingStatus !== 'onboarded') {
    warnings.push('Geraet ist nicht vollstaendig in Defender onboarded.');
  }

  return {
    changes: [
      {
        objectType: 'device',
        objectId: device.id,
        objectDisplayName: device.deviceName,
        action: 'update',
        before: {
          networkStatus: 'connected',
          isolationStatus: 'none',
        },
        after: {
          networkStatus: 'isolated',
          isolationStatus: 'full',
        },
      },
    ],
    warnings,
    estimatedDurationSeconds: 30,
    expiresInSeconds: 300,
  };
}

const jobs: ReadonlyArray<JobDefinition> = [
  {
    type: 'defender.isolate-device',
    displayName: 'Geraet isolieren',
    handler: handleIsolateDevice,
    maxRetries: 1,
    timeoutSeconds: 120,
    concurrencyPerTenant: 5,
    requiresPreview: true,
    previewGenerator: previewIsolateDevice,
  },
  {
    type: 'defender.release-device',
    displayName: 'Geraet-Isolation aufheben',
    handler: async (ctx) => {
      // Implementierung analog zu isolateDevice
      return { success: true };
    },
    maxRetries: 1,
    timeoutSeconds: 120,
    concurrencyPerTenant: 5,
    requiresPreview: true,
  },
  {
    type: 'defender.run-av-scan',
    displayName: 'Antivirus-Scan starten',
    handler: async (ctx) => {
      // Quick Scan oder Full Scan auf Geraet starten
      return { success: true };
    },
    maxRetries: 2,
    timeoutSeconds: 60,
    concurrencyPerTenant: 10,
    requiresPreview: false,
  },
  {
    type: 'defender.update-alert-status',
    displayName: 'Alert-Status aendern',
    handler: async (ctx) => {
      // Alert schliessen, zuweisen, etc.
      return { success: true };
    },
    maxRetries: 3,
    timeoutSeconds: 30,
    concurrencyPerTenant: 20,
    requiresPreview: false,
  },
];

// ============================================
// Widgets
// ============================================

// Widget: Aktuelle High-Severity-Alerts
function HighSeverityAlertsWidget(props: WidgetProps): JSX.Element | null {
  // React-Komponente, die die aktuellen High-Severity-Alerts anzeigt
  // Implementierung wuerde React-Hooks und API-Calls verwenden
  return null;
}

// Widget: Security-Score
function SecurityScoreWidget(props: WidgetProps): JSX.Element | null {
  // Zeigt den Microsoft Secure Score fuer den Tenant
  return null;
}

// Widget: Geraete nach Risiko-Level
function DeviceRiskWidget(props: WidgetProps): JSX.Element | null {
  // Pie-Chart mit Geraeteverteilung nach Risiko-Level
  return null;
}

const widgets: ReadonlyArray<WidgetDefinition> = [
  {
    id: 'defender-high-alerts',
    displayName: 'Kritische Alerts',
    component: HighSeverityAlertsWidget,
    defaultSize: 'medium',
    refreshIntervalSeconds: 60,
    requiredPermission: 'defender.alerts.read',
    scope: 'tenant',
  },
  {
    id: 'defender-secure-score',
    displayName: 'Security Score',
    component: SecurityScoreWidget,
    defaultSize: 'small',
    refreshIntervalSeconds: 3600,
    requiredPermission: 'defender.score.read',
    scope: 'tenant',
  },
  {
    id: 'defender-device-risk',
    displayName: 'Geraete nach Risiko',
    component: DeviceRiskWidget,
    defaultSize: 'medium',
    refreshIntervalSeconds: 300,
    requiredPermission: 'defender.devices.read',
    scope: 'tenant',
  },
];

// ============================================
// Lifecycle-Hooks
// ============================================

const hooks: ModuleHooks = {
  onLoad: async () => {
    console.log('Defender module loaded');
  },

  onTenantSwitch: async (tenantId: TenantId) => {
    console.log(`Defender: Switched to tenant ${tenantId}`);
    // Ggf. Caches invalidieren, Subscriptions aktualisieren
  },

  onSyncComplete: async (tenantId: TenantId, result) => {
    console.log(`Defender sync for ${tenantId}: ${result.entitiesUpdated} updated`);
  },
};

// ============================================
// Modul-Contract Export
// ============================================

export const defenderModule: ModuleContract<DefenderModuleConfig> = {
  id: 'defender',
  displayName: 'Microsoft Defender',
  version: '1.0.0',
  description: 'Security-Alerts, Incidents und Device-Response ueber Defender for Endpoint',

  graphScopes,
  azureRoles,
  navigation,
  routes,
  jobs,
  widgets,

  defaultConfig: DEFAULT_CONFIG,
  hooks,

  dependencies: ['identity'], // Benoetigt User-Informationen fuer Alert-Kontext
};

// ============================================
// Provider-Interface (Referenz)
// ============================================

interface DefenderProvider {
  getAlerts(
    tenantId: TenantId,
    options: {
      severity?: string;
      status?: string;
      pageSize: number;
      pageToken?: string;
    }
  ): Promise<AlertList>;

  getAlertById(tenantId: TenantId, alertId: string): Promise<Alert | null>;

  getDeviceById(tenantId: TenantId, deviceId: string): Promise<Device | null>;

  isolateDevice(
    tenantId: TenantId,
    deviceId: string,
    comment: string
  ): Promise<IsolationResult>;
}

// Service-Tokens (Dependency Injection)
const DEFENDER_PROVIDER = { name: 'DefenderProvider' } as const;
const JOB_SERVICE = { name: 'JobService' } as const;

// Typ-Definitionen (Platzhalter)
interface AlertList {
  items: Alert[];
  nextPageToken?: string;
}
interface Alert {
  id: string;
  title: string;
  severity: string;
  status: string;
}
interface Device {
  id: string;
  deviceName: string;
  isAzureAdJoined: boolean;
  onboardingStatus: string;
}
interface IsolationResult {
  status: string;
  machineActionId: string;
}
interface JobService {
  createWithPreview(options: unknown): Promise<unknown>;
}
