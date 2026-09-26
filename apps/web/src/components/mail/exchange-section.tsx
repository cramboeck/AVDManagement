'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { formatDateTime } from '@/components/identity/sign-in-table';
import { ExchangeActionDialog, type ExchangeAction } from '@/components/mail/exchange-dialogs';
import type { MailboxDetail } from '@zerostress/types';

/**
 * Daten und Aktionen, die nur der Exchange-Worker liefert: Kontingente,
 * Weiterleitung auf Postfachebene, Berechtigungen, Archiv, Beweissicherung.
 */
export function ExchangeSection({ tenantId, box, onCompleted }: { tenantId: string; box: MailboxDetail; onCompleted: () => void }) {
  const [action, setAction] = useState<ExchangeAction | null>(null);
  const facts = box.exchange.facts;
  const mailboxRef = { tenantId, userPrincipalName: box.userPrincipalName, displayName: box.displayName };
  const canAct = box.userId !== null;

  const buttons: Array<{ id: ExchangeAction; label: string; tone?: 'destructive' }> = [
    { id: 'quota', label: 'Kontingent' },
    { id: 'forwarding', label: 'Weiterleitung' },
    { id: 'full-access', label: 'Vollzugriff' },
    { id: 'send-as', label: 'Senden als' },
    { id: 'archive', label: 'Archiv aktivieren' },
    { id: 'convert', label: 'Postfachtyp', tone: 'destructive' },
    { id: 'hold', label: 'Beweissicherung', tone: 'destructive' },
  ];

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Exchange-Einstellungen (Worker)</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {box.exchange.collectedAt ? `Stand ${formatDateTime(box.exchange.collectedAt)} aus dem Exchange-Worker` : 'Noch keine Daten vom Exchange-Worker fuer diesen Tenant; unter Exchange "Postfachdaten sammeln" starten.'}
            {box.exchange.autoForwardingMode ? ` · Automatische Weiterleitung laut Outbound-Spam-Richtlinie: ${box.exchange.autoForwardingMode}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {buttons.map((b) => (
            <button key={b.id} onClick={() => setAction(b.id)} disabled={!canAct} className={clsx('rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50', b.tone === 'destructive' && 'border-destructive/40 text-destructive hover:bg-destructive/10')}>
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {facts ? (
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[180px_1fr]">
          <dt className="text-muted-foreground">Typ</dt>
          <dd>{facts.recipientTypeDetails}</dd>
          <dt className="text-muted-foreground">Kontingent</dt>
          <dd>
            Warnung {facts.issueWarningQuota ?? '—'} · Sendesperre {facts.prohibitSendQuota ?? '—'} · Empfangssperre {facts.prohibitSendReceiveQuota ?? '—'}
          </dd>
          <dt className="text-muted-foreground">Weiterleitung (Postfach)</dt>
          <dd className={clsx(facts.forwardingSmtpAddress && 'text-warning')}>
            {facts.forwardingSmtpAddress ?? facts.forwardingAddress ?? 'keine'}
            {(facts.forwardingSmtpAddress || facts.forwardingAddress) && <span className="ml-1 text-xs text-muted-foreground">({facts.deliverToMailboxAndForward ? 'Kopie bleibt' : 'ohne Kopie'})</span>}
          </dd>
          <dt className="text-muted-foreground">Vollzugriff</dt>
          <dd>{facts.fullAccess.length > 0 ? facts.fullAccess.join(', ') : 'niemand'}</dd>
          <dt className="text-muted-foreground">Senden als</dt>
          <dd>{facts.sendAs.length > 0 ? facts.sendAs.join(', ') : 'niemand'}</dd>
          <dt className="text-muted-foreground">Senden im Auftrag</dt>
          <dd>{facts.sendOnBehalf.length > 0 ? facts.sendOnBehalf.join(', ') : 'niemand'}</dd>
          <dt className="text-muted-foreground">Archiv</dt>
          <dd>{facts.archiveStatus ?? '—'}</dd>
          <dt className="text-muted-foreground">Beweissicherung</dt>
          <dd>{facts.litigationHoldEnabled ? `aktiv${facts.litigationHoldDuration ? ` (${facts.litigationHoldDuration})` : ''}` : 'aus'}</dd>
          <dt className="text-muted-foreground">Aufbewahrung</dt>
          <dd>{facts.retentionPolicy ?? '—'}</dd>
          <dt className="text-muted-foreground">Sonstiges</dt>
          <dd className="text-muted-foreground">
            {facts.hiddenFromAddressLists ? 'in Adresslisten verborgen' : 'in Adresslisten sichtbar'}
            {facts.auditEnabled === null ? '' : facts.auditEnabled ? ' · Postfachaudit an' : ' · Postfachaudit aus'}
          </dd>
        </dl>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Kontingente, Weiterleitung auf Postfachebene, Berechtigungen, Archiv und Beweissicherung erscheinen hier, sobald der Worker die Daten gesammelt hat. Aktionen sind trotzdem moeglich; die Vorschau zeigt dann "unbekannt" als Ist-Zustand.</p>
      )}

      {action && <ExchangeActionDialog mailbox={mailboxRef} action={action} facts={facts} onClose={() => setAction(null)} onCompleted={onCompleted} />}
    </section>
  );
}
