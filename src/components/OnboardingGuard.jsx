import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

export default function OnboardingGuard({ children }) {
  const navigate = useNavigate();

  const { data: settings, isLoading: isLoadingSettings } = useQuery({
    queryKey: ["userSettings"],
    queryFn: async () => {
      const list = await base44.entities.UserSettings.list();
      return list[0] || null;
    },
  });

  const { data: currentUser, isLoading: isLoadingUser } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters, isLoading: isLoadingChars } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => base44.entities.Character.filter({ created_by: currentUser.email }, "-created_date", 1),
    enabled: !!currentUser?.email,
  });

  const isLoading = isLoadingSettings || isLoadingUser || isLoadingChars;

  useEffect(() => {
    if (isLoading) return;
    const hasCompletedOnboarding = settings?.has_completed_onboarding;
    const hasCharacters = characters && characters.length > 0;
    if (hasCompletedOnboarding || hasCharacters) {
      navigate("/home", { replace: true });
    }
  }, [settings, characters, isLoading, navigate]);

  if (isLoading) return null;
  if (settings?.has_completed_onboarding || (characters && characters.length > 0)) return null;

  return children;
}