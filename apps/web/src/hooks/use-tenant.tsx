'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ManagedTenant, TenantId } from '@zerostress/types';

interface TenantContextValue {
  tenants: ManagedTenant[];
  isLoading: boolean;
  error: Error | null;
  activeTenant: ManagedTenant | null;
  setActiveTenantId: (id: TenantId | null) => void;
  refetch: () => void;
}

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: ReactNode }) {
  const [activeTenantId, setActiveTenantId] = useState<TenantId | null>(null);

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['tenants'],
    queryFn: () => api.get<{ items: ManagedTenant[] }>('/tenants'),
    staleTime: 5 * 60 * 1000,
  });

  const tenants = data?.items ?? [];
  const activeTenant = activeTenantId
    ? tenants.find((t) => t.id === activeTenantId) ?? null
    : tenants[0] ?? null;

  const handleSetActiveTenantId = useCallback((id: TenantId | null) => {
    setActiveTenantId(id);
    if (id) {
      localStorage.setItem('active_tenant_id', id);
    } else {
      localStorage.removeItem('active_tenant_id');
    }
  }, []);

  return (
    <TenantContext.Provider
      value={{
        tenants,
        isLoading,
        error: error as Error | null,
        activeTenant,
        setActiveTenantId: handleSetActiveTenantId,
        refetch,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return context;
}
