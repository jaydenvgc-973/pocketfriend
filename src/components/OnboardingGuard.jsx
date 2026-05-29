import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { lfcRead } from "@/lib/localFirstCache.js";

export default function OnboardingGuard({ children }) {
  const navigate = useNavigate();

  const { data: currentUser, isLoading: isLoadingUser } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  // Settings query — shares queryKey with useUserSettings so warm cache is reused.
  // Seeded from localStorage so a rate-limited fetch never produces a false "no settings" state.
  const { data: settings, isLoading: isLoadingSettings } = useQuery({
    queryKey: ["userSettings", currentUser?.email],
    initialData: () => {
      if (!currentUser?.email) return undefined;
      const lfc = lfcRead(currentUser.email, 'settings');
      return lfc?.data ?? undefined;
    },
    initialDataUpdatedAt: () => {
      if (!currentUser?.email) return undefined;
      const lfc = lfcRead(currentUser.email, 'settings');
      return lfc?.loaded_at ?? undefined;
    },
    queryFn: async () => {
      if (!currentUser?.email) return null;
      const list = await base44.entities.UserSettings.filter({ owner_email: currentUser.email });
      return list[0] || null;
    },
    enabled: !!currentUser?.email,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 3000,
  });

  // Guard-only existence check.
  // KEY: ["onboardingGuardCharacterCheck", email] — intentionally separate from
  // ["characters", email] which belongs exclusively to useOwnedCharacters.
  // A limit-1 result here must NEVER write into the full character list cache.
  const { data: guardChars, isLoading: isLoadingChars, isError: isCharsError } = useQuery({
    queryKey: ["onboardingGuardCharacterCheck", currentUser?.email],
    queryFn: () => base44.entities.Character.filter(
      { owner_email: currentUser.email, status: "active" },
      "-created_date", 1
    ),
    enabled: !!currentUser?.email,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 3000,
  });

  const isLoading = isLoadingSettings || isLoadingUser || isLoadingChars;

  // Read localStorage evidence synchronously — counts as established-user proof.
  const lfcChars    = currentUser?.email ? lfcRead(currentUser.email, 'characters') : null;
  const lfcSettings = currentUser?.email ? lfcRead(currentUser.email, 'settings')   : null;
  const hasLfcCharacters  = lfcChars?.data?.length > 0;
  const hasLfcOnboarding  = !!lfcSettings?.data?.has_completed_onboarding;

  // Decision: only redirect to /onboarding for CONFIRMED new accounts.
  //   CONFIRMED NEW:         queries succeeded, 0 results, no onboarding flag → redirect
  //   CONFIRMED ESTABLISHED: ≥1 character, onboarding flag, OR localStorage evidence → pass through
  //   UNKNOWN:               loading, errored, or rate-limited → do NOT redirect
  const confirmedNew =
    !isLoading &&
    !isCharsError &&
    !hasLfcCharacters &&
    !hasLfcOnboarding &&
    !settings?.has_completed_onboarding &&
    !(Array.isArray(guardChars) && guardChars.length > 0);

  useEffect(() => {
    if (confirmedNew) {
      navigate("/onboarding", { replace: true });
    }
  }, [confirmedNew, navigate]);

  // Established via localStorage — render immediately, no server wait.
  if (hasLfcCharacters || hasLfcOnboarding) return children;

  // Still loading, no local evidence — wait silently.
  if (isLoading) return null;

  // Query errored/rate-limited — unknown state, treat as established to avoid false trap.
  if (isCharsError) return children;

  // Confirmed new — block children while useEffect fires the redirect.
  if (confirmedNew) return null;

  // Confirmed established — pass through.
  return children;
}