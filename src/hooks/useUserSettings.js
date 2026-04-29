import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

async function fetchAndConsolidate(userEmail) {
  if (!userEmail) return null;
  const list = await base44.entities.UserSettings.filter({ owner_email: userEmail });
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  // Silently consolidate duplicates
  await base44.functions.invoke("consolidateUserSettings", {});
  const consolidated = await base44.entities.UserSettings.filter({ owner_email: userEmail });
  return consolidated[0] || null;
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
    staleTime: 30_000,
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