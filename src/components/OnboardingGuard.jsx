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

  // Settings: seed from localStorage immediately so rate-limited fetches never cause
  // a false "no settings" state. Shares the same queryKey as useUserSettings.
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
    // On rate limit: keep prior cached value, never treat error as empty
    retry: 1,
    retryDelay: 3000,
  });

  // Characters: seed from localStorage immediately. Shares the same queryKey as
  // useOwnedCharacters so warm cache is reused — no duplicate fetch.
  const { data: characters, isLoading: isLoadingChars, isError: isCharsError } = useQuery({
    queryKey: ["characters", currentUser?.email],
    initialData: () => {
      if (!currentUser?.email) return undefined;
      const lfc = lfcRead(currentUser.email, 'characters');
      return lfc?.data?.length > 0 ? lfc.data : undefined;
    },
    initialDataUpdatedAt: () => {
      if (!currentUser?.email) return undefined;
      const lfc = lfcRead(currentUser.email, 'characters');
      return lfc?.loaded_at ?? undefined;
    },
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

  // RATE-LIMIT SAFE ONBOARDING DECISION:
  // Only redirect to /onboarding when we can POSITIVELY prove the account is new.
  // A failed query, rate-limited response, or undefined result is NOT proof of empty account.
  // Rules:
  //   1. If still loading — wait, do not decide yet.
  //   2. If characters query errored — do not redirect, cannot prove empty.
  //   3. If characters exist (any length > 0) — user has an account, pass through.
  //   4. If settings confirm onboarding complete — pass through.
  //   5. Only redirect if settings.has_completed_onboarding is explicitly false/missing
  //      AND characters returned successfully with 0 results (no error).
  useEffect(() => {
    if (isLoading) return;
    if (isCharsError) return; // rate limit or network — cannot prove empty, do not redirect
    const hasCompletedOnboarding = settings?.has_completed_onboarding;
    const hasCharacters = Array.isArray(characters) && characters.length > 0;
    // Only redirect when we have a confirmed empty account (successful fetch, 0 results, no onboarding flag)
    if (!hasCompletedOnboarding && !hasCharacters && !isCharsError) {
      navigate("/onboarding", { replace: true });
    }
  }, [settings, characters, isLoading, isCharsError, navigate]);

  // While loading: render children immediately if localStorage has characters.
  // This avoids a blank screen during the auth/settings loading window.
  const hasLfcCharacters = !!currentUser?.email &&
    (lfcRead(currentUser.email, 'characters')?.data?.length > 0);
  const hasLfcSettings = !!currentUser?.email &&
    !!lfcRead(currentUser.email, 'settings')?.data?.has_completed_onboarding;

  // Render null (blank) only during the initial loading window AND no local data available.
  if (isLoading && !hasLfcCharacters && !hasLfcSettings) return null;

  // After load: only block if we've confirmed truly empty account (no error, no chars, no onboarding flag)
  if (!isLoading && !isCharsError) {
    const hasCompletedOnboarding = settings?.has_completed_onboarding;
    const hasCharacters = Array.isArray(characters) && characters.length > 0;
    if (!hasCompletedOnboarding && !hasCharacters) return null;
  }

  return children;
}