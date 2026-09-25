'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { handleCallback } from '@/lib/auth';

const DEV_AUTH_BYPASS = process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true';

function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (DEV_AUTH_BYPASS) {
      router.replace('/');
      return;
    }

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const errorParam = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    if (errorParam) {
      setError(errorDescription || errorParam);
      return;
    }

    if (!code || !state) {
      setError('Fehlende Authentifizierungsparameter');
      return;
    }

    handleCallback(code, state).then((success) => {
      if (success) {
        router.replace('/');
      } else {
        setError('Authentifizierung fehlgeschlagen');
      }
    });
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-destructive">Anmeldung fehlgeschlagen</h1>
          <p className="mt-2 text-muted-foreground">{error}</p>
          <a href="/" className="mt-4 inline-block text-primary hover:underline">
            Zurueck zur Startseite
          </a>
        </div>
      </div>
    );
  }

  return <Spinner />;
}

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="mt-4 text-muted-foreground">Anmeldung wird abgeschlossen...</p>
      </div>
    </div>
  );
}

// useSearchParams braucht eine Suspense-Grenze, sonst schlaegt next build fehl
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <AuthCallback />
    </Suspense>
  );
}
