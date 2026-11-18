import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Heart } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import ChatActionsMenu from "@/components/chat/ChatActionsMenu";
import BackfillNarrativesWrapper from "@/components/chat/BackfillNarrativesWrapper";
import { base44 } from "@/api/base44Client";
import { useActionNarrationMode } from "@/hooks/useActionNarrationMode";
import { useInstantImage } from "@/hooks/useInstantImage";
import AlarmTool from "@/components/chat/AlarmTool";
import LifeNeedsPopover from "@/components/chat/LifeNeedsPopover";
import { getCharacterSleepState } from "@/lib/characterSleepState";
import { buildCharacterInScene } from "@/lib/chatSceneCharacter";
import { getLocations } from "@/lib/locationSessionCache";

export default function ChatHeader({
  character,
  characterId,
  isPhone,
  conversationId,
  setMessages,
  messages,
  userSettings,
  onMediaGalleryToggle,
  onGameLauncherToggle,
  onNarrativeActionToggle,
  onWorldContactsToggle,
  onNarrativeBuilderToggle,
  onSendMoneyToggle,
  onTroubleshootingToggle,
  onShoppingToggle,
  onHousingChangeToggle,
  onLocationShareToggle,
  onInstantImage,
}) {
  const [isGeneratingRightNow, setIsGeneratingRightNow] = useState(false);
  const [showAlarm, setShowAlarm] = useState(false);
  const [showLifeNeeds, setShowLifeNeeds] = useState(false);

  const { triggerActionNarration, isGenerating: isGeneratingActionNarration } = useActionNarrationMode({
    character, characterId, conversationId, messages: messages || [], setMessages, userSettings,
  });

  // Instant Image — one-tap image of the current scene, no manual prompt.
  // Generates a visual scene description via InvokeLLM, then hands it to the
  // existing createImageMessage pipeline in Chat.jsx (onInstantImage callback).
  const { triggerInstantImage, isGenerating: isGeneratingInstantImage } = useInstantImage({
    character, characterId, conversationId, messages: messages || [], userSettings,
    onImagePromptReady: onInstantImage,
  });

  // Right Now — instant user-controlled narrative based on current state.
  // Creates placeholder immediately, then generates real narrative in background.
  //
  // LOCATION AUTHORITY: the stored resolved_* fields can lag the schedule. The
  // homepage card and the Incorrect location correction both read the shared resolver
  // with the location map (buildCharacterInScene → resolveCharacterLocation), so the
  // same call is used here and its answer travels with the request. Right Now then
  // describes the place the UI already shows.
  const buildAuthoritativeState = async () => {
    const locations = await getLocations(async () => {
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});
      return res?.data?.locations || [];
    }).catch(() => []);
    const locationMap = Object.fromEntries((locations || []).map(l => [l.id, l]));
    const live = buildCharacterInScene(character, locationMap) || {};
    return {
      location_id: live.resolved_current_location_id ?? null,
      location_name: live.resolved_current_location_name ?? null,
      location_type: live.resolved_location_type ?? null,
      presence_status: live.resolved_presence_status ?? null,
      current_activity: live.current_activity ?? null,
      source: 'buildCharacterInScene',
    };
  };

  // A Right Now selection always ends with a narrative in the conversation. If the
  // invocation fails, the same existing call is retried; if it still returns nothing,
  // the reader gets the character's verified present state — never a technical message.
  const buildStateFallback = (state) => {
    const name = character?.name || 'They';
    const place = state?.location_name;
    const activity = state?.current_activity;
    if (activity && place) return `${name} is at ${place}, ${activity}.`;
    if (activity) return `${name} is ${activity}.`;
    if (place) return `${name} is at ${place} right now, in the middle of their day.`;
    return `${name} is somewhere in the middle of their day right now.`;
  };

  const handleRightNow = async () => {
    if (!character || !conversationId || isGeneratingRightNow) return;
    setIsGeneratingRightNow(true);

    // 1. Placeholder for instant feedback — replaced as soon as the narrative exists.
    let placeholderMsg = null;
    try {
      placeholderMsg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'character',
        character_id: characterId,
        character_name: character.name,
        content: '...',
        is_narrative: true,
        is_read: true,
        timestamp: new Date().toISOString(),
      });
      if (setMessages && placeholderMsg?.id) setMessages(prev => [...prev, placeholderMsg]);
    } catch (placeholderErr) {
      console.error('[RightNow] Placeholder could not be created:', placeholderErr.message);
    }

    // 2. Generate the narrative. Two attempts, then the verified state line.
    let narrativeText = null;
    let authoritativeState = null;
    try {
      authoritativeState = await buildAuthoritativeState();
      for (let attempt = 1; attempt <= 2 && !narrativeText; attempt++) {
        try {
          const res = await base44.functions.invoke('generateAutomaticNarrative', {
            characterId,
            trigger: 'manual_right_now',
            forceGenerate: true,
            authoritativeState,
          });
          narrativeText = res?.data?.narrativeText?.trim() || null;
          if (!narrativeText) console.warn('[RightNow] Attempt', attempt, 'returned no narrative:', res?.data?.reason || res?.data?.error);
        } catch (attemptErr) {
          console.warn('[RightNow] Attempt', attempt, 'failed:', attemptErr.message);
        }
      }
      if (!narrativeText) narrativeText = buildStateFallback(authoritativeState);

      if (placeholderMsg?.id) {
        await base44.entities.Message.update(placeholderMsg.id, { content: narrativeText });
        setMessages(prev => prev.map(m => m.id === placeholderMsg.id ? { ...m, content: narrativeText } : m));
      } else {
        const saved = await base44.entities.Message.create({
          conversation_id: conversationId,
          sender_type: 'character',
          character_id: characterId,
          character_name: character.name,
          content: narrativeText,
          is_narrative: true,
          is_read: true,
          timestamp: new Date().toISOString(),
        });
        if (setMessages) setMessages(prev => prev.some(m => m.id === saved.id) ? prev : [...prev, saved]);
      }
    } catch (err) {
      console.error('[RightNow] Generation failed:', err.message);
      const fallback = buildStateFallback(authoritativeState);
      if (placeholderMsg?.id) {
        await base44.entities.Message.update(placeholderMsg.id, { content: fallback }).catch(() => {});
        setMessages(prev => prev.map(m => m.id === placeholderMsg.id ? { ...m, content: fallback } : m));
      }
    } finally {
      setIsGeneratingRightNow(false);
    }
  };
  return (
    <>
      <BackfillNarrativesWrapper conversationId={conversationId} characterId={characterId} character={character} />
      <div className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3 pointer-events-auto">
      <Link to="/home" className="text-muted-foreground hover:text-foreground transition-colors pointer-events-auto cursor-pointer">
        <ArrowLeft className="w-5 h-5" />
      </Link>
      <Link to={`/profile/${characterId}`}>
        {character && <CharacterAvatar character={character} size="sm" />}
      </Link>
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-semibold text-foreground truncate">{character?.name || "Loading..."}</h2>
        {character ? (() => {
          const ss = getCharacterSleepState(character);
          if (ss.isSleeping) {
            const label = ss.isNapping ? '💤 Napping' : '🌙 Sleeping';
            return (
              <p className="text-xs text-muted-foreground">{label}</p>
            );
          }
          if (ss.displayLabel === 'resting') {
            return (
              <p className="text-xs text-muted-foreground">Resting</p>
            );
          }
          return <p className="text-xs text-muted-foreground">{isPhone ? 'Texting' : 'Talking'}</p>;
        })() : <p className="text-xs text-muted-foreground">{isPhone ? 'Texting' : 'Talking'}</p>}
      </div>
      {character && (
        <button
          onClick={() => setShowLifeNeeds(true)}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg transition-colors"
          title="Life Needs"
          aria-label="Life Needs"
        >
          <Heart className="w-5 h-5" />
        </button>
      )}
      <ChatActionsMenu
        visible={{
          alarm: !!character,
          media: !!character,
          game: !!character && !isPhone,
          narrative: !!character && !!conversationId,
          action_narration: !!character && !!conversationId,
          contacts: !!character && (character.fictional_relationships || []).length > 0,
          story: !!character,
          money: !!character,
          shopping: !!character,
          troubleshoot: !!character && !!conversationId,
          right_now: !!character && !!conversationId,
          housing_change: !!character,
          location_share: !!character && !!conversationId,
          instant_image: !!character && !!conversationId,
        }}
        onSelect={(id) => {
          if (id === "media") onMediaGalleryToggle();
          if (id === "game") onGameLauncherToggle();
          if (id === "narrative") onNarrativeActionToggle();
          if (id === "contacts") onWorldContactsToggle();
          if (id === "story") onNarrativeBuilderToggle();
          if (id === "money") onSendMoneyToggle();
          if (id === "shopping") onShoppingToggle();
          if (id === "troubleshoot") onTroubleshootingToggle();
          if (id === "housing_change") onHousingChangeToggle?.();
          if (id === "location_share") onLocationShareToggle?.();
          if (id === "instant_image") triggerInstantImage();
          if (id === "alarm") setShowAlarm(true);
          if (id === "right_now") handleRightNow();
          if (id === "action_narration") triggerActionNarration();
        }}
      />
      <AlarmTool
        isOpen={showAlarm}
        onClose={() => setShowAlarm(false)}
        character={character}
        characterId={characterId}
        currentUser={userSettings}
      />
      </div>
      <LifeNeedsPopover
        isOpen={showLifeNeeds}
        onClose={() => setShowLifeNeeds(false)}
        character={character}
      />
    </>
  );
}