import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * CharacterInitiatedMessageButton
 *
 * Lets the user ask the character in THIS conversation to speak first.
 *
 * It reuses the existing character response path — sendProactiveMessageForCharacter
 * already builds the canonical character context (personality, emotional and physical
 * state, current location including rabbit holes, recent conversation, recent
 * narratives, schedule and time), generates the character's own words, and writes
 * them into the conversation as a normal character message.
 *
 * onDemand: true only skips the gates that exist to stop UNPROMPTED outreach
 * (pressure threshold, timing window, daily cap, once-per-hour). No new generation
 * system, no fabricated user message, no separate conversation pathway.
 *
 * The resulting message arrives through the page's normal message subscription.
 */
export default function CharacterInitiatedMessageButton({
  characterId,
  conversationId,
  characterName,
  isPhone = false,
  disabled = false,
}) {
  const [isStarting, setIsStarting] = useState(false);

  const handleClick = async () => {
    if (isStarting || disabled || !conversationId || !characterId) return;
    setIsStarting(true);
    try {
      const res = await base44.functions.invoke('sendProactiveMessageForCharacter', {
        characterId,
        conversationId,
        channel: isPhone ? 'phone' : 'direct',
        onDemand: true,
      });
      if (res?.data?.success === false) {
        console.warn('[CharacterInitiatedMessage] no message generated:', res.data.reason);
      }
    } catch (err) {
      console.error('[CharacterInitiatedMessage] failed:', err?.message);
    } finally {
      setIsStarting(false);
    }
  };

  const unavailable = disabled || !conversationId || !characterId;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleClick}
      disabled={unavailable || isStarting}
      title={characterName ? `Let ${characterName} speak first` : 'Let them speak first'}
      aria-label={characterName ? `Let ${characterName} speak first` : 'Let them speak first'}
      className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground flex-shrink-0"
    >
      {isStarting
        ? <Loader2 className="w-4 h-4 animate-spin" />
        : <Sparkles className="w-4 h-4" />}
    </Button>
  );
}