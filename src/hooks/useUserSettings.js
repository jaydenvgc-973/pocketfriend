import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

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

export function useUserSettings() {
  const queryClient = useQueryClient();
  const { data: user = {} } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me(),
  });

  const queryKey = ["userSettings", user?.email];

  const { data: settings = null, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchAndConsolidate(user?.email),
    staleTime: 5 * 60 * 1000,    // 5 min — settings are stable; mutation invalidates on explicit save
    refetchOnWindowFocus: false,  // Prevents refetch storm on tab switch
    enabled: !!user?.email,
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
      const freshList = await base44.entities.UserSettings.filter({ owner_email: user?.email });
      if (freshList[0]?.id) {
        return base44.entities.UserSettings.update(freshList[0].id, data);
      }
      return base44.entities.UserSettings.create(data);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    settings: settings || {},
    isLoading,
    updateSettings: mutation.mutate,
    isSaving: mutation.isPending,
  };
}