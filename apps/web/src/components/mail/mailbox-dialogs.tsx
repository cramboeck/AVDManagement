'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import type { AutoReplyAudience, AutoReplyStatus, InboxRule, Job, MailboxAutoReply } from '@zerostress/types';

interface MailboxRef {
  tenantId: string;
  userPrincipalName: string;
  displayName: string;
}

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
      <div className="w-full max-w-xl rounded-lg border bg-background shadow-lg" role="dialog" aria-modal="true" aria-labelledby={titleId}>
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

/** Abwesenheitsnotiz: Formular, dann Job mit Vorschau. */
export function AutoReplyDialog({ mailbox, current, onClose, onCompleted }: { mailbox: MailboxRef; current: MailboxAutoReply; onClose: () => void; onCompleted: () => void }) {
  const [status, setStatus] = useState<AutoReplyStatus>(current.status === 'disabled' ? 'alwaysEnabled' : current.status);
  const [audience, setAudience] = useState<AutoReplyAudience>(current.externalAudience === 'none' && current.status === 'disabled' ? 'contactsOnly' : current.externalAudience);
  const [start, setStart] = useState(current.scheduledStart?.slice(0, 16) ?? '');
  const [end, setEnd] = useState(current.scheduledEnd?.slice(0, 16) ?? '');
  const [internal, setInternal] = useState(stripHtml(current.internalMessage));
  const [external, setExternal] = useState(stripHtml(current.externalMessage));
  const [submitted, setSubmitted] = useState(false);
  useEscape(onClose, !submitted);

  const valid = status !== 'scheduled' || (start && end && end > start);

  if (submitted) {
    return (
      <JobActionDialog
        title={`Abwesenheit setzen: ${mailbox.displayName}`}
        description="Die Vorschau zeigt die bisherige und die neue Einstellung. Die Aenderung steht im Audit."
        confirmLabel="Setzen"
        createJob={() =>
          api.post<Job>(`/tenants/${mailbox.tenantId}/mail/mailboxes/${encodeURIComponent(mailbox.userPrincipalName)}/auto-reply`, {
            displayName: mailbox.displayName,
            status,
            externalAudience: audience,
            scheduledStart: status === 'scheduled' ? start : null,
            scheduledEnd: status === 'scheduled' ? end : null,
            internalMessage: internal,
            externalMessage: audience === 'none' ? '' : external,
          })
        }
        onClose={onClose}
        onCompleted={onCompleted}
      />
    );
  }

  return (
    <Shell title={`Abwesenheit: ${mailbox.displayName}`} titleId="auto-reply-title" onClose={onClose}>
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) setSubmitted(true);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Modus</span>
            <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as AutoReplyStatus)}>
              <option value="alwaysEnabled">Sofort, bis zum Ausschalten</option>
              <option value="scheduled">Geplant (von/bis)</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Externe Absender</span>
            <select className={inputClass} value={audience} onChange={(e) => setAudience(e.target.value as AutoReplyAudience)}>
              <option value="none">Keine externe Antwort</option>
              <option value="contactsOnly">Nur Kontakte</option>
              <option value="all">Alle externen Absender</option>
            </select>
          </label>
        </div>
        {status === 'scheduled' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Von (lokale Zeit)</span>
              <input type="datetime-local" className={inputClass} value={start} onChange={(e) => setStart(e.target.value)} required />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Bis</span>
              <input type="datetime-local" className={inputClass} value={end} onChange={(e) => setEnd(e.target.value)} required />
            </label>
          </div>
        )}
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Nachricht intern</span>
          <textarea className={inputClass} rows={4} value={internal} onChange={(e) => setInternal(e.target.value)} placeholder="Ich bin bis ... nicht erreichbar. In dringenden Faellen ..." />
        </label>
        {audience !== 'none' && (
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Nachricht extern (keine internen Details)</span>
            <textarea className={inputClass} rows={3} value={external} onChange={(e) => setExternal(e.target.value)} />
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Abbrechen
          </button>
          <button type="submit" disabled={!valid} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            Weiter zur Vorschau
          </button>
        </div>
      </form>
    </Shell>
  );
}

