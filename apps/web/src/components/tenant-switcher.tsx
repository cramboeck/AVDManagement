'use client';

import { useState, useRef, useEffect } from 'react';
import { useTenant } from '@/hooks/use-tenant';
import clsx from 'clsx';

export function TenantSwitcher() {
  const { tenants, activeTenant, setActiveTenantId, isLoading } = useTenant();
  const [isOpen, setIsOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setFocusIndex((i) => Math.min(i + 1, tenants.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (tenants[focusIndex]) {
            setActiveTenantId(tenants[focusIndex].id);
            setIsOpen(false);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          buttonRef.current?.focus();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, focusIndex, tenants, setActiveTenantId]);

  // Focus auf aktives Element setzen
  useEffect(() => {
    if (isOpen && listRef.current) {
      const item = listRef.current.children[focusIndex] as HTMLElement;
      item?.focus();
    }
  }, [isOpen, focusIndex]);

  if (isLoading) {
    return (
      <div className="h-10 w-48 animate-pulse rounded-md bg-muted" />
    );
  }

  if (tenants.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        Kein Tenant verbunden
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setIsOpen(true);
            setFocusIndex(0);
          }
        }}
        className={clsx(
          'flex items-center gap-2 rounded-md border px-3 py-2',
          'bg-background hover:bg-accent',
          'text-sm font-medium',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        )}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <TenantStatusDot status={activeTenant?.connectionStatus ?? 'error'} />
        <span className="max-w-[150px] truncate">
          {activeTenant?.displayName ?? 'Tenant wählen'}
        </span>
        <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <ul
            ref={listRef}
            role="listbox"
            className={clsx(
              'absolute left-0 top-full z-50 mt-1 w-64',
              'rounded-md border bg-background shadow-lg',
              'max-h-60 overflow-y-auto'
            )}
          >
            {tenants.map((tenant, index) => (
              <li
                key={tenant.id}
                role="option"
                aria-selected={tenant.id === activeTenant?.id}
                tabIndex={-1}
                onClick={() => {
                  setActiveTenantId(tenant.id);
                  setIsOpen(false);
                }}
                onMouseEnter={() => setFocusIndex(index)}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2',
                  'cursor-pointer text-sm',
                  index === focusIndex && 'bg-accent',
                  tenant.id === activeTenant?.id && 'font-medium'
                )}
              >
                <TenantStatusDot status={tenant.connectionStatus} />
                <div className="flex-1 overflow-hidden">
                  <div className="truncate">{tenant.displayName}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {tenant.primaryDomain}
                  </div>
                </div>
                {tenant.connectionStatus !== 'connected' && (
                  <span className="text-xs text-warning">
                    {tenant.connectionStatus === 'consent-required'
                      ? 'Consent'
                      : 'Fehlt'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TenantStatusDot({
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
      className={clsx('h-2 w-2 flex-shrink-0 rounded-full', colors[status])}
    />
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}
