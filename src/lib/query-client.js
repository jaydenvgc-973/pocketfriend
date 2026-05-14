import { QueryClient } from '@tanstack/react-query';

export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 2,
			retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 10000),
			staleTime: 5 * 60 * 1000,   // 5min — serve in-memory cache immediately; reduces cold fetches
			gcTime: 15 * 60 * 1000,     // 15min — keep unused query data in memory much longer
			refetchOnMount: false,       // don't re-fetch if data is fresh
			refetchOnReconnect: false,   // reconnect alone doesn't justify a full re-fetch
			// placeholderData: keep showing previous data while refetching (stale-while-refresh)
			// Each query can override with placeholderData: (prev) => prev
		},
		mutations: {
			retry: 0,
		},
	},
});