/** Abwesenheit ausschalten: direkt der Job. */
export function DisableAutoReplyDialog({ mailbox, onClose, onCompleted }: { mailbox: MailboxRef; onClose: () => void; onCompleted: () => void }) {
  return (
    <JobActionDialog
      title={`Abwesenheit ausschalten: ${mailbox.displayName}`}
      confirmLabel="Ausschalten"
      createJob={() => api.post<Job>(`/tenants/${mailbox.tenantId}/mail/mailboxes/${encodeURIComponent(mailbox.userPrincipalName)}/auto-reply`, { displayName: mailbox.displayName, status: 'disabled', externalAudience: 'none', internalMessage: '', externalMessage: '' })}
      onClose={onClose}
      onCompleted={onCompleted}
    />
  );
}

/** Weiterleitungsregel: Formular, dann Job mit Vorschau. */
export function ForwardRuleDialog({ mailbox, onClose, onCompleted }: { mailbox: MailboxRef; onClose: () => void; onCompleted: () => void }) {
  const [name, setName] = useState('Weiterleitung');
  const [addresses, setAddresses] = useState('');
  const [keepCopy, setKeepCopy] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  useEscape(onClose, !submitted);

  const list = addresses
    .split(/[,;\s]+/)
    .map((a) => a.trim())
    .filter(Boolean);
  const valid = name.trim().length > 0 && list.length > 0 && list.every((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));

  if (submitted) {
    return (
      <JobActionDialog
        title={`Weiterleitung anlegen: ${mailbox.displayName}`}
        description="Die Vorschau warnt bei Zielen ausserhalb des Tenants. Die Regel steht im Audit."
        confirmLabel="Anlegen"
        createJob={() => api.post<Job>(`/tenants/${mailbox.tenantId}/mail/mailboxes/${encodeURIComponent(mailbox.userPrincipalName)}/rules`, { displayName: mailbox.displayName, ruleName: name.trim(), addresses: list, keepCopy })}
        onClose={onClose}
        onCompleted={onCompleted}
      />
    );
  }

  return (
    <Shell title={`Weiterleitung: ${mailbox.displayName}`} titleId="forward-rule-title" onClose={onClose}>
      <form
        className="space-y-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) setSubmitted(true);
        }}
      >
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Regelname</span>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-muted-foreground">Zieladressen (Komma oder Zeilenumbruch)</span>
          <textarea className={inputClass} rows={3} value={addresses} onChange={(e) => setAddresses(e.target.value)} placeholder="vertretung@kunde.de" required />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={keepCopy} onChange={(e) => setKeepCopy(e.target.checked)} />
          Kopie im Postfach behalten (weiterleiten statt umleiten)
        </label>
        <p className="text-xs text-muted-foreground">
          Das ist eine Posteingangsregel im Postfach (wie in Outlook). Die Weiterleitung auf Postfachebene und Kontingente folgen mit dem Exchange-Worker. Externe Ziele blockiert Exchange, wenn die Outbound-Spam-Richtlinie automatische Weiterleitung verbietet.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            Abbrechen
          </button>
          <button type="submit" disabled={!valid} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            Weiter zur Vorschau
          </button>
        </div>
      </form>
    </Shell>
  );
}

export type RuleAction = 'enable' | 'disable' | 'delete';

const ruleTitles: Record<RuleAction, string> = { enable: 'Regel aktivieren', disable: 'Regel deaktivieren', delete: 'Regel loeschen' };

/** Regel aktivieren, deaktivieren oder loeschen: direkt der Job. */
export function RuleJobDialog({ mailbox, rule, action, onClose, onCompleted }: { mailbox: MailboxRef; rule: InboxRule; action: RuleAction; onClose: () => void; onCompleted: () => void }) {
  return (
    <JobActionDialog
      title={`${ruleTitles[action]}: ${rule.displayName}`}
      description={`Postfach ${mailbox.displayName}. Die Vorschau zeigt die Regel mit Bedingungen und Aktionen.`}
      confirmLabel={action === 'delete' ? 'Loeschen' : action === 'enable' ? 'Aktivieren' : 'Deaktivieren'}
      tone={action === 'delete' ? 'destructive' : 'default'}
      createJob={() => api.post<Job>(`/tenants/${mailbox.tenantId}/mail/mailboxes/${encodeURIComponent(mailbox.userPrincipalName)}/rules/${encodeURIComponent(rule.id)}/${action}`, { displayName: mailbox.displayName, ruleName: rule.displayName })}
      onClose={onClose}
      onCompleted={onCompleted}
    />
  );
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
