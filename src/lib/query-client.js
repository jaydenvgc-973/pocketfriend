import { QueryClient } from '@tanstack/react-query';

export const queryClientInstance = new QueryClient({
	defaultOptions: {
		queries: {
			// ANTI-STORM DEFAULTS:
			// These prevent refetch-on-focus/reconnect waterfalls that can cause 429 loops.
			// Individual queries can override with { refetchOnWindowFocus: true } if truly needed.
			refetchOnWindowFocus: false,   // never refetch just because window regained focus
			refetchOnReconnect: false,     // reconnect alone doesn't justify a full re-fetch
			refetchOnMount: false,         // don't re-fetch if data is still within staleTime
			retry: 2,
			retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 10000),
			staleTime: 5 * 60 * 1000,     // 5min — serve in-memory cache immediately
			gcTime: 20 * 60 * 1000,       // 20min — keep unused query data in memory longer (prev 15min)
			// placeholderData: keep showing previous data while refetching (stale-while-refresh)
			// Each query can override with placeholderData: (prev) => prev
			//
			// LAST-KNOWN-GOOD RULE: failed queries NEVER wipe good cached data.
			// React Query already enforces this by default — failed fetches leave `data` unchanged.
			// The UI must never treat `isFetching=true` as permission to show empty state.
		},
		mutations: {
			retry: 0,
		},
	},
});