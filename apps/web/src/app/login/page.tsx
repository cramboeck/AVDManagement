'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { startLogin, isAuthenticated } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated()) {
      router.replace('/');
    }
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-8 rounded-lg border bg-card p-8 shadow-lg">
        <div className="text-center">
          <h1 className="text-2xl font-bold">ZeroStress Cockpit</h1>
          <p className="mt-2 text-muted-foreground">
            Multi-Tenant Management fuer Microsoft Cloud
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={() => startLogin()}
            className="flex w-full items-center justify-center gap-3 rounded-md bg-[#0078d4] px-4 py-3 text-white transition-colors hover:bg-[#006cbe]"
          >
            <MicrosoftLogo className="h-5 w-5" />
            Mit Microsoft anmelden
          </button>

          <p className="text-center text-xs text-muted-foreground">
            Melde dich mit deinem Microsoft-Konto an, um fortzufahren.
          </p>
        </div>
      </div>
    </div>
  );
}

function MicrosoftLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}
