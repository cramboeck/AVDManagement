'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { TenantProvider } from '@/hooks/use-tenant';
import { JobTrackerProvider } from '@/hooks/use-job-tracker';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
          },
        },
      })
  );

  // Keyboard navigation detection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        document.body.setAttribute('data-keyboard-user', 'true');
      }
    };

    const handleMouseDown = () => {
      document.body.removeAttribute('data-keyboard-user');
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TenantProvider>
        <JobTrackerProvider>{children}</JobTrackerProvider>
      </TenantProvider>
    </QueryClientProvider>
  );
}
