'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import type { ExchangeMailboxFacts, Job } from '@zerostress/types';

interface MailboxRef {
  tenantId: string;
  userPrincipalName: string;
  displayName: string;
}

export type ExchangeAction = 'quota' | 'forwarding' | 'full-access' | 'send-as' | 'archive' | 'convert' | 'hold';

const inputClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

function useEscape(onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, active]);
}

function Shell({ title, titleId, children, onClose }: { title: string; titleId: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 id={titleId} className="font-medium">
            {title}
          </h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent" aria-label="Schliessen">
            Schliessen
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Footer({ valid, onClose }: { valid: boolean; onClose: () => void }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
        Abbrechen
      </button>
      <button type="submit" disabled={!valid} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
        Weiter zur Vorschau
      </button>
    </div>
  );
}

function gbOf(text: string | null): number | null {
  if (!text) return null;
  const m = /([0-9]+(?:\.[0-9]+)?)\s*(GB|MB)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].toUpperCase() === 'MB' ? Math.round((n / 1024) * 10) / 10 : n;
}

/**
 * Eine Exchange-Aktion: Formular je Aktion, dann Job mit Vorschau. Der
 * Exchange-Worker fuehrt die Aenderung aus; das Cockpit wartet auf ihn.
 */
export function ExchangeActionDialog({ mailbox, action, facts, onClose, onCompleted }: { mailbox: MailboxRef; action: ExchangeAction; facts: ExchangeMailboxFacts | null; onClose: () => void; onCompleted: () => void }) {
  const [submitted, setSubmitted] = useState(false);
  const [body, setBody] = useState<Record<string, unknown> | null>(null);
  useEscape(onClose, !submitted);

  if (submitted && body) {
    const titles: Record<ExchangeAction, string> = {
      quota: 'Kontingent setzen',
      forwarding: body.forwardingSmtpAddress ? 'Weiterleitung setzen' : 'Weiterleitung entfernen',
      'full-access': body.grant ? 'Vollzugriff gewaehren' : 'Vollzugriff entziehen',
      'send-as': body.grant ? 'Senden als gewaehren' : 'Senden als entziehen',
      archive: 'Archiv aktivieren',
      convert: body.toShared ? 'In freigegebenes Postfach umwandeln' : 'In Benutzerpostfach umwandeln',
      hold: body.enabled ? 'Beweissicherung aktivieren' : 'Beweissicherung aufheben',
    };
    return (
      <JobActionDialog
        title={`${titles[action]}: ${mailbox.displayName}`}
        description="Der Exchange-Worker fuehrt die Aenderung mit Exchange Online PowerShell aus. Die Vorschau zeigt den zuletzt gesammelten Zustand."
        confirmLabel="Auftrag freigeben"
        tone={action === 'convert' || action === 'hold' || (action === 'forwarding' && !!body.forwardingSmtpAddress) ? 'destructive' : 'default'}
        createJob={() => api.post<Job>(`/tenants/${mailbox.tenantId}/mail/mailboxes/${encodeURIComponent(mailbox.userPrincipalName)}/exchange/${action}`, { displayName: mailbox.displayName, ...body })}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    );
  }

  const submit = (values: Record<string, unknown>) => {
    setBody(values);
    setSubmitted(true);
  };

  switch (action) {
    case 'quota':
      return <QuotaForm mailbox={mailbox} facts={facts} onSubmit={submit} onClose={onClose} />;
    case 'forwarding':
      return <ForwardingForm mailbox={mailbox} facts={facts} onSubmit={submit} onClose={onClose} />;
    case 'full-access':
    case 'send-as':
      return <PermissionForm mailbox={mailbox} action={action} facts={facts} onSubmit={submit} onClose={onClose} />;
    case 'archive':
      submit({});
      return null;
    case 'convert':
      return <ConvertForm mailbox={mailbox} facts={facts} onSubmit={submit} onClose={onClose} />;
    case 'hold':
      return <HoldForm mailbox={mailbox} facts={facts} onSubmit={submit} onClose={onClose} />;
  }
}

