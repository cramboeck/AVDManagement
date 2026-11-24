/**
 * Baseline-Provider: Intune-Sicherheitsbaselines und Compliance-Richtlinien
 * eines Tenants mit Zuweisung und Geraetestatus. Nur lesend.
 *
 * Quellen (Microsoft Graph):
 * - Baselines im neuen Format: beta configurationPolicies mit
 *   templateFamily "baseline"; Status je Richtlinie aus dem Intune-Bericht
 *   getConfigurationPolicyDeviceSummaryReport.
 * - Aeltere Baselines: beta intents, deren Vorlage den Typ securityBaseline
 *   hat; Status aus deviceStateSummary.
 * - Compliance-Richtlinien: v1.0 deviceCompliancePolicies mit Zuweisungen
 *   und deviceStatusOverview.
 *
 * Ein nicht lesbarer Status einer einzelnen Richtlinie bricht die Uebersicht
 * nicht ab; die Richtlinie erscheint dann mit status null.
 */

import type { BaselineKind, BaselineOverview, CompliancePlatform, CompliancePolicyInfo, PolicyDeviceStatus, SecurityBaselineInfo } from '@zerostress/types';
import { BaseResourceProvider, type ProviderContext } from './resource-provider.js';
import { GraphClient, type GraphResponse } from './graph-client.js';
import { GraphApiError } from '../errors.js';
import { GRAPH_BETA } from './remediation-provider.js';
import { reportRows, type IntuneReport } from './app-provider.js';

interface GraphConfigurationPolicy {
  id: string;
  name: string;
  isAssigned?: boolean | null;
  lastModifiedDateTime?: string | null;
  templateReference?: { templateId?: string | null; templateFamily?: string | null; templateDisplayName?: string | null; templateDisplayVersion?: string | null } | null;
}

interface GraphIntent {
  id: string;
  displayName: string;
  templateId?: string | null;
  isAssigned?: boolean | null;
  lastModifiedDateTime?: string | null;
}

interface GraphTemplate {
  id: string;
  displayName: string;
  versionInfo?: string | null;
  templateType?: string | null;
}

interface GraphIntentStateSummary {
  conflictCount?: number;
  errorCount?: number;
  failedCount?: number;
  notApplicableCount?: number;
  notApplicablePlatformCount?: number;
  successCount?: number;
}

interface GraphCompliancePolicy {
  '@odata.type'?: string;
  id: string;
  displayName: string;
  lastModifiedDateTime?: string | null;
  assignments?: unknown[] | null;
}

interface GraphComplianceOverview {
  pendingCount?: number;
  notApplicableCount?: number;
  notApplicablePlatformCount?: number;
  successCount?: number;
  errorCount?: number;
  failedCount?: number;
  conflictCount?: number;
}

const MAX_POLICIES = 50;

