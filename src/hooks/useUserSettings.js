import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

const QUERY_KEY = ["userSettings"];

async function fetchAndConsolidate() {
  const list = await base44.entities.UserSettings.list();
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  // Silently consolidate duplicates
  await base44.functions.invoke("consolidateUserSettings", {});
  const consolidated = await base44.entities.UserSettings.list();
  return consolidated[0] || null;
}

export function useUserSettings() {
  const queryClient = useQueryClient();

  const { data: settings = null, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchAndConsolidate,
    staleTime: 30_000, // 30s — avoids hammering the API on every render
  });

  const mutation = useMutation({
    mutationFn: async (data) => {
      if (!data) return;
      // Optimistically update cache
      queryClient.setQueryData(QUERY_KEY, (old) => old ? { ...old, ...data } : data);

      if (settings?.id) {
        return base44.entities.UserSettings.update(settings.id, data);
      }
      // Re-fetch before creating to prevent race-condition duplicates
      const freshList = await base44.entities.UserSettings.list();
      if (freshList[0]?.id) {
        return base44.entities.UserSettings.update(freshList[0].id, data);
      }
      return base44.entities.UserSettings.create(data);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return {
    settings: settings || {},
    isLoading,
    updateSettings: mutation.mutate,
    isSaving: mutation.isPending,
  };
}