function QuotaForm({ mailbox, facts, onSubmit, onClose }: { mailbox: MailboxRef; facts: ExchangeMailboxFacts | null; onSubmit: (v: Record<string, unknown>) => void; onClose: () => void }) {
  const [warn, setWarn] = useState(String(gbOf(facts?.issueWarningQuota ?? null) ?? 45));
  const [send, setSend] = useState(String(gbOf(facts?.prohibitSendQuota ?? null) ?? 49));
  const [receive, setReceive] = useState(String(gbOf(facts?.prohibitSendReceiveQuota ?? null) ?? 50));
  const w = Number(warn);
  const s = Number(send);
  const r = Number(receive);
  const valid = [w, s, r].every((n) => Number.isFinite(n) && n >= 1 && n <= 100) && w <= s && s <= r;
  return (
    <Shell title={`Kontingent: ${mailbox.displayName}`} titleId="exo-quota" onClose={onClose}>
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit({ issueWarningGb: w, prohibitSendGb: s, prohibitSendReceiveGb: r });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Warnung ab (GB)</span>
            <input type="number" step="0.5" min={1} max={100} className={inputClass} value={warn} onChange={(e) => setWarn(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Sendesperre (GB)</span>
            <input type="number" step="0.5" min={1} max={100} className={inputClass} value={send} onChange={(e) => setSend(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Empfangssperre (GB)</span>
            <input type="number" step="0.5" min={1} max={100} className={inputClass} value={receive} onChange={(e) => setReceive(e.target.value)} />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">Reihenfolge Warnung ≤ Sendesperre ≤ Empfangssperre. Die Lizenz begrenzt das Maximum (50 GB bei Business-Plaenen, 100 GB bei E3/E5).</p>
        <Footer valid={valid} onClose={onClose} />
      </form>
    </Shell>
  );
}

function ForwardingForm({ mailbox, facts, onSubmit, onClose }: { mailbox: MailboxRef; facts: ExchangeMailboxFacts | null; onSubmit: (v: Record<string, unknown>) => void; onClose: () => void }) {
  const [address, setAddress] = useState(facts?.forwardingSmtpAddress ?? '');
  const [keep, setKeep] = useState(facts ? facts.deliverToMailboxAndForward : true);
  const [remove, setRemove] = useState(false);
  const valid = remove || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim());
  return (
    <Shell title={`Weiterleitung auf Postfachebene: ${mailbox.displayName}`} titleId="exo-forwarding" onClose={onClose}>
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(remove ? { forwardingSmtpAddress: null, deliverToMailboxAndForward: false } : { forwardingSmtpAddress: address.trim().toLowerCase(), deliverToMailboxAndForward: keep });
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Zieladresse</span>
          <input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} disabled={remove} placeholder="vertretung@kunde.de" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} disabled={remove} />
          Kopie im Postfach behalten
        </label>
        {(facts?.forwardingSmtpAddress || facts?.forwardingAddress) && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
            Bestehende Weiterleitung entfernen
          </label>
        )}
        <p className="text-xs text-muted-foreground">Greift vor allen Posteingangsregeln und fuer jede Mail. Externe Ziele stellt Exchange nur zu, wenn die Outbound-Spam-Richtlinie automatische Weiterleitung erlaubt.</p>
        <Footer valid={valid} onClose={onClose} />
      </form>
    </Shell>
  );
}

