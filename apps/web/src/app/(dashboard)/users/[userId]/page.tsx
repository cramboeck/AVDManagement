'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useTenant } from '@/hooks/use-tenant';
import { api } from '@/lib/api';
import { LoadingPage, LoadingTable, LoadingSpinner } from '@/components/ui/loading';
import { ErrorState } from '@/components/ui/error-state';
import { NoTenantSelected, EmptyState } from '@/components/ui/empty-state';
import { JobActionDialog } from '@/components/jobs/job-action-dialog';
import { AssignLicenseDialog } from '@/components/assign-license-dialog';
import { CapabilityNotice } from '@/components/identity/capability-notice';
import { SignInTable, formatDateTime } from '@/components/identity/sign-in-table';
import { AuditTable } from '@/components/identity/audit-table';
import { DataTable, type ColumnDef } from '@/components/ui/data-table';
import { MembershipJobDialog } from '@/components/groups/membership-dialogs';
import type {
  UserDetail,
  UserLicense,
  UserGroup,
  UserGroupKind,
  AuthenticationMethodsSummary,
  AuthenticationMethodKind,
  CapabilityResult,
  SignInEvent,
  DirectoryAuditEvent,
  Job,
  JobStatus,
} from '@zerostress/types';

type Tab = 'overview' | 'security' | 'groups' | 'history' | 'jobs';
type AccountAction = 'disable-user' | 'enable-user' | 'revoke-sessions' | 'reset-password';

const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Uebersicht' },
  { id: 'security', label: 'Sicherheit' },
  { id: 'groups', label: 'Gruppen' },
  { id: 'history', label: 'Verlauf' },
  { id: 'jobs', label: 'Jobs' },
];

const actionMeta: Record<AccountAction, { title: string; description: string; confirmLabel: string; tone: 'default' | 'destructive' }> = {
  'disable-user': {
    title: 'Benutzer deaktivieren',
    description: 'Das Konto wird gesperrt und alle aktiven Sitzungen werden widerrufen. Lizenzen und Daten bleiben erhalten.',
    confirmLabel: 'Deaktivieren',
    tone: 'destructive',
  },
  'enable-user': {
    title: 'Benutzer aktivieren',
    description: 'Das Konto kann sich wieder anmelden.',
    confirmLabel: 'Aktivieren',
    tone: 'default',
  },
  'revoke-sessions': {
    title: 'Sitzungen widerrufen',
    description: 'Alle Refresh-Token werden ungueltig; der Benutzer muss sich auf allen Geraeten neu anmelden. Das Konto bleibt aktiv.',
    confirmLabel: 'Widerrufen',
    tone: 'destructive',
  },
  'reset-password': {
    title: 'Passwort zuruecksetzen',
    description: 'Ein temporaeres Passwort wird erzeugt und dir einmalig angezeigt. Der Benutzer muss es beim naechsten Login aendern.',
    confirmLabel: 'Zuruecksetzen',
    tone: 'default',
  },
};

const groupKindLabels: Record<UserGroupKind, string> = {
  security: 'Sicherheitsgruppen',
  microsoft365: 'Microsoft 365-Gruppen',
  'mail-enabled-security': 'E-Mail-aktivierte Sicherheitsgruppen',
  distribution: 'Verteilerlisten',
};

const methodLabels: Record<AuthenticationMethodKind, string> = {
  password: 'Passwort',
  'microsoft-authenticator': 'Microsoft Authenticator',
  phone: 'Telefon (SMS/Anruf)',
  fido2: 'FIDO2-Sicherheitsschluessel',
  'windows-hello': 'Windows Hello for Business',
  'software-oath': 'Authenticator-App (OATH)',
  email: 'E-Mail (nur Passwort-Reset)',
  'temporary-access-pass': 'Temporaerer Zugriffspass',
  unknown: 'Unbekannt',
};

const jobStatusLabels: Record<JobStatus, string> = {
  pending_approval: 'Warte auf Freigabe',
  queued: 'In Warteschlange',
  running: 'Laeuft',
  completed: 'Abgeschlossen',
  failed: 'Fehlgeschlagen',
  cancelled: 'Abgebrochen',
};

