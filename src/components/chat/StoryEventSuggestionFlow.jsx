import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import StoryEventSuggestionPrompt from "@/components/moments/StoryEventSuggestionPrompt";
import StoryEventCreator from "@/components/moments/StoryEventCreator";

/**
 * StoryEventSuggestionFlow
 *
 * Self-contained flow that renders the optional Story Event suggestion prompt
 * and (if accepted) the StoryEventCreator modal. Fetches its own data
 * (currentUser, userSettings, characters, locations) only when a suggestion
 * is active — no polling, no global listener.
 *
 * Reused by LogHousingChangeModal (after a confirmed housing change) and
 * ChatApprovals (after an approved life event creates a LifeEvent).
 */
export default function StoryEventSuggestionFlow({ character, suggestion, onDone }) {
  const queryClient = useQueryClient();
  const [showCreator, setShowCreator] = useState(false);

  const needsData = !!suggestion || showCreator;
  const { data: currentUser } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
    enabled: needsData,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
  });
  const { data: userSettings } = useQuery({
    queryKey: ["userSettings", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.UserSettings.filter({ owner_email: currentUser.email }, null, 1).then(r => r[0] || null)
      : null,
    enabled: !!currentUser?.email && needsData,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
  });
  const { data: allCharacters = [] } = useQuery({
    queryKey: ["characters", currentUser?.email],
    queryFn: () => currentUser?.email
      ? base44.entities.Character.filter({ status: "active", owner_email: currentUser.email })
      : [],
    enabled: !!currentUser?.email && needsData,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });
  const { data: appLocations = [] } = useQuery({
    queryKey: ['appLocations', currentUser?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});
      return res?.data?.locations || [];
    },
    enabled: !!currentUser?.email && needsData,
    staleTime: 10 * 60 * 1000,
    refetchOnMount: false,
    placeholderData: (prev) => prev,
  });

  if (!suggestion && !showCreator) return null;

  return (
    <>
      {suggestion && !showCreator && (
        <StoryEventSuggestionPrompt
          suggestion={suggestion}
          onAccept={() => setShowCreator(true)}
          onDismiss={onDone}
        />
      )}
      {showCreator && (
        <div
          className="fixed inset-0 z-[65] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowCreator(false); onDone?.(); } }}
        >
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5">
            <StoryEventCreator
              date={new Date()}
              characters={allCharacters}
              currentUser={currentUser}
              userSettings={userSettings}
              appLocations={appLocations}
              initialTitle={suggestion?.prefill?.initialTitle}
              initialPlot={suggestion?.prefill?.initialPlot}
              initialVenueId={suggestion?.prefill?.initialVenueId}
              initialParticipantIds={suggestion?.prefill?.initialParticipantIds}
              initialFocusIds={suggestion?.prefill?.initialFocusIds}
              onCreated={() => {
                setShowCreator(false);
                queryClient.invalidateQueries({ queryKey: ['storyEvents'] });
                onDone?.();
              }}
              onCancel={() => { setShowCreator(false); onDone?.(); }}
            />
          </div>
        </div>
      )}
    </>
  );
}