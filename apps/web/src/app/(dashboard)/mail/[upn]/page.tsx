'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { useTenant } from '@/hooks/use-tenant';
import { LoadingPage } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState, NoTenantSelected } from '@/components/ui/empty-state';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { Collapsible } from '@/components/ui/collapsible';
import { formatDateTime } from '@/components/identity/sign-in-table';
import { AutoReplyDialog, DisableAutoReplyDialog, ForwardRuleDialog, RuleJobDialog, type RuleAction } from '@/components/mail/mailbox-dialogs';
import type { InboxRule, InboxRuleActionKind, MailboxDetail } from '@zerostress/types';

const actionLabels: Record<InboxRuleActionKind, string> = {
  forward: 'weiterleiten an',
  forwardAsAttachment: 'als Anlage weiterleiten an',
  redirect: 'umleiten an',
  delete: 'loeschen',
  permanentDelete: 'endgueltig loeschen',
  move: 'verschieben/kopieren',
  markAsRead: 'als gelesen markieren',
  other: 'sonstige Aktion',
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—';
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

export default function MailboxDetailPage({ params }: { params: { upn: string } }) {
  const upn = decodeURIComponent(params.upn);
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<{ kind: 'auto-reply' } | { kind: 'auto-reply-off' } | { kind: 'forward' } | { kind: 'rule'; rule: InboxRule; action: RuleAction } | null>(null);

  const query = useQuery({
    queryKey: ['mailbox', activeTenant?.id, upn],
    queryFn: () => api.get<MailboxDetail>(`/tenants/${activeTenant!.id}/mail/mailboxes/${encodeURIComponent(upn)}`),
    enabled: !!activeTenant,
    staleTime: 60 * 1000,
  });

  if (tenantLoading) return <LoadingPage message="Lade Postfach..." />;
  if (!activeTenant) return <NoTenantSelected />;
  if (query.isLoading) return <LoadingPage message="Lade Postfach..." />;
  if (query.error) return <ErrorState error={query.error as Error} onRetry={query.refetch} />;
  const box = query.data;
  if (!box) return <EmptyState title="Postfach nicht gefunden" />;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['mailbox', activeTenant.id, upn] });
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
  };
  const mailboxRef = { tenantId: activeTenant.id, userPrincipalName: box.userPrincipalName, displayName: box.displayName };
  const autoReply = box.settings.available ? box.settings.data.autoReply : null;
  const rules = box.rules.available ? box.rules.data : [];
  const forwarding = rules.filter((r) => r.forwardsTo.length > 0);
  const canAct = box.userId !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Link href="/mail" className="mt-1 text-muted-foreground hover:text-foreground" aria-label="Zurueck zu Exchange">
            ←
          </Link>
          <div>
            <h1 className="text-2xl font-semibold">{box.displayName}</h1>
            <p className="text-sm text-muted-foreground">
              {box.userPrincipalName}
              {box.usage ? ` · ${typeLabel(box.usage.recipientType)}` : ''}
              {box.settings.available && box.settings.data.userPurpose ? ` · Zweck ${box.settings.data.userPurpose}` : ''}
              {box.accountEnabled === false ? ' · Konto deaktiviert' : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {autoReply && autoReply.status !== 'disabled' && <Badge tone="warning">Abwesenheit {autoReply.status === 'scheduled' ? 'geplant' : 'aktiv'}</Badge>}
              {forwarding.some((r) => r.forwardsExternally && r.isEnabled) && <Badge tone="destructive">Externe Weiterleitung</Badge>}
              {forwarding.length > 0 && !forwarding.some((r) => r.forwardsExternally && r.isEnabled) && <Badge tone="muted">Interne Weiterleitung</Badge>}
              {box.usage?.hasArchive && <Badge tone="muted">Archiv</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {box.userId && (
            <Link href={`/users/${box.userId}`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Benutzer
            </Link>
          )}
          <button onClick={() => setDialog({ kind: 'auto-reply' })} disabled={!canAct || !box.settings.available} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
            Abwesenheit setzen
          </button>
          {autoReply && autoReply.status !== 'disabled' && (
            <button onClick={() => setDialog({ kind: 'auto-reply-off' })} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
              Abwesenheit aus
            </button>
          )}
          <button onClick={() => setDialog({ kind: 'forward' })} disabled={!canAct || !box.rules.available} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            Weiterleitung einrichten
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Belegt" value={formatBytes(box.usage?.storageUsedBytes ?? null)} sub={box.usage?.prohibitSendQuotaBytes ? `von ${formatBytes(box.usage.prohibitSendQuotaBytes)}` : undefined} tone={box.usage && (box.usage.usagePercent ?? 0) >= 95 ? 'destructive' : box.usage && (box.usage.usagePercent ?? 0) >= 80 ? 'warning' : undefined} />
        <Stat label="Kontingent" value={box.usage?.usagePercent === null || box.usage?.usagePercent === undefined ? '—' : `${box.usage.usagePercent.toFixed(0)} %`} sub={box.usage?.warningQuotaBytes ? `Warnung ab ${formatBytes(box.usage.warningQuotaBytes)}` : undefined} />
        <Stat label="Elemente" value={box.usage?.itemCount === null || box.usage?.itemCount === undefined ? '—' : box.usage.itemCount.toLocaleString('de-DE')} />
        <Stat label="Letzte Aktivitaet" value={box.usage?.lastActivityAt ? new Date(box.usage.lastActivityAt).toLocaleDateString('de-DE') : 'nie'} />
        <Stat label="Gesendet (30 Tage)" value={box.usage?.sentCount === null || box.usage?.sentCount === undefined ? '—' : String(box.usage.sentCount)} sub={box.usage?.receivedCount !== null && box.usage?.receivedCount !== undefined ? `${box.usage.receivedCount} empfangen` : undefined} />
        <Stat label="Regeln" value={box.rules.available ? String(rules.length) : '—'} sub={forwarding.length > 0 ? `${forwarding.length} mit Weiterleitung` : undefined} tone={forwarding.some((r) => r.forwardsExternally && r.isEnabled) ? 'destructive' : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Abwesenheit</h2>
          {!box.settings.available ? (
            <CapabilityNotice what="die Postfacheinstellungen" reason={box.settings.reason} missingPermission={box.settings.missingPermission} detail={box.settings.detail} compact />
          ) : (
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[140px_1fr]">
              <dt className="text-muted-foreground">Status</dt>
              <dd>{autoReply!.status === 'disabled' ? 'aus' : autoReply!.status === 'scheduled' ? `geplant ${formatDateTime(autoReply!.scheduledStart ?? '')} bis ${formatDateTime(autoReply!.scheduledEnd ?? '')}` : 'aktiv bis zum Ausschalten'}</dd>
              {autoReply!.status !== 'disabled' && (
                <>
                  <dt className="text-muted-foreground">Extern</dt>
                  <dd>{autoReply!.externalAudience === 'none' ? 'keine externe Antwort' : autoReply!.externalAudience === 'contactsOnly' ? 'nur Kontakte' : 'alle externen Absender'}</dd>
                  <dt className="text-muted-foreground">Intern</dt>
                  <dd className="whitespace-pre-wrap text-muted-foreground">{stripHtml(autoReply!.internalMessage) || '(leer)'}</dd>
                  {autoReply!.externalAudience !== 'none' && (
                    <>
                      <dt className="text-muted-foreground">Extern</dt>
                      <dd className="whitespace-pre-wrap text-muted-foreground">{stripHtml(autoReply!.externalMessage) || '(leer)'}</dd>
                    </>
                  )}
                </>
              )}
              <dt className="text-muted-foreground">Zeitzone</dt>
              <dd>{box.settings.data.timeZone ?? '—'}</dd>
              <dt className="text-muted-foreground">Sprache</dt>
              <dd>{box.settings.data.language ?? '—'}</dd>
            </dl>
          )}
        </section>

        <section className="rounded-lg border p-4">
          <h2 className="mb-3 font-medium">Adressen</h2>
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="text-muted-foreground">Primaer</dt>
            <dd className="font-mono text-xs">{box.mail ?? box.userPrincipalName}</dd>
            <dt className="text-muted-foreground">Aliasse</dt>
            <dd className="font-mono text-xs">{box.aliases.length > 0 ? box.aliases.join(', ') : '—'}</dd>
            <dt className="text-muted-foreground">Kontingente</dt>
            <dd className="text-muted-foreground">
              {box.usage ? `Warnung ${formatBytes(box.usage.warningQuotaBytes)}, Sendesperre ${formatBytes(box.usage.prohibitSendQuotaBytes)}, Empfangssperre ${formatBytes(box.usage.prohibitSendReceiveQuotaBytes)}` : 'nicht im Bericht'}
            </dd>
            <dt className="text-muted-foreground">Angelegt</dt>
            <dd>{box.usage?.createdAt ? new Date(box.usage.createdAt).toLocaleDateString('de-DE') : '—'}</dd>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Kontingente aendern, Weiterleitung auf Postfachebene, Vollzugriff/Senden als, Archiv und Freigabe-Umwandlung kommen mit dem Exchange-Worker (siehe Plan Exchange).</p>
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Posteingangsregeln</h2>
        {!box.rules.available ? (
          <CapabilityNotice what="die Posteingangsregeln" reason={box.rules.reason} missingPermission={box.rules.missingPermission} detail={box.rules.detail} compact />
        ) : rules.length === 0 ? (
          <p className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">Keine Regeln im Posteingang.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {rules.map((r) => (
              <li key={r.id} className={clsx('flex flex-wrap items-start justify-between gap-3 px-4 py-3', r.forwardsExternally && r.isEnabled && 'bg-destructive/5')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={clsx('font-medium', !r.isEnabled && 'text-muted-foreground line-through')}>{r.displayName}</span>
                    {!r.isEnabled && <Badge tone="muted">aus</Badge>}
                    {r.forwardsExternally && <Badge tone="destructive">extern</Badge>}
                    {r.forwardsTo.length > 0 && !r.forwardsExternally && <Badge tone="muted">Weiterleitung</Badge>}
                    {r.hasError && <Badge tone="warning">Fehler</Badge>}
                    {r.isReadOnly && <Badge tone="muted">schreibgeschuetzt</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">Wenn: {r.conditions.join('; ')}</p>
                  <p className="text-xs text-muted-foreground">Dann: {r.actions.map((a) => (a.recipients.length > 0 ? `${actionLabels[a.kind]} ${a.recipients.join(', ')}` : actionLabels[a.kind])).join('; ')}</p>
                </div>
                {canAct && !r.isReadOnly && (
                  <div className="flex gap-1">
                    <button onClick={() => setDialog({ kind: 'rule', rule: r, action: r.isEnabled ? 'disable' : 'enable' })} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">
                      {r.isEnabled ? 'Deaktivieren' : 'Aktivieren'}
                    </button>
                    <button onClick={() => setDialog({ kind: 'rule', rule: r, action: 'delete' })} className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10">
                      Loeschen
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <Collapsible summary="Was hier moeglich ist" aside="Graph">
          <p className="text-xs text-muted-foreground">
            Abwesenheit und Posteingangsregeln laufen ueber Microsoft Graph (MailboxSettings.ReadWrite) und wirken sofort. Alles, was Exchange nur per PowerShell kann (Kontingent, Weiterleitung auf Postfachebene, Berechtigungen, Archiv, Aufbewahrung, Umwandlung in ein freigegebenes Postfach), ist fuer den Exchange-Worker vorgesehen.
          </p>
        </Collapsible>
      </section>

      {dialog?.kind === 'auto-reply' && autoReply && <AutoReplyDialog mailbox={mailboxRef} current={autoReply} onClose={() => setDialog(null)} onCompleted={refresh} />}
      {dialog?.kind === 'auto-reply-off' && <DisableAutoReplyDialog mailbox={mailboxRef} onClose={() => setDialog(null)} onCompleted={refresh} />}
      {dialog?.kind === 'forward' && <ForwardRuleDialog mailbox={mailboxRef} onClose={() => setDialog(null)} onCompleted={refresh} />}
      {dialog?.kind === 'rule' && <RuleJobDialog mailbox={mailboxRef} rule={dialog.rule} action={dialog.action} onClose={() => setDialog(null)} onCompleted={refresh} />}
    </div>
  );
}

function typeLabel(type: string): string {
  return type === 'UserMailbox' ? 'Benutzerpostfach' : type === 'SharedMailbox' ? 'Freigegebenes Postfach' : type === 'RoomMailbox' ? 'Raumpostfach' : type === 'EquipmentMailbox' ? 'Geraetepostfach' : 'Postfach';
}

function Badge({ tone, children }: { tone: 'warning' | 'destructive' | 'muted'; children: React.ReactNode }) {
  return <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', tone === 'warning' && 'bg-warning/10 text-warning', tone === 'destructive' && 'bg-destructive/10 text-destructive', tone === 'muted' && 'bg-muted text-muted-foreground')}>{children}</span>;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warning' | 'destructive' }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={clsx('mt-1 text-xl font-semibold tabular-nums', tone === 'warning' && 'text-warning', tone === 'destructive' && 'text-destructive')}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}
