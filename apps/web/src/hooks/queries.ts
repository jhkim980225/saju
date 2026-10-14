import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export const qk = {
  config: ['config'] as const,
  products: (uid?: string | null) => ['products', uid ?? 'anon'] as const,
  profiles: ['profiles'] as const,
  me: ['me'] as const,
  wallet: ['wallet'] as const,
  orders: ['orders'] as const,
  reports: ['reports'] as const,
  reading: (key: string) => ['reading', key] as const,
  daily: (profileId: string | undefined, date: string) => ['daily', profileId ?? 'primary', date] as const,
};

export function useConfig() {
  return useQuery({ queryKey: qk.config, queryFn: api.config, staleTime: 5 * 60_000 });
}

export function useProducts() {
  const uid = useSession((s) => s.user?.id);
  return useQuery({ queryKey: qk.products(uid), queryFn: api.products, staleTime: 60_000 });
}

export function useProfiles(enabled = true) {
  const token = useSession((s) => s.accessToken);
  return useQuery({ queryKey: qk.profiles, queryFn: api.profiles, enabled: enabled && Boolean(token) });
}

export function useWallet() {
  const token = useSession((s) => s.accessToken);
  return useQuery({ queryKey: qk.wallet, queryFn: api.wallet, enabled: Boolean(token) });
}
