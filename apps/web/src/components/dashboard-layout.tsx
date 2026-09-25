'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { TenantSwitcher } from './tenant-switcher';
import { CommandPalette } from './command-palette';
import { logout } from '@/lib/auth';

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
                  pathname === item.href || (item.href !== '/' && pathname.startsWith(`${item.href}/`))
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
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  Cmd+K
                </kbd>
                <span className="ml-2">Schnellzugriff</span>
              </div>
              <button
                onClick={() => logout()}
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Abmelden"
              >
                <LogoutIcon className="h-4 w-4" />
              </button>
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
  { href: '/tenants', label: 'Tenants', icon: BuildingIcon },
  { href: '/avd', label: 'Virtual Desktop', icon: DesktopIcon },
  { href: '/users', label: 'Benutzer', icon: UsersIcon },
  { href: '/groups', label: 'Gruppen', icon: GroupsIcon },
  { href: '/mail', label: 'Exchange', icon: MailIcon },
  { href: '/sharepoint', label: 'SharePoint', icon: FolderIcon },
  { href: '/devices', label: 'Geraete', icon: DeviceIcon },
  { href: '/apps', label: 'Apps', icon: AppsIcon },
  { href: '/network', label: 'Netzwerk', icon: NetworkIcon },
  { href: '/security', label: 'Sicherheit', icon: ShieldIcon },
  { href: '/alerts', label: 'Alerts', icon: BellIcon },
  { href: '/jobs', label: 'Jobs', icon: JobsIcon },
  { href: '/audit', label: 'Audit-Log', icon: AuditIcon },
];

function BreadcrumbNav({ pathname }: { pathname: string }) {
  const currentItem = navItems.find(
    (item) => item.href === pathname || (item.href !== '/' && pathname.startsWith(`${item.href}/`))
  );

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

function BuildingIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16" />
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

function DeviceIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M7 20h10M12 16v4" />
    </svg>
  );
}

function GroupsIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 19a6 6 0 0 1 12 0M14.5 18a4.5 4.5 0 0 1 6.5 0" />
    </svg>
  );
}

function AppsIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M17.5 14v7M14 17.5h7" />
    </svg>
  );
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

function NetworkIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v4M6 16v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
      <path d="M9 12l2 2 4-4" />
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

function DesktopIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
    >
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
