'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Job, JobStatus } from '@zerostress/types';

export interface JobFilter {
  type?: string;
  typePrefix?: string;
  managedDeviceId?: string;
  userId?: string;
  appId?: string;
  scriptId?: string;
  groupId?: string;
  packageId?: string;
  limit?: number;
}

const ACTIVE: JobStatus[] = ['queued', 'running'];

/**
 * Jobs eines Tenants, serverseitig gefiltert. Eigener Cache-Schluessel je
 * Filter (Praefix ['jobs', tenantId] bleibt, damit invalidateQueries greift).
 * Nachgefragt wird nur, solange ein Job eingereiht ist oder laeuft.
 */
export function useJobs(tenantId: string | undefined, filter: JobFilter = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['jobs', tenantId, filter],
    queryFn: () => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filter)) {
        if (value !== undefined && value !== '') params.set(key, String(value));
      }
      const qs = params.toString();
      return api.get<{ items: Job[] }>(`/tenants/${tenantId}/jobs${qs ? `?${qs}` : ''}`);
    },
    enabled: !!tenantId && (options.enabled ?? true),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      if (items.some((j) => ACTIVE.includes(j.status))) return 3000;
      // Wartende Freigaben aendern sich selten; langsam nachsehen
      if (items.some((j) => j.status === 'pending_approval' || j.status === 'pending_second_approval')) return 30000;
      return false;
    },
    refetchIntervalInBackground: false,
  });
}
