import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import ApprovalPopup from "@/components/approvals/ApprovalPopup";
import BirthApprovalPopup from "@/components/approvals/BirthApprovalPopup";
import HouseholdChangeApprovalPopup from "@/components/approvals/HouseholdChangeApprovalPopup";
import StoryEventSuggestionPrompt from "@/components/moments/StoryEventSuggestionPrompt";
import StoryEventCreator from "@/components/moments/StoryEventCreator";

/**
 * ChatApprovals
 *
 * Renders all approval popup modals for life events detected in chat.
 * After an approved life event (marriage, birth, housing change)
 * creates a LifeEvent record, offers an optional Story Event suggestion
 * via the existing StoryEventCreator — no new backend, classifier, or listener.
 */
const LIFE_EVENT_TYPES = new Set(['move_in', 'move_out', 'marriage', 'birth']);

const TYPE_INFO = {
  marriage: { title: 'Got married', plot: (n, o) => `${n} got married${o ? ` to ${o}` : ''}.` },
  birth: { title: 'Baby born', plot: (n, o) => `${n} had a baby${o ? ` with ${o}` : ''}.` },
  move_in: { title: 'Moved in', plot: (n) => `${n} moved in.` },
  move_out: { title: 'Moved out', plot: (n) => `${n} moved out.` },
};

export default function ChatApprovals({ pendingApproval, approveEvent, dismissApproval, character }) {
  const queryClient = useQueryClient();
  const [storySuggestion, setStorySuggestion] = useState(null);
  const [showCreator, setShowCreator] = useState(false);

  const needsData = !!storySuggestion || showCreator;
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

  const handleApprove = async (approvalData) => {
    const approvalCtx = pendingApproval;
    const isLifeEvent = approvalCtx && LIFE_EVENT_TYPES.has(approvalCtx.type);
    const result = await approveEvent(approvalData);
    if (isLifeEvent && result?.success !== false && approvalCtx?.data?.character) {
      const char = approvalCtx.data.character;
      const otherName = approvalCtx.data.otherCharName || approvalCtx.data.otherParentName || null;
      const info = TYPE_INFO[approvalCtx.type] || { title: 'Life event', plot: (n) => `${n} had a life event.` };
      const plot = info.plot(char.name, otherName);
      setStorySuggestion({
        title: info.title,
        description: plot,
        characterName: char.name,
        prefill: {
          initialTitle: info.title,
          initialPlot: plot,
          initialParticipantIds: [char.id],
          initialFocusIds: [char.id],
        },
      });
    }
  };

  if (!pendingApproval && !storySuggestion) return null;

  return (
    <>
      {pendingApproval && (pendingApproval.type === 'move_in' || pendingApproval.type === 'move_out') && pendingApproval.data.householdAnalysis && (
        <HouseholdChangeApprovalPopup
          analysis={pendingApproval.data.householdAnalysis}
          character={pendingApproval.data.character}
          onApprove={handleApprove}
          onDeny={dismissApproval}
        />
      )}

      {pendingApproval && pendingApproval.type === 'engagement' && (
        <ApprovalPopup
          type="engagement"
          title="Engagement Detected"
          description={`It looks like ${pendingApproval.data.character?.name} may be getting engaged${pendingApproval.data.otherCharName ? ` to ${pendingApproval.data.otherCharName}` : ''}. Approve this?`}
          details={pendingApproval.data}
          onApprove={handleApprove}
          onDeny={dismissApproval}
        >
          <p><span className="text-muted-foreground">Character:</span> {pendingApproval.data.character?.name}</p>
          {pendingApproval.data.otherCharName && <p><span className="text-muted-foreground">Fiancé(e):</span> {pendingApproval.data.otherCharName}</p>}
        </ApprovalPopup>
      )}

      {pendingApproval && pendingApproval.type === 'marriage' && (
        <ApprovalPopup
          type="marriage"
          title="Marriage Event Detected"
          description={`It looks like ${pendingApproval.data.character?.name} may be getting married${pendingApproval.data.otherCharName ? ` to ${pendingApproval.data.otherCharName}` : ''}. Approve this?`}
          details={pendingApproval.data}
          onApprove={handleApprove}
          onDeny={dismissApproval}
        >
          <p><span className="text-muted-foreground">Character:</span> {pendingApproval.data.character?.name}</p>
          {pendingApproval.data.otherCharName && <p><span className="text-muted-foreground">Partner:</span> {pendingApproval.data.otherCharName}</p>}
        </ApprovalPopup>
      )}

      {pendingApproval && pendingApproval.type === 'birth' && (
        <BirthApprovalPopup
          parentCharacter={pendingApproval.data.character}
          otherParentName={pendingApproval.data.otherParentName}
          onApprove={handleApprove}
          onDeny={dismissApproval}
        />
      )}

      {pendingApproval && pendingApproval.type === 'education' && (
        <ApprovalPopup
          type="education"
          title="Education Detail Detected"
          description={`${pendingApproval.data.character?.name} mentioned an education detail. Add this to their profile?`}
          details={pendingApproval.data}
          detectedItem={pendingApproval.data.detail}
          sourceSentence={pendingApproval.data.sentence}
          onApprove={handleApprove}
          onDeny={dismissApproval}
          onIgnoreType={() => dismissApproval()}
        >
          <p><span className="text-muted-foreground">Status:</span> {pendingApproval.data.status === 'completed' ? 'Past / Completed' : pendingApproval.data.status === 'ongoing' ? 'Current / Ongoing' : 'Future / Planned'}</p>
        </ApprovalPopup>
      )}

      {pendingApproval && pendingApproval.type === 'background_detail' && (
        <ApprovalPopup
          type="background_detail"
          title="Background Detail Detected"
          description={`${pendingApproval.data.character?.name} revealed a background detail. Add this to their profile?`}
          details={pendingApproval.data}
          detectedItem={pendingApproval.data.detail}
          sourceSentence={pendingApproval.data.sentence}
          onApprove={handleApprove}
          onDeny={dismissApproval}
          onIgnoreType={() => dismissApproval()}
        >
          <p><span className="text-muted-foreground">Category:</span> {pendingApproval.data.label}</p>
        </ApprovalPopup>
      )}

      {storySuggestion && !showCreator && (
        <StoryEventSuggestionPrompt
          suggestion={storySuggestion}
          onAccept={() => setShowCreator(true)}
          onDismiss={() => setStorySuggestion(null)}
        />
      )}
      {showCreator && storySuggestion && (
        <div
          className="fixed inset-0 z-[65] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setShowCreator(false); setStorySuggestion(null); } }}
        >
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5">
            <StoryEventCreator
              date={new Date()}
              characters={allCharacters}
              currentUser={currentUser}
              userSettings={userSettings}
              appLocations={appLocations}
              initialTitle={storySuggestion.prefill?.initialTitle}
              initialPlot={storySuggestion.prefill?.initialPlot}
              initialParticipantIds={storySuggestion.prefill?.initialParticipantIds}
              initialFocusIds={storySuggestion.prefill?.initialFocusIds}
              onCreated={() => {
                setShowCreator(false);
                setStorySuggestion(null);
                queryClient.invalidateQueries({ queryKey: ['storyEvents'] });
              }}
              onCancel={() => { setShowCreator(false); setStorySuggestion(null); }}
            />
          </div>
        </div>
      )}
    </>
  );
}