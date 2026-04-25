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

  // Right Now — direct LLM call, no backend queue, no delay.
  // Pattern mirrors NarrativeActionButton which is proven to work.
  const handleRightNow = async () => {
    console.log('[RightNow] Clicked | char:', character?.name, '| convoId:', conversationId);
    if (!character || !conversationId || isGeneratingRightNow) return;
    setIsGeneratingRightNow(true);
    try {
      const now = new Date();
      const hour = now.getHours();
      const timeStr = `${String(hour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
      const isAsleep = hour >= 23 || hour < 7;

      const prompt = `Generate a vivid, present-moment narrative (2-4 sentences) describing exactly what ${character.name} is experiencing RIGHT NOW.

TIME: ${timeStr} on ${dayName}
CHARACTER: ${character.name}
Personality: ${character.personality_summary || 'not defined'}
Emotional state: ${character.emotional_state || 'calm'}
Location: ${character.resolved_current_location_name || character.city || 'home'}
Status: ${isAsleep ? 'asleep' : (character.resolved_presence_status || 'at home')}
Occupation: ${character.occupation || 'unknown'}

Write in present tense, third-person. Make it immersive and specific. No dialogue. 2-4 sentences only. No preamble.`;

      const narrativeText = await base44.integrations.Core.InvokeLLM({ prompt });

      if (!narrativeText?.trim()) {
        console.warn('[RightNow] LLM returned empty narrative');
        return;
      }

      // Create Message immediately — subscription in Chat.jsx delivers it to UI
      const msg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'character',
        character_id: characterId,
        character_name: character.name,
        content: narrativeText.trim(),
        is_narrative: true,
        is_read: true,
        timestamp: new Date().toISOString(),
      });

      // Optimistic update in case subscription is slow
      if (setMessages && msg?.id) {
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      }

      console.log('[RightNow] ✓ Message created:', msg?.id);

      // Fire-and-forget: save to memory/timeline (non-blocking)
      base44.entities.Memory.create({
        character_id: characterId,
        memory_type: 'event',
        title: `[Right Now] ${timeStr} ${dayName}`,
        description: narrativeText.trim(),
        importance_score: 3,
        confidence_score: 0.9,
        permanence: 'long_term',
        timestamp: new Date().toISOString(),
      }).catch(() => {});

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