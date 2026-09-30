'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchSession } from '@/lib/auth';

/**
 * Sitzung bei der API pruefen (httpOnly-Cookie, im Browser nicht lesbar).
 * Ohne Sitzung geht es zur Login-Seite.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'ok' | 'anonymous'>('checking');

  useEffect(() => {
    let cancelled = false;
    fetchSession().then((session) => {
      if (cancelled) return;
      if (session.authenticated) {
        setState('ok');
      } else {
        setState('anonymous');
        router.replace('/login');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (state === 'anonymous') {
    return null;
  }

  return <>{children}</>;
}
