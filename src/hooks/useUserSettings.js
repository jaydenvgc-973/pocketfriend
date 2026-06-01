import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { lfcRead, lfcWrite } from "@/lib/localFirstCache.js";

async function fetchAndConsolidate(userEmail) {
  if (!userEmail) return null;
  const list = await base44.entities.UserSettings.filter({ owner_email: userEmail });

  // If nothing found: existing records may be missing owner_email (pre-migration state).
  // Trigger a one-time safe migration scoped to the current user, then re-fetch.
  if (list.length === 0) {
    const migrationKey = `user_settings_migrated_${userEmail}`;
    if (!sessionStorage.getItem(migrationKey)) {
      sessionStorage.setItem(migrationKey, '1');
      await base44.functions.invoke("backfillUserSettingsOwnerEmail", {}).catch(() => {});
      const afterMigration = await base44.entities.UserSettings.filter({ owner_email: userEmail });
      return afterMigration[0] || null;
    }
    return null;
  }

  if (list.length === 1) return list[0];
  // Consolidate duplicates — but only once per session to avoid 429 storms
  const consolidateKey = `settings_consolidated_${userEmail}`;
  if (!sessionStorage.getItem(consolidateKey)) {
    sessionStorage.setItem(consolidateKey, '1');
    await base44.functions.invoke("consolidateUserSettings", {}).catch(() => {});
    const consolidated = await base44.entities.UserSettings.filter({ owner_email: userEmail });
    return consolidated[0] || list[0];
  }
  return list[0];
}

export function useUserSettings(ownerEmailOverride = null) {
  const queryClient = useQueryClient();
  // Use staleTime: Infinity so this reads from the shared ['user'] cache populated by Home.
  // This eliminates the double-waterfall: without this, useUserSettings fires its own
  // base44.auth.me() call that races with Home's user fetch, delaying settings resolution.
  const { data: user = {} } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
    staleTime: Infinity, // always read from shared cache — Home's query populates it
    // COLD CACHE FIX: if ownerEmailOverride is provided (e.g. from Home which resolves user first),
    // skip this query entirely — we already have the email we need.
    enabled: !ownerEmailOverride,
  });
  // ownerEmailOverride wins over the internal user query result.
  // This eliminates the waterfall: Home passes currentUser?.email directly so settings
  // can load in parallel with (not after) the Home user query resolution.
  const resolvedEmail = ownerEmailOverride || user?.email;

  const queryKey = ["userSettings", resolvedEmail];

  const { data: settings = null, isLoading, isError } = useQuery({
    queryKey,
    // Serve from localStorage immediately — zero wait on mount
    initialData: () => {
      if (!resolvedEmail) return undefined;
      const lfc = lfcRead(resolvedEmail, 'settings');
      return lfc?.data ?? undefined;
    },
    initialDataUpdatedAt: () => {
      if (!resolvedEmail) return undefined;
      const lfc = lfcRead(resolvedEmail, 'settings');
      return lfc?.loaded_at ?? undefined;
    },
    queryFn: async () => {
      const result = await fetchAndConsolidate(resolvedEmail);
      // Persist to localStorage on every successful fetch
      if (result && resolvedEmail) lfcWrite(resolvedEmail, 'settings', result);
      return result;
    },
    staleTime: 5 * 60 * 1000,   // 5 min — settings including user_balance
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: !!resolvedEmail,
    retry: 2,
    retryDelay: (attempt) => attempt * 1500,
    placeholderData: (prev) => prev,
  });

  const mutation = useMutation({
    mutationFn: async (data) => {
      if (!data) return;
      // Optimistically update cache
      queryClient.setQueryData(queryKey, (old) => old ? { ...old, ...data } : data);

      if (settings?.id) {
        return base44.entities.UserSettings.update(settings.id, data);
      }
      // Re-fetch before creating to prevent race-condition duplicates
      const freshList = await base44.entities.UserSettings.filter({ owner_email: resolvedEmail });
      if (freshList[0]?.id) {
        return base44.entities.UserSettings.update(freshList[0].id, data);
      }
      return base44.entities.UserSettings.create(data);
    },
    onSuccess: (saved) => {
      // Persist the updated settings to localStorage immediately
      if (saved && resolvedEmail) lfcWrite(resolvedEmail, 'settings', saved);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    settings: settings || {},
    isLoading,
    isError,
    settingsLoaded: !isLoading && !isError && settings !== null,
    updateSettings: mutation.mutate,
    isSaving: mutation.isPending,
  };
}