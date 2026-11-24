'use client';

import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { LoadingTable } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import type { BaselineKind, BaselineOverview, CompliancePlatform, PolicyDeviceStatus } from '@zerostress/types';

const kindLabels: Record<BaselineKind, string> = {
  windows: 'Windows',
  defender: 'Defender for Endpoint',
  edge: 'Microsoft Edge',
  'm365-apps': 'Microsoft 365 Apps',
  windows365: 'Windows 365',
  other: 'Sonstige',
};

const platformLabels: Record<CompliancePlatform, string> = { windows: 'Windows', macos: 'macOS', ios: 'iOS/iPadOS', android: 'Android', other: 'Sonstige' };

// Erwartete Baselines fuer Business-Premium-Kunden; fehlende werden als Luecke gezeigt
const EXPECTED: BaselineKind[] = ['windows', 'defender', 'edge', 'm365-apps'];

function dateText(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('de-DE') : '-';
}

function StatusCell({ status }: { status: PolicyDeviceStatus | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">nicht gemeldet</span>;
  const problems = status.error + status.conflict;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      <span className="text-success">{status.success} ok</span>
      {status.failed > 0 && <span className="text-warning">{status.failed} nicht konform</span>}
      {problems > 0 && <span className="text-destructive">{problems} Fehler/Konflikt</span>}
      {status.pending > 0 && <span className="text-muted-foreground">{status.pending} ausstehend</span>}
      {status.notApplicable > 0 && <span className="text-muted-foreground">{status.notApplicable} n. z.</span>}
    </span>
  );
}

function AssignedBadge({ assigned }: { assigned: boolean }) {
  return <span className={clsx('rounded-full px-2 py-0.5 text-xs', assigned ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>{assigned ? 'zugewiesen' : 'nicht zugewiesen'}</span>;
}

/**
 * Intune-Sicherheitsbaselines und Compliance-Richtlinien des Tenants mit
 * Zuweisung und Geraetestatus. Nur lesend; die Bewertung steht unter Best Practices.
 */
export function BaselinesTab({ tenantId }: { tenantId: string }) {
  const query = useQuery({
    queryKey: ['security-baselines', tenantId],
    queryFn: () => api.get<BaselineOverview>(`/tenants/${tenantId}/security/baselines`),
    staleTime: 10 * 60 * 1000,
  });

  if (query.isLoading) return <LoadingTable rows={6} />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const data = query.data;
  if (!data) return null;
  if (!data.available) return <CapabilityNotice what="die Intune-Baselines" reason={data.reason} missingPermission={data.missingPermission} detail={data.detail} />;

  const { baselines, compliance, collectedAt } = data.data;
  const missing = EXPECTED.filter((k) => !baselines.some((b) => b.kind === k && b.assigned));

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-xs text-muted-foreground">
        Sicherheitsbaselines und Compliance-Richtlinien aus Intune, Stand {new Date(collectedAt).toLocaleString('de-DE')}. Die Pruefungen leiten sich aus Microsoft-Empfehlungen ab. Eine formale Zuordnung zu CIS-Benchmarks ist nicht enthalten, weil deren Nutzung in kommerziellen Produkten eine CIS-Lizenz voraussetzt.
      </p>

      {missing.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm" role="status">
          Keine zugewiesene Baseline fuer: {missing.map((k) => kindLabels[k]).join(', ')}. Bewertung und Empfehlung stehen unter Best Practices.
        </div>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">Sicherheitsbaselines</h2>
        {baselines.length === 0 ? (
          <EmptyState title="Keine Sicherheitsbaselines" description="In Intune unter Endpunktsicherheit > Sicherheitsbaselines ist keine Baseline angelegt." />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Art</th>
                  <th className="px-3 py-2 font-medium">Vorlage</th>
                  <th className="px-3 py-2 font-medium">Zuweisung</th>
                  <th className="px-3 py-2 font-medium">Geraete</th>
                  <th className="px-3 py-2 font-medium">Geaendert</th>
                </tr>
              </thead>
              <tbody>
                {baselines.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="px-3 py-2">{b.name}</td>
                    <td className="px-3 py-2">{kindLabels[b.kind]}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {b.templateName ?? '-'}
                      {b.templateVersion && <span className="block">{b.templateVersion}</span>}
                      {b.source === 'template' && <span className="block">aelteres Vorlagenformat</span>}
                    </td>
                    <td className="px-3 py-2">
                      <AssignedBadge assigned={b.assigned} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusCell status={b.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{dateText(b.lastModified)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Compliance-Richtlinien</h2>
        {compliance.length === 0 ? (
          <EmptyState title="Keine Compliance-Richtlinien" description="Ohne Compliance-Richtlinie fliesst der Geraetezustand nicht in Conditional Access ein." />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Plattform</th>
                  <th className="px-3 py-2 font-medium">Zuweisung</th>
                  <th className="px-3 py-2 font-medium">Geraete</th>
                  <th className="px-3 py-2 font-medium">Geaendert</th>
                </tr>
              </thead>
              <tbody>
                {compliance.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="px-3 py-2">{p.name}</td>
                    <td className="px-3 py-2">{platformLabels[p.platform]}</td>
                    <td className="px-3 py-2">
                      <AssignedBadge assigned={p.assigned} />
                    </td>
                    <td className="px-3 py-2">
                      <StatusCell status={p.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{dateText(p.lastModified)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