function PermissionForm({ mailbox, action, facts, onSubmit, onClose }: { mailbox: MailboxRef; action: 'full-access' | 'send-as'; facts: ExchangeMailboxFacts | null; onSubmit: (v: Record<string, unknown>) => void; onClose: () => void }) {
  const [trustee, setTrustee] = useState('');
  const [grant, setGrant] = useState(true);
  const [autoMapping, setAutoMapping] = useState(true);
  const existing = action === 'full-access' ? (facts?.fullAccess ?? []) : (facts?.sendAs ?? []);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trustee.trim()) && trustee.trim().toLowerCase() !== mailbox.userPrincipalName.toLowerCase();
  return (
    <Shell title={`${action === 'full-access' ? 'Vollzugriff' : 'Senden als'}: ${mailbox.displayName}`} titleId="exo-permission" onClose={onClose}>
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit({ trustee: trustee.trim().toLowerCase(), grant, ...(action === 'full-access' ? { autoMapping } : {}) });
        }}
      >
        <div className="flex gap-2 text-sm">
          <button type="button" onClick={() => setGrant(true)} aria-pressed={grant} className={`rounded-md border px-3 py-1 ${grant ? 'border-primary bg-primary/10 text-primary' : ''}`}>
            Gewaehren
          </button>
          <button type="button" onClick={() => setGrant(false)} aria-pressed={!grant} className={`rounded-md border px-3 py-1 ${!grant ? 'border-primary bg-primary/10 text-primary' : ''}`}>
            Entziehen
          </button>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Berechtigter (UPN)</span>
          <input className={inputClass} value={trustee} onChange={(e) => setTrustee(e.target.value)} placeholder="erika@kunde.de" list="exo-trustees" />
          <datalist id="exo-trustees">
            {existing.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        {action === 'full-access' && grant && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autoMapping} onChange={(e) => setAutoMapping(e.target.checked)} />
            AutoMapping (Postfach erscheint automatisch in Outlook)
          </label>
        )}
        {existing.length > 0 && <p className="text-xs text-muted-foreground">Aktuell: {existing.join(', ')}</p>}
        <Footer valid={valid} onClose={onClose} />
      </form>
    </Shell>
  );
}

function ConvertForm({ mailbox, facts, onSubmit, onClose }: { mailbox: MailboxRef; facts: ExchangeMailboxFacts | null; onSubmit: (v: Record<string, unknown>) => void; onClose: () => void }) {
  const isShared = facts?.recipientTypeDetails === 'SharedMailbox';
  const [toShared, setToShared] = useState(!isShared);
  return (
    <Shell title={`Postfachtyp: ${mailbox.displayName}`} titleId="exo-convert" onClose={onClose}>
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ toShared });
        }}
      >
        <p className="text-sm">Aktuell: {facts?.recipientTypeDetails ?? 'unbekannt'}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={toShared} onChange={() => setToShared(true)} />
          In freigegebenes Postfach umwandeln (bis 50 GB ohne Lizenz; Konto danach sperren)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={!toShared} onChange={() => setToShared(false)} />
          In Benutzerpostfach umwandeln (braucht eine Exchange-Lizenz)
        </label>
        <Footer valid onClose={onClose} />
      </form>
    </Shell>
  );
}

function HoldForm({ mailbox, facts, onSubmit, onClose }: { mailbox: MailboxRef; facts: ExchangeMailboxFacts | null; onSubmit: (v: Record<string, unknown>) => void; onClose: () => void }) {
  const [enabled, setEnabled] = useState(!(facts?.litigationHoldEnabled ?? false));
  const [days, setDays] = useState('');
  const d = days.trim() ? Number(days) : null;
  const valid = !enabled || d === null || (Number.isInteger(d) && d >= 1 && d <= 24855);
  return (
    <Shell title={`Beweissicherung: ${mailbox.displayName}`} titleId="exo-hold" onClose={onClose}>
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit({ enabled, durationDays: enabled ? d : null });
        }}
      >
        <p className="text-sm">Aktuell: {facts ? (facts.litigationHoldEnabled ? `aktiv${facts.litigationHoldDuration ? ` (${facts.litigationHoldDuration})` : ''}` : 'aus') : 'unbekannt'}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Beweissicherung aktiv
        </label>
        {enabled && (
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Dauer in Tagen (leer = unbegrenzt)</span>
            <input type="number" min={1} max={24855} className={inputClass} value={days} onChange={(e) => setDays(e.target.value)} placeholder="unbegrenzt" />
          </label>
        )}
        <p className="text-xs text-muted-foreground">Braucht Exchange Online Plan 2 oder eine Archiv-Lizenz. Aufbewahrung geloeschter und geaenderter Elemente; Datenschutzfolgen dokumentieren.</p>
        <Footer valid={valid} onClose={onClose} />
      </form>
    </Shell>
  );
}
