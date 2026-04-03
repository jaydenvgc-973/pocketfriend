import { QueryClient } from '@tanstack/react-query';

export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: 30_000,          // 30s — avoid redundant refetches on mount
			gcTime: 5 * 60 * 1000,      // 5min — keep unused data in memory longer
			refetchOnMount: false,      // don't re-fetch if data is fresh
		},
		mutations: {
			retry: 0,
		},
	},
});