function n(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Art der Baseline aus dem Vorlagennamen (Microsoft benennt die Vorlagen sprechend). */
export function classifyBaseline(templateName: string | null, policyName: string): BaselineKind {
  const text = `${templateName ?? ''} ${policyName}`.toLowerCase();
  if (/defender|endpoint/.test(text)) return 'defender';
  if (/edge/.test(text)) return 'edge';
  if (/365 apps|office/.test(text)) return 'm365-apps';
  if (/windows 365|cloud pc/.test(text)) return 'windows365';
  if (/windows|mdm security/.test(text)) return 'windows';
  return 'other';
}

export function compliancePlatform(odataType: string | undefined): CompliancePlatform {
  const t = (odataType ?? '').toLowerCase();
  if (t.includes('windows')) return 'windows';
  if (t.includes('macos')) return 'macos';
  if (t.includes('ios')) return 'ios';
  if (t.includes('android') || t.includes('aosp')) return 'android';
  return 'other';
}

/**
 * Zusammenfassung aus einer Berichtszeile ueber die Spaltennamen. Liefert
 * null, wenn keine bekannte Spalte vorkommt (anderes Berichtsformat).
 */
export function statusFromReportRow(row: Record<string, unknown> | undefined): PolicyDeviceStatus | null {
  if (!row) return null;
  const status: PolicyDeviceStatus = { success: 0, failed: 0, error: 0, conflict: 0, notApplicable: 0, pending: 0 };
  let known = false;
  for (const [column, value] of Object.entries(row)) {
    const c = column.toLowerCase();
    if (!c.startsWith('numberof') && !c.endsWith('count')) continue;
    const v = n(value);
    if (c.includes('noncompliant') || c.includes('failed')) status.failed += v;
    else if (c.includes('compliant') || c.includes('success')) status.success += v;
    else if (c.includes('error')) status.error += v;
    else if (c.includes('conflict')) status.conflict += v;
    else if (c.includes('notapplicable')) status.notApplicable += v;
    else if (c.includes('inprogress') || c.includes('pending')) status.pending += v;
    else continue;
    known = true;
  }
  return known ? status : null;
}

export class BaselineProvider extends BaseResourceProvider {
  readonly name = 'baselines';
  // Lesen reicht; die App hat ohnehin ReadWrite fuer die Skriptbibliothek
  readonly requiredScopes = ['DeviceManagementConfiguration.ReadWrite.All'];

  constructor(private readonly graphClient: GraphClient) {
    super();
  }

  async getOverview(ctx: ProviderContext, now = new Date()): Promise<BaselineOverview> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;
    try {
      const [catalog, templates, compliance] = await Promise.all([
        this.listCatalogBaselines(tenantId),
        this.listTemplateBaselines(tenantId),
        this.listCompliancePolicies(tenantId),
      ]);
      const baselines = [...catalog, ...templates].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'de'));
      return { available: true, data: { baselines, compliance, collectedAt: now.toISOString() } };
    } catch (error) {
      if (error instanceof GraphApiError && error.isAuthError) {
        return { available: false, reason: 'permission-missing', missingPermission: 'DeviceManagementConfiguration.Read.All', detail: error.message };
      }
      if (error instanceof GraphApiError && (error.statusCode === 400 || error.statusCode === 404)) {
        return { available: false, reason: 'not-licensed', missingPermission: null, detail: error.message };
      }
      throw error;
    }
  }

  private async listCatalogBaselines(tenantId: string): Promise<SecurityBaselineInfo[]> {
    const filter = encodeURIComponent("templateReference/templateFamily eq 'baseline'");
    const res = await this.graphClient.get<GraphResponse<GraphConfigurationPolicy[]>>(
      tenantId,
      `${GRAPH_BETA}/deviceManagement/configurationPolicies?$filter=${filter}&$select=id,name,isAssigned,lastModifiedDateTime,templateReference&$top=${MAX_POLICIES}`,
      this.requiredScopes
    );
    const policies = (res.value ?? []).slice(0, MAX_POLICIES);
    return Promise.all(
      policies.map(async (p) => {
        const templateName = p.templateReference?.templateDisplayName ?? null;
        return {
          id: p.id,
          name: p.name,
          kind: classifyBaseline(templateName, p.name),
          source: 'settings-catalog' as const,
          templateName,
          templateVersion: p.templateReference?.templateDisplayVersion ?? null,
          assigned: p.isAssigned === true,
          lastModified: p.lastModifiedDateTime ?? null,
          status: await this.catalogStatus(tenantId, p.id),
        };
      })
    );
  }

  private async catalogStatus(tenantId: string, policyId: string): Promise<PolicyDeviceStatus | null> {
    try {
      const report = await this.graphClient.post<IntuneReport>(tenantId, `${GRAPH_BETA}/deviceManagement/reports/getConfigurationPolicyDeviceSummaryReport`, this.requiredScopes, {
        filter: `(PolicyId eq '${policyId}')`,
      });
      return statusFromReportRow(reportRows(report)[0]);
    } catch {
      // Bericht nicht verfuegbar oder anderes Format: Richtlinie trotzdem anzeigen
      return null;
    }
  }

  private async listTemplateBaselines(tenantId: string): Promise<SecurityBaselineInfo[]> {
    const templatesFilter = encodeURIComponent("templateType eq 'securityBaseline'");
    const [templates, intents] = await Promise.all([
      this.graphClient.get<GraphResponse<GraphTemplate[]>>(tenantId, `${GRAPH_BETA}/deviceManagement/templates?$filter=${templatesFilter}&$select=id,displayName,versionInfo,templateType`, this.requiredScopes),
      this.graphClient.get<GraphResponse<GraphIntent[]>>(tenantId, `${GRAPH_BETA}/deviceManagement/intents?$select=id,displayName,templateId,isAssigned,lastModifiedDateTime&$top=${MAX_POLICIES}`, this.requiredScopes),
    ]);
    const byId = new Map((templates.value ?? []).map((t) => [t.id.toLowerCase(), t]));
    const baselineIntents = (intents.value ?? []).filter((i) => i.templateId && byId.has(i.templateId.toLowerCase())).slice(0, MAX_POLICIES);
    return Promise.all(
      baselineIntents.map(async (i) => {
        const template = byId.get((i.templateId ?? '').toLowerCase()) ?? null;
        return {
          id: i.id,
          name: i.displayName,
          kind: classifyBaseline(template?.displayName ?? null, i.displayName),
          source: 'template' as const,
          templateName: template?.displayName ?? null,
          templateVersion: template?.versionInfo ?? null,
          assigned: i.isAssigned === true,
          lastModified: i.lastModifiedDateTime ?? null,
          status: await this.intentStatus(tenantId, i.id),
        };
      })
    );
  }

  private async intentStatus(tenantId: string, intentId: string): Promise<PolicyDeviceStatus | null> {
    try {
      const s = await this.graphClient.get<GraphIntentStateSummary>(tenantId, `${GRAPH_BETA}/deviceManagement/intents/${encodeURIComponent(intentId)}/deviceStateSummary`, this.requiredScopes);
      return { success: n(s.successCount), failed: n(s.failedCount), error: n(s.errorCount), conflict: n(s.conflictCount), notApplicable: n(s.notApplicableCount) + n(s.notApplicablePlatformCount), pending: 0 };
    } catch {
      return null;
    }
  }

  private async listCompliancePolicies(tenantId: string): Promise<CompliancePolicyInfo[]> {
    const res = await this.graphClient.get<GraphResponse<GraphCompliancePolicy[]>>(
      tenantId,
      `/deviceManagement/deviceCompliancePolicies?$select=id,displayName,lastModifiedDateTime&$expand=assignments`,
      this.requiredScopes
    );
    const policies = (res.value ?? []).slice(0, MAX_POLICIES);
    return Promise.all(
      policies.map(async (p) => ({
        id: p.id,
        name: p.displayName,
        platform: compliancePlatform(p['@odata.type']),
        assigned: (p.assignments ?? []).length > 0,
        lastModified: p.lastModifiedDateTime ?? null,
        status: await this.complianceStatus(tenantId, p.id),
      }))
    );
  }

  private async complianceStatus(tenantId: string, policyId: string): Promise<PolicyDeviceStatus | null> {
    try {
      const o = await this.graphClient.get<GraphComplianceOverview>(tenantId, `/deviceManagement/deviceCompliancePolicies/${encodeURIComponent(policyId)}/deviceStatusOverview`, this.requiredScopes);
      return { success: n(o.successCount), failed: n(o.failedCount), error: n(o.errorCount), conflict: n(o.conflictCount), notApplicable: n(o.notApplicableCount) + n(o.notApplicablePlatformCount), pending: n(o.pendingCount) };
    } catch {
      return null;
    }
  }
}
