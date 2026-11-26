'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ConsoleMode } from '@zerostress/types';

/** Betriebsart der Konsole (Nur-Lese-Betrieb ueber CONSOLE_READ_ONLY). */
export function useConsoleMode() {
  return useQuery({
    queryKey: ['console-mode'],
    queryFn: () => api.get<ConsoleMode>('/settings/console-mode'),
    staleTime: 10 * 60 * 1000,
  });
}
