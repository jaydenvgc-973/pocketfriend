import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import ChatActionsMenu from "@/components/chat/ChatActionsMenu";
import BackfillNarrativesWrapper from "@/components/chat/BackfillNarrativesWrapper";
import { base44 } from "@/api/base44Client";

export default function ChatHeader({
  character,
  characterId,
  isPhone,
  conversationId,
  setMessages,
  onMediaGalleryToggle,
  onGameLauncherToggle,
  onNarrativeActionToggle,
  onWorldContactsToggle,
  onNarrativeBuilderToggle,
  onSendMoneyToggle,
  onTroubleshootingToggle,
  onShoppingToggle,
}) {
  const [isGeneratingRightNow, setIsGeneratingRightNow] = useState(false);

  // Right Now — uses existing generateAutomaticNarrative with full state accuracy.
  // Immediate display via optimistic setMessages after narrative returns.
  const handleRightNow = async () => {
    console.log('[RightNow] Clicked | char:', character?.name, '| convoId:', conversationId);
    if (!character || !conversationId || isGeneratingRightNow) return;
    setIsGeneratingRightNow(true);
    try {
      const res = await base44.functions.invoke('generateAutomaticNarrative', {
        characterId,
        trigger: 'manual_right_now',
        forceGenerate: true,
      });
      const narrativeText = res?.data?.narrativeText;
      if (!narrativeText) {
        console.warn('[RightNow] No narrativeText in response');
        return;
      }

      const msg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'character',
        character_id: characterId,
        character_name: character.name,
        content: narrativeText,
        is_narrative: true,
        is_read: true,
        timestamp: new Date().toISOString(),
      });

      // Optimistic display: add to local state immediately after backend returns
      if (setMessages && msg?.id) {
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      }

      console.log('[RightNow] ✓ Message created:', msg.id);
    } catch (err) {
      console.error('[RightNow] ERROR:', err.message);
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
          media: !!character,
          game: !!character && !isPhone,
          narrative: !!character && !!conversationId,
          contacts: !!character && (character.fictional_relationships || []).length > 0,
          story: !!character,
          money: !!character,
          shopping: !!character,
          troubleshoot: !!character && !!conversationId,
          right_now: !!character && !!conversationId,
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
          if (id === "right_now") handleRightNow();
        }}
      />
      </div>
    </>
  );
}