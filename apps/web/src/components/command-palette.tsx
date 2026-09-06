'use client';

import { useEffect, useState, useCallback } from 'react';
import { Command } from 'cmdk';
import { useRouter } from 'next/navigation';
import { useTenant } from '@/hooks/use-tenant';
import clsx from 'clsx';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { tenants, activeTenant, setActiveTenantId } = useTenant();

  // Cmd/Ctrl+K Handler
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const handleSelect = useCallback(
    (value: string) => {
      const [type, id] = value.split(':');

      if (type === 'tenant') {
        setActiveTenantId(id as Parameters<typeof setActiveTenantId>[0]);
        setOpen(false);
      } else if (type === 'nav') {
        router.push(id);
        setOpen(false);
      }
    },
    [router, setActiveTenantId]
  );

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Palette"
      className={clsx(
        'fixed inset-0 z-50 flex items-start justify-center pt-[20vh]',
        'bg-black/50'
      )}
    >
      <div
        className={clsx(
          'w-full max-w-lg rounded-lg border bg-background shadow-2xl',
          'overflow-hidden'
        )}
      >
        <Command.Input
          placeholder="Suchen oder Befehl eingeben..."
          className={clsx(
            'w-full border-b bg-transparent px-4 py-3',
            'text-sm placeholder:text-muted-foreground',
            'focus:outline-none'
          )}
          autoFocus
        />

        <Command.List className="max-h-[300px] overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
            Keine Ergebnisse gefunden.
          </Command.Empty>

          <Command.Group heading="Tenants wechseln" className="mb-2">
            {tenants.map((tenant) => (
              <Command.Item
                key={tenant.id}
                value={`tenant:${tenant.id}`}
                onSelect={handleSelect}
                className={clsx(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                  'cursor-pointer',
                  'aria-selected:bg-accent aria-selected:text-accent-foreground',
                  tenant.id === activeTenant?.id && 'bg-accent/50'
                )}
              >
                <TenantStatusIndicator status={tenant.connectionStatus} />
                <div className="flex-1">
                  <div className="font-medium">{tenant.displayName}</div>
                  <div className="text-xs text-muted-foreground">
                    {tenant.primaryDomain}
                  </div>
                </div>
                {tenant.id === activeTenant?.id && (
                  <span className="text-xs text-muted-foreground">Aktiv</span>
                )}
              </Command.Item>
            ))}
          </Command.Group>

          <Command.Group heading="Navigation" className="mb-2">
            <Command.Item
              value="nav:/users"
              onSelect={handleSelect}
              className={clsx(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                'cursor-pointer',
                'aria-selected:bg-accent aria-selected:text-accent-foreground'
              )}
            >
              <span>Benutzer</span>
            </Command.Item>
            <Command.Item
              value="nav:/jobs"
              onSelect={handleSelect}
              className={clsx(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                'cursor-pointer',
                'aria-selected:bg-accent aria-selected:text-accent-foreground'
              )}
            >
              <span>Jobs</span>
            </Command.Item>
            <Command.Item
              value="nav:/audit"
              onSelect={handleSelect}
              className={clsx(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                'cursor-pointer',
                'aria-selected:bg-accent aria-selected:text-accent-foreground'
              )}
            >
              <span>Audit-Log</span>
            </Command.Item>
          </Command.Group>
        </Command.List>

        <div className="border-t px-3 py-2 text-xs text-muted-foreground">
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">Esc</kbd>
          <span className="ml-2">Schliessen</span>
          <span className="mx-2">|</span>
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">
            Pfeil-Tasten
          </kbd>
          <span className="ml-2">Navigieren</span>
          <span className="mx-2">|</span>
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">Enter</kbd>
          <span className="ml-2">Auswaehlen</span>
        </div>
      </div>
    </Command.Dialog>
  );
}

function TenantStatusIndicator({
  status,
}: {
  status: 'connected' | 'consent-required' | 'permissions-insufficient' | 'error';
}) {
  const colors = {
    connected: 'bg-success',
    'consent-required': 'bg-warning',
    'permissions-insufficient': 'bg-warning',
    error: 'bg-destructive',
  };

  return (
    <span
      className={clsx('h-2 w-2 rounded-full', colors[status])}
      aria-label={status}
    />
  );
}
