import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import ChatActionsMenu from "@/components/chat/ChatActionsMenu";
import BackfillNarrativesWrapper from "@/components/chat/BackfillNarrativesWrapper";
import { base44 } from "@/api/base44Client";
import { useActionNarrationMode } from "@/hooks/useActionNarrationMode";
import AlarmTool from "@/components/chat/AlarmTool";

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
}) {
  const [isGeneratingRightNow, setIsGeneratingRightNow] = useState(false);
  const [showAlarm, setShowAlarm] = useState(false);

  const { triggerActionNarration, isGenerating: isGeneratingActionNarration } = useActionNarrationMode({
    character, characterId, conversationId, messages: messages || [], setMessages, userSettings,
  });

  // Right Now — instant user-controlled narrative based on current state.
  // Creates placeholder immediately, then generates real narrative in background.
  const handleRightNow = async () => {
    console.log('[RightNow] Clicked | char:', character?.name, '| convoId:', conversationId);
    if (!character || !conversationId || isGeneratingRightNow) return;
    setIsGeneratingRightNow(true);
    
    // 1. Create placeholder message immediately for instant feedback
    const placeholderMsg = await base44.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: characterId,
      character_name: character.name,
      content: '...',
      is_narrative: true,
      is_read: true,
      timestamp: new Date().toISOString(),
    });

    if (setMessages && placeholderMsg?.id) {
      setMessages(prev => [...prev, placeholderMsg]);
    }

    // 2. Generate real narrative in background
    try {
      const res = await base44.functions.invoke('generateAutomaticNarrative', {
        characterId,
        trigger: 'manual_right_now',
        forceGenerate: true,
      });
      const narrativeText = res?.data?.narrativeText;
      
      if (narrativeText && placeholderMsg?.id) {
        // Update placeholder with real narrative
        await base44.entities.Message.update(placeholderMsg.id, { content: narrativeText });
        setMessages(prev => prev.map(m => m.id === placeholderMsg.id ? { ...m, content: narrativeText } : m));
      }
    } catch (err) {
      console.error('[RightNow] Background generation failed:', err.message);
      // Placeholder stays visible even if generation fails
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
        <p className="text-xs text-muted-foreground">{isPhone ? "Texting" : "Talking"}</p>
      </div>
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
    </>
  );
}