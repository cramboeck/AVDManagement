'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { TenantSwitcher } from './tenant-switcher';
import { CommandPalette } from './command-palette';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();

  return (
    <>
      <CommandPalette />
      <div className="flex min-h-screen">
        <aside className="fixed left-0 top-0 z-30 flex h-screen w-64 flex-col border-r bg-background">
          <div className="flex h-14 items-center border-b px-4">
            <Link href="/" className="text-lg font-semibold">
              ZeroStress
            </Link>
          </div>

          <div className="border-b p-4">
            <TenantSwitcher />
          </div>

          <nav className="flex-1 space-y-1 p-4">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                  'transition-colors',
                  pathname === item.href
                    ? 'bg-accent font-medium'
                    : 'hover:bg-accent/50'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="border-t p-4">
            <div className="text-xs text-muted-foreground">
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">
                Cmd+K
              </kbd>
              <span className="ml-2">Schnellzugriff</span>
            </div>
          </div>
        </aside>

        <main className="ml-64 flex-1">
          <header className="sticky top-0 z-20 flex h-14 items-center border-b bg-background/95 px-6 backdrop-blur">
            <BreadcrumbNav pathname={pathname} />
          </header>
          <div className="p-6">{children}</div>
        </main>
      </div>
    </>
  );
}

const navItems = [
  { href: '/', label: 'Dashboard', icon: HomeIcon },
  { href: '/users', label: 'Benutzer', icon: UsersIcon },
  { href: '/jobs', label: 'Jobs', icon: JobsIcon },
  { href: '/audit', label: 'Audit-Log', icon: AuditIcon },
];

function BreadcrumbNav({ pathname }: { pathname: string }) {
  const currentItem = navItems.find((item) => item.href === pathname);

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex items-center gap-2 text-sm">
        <li>
          <Link href="/" className="text-muted-foreground hover:text-foreground">
            ZeroStress
          </Link>
        </li>
        {currentItem && pathname !== '/' && (
          <>
            <li className="text-muted-foreground">/</li>
            <li className="font-medium">{currentItem.label}</li>
          </>
        )}
      </ol>
    </nav>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function JobsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function AuditIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}
