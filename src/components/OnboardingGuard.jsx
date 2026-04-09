import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Wraps the Onboarding page and redirects to /home
 * if the user has already completed onboarding.
 * This prevents any accidental navigation back to the onboarding flow.
 */
export default function OnboardingGuard({ children }) {
  const navigate = useNavigate();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["userSettings"],
    queryFn: async () => {
      const list = await base44.entities.UserSettings.list();
      return list[0] || null;
    },
  });

  useEffect(() => {
    if (!isLoading && settings?.has_completed_onboarding) {
      navigate("/home", { replace: true });
    }
  }, [settings, isLoading, navigate]);

  // Don't flash the onboarding page while checking
  if (isLoading) return null;
  if (settings?.has_completed_onboarding) return null;

  return children;
}