export default function UserDetailPage({ params }: { params: { userId: string } }) {
  const userId = decodeURIComponent(params.userId);
  const { activeTenant, isLoading: tenantLoading } = useTenant();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [action, setAction] = useState<AccountAction | null>(null);
  const [showLicenseDialog, setShowLicenseDialog] = useState(false);
  const [pendingLicenseJob, setPendingLicenseJob] = useState<Job | null>(null);

  const base = activeTenant ? `/tenants/${activeTenant.id}/users/${encodeURIComponent(userId)}` : '';

  const detailQuery = useQuery({
    queryKey: ['user-detail', activeTenant?.id, userId],
    queryFn: () => api.get<UserDetail>(`${base}/detail`),
    enabled: !!activeTenant,
  });

  const user = detailQuery.data;

  const createAccountJob = useCallback(() => {
    if (!user || !action || !activeTenant) return Promise.reject(new Error('Kein Benutzer geladen'));
    return api.post<Job>(`/tenants/${activeTenant.id}/jobs/${action}`, {
      userId: user.microsoftId,
      userDisplayName: user.displayName,
      userPrincipalName: user.userPrincipalName,
      revokeSessions: true,
    });
  }, [user, action, activeTenant]);

  const resumeLicenseJob = useCallback(
    () => (pendingLicenseJob ? Promise.resolve(pendingLicenseJob) : Promise.reject(new Error('Kein Job'))),
    [pendingLicenseJob]
  );

  const refreshUser = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['user-detail', activeTenant?.id, userId] });
    queryClient.invalidateQueries({ queryKey: ['user-licenses', activeTenant?.id, userId] });
    queryClient.invalidateQueries({ queryKey: ['users', activeTenant?.id] });
  }, [queryClient, activeTenant?.id, userId]);

  if (tenantLoading) return <LoadingPage message="Lade Tenant..." />;
  if (!activeTenant) return <NoTenantSelected />;
  if (detailQuery.isLoading) return <LoadingPage message="Lade Benutzer..." />;
  if (detailQuery.error) return <ErrorState error={detailQuery.error as Error} onRetry={detailQuery.refetch} />;
  if (!user) return <EmptyState title="Benutzer nicht gefunden" />;

  const lastSignIn = user.signInActivity?.lastSignInAt ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Link href="/users" className="mt-1 text-muted-foreground hover:text-foreground" aria-label="Zurueck zur Benutzerliste">
            ←
          </Link>
          <Avatar name={user.displayName} />
          <div>
            <h1 className="text-2xl font-semibold">{user.displayName}</h1>
            <p className="text-sm text-muted-foreground">{user.userPrincipalName}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone={user.accountEnabled ? 'success' : 'muted'}>{user.accountEnabled ? 'Aktiv' : 'Deaktiviert'}</Badge>
              <Badge tone="muted">{user.userType === 'Guest' ? 'Gast' : 'Mitglied'}</Badge>
              {user.onPremisesSyncEnabled && <Badge tone="muted">Aus lokalem AD synchronisiert</Badge>}
              <Badge tone="muted">
                {lastSignIn ? `Zuletzt angemeldet ${formatDateTime(lastSignIn)}` : 'Letzte Anmeldung: nicht verfuegbar'}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {user.accountEnabled ? (
            <ActionButton onClick={() => setAction('disable-user')} tone="destructive">Deaktivieren</ActionButton>
          ) : (
            <ActionButton onClick={() => setAction('enable-user')} tone="primary">Aktivieren</ActionButton>
          )}
          <ActionButton onClick={() => setAction('reset-password')}>Passwort zuruecksetzen</ActionButton>
          <ActionButton onClick={() => setAction('revoke-sessions')}>Sitzungen widerrufen</ActionButton>
          <ActionButton onClick={() => setShowLicenseDialog(true)}>Lizenz zuweisen</ActionButton>
        </div>
      </div>

      {user.onPremisesSyncEnabled && (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm">
          Dieses Konto wird aus dem lokalen Active Directory synchronisiert. Passwort und Deaktivierung
          muessen dort geaendert werden; Cloud-Aenderungen werden ueberschrieben.
        </p>
      )}

      <div role="tablist" aria-label="Benutzerbereiche" className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              '-mb-px border-b-2 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              tab === t.id ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'overview' && <OverviewTab user={user} base={base} tenantId={activeTenant.id} />}
        {tab === 'security' && <SecurityTab base={base} tenantId={activeTenant.id} userId={userId} />}
        {tab === 'groups' && <GroupsTab base={base} tenantId={activeTenant.id} userId={userId} user={user} />}
        {tab === 'history' && <HistoryTab base={base} tenantId={activeTenant.id} userId={userId} />}
        {tab === 'jobs' && <JobsTab tenantId={activeTenant.id} microsoftId={user.microsoftId} />}
      </div>

      {action && (
        <JobActionDialog
          title={actionMeta[action].title}
          description={actionMeta[action].description}
          confirmLabel={actionMeta[action].confirmLabel}
          tone={actionMeta[action].tone}
          createJob={createAccountJob}
          onClose={() => setAction(null)}
          onCompleted={refreshUser}
          renderResult={action === 'reset-password' ? (job) => <TemporaryPassword job={job} /> : undefined}
        />
      )}

      {showLicenseDialog && (
        <AssignLicenseDialog
          user={user}
          onClose={() => setShowLicenseDialog(false)}
          onSuccess={(job) => {
            setShowLicenseDialog(false);
            setPendingLicenseJob(job);
          }}
        />
      )}

      {pendingLicenseJob && (
        <JobActionDialog
          title="Lizenz zuweisen"
          confirmLabel="Zuweisen"
          createJob={resumeLicenseJob}
          onClose={() => setPendingLicenseJob(null)}
          onCompleted={refreshUser}
        />
      )}
    </div>
  );
}

