import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Null-safe UserSettings loader for the Scene page.
 * React Query can return null before the query resolves even with = [] default.
 * This hook normalizes the result with Array.isArray before indexing.
 */
export function useSceneSettings(currentUser) {
  const { data: settingsList } = useQuery({
    queryKey: ["userSettings", currentUser?.email],
    queryFn: () => base44.entities.UserSettings.filter({ owner_email: currentUser.email }),
    enabled: !!currentUser?.email,
    placeholderData: [],
  });
  const settings = (Array.isArray(settingsList) ? settingsList : [])[0] || {};
  return settings;
}