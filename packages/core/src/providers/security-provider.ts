/**
 * Security-Provider: Secure Score, MFA-Registrierung und offene Alerts
 * ueber Microsoft Graph. Alle Quellen sind optional (Lizenz, Berechtigung).
 */

import type {
  AlertSeverity,
  CapabilityResult,
  MfaRegistrationSummary,
  OpenAlertsSummary,
  SecureScoreSummary,
} from '@zerostress/types';
import { BaseResourceProvider, type ProviderContext } from './resource-provider.js';
import { GraphClient, type GraphResponse } from './graph-client.js';
import { GraphApiError } from '../errors.js';

interface GraphSecureScore {
  id: string;
  createdDateTime: string;
  currentScore: number;
  maxScore: number;
  averageComparativeScores?: { basis: string; averageScore: number }[];
  controlScores?: {
    controlName: string;
    controlCategory?: string;
    score: number;
    implementationStatus?: string | null;
    description?: string;
  }[];
}

interface GraphControlProfile {
  id: string;
  title?: string | null;
  maxScore?: number | null;
  controlCategory?: string | null;
  userImpact?: string | null;
  implementationCost?: string | null;
  actionUrl?: string | null;
  remediation?: string | null;
  deprecated?: boolean | null;
}

interface GraphRegistrationDetail {
  id: string;
  isAdmin?: boolean;
  isMfaRegistered?: boolean;
  isMfaCapable?: boolean;
  isPasswordlessCapable?: boolean;
  isSsprRegistered?: boolean;
  userType?: string;
}

interface GraphAlert {
  id: string;
  title: string;
  severity?: string | null;
  status?: string | null;
  createdDateTime: string;
  serviceSource?: string | null;
}

const PREMIUM_REQUIRED_CODE = 'Authentication_RequestFromNonPremiumTenantOrB2CTenant';
const ALERT_SEVERITIES: AlertSeverity[] = ['high', 'medium', 'low', 'informational'];

type Unavailable = Exclude<CapabilityResult<never>, { available: true }>;

function asUnavailable(error: unknown, permission: string): Unavailable | null {
  if (!(error instanceof GraphApiError) || !error.isAuthError) {
    return null;
  }
  if (error.graphErrorCode === PREMIUM_REQUIRED_CODE) {
    return { available: false, reason: 'premium-required', missingPermission: null, detail: error.message };
  }
  return { available: false, reason: 'permission-missing', missingPermission: permission, detail: error.message };
}

export class SecurityProvider extends BaseResourceProvider {
  readonly name = 'security';
  readonly requiredScopes = ['SecurityEvents.Read.All'];

  private readonly alertScopes = ['SecurityAlert.Read.All'];

  // Registrierungsreport braucht Entra ID P1
  private readonly reportScopes = ['AuditLog.Read.All'];

  constructor(private readonly graphClient: GraphClient) {
    super();
  }

  async getSecureScore(ctx: ProviderContext): Promise<CapabilityResult<SecureScoreSummary>> {
    this.validateContext(ctx);

    try {
      const tenantId = ctx.tenantId as string;
      const [response, profiles] = await Promise.all([
        this.graphClient.get<GraphResponse<GraphSecureScore[]>>(tenantId, '/security/secureScores?$top=1', this.requiredScopes),
        this.graphClient.get<GraphResponse<GraphControlProfile[]>>(
          tenantId,
          '/security/secureScoreControlProfiles?$select=id,title,maxScore,controlCategory,userImpact,implementationCost,actionUrl,remediation,deprecated',
          this.requiredScopes
        ),
      ]);
      const score = response.value[0];
      if (!score) {
        return { available: false, reason: 'not-onboarded', missingPermission: null, detail: 'No Secure Score available yet' };
      }

      const maxScore = score.maxScore || 1;
      const profileById = new Map(profiles.value.map((p) => [p.id, p]));
      const topImprovements = (score.controlScores ?? [])
        .map((c) => {
          const profile = profileById.get(c.controlName);
          const controlMax = profile?.maxScore ?? 0;
          return {
            control: c.controlName,
            title: profile?.title ?? c.controlName,
            category: profile?.controlCategory ?? c.controlCategory ?? 'Unknown',
            currentScore: c.score,
            maxScore: controlMax,
            scoreGain: Math.max(0, Math.round((controlMax - c.score) * 100) / 100),
            implementationStatus: c.implementationStatus ?? null,
            userImpact: profile?.userImpact ?? null,
            implementationCost: profile?.implementationCost ?? null,
            actionUrl: profile?.actionUrl ?? null,
            remediation: stripHtml(profile?.remediation ?? null),
            deprecated: profile?.deprecated === true,
          };
        })
        .filter((c) => c.scoreGain > 0 && !c.deprecated)
        .sort((a, b) => b.scoreGain - a.scoreGain)
        .slice(0, 15)
        .map(({ deprecated: _deprecated, ...rest }) => rest);

      return {
        available: true,
        data: {
          currentScore: score.currentScore,
          maxScore: score.maxScore,
          percent: Math.round((score.currentScore / maxScore) * 1000) / 10,
          createdAt: score.createdDateTime,
          comparisons: (score.averageComparativeScores ?? []).map((c) => ({
            basis: c.basis,
            averagePercent: Math.round((c.averageScore / maxScore) * 1000) / 10,
          })),
          topImprovements,
        },
      };
    } catch (error) {
      const unavailable = asUnavailable(error, 'SecurityEvents.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }
  }

  async getMfaRegistration(ctx: ProviderContext): Promise<CapabilityResult<MfaRegistrationSummary>> {
    this.validateContext(ctx);
    const tenantId = ctx.tenantId as string;

    const details: GraphRegistrationDetail[] = [];
    let next: string | null =
      '/reports/authenticationMethods/userRegistrationDetails?$select=id,isAdmin,isMfaRegistered,isMfaCapable,isPasswordlessCapable,isSsprRegistered,userType&$top=999';

    try {
      while (next) {
        const page: GraphResponse<GraphRegistrationDetail[]> = await this.graphClient.get<GraphResponse<GraphRegistrationDetail[]>>(
          tenantId,
          next,
          this.reportScopes
        );
        details.push(...page.value);
        next = page['@odata.nextLink'] ?? null;
      }
    } catch (error) {
      const unavailable = asUnavailable(error, 'AuditLog.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }

    const members = details.filter((d) => d.userType !== 'guest');
    const admins = members.filter((d) => d.isAdmin === true);

    return {
      available: true,
      data: {
        totalUsers: members.length,
        mfaRegistered: members.filter((d) => d.isMfaRegistered === true).length,
        mfaCapable: members.filter((d) => d.isMfaCapable === true).length,
        passwordlessCapable: members.filter((d) => d.isPasswordlessCapable === true).length,
        ssprRegistered: members.filter((d) => d.isSsprRegistered === true).length,
        admins: admins.length,
        adminsWithoutMfa: admins.filter((d) => d.isMfaRegistered !== true).length,
      },
    };
  }

  async getOpenAlerts(ctx: ProviderContext): Promise<CapabilityResult<OpenAlertsSummary>> {
    this.validateContext(ctx);

    try {
      const response = await this.graphClient.get<GraphResponse<GraphAlert[]>>(
        ctx.tenantId as string,
        `/security/alerts_v2?$filter=${encodeURIComponent("status eq 'new' or status eq 'inProgress'")}&$top=200&$select=id,title,severity,status,createdDateTime,serviceSource`,
        this.alertScopes
      );

      const bySeverity: Record<AlertSeverity, number> = { high: 0, medium: 0, low: 0, informational: 0, unknown: 0 };
      const alerts = response.value.map((a) => ({
        id: a.id,
        title: a.title,
        severity: normaliseSeverity(a.severity),
        createdAt: a.createdDateTime,
        source: a.serviceSource ?? null,
      }));
      for (const alert of alerts) {
        bySeverity[alert.severity] += 1;
      }

      return {
        available: true,
        data: {
          total: alerts.length,
          bySeverity,
          newest: alerts
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
            .slice(0, 10),
        },
      };
    } catch (error) {
      const unavailable = asUnavailable(error, 'SecurityAlert.Read.All');
      if (unavailable) return unavailable;
      throw error;
    }
  }
}

// Remediation-Texte aus Graph enthalten gelegentlich HTML
function stripHtml(value: string | null): string | null {
  if (!value) return null;
  const text = value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text || null;
}

function normaliseSeverity(value: string | null | undefined): AlertSeverity {
  const lower = (value ?? '').toLowerCase();
  return (ALERT_SEVERITIES as string[]).includes(lower) ? (lower as AlertSeverity) : 'unknown';
}