function OverviewTab({ user, base, tenantId }: { user: UserDetail; base: string; tenantId: string }) {
  const licensesQuery = useQuery({
    queryKey: ['user-licenses', tenantId, user.microsoftId],
    queryFn: () => api.get<{ items: UserLicense[] }>(`${base}/licenses`),
  });

  const fields: { label: string; value: string | null }[] = [
    { label: 'Position', value: user.jobTitle },
    { label: 'Abteilung', value: user.department },
    { label: 'Standort', value: user.officeLocation },
    { label: 'Mobil', value: user.mobilePhone },
    { label: 'Telefon', value: user.businessPhones.join(', ') || null },
    { label: 'Ort / Land', value: [user.city, user.country].filter(Boolean).join(', ') || null },
    { label: 'Nutzungsstandort', value: user.usageLocation },
    { label: 'E-Mail', value: user.mail },
    { label: 'Erstellt', value: user.createdAt ? formatDateTime(String(user.createdAt)) : null },
    { label: 'Passwort geaendert', value: user.lastPasswordChangeAt ? formatDateTime(user.lastPasswordChangeAt) : null },
    {
      label: 'Letzte nicht-interaktive Anmeldung',
      value: user.signInActivity?.lastNonInteractiveSignInAt
        ? formatDateTime(user.signInActivity.lastNonInteractiveSignInAt)
        : null,
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="rounded-lg border p-4 lg:col-span-2">
        <h2 className="mb-3 font-medium">Profil</h2>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.label}>
              <dt className="text-xs text-muted-foreground">{field.label}</dt>
              <dd className="text-sm">{field.value ?? '—'}</dd>
            </div>
          ))}
        </dl>
        {!user.signInActivity && (
          <p className="mt-3 text-xs text-muted-foreground">
            Anmeldeaktivitaet nicht verfuegbar: erfordert Entra ID P1 und die Berechtigung AuditLog.Read.All.
          </p>
        )}
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Lizenzen</h2>
        {licensesQuery.isLoading ? (
          <LoadingSpinner size="sm" />
        ) : licensesQuery.error ? (
          <p className="text-sm text-destructive">{(licensesQuery.error as Error).message}</p>
        ) : !licensesQuery.data?.items.length ? (
          <p className="text-sm text-muted-foreground">Keine Lizenzen zugewiesen.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {licensesQuery.data.items.map((license) => (
              <li key={license.skuId} className="flex items-center justify-between rounded border px-2 py-1">
                <span className="font-mono text-xs">{license.skuPartNumber}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SecurityTab({ base, tenantId, userId }: { base: string; tenantId: string; userId: string }) {
  const [failuresOnly, setFailuresOnly] = useState(false);
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const methodsQuery = useQuery({
    queryKey: ['user-auth-methods', tenantId, userId],
    queryFn: () => api.get<CapabilityResult<AuthenticationMethodsSummary>>(`${base}/auth-methods`),
  });

  // Jeder Abruf wird serverseitig auditiert, daher nur laden, wenn der Tab offen ist
  const signInsQuery = useQuery({
    queryKey: ['user-sign-ins', tenantId, userId, failuresOnly],
    queryFn: () =>
      api.get<CapabilityResult<SignInEvent[]>>(
        `${base}/sign-ins?top=50&since=${encodeURIComponent(since)}&failuresOnly=${failuresOnly}`
      ),
    staleTime: 60 * 1000,
  });

  return (
    <div className="space-y-6">
      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-medium">Authentifizierungsmethoden</h2>
        {methodsQuery.isLoading ? (
          <LoadingSpinner size="sm" />
        ) : methodsQuery.error ? (
          <p className="text-sm text-destructive">{(methodsQuery.error as Error).message}</p>
        ) : methodsQuery.data && !methodsQuery.data.available ? (
          <CapabilityNotice what="die registrierten Authentifizierungsmethoden" {...methodsQuery.data} />
        ) : methodsQuery.data?.available ? (
          <AuthMethods summary={methodsQuery.data.data} />
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Anmeldungen (letzte 30 Tage)</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={failuresOnly} onChange={(e) => setFailuresOnly(e.target.checked)} className="h-4 w-4" />
            Nur Fehlschlaege
          </label>
        </div>
        {signInsQuery.isLoading ? (
          <LoadingTable rows={4} />
        ) : signInsQuery.error ? (
          <ErrorState error={signInsQuery.error as Error} onRetry={signInsQuery.refetch} />
        ) : signInsQuery.data && !signInsQuery.data.available ? (
          <CapabilityNotice what="das Anmeldeprotokoll" {...signInsQuery.data} />
        ) : signInsQuery.data?.available && signInsQuery.data.data.length === 0 ? (
          <EmptyState title="Keine Anmeldungen im Zeitraum" description={failuresOnly ? 'Keine fehlgeschlagenen Anmeldungen in den letzten 30 Tagen.' : undefined} />
        ) : signInsQuery.data?.available ? (
          <SignInTable events={signInsQuery.data.data} showUser={false} />
        ) : null}
      </section>
    </div>
  );
}

function AuthMethods({ summary }: { summary: AuthenticationMethodsSummary }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge tone={summary.mfaCapable ? 'success' : 'destructive'}>
          {summary.mfaCapable ? 'MFA registriert' : 'Keine MFA-Methode'}
        </Badge>
        <Badge tone={summary.phishingResistant ? 'success' : 'muted'}>
          {summary.phishingResistant ? 'Phishing-resistent' : 'Nicht phishing-resistent'}
        </Badge>
      </div>
      <ul className="divide-y rounded-md border text-sm">
        {summary.methods.map((method) => (
          <li key={method.id} className="flex items-center justify-between px-3 py-2">
            <div>
              <p>{methodLabels[method.kind]}</p>
              {(method.displayName || method.detail) && (
                <p className="text-xs text-muted-foreground">{[method.displayName, method.detail].filter(Boolean).join(' · ')}</p>
              )}
            </div>
            <div className="flex gap-1">
              {method.countsAsMfa && <Badge tone="success">MFA</Badge>}
              {method.isPhishingResistant && <Badge tone="success">Phishing-resistent</Badge>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GroupsTab({ base, tenantId, userId, user }: { base: string; tenantId: string; userId: string; user: UserDetail }) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<UserGroup | null>(null);
  const groupsQuery = useQuery({
    queryKey: ['user-groups', tenantId, userId],
    queryFn: () => api.get<{ items: UserGroup[] }>(`${base}/groups`),
  });

  if (groupsQuery.isLoading) return <LoadingTable rows={4} />;
  if (groupsQuery.error) return <ErrorState error={groupsQuery.error as Error} onRetry={groupsQuery.refetch} />;
  const groups = groupsQuery.data?.items ?? [];
  if (groups.length === 0) return <EmptyState title="Keine Gruppenmitgliedschaften" />;

  const counts = (Object.keys(groupKindLabels) as UserGroupKind[]).map((kind) => ({ kind, count: groups.filter((g) => g.kind === kind).length })).filter((c) => c.count > 0);
  const columns: ColumnDef<UserGroup>[] = [
    {
      id: 'name',
      header: 'Gruppe',
      accessor: (g) => g.displayName,
      cell: (g) => (
        <Link href={`/groups/${encodeURIComponent(g.id)}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
          {g.displayName}
        </Link>
      ),
    },
    {
      id: 'kind',
      header: 'Typ',
      accessor: (g) => g.kind,
      filterOptions: (Object.keys(groupKindLabels) as UserGroupKind[]).map((k) => ({ value: k, label: groupKindLabels[k] })),
      cell: (g) => <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{groupKindLabels[g.kind]}</span>,
      searchable: false,
    },
    {
      id: 'actions',
      header: '',
      accessor: () => null,
      sortable: false,
      searchable: false,
      align: 'right',
      cell: (g) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setRemoving(g);
          }}
          className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
        >
          Entfernen
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {counts.map((c) => (
          <span key={c.kind} className="rounded-full border px-2 py-0.5">
            {groupKindLabels[c.kind]}: {c.count}
          </span>
        ))}
      </div>
      <DataTable rows={groups} columns={columns} getRowId={(g) => g.id} storageKey="user-groups" initialSort={{ columnId: 'name', direction: 'asc' }} searchPlaceholder="Gruppe..." exportFileName={`gruppen-${user.displayName}`} dense />
      <p className="text-xs text-muted-foreground">Entfernen erzeugt einen Job mit Vorschau; dynamische und aus dem lokalen AD synchronisierte Gruppen lehnen die Aenderung ab.</p>
      {removing && (
        <MembershipJobDialog
          tenantId={tenantId}
          groupId={removing.id}
          groupName={removing.displayName}
          action="remove-member"
          target={{ objectId: user.microsoftId, objectDisplayName: user.displayName, objectUpn: user.userPrincipalName }}
          onClose={() => setRemoving(null)}
          onCompleted={() => {
            queryClient.invalidateQueries({ queryKey: ['user-groups', tenantId, userId] });
            queryClient.invalidateQueries({ queryKey: ['groups', tenantId] });
          }}
        />
      )}
    </div>
  );
}

function HistoryTab({ base, tenantId, userId }: { base: string; tenantId: string; userId: string }) {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const auditQuery = useQuery({
    queryKey: ['user-audit', tenantId, userId],
    queryFn: () => api.get<CapabilityResult<DirectoryAuditEvent[]>>(`${base}/audit?top=50&since=${encodeURIComponent(since)}`),
    staleTime: 60 * 1000,
  });

  if (auditQuery.isLoading) return <LoadingTable rows={4} />;
  if (auditQuery.error) return <ErrorState error={auditQuery.error as Error} onRetry={auditQuery.refetch} />;
  const result = auditQuery.data;
  if (!result) return null;
  if (!result.available) return <CapabilityNotice what="das Entra-Verzeichnisaudit" {...result} />;
  if (result.data.length === 0) return <EmptyState title="Keine Aenderungen in den letzten 30 Tagen" />;

  return (
    <div className="space-y-2">
      <h2 className="font-medium">Aenderungen an diesem Konto (Entra ID, letzte 30 Tage)</h2>
      <AuditTable events={result.data} />
    </div>
  );
}

function JobsTab({ tenantId, microsoftId }: { tenantId: string; microsoftId: string }) {
  const jobsQuery = useQuery({
    queryKey: ['jobs', tenantId],
    queryFn: () => api.get<{ items: Job[] }>(`/tenants/${tenantId}/jobs`),
    refetchInterval: 5000,
  });

  if (jobsQuery.isLoading) return <LoadingTable rows={3} />;
  if (jobsQuery.error) return <ErrorState error={jobsQuery.error as Error} onRetry={jobsQuery.refetch} />;
  const jobs = (jobsQuery.data?.items ?? []).filter((job) => job.payload.userId === microsoftId);
  if (jobs.length === 0) return <EmptyState title="Keine Jobs fuer diesen Benutzer" />;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">Zeit</th>
            <th className="px-3 py-2 font-medium">Aktion</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Ausgeloest von</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id} className="border-b last:border-0">
              <td className="px-3 py-2 text-muted-foreground">{formatDateTime(job.createdAt)}</td>
              <td className="px-3 py-2 font-mono text-xs">{job.type}</td>
              <td className="px-3 py-2">{jobStatusLabels[job.status]}</td>
              <td className="px-3 py-2 text-muted-foreground">{job.createdByEmail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TemporaryPassword({ job }: { job: Job }) {
  const [copied, setCopied] = useState(false);
  const password = typeof job.result?.temporaryPassword === 'string' ? job.result.temporaryPassword : null;
  if (!password) return <p className="text-sm text-muted-foreground">Kein Passwort im Ergebnis.</p>;

  const copy = async () => {
    await navigator.clipboard.writeText(password);
    setCopied(true);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm">Temporaeres Passwort (einmalig anzeigen, sicher uebermitteln):</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-sm">{password}</code>
        <button onClick={copy} className="rounded-md border px-3 py-2 text-sm hover:bg-accent">
          {copied ? 'Kopiert' : 'Kopieren'}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">Der Benutzer muss das Passwort beim naechsten Login aendern.</p>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
      {initials}
    </div>
  );
}

function Badge({ tone, children }: { tone: 'success' | 'destructive' | 'muted'; children: React.ReactNode }) {
  const classes = {
    success: 'bg-success/10 text-success',
    destructive: 'bg-destructive/10 text-destructive',
    muted: 'bg-muted text-muted-foreground',
  };
  return <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', classes[tone])}>{children}</span>;
}

function ActionButton({
  children,
  onClick,
  tone = 'default',
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'default' | 'primary' | 'destructive';
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        tone === 'primary' && 'bg-primary text-primary-foreground hover:bg-primary/90',
        tone === 'destructive' && 'border border-destructive/40 text-destructive hover:bg-destructive/10',
        tone === 'default' && 'border hover:bg-accent'
      )}
    >
      {children}
    </button>
  );
}
