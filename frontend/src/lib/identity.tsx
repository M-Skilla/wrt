import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, setApiIdentity, storeIdentity, storedIdentity } from './api';
import type { Me } from './types';

interface IdentityState {
  label: string | null;
  me: Me | undefined;
  loading: boolean;
  signIn: (label: string) => void;
  signOut: () => void;
}

const Ctx = createContext<IdentityState | null>(null);

/** The demo identity in use. Switching clears all cached data, since every read is evaluated as that identity. */
export function IdentityProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [label, setLabel] = useState<string | null>(() => storedIdentity());
  const me = useQuery({ queryKey: ['me', label], queryFn: () => api.get<Me>('/me'), enabled: !!label, staleTime: 30_000 });

  const signIn = useCallback(
    (next: string) => {
      setApiIdentity(next);
      storeIdentity(next);
      qc.clear();
      setLabel(next);
    },
    [qc],
  );
  const signOut = useCallback(() => {
    setApiIdentity(null);
    storeIdentity(null);
    qc.clear();
    setLabel(null);
  }, [qc]);

  const value = useMemo(() => ({ label, me: me.data, loading: me.isLoading, signIn, signOut }), [label, me.data, me.isLoading, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIdentity(): IdentityState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useIdentity outside IdentityProvider');
  return v;
}

/** Home route for a role. */
export function homeFor(role: string | null | undefined): string {
  switch (role) {
    case 'warehouse_operator':
      return '/warehouse';
    case 'farmer':
      return '/farmer';
    case 'lender_officer':
      return '/lender';
    case 'inspector':
      return '/inspector';
    case 'regulator_officer':
      return '/regulator';
    default:
      return '/';
  }
}
