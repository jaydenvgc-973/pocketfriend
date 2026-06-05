import React, { useState, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import MessageBubble from "@/components/chat/MessageBubble";
import TypingIndicator from "@/components/chat/TypingIndicator";
import ArchiveNotice from "@/components/chat/ArchiveNotice";
import MessageCountDisplay from "@/components/chat/MessageCountDisplay";
import DateSeparator from "@/components/chat/DateSeparator";
import { injectDateSeparators } from "@/lib/messageDateGrouping";
import { ChevronUp, Loader2 } from "lucide-react";
import MovementCommitmentPromptWithResolver from "@/components/chat/MovementCommitmentPromptWithResolver";

/**
 * ChatMessageList
 *
 * Renders the scrollable message thread with daily date separators.
 * Day boundary: 12:00 AM local time (America/New_York).
 * Date format: "Monday, April 21, 2026"
 */
export default function ChatMessageList({
  messages,
  conversationId,
  characterId,
  character,
  userSettings,
  isTyping,
  sendError,
  playingAudioId,
  voiceErrors,
  bottomRef,
  onReact,
  onDelete,
  onDeleteImage,
  onPlayVoice,
  onForward,
  onImageLoaded,
  onDismissError,
  setSendError,
  onLocationSignal,
  onShareNarrative,
  hasOlderMessages,
  onLoadOlderMessages,
}) {
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  // Persist dismissed commitment IDs in sessionStorage so they survive re-mounts
  const [dismissedCommitmentIds, setDismissedCommitmentIds] = useState(() => {
    try {
      const stored = sessionStorage.getItem('dismissed_commitment_ids');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  // Override commitment: set when the user taps the pin on a specific older message
  // that contains movement intent (bypasses the auto-detected latestCharMsg restriction).
  const [pinTriggeredCommitment, setPinTriggeredCommitment] = useState(null);

  const dismissCommitment = (id) => {
    setDismissedCommitmentIds(prev => {
      const next = new Set([...prev, id]);
      try { sessionStorage.setItem('dismissed_commitment_ids', JSON.stringify([...next])); } catch {}
      return next;
    });
    setPinTriggeredCommitment(null);
  };

  const handleMovementCommitmentFromPin = (commitmentData) => {
    // User clicked pin on a movement-intent message — show card for that specific message
    setPinTriggeredCommitment(commitmentData);
  };

  // Detect movement commitment in latest character message
  // Only shows for messages sent within the last 30 minutes — prevents stale re-trigger on re-mount
  const detectedCommitment = useMemo(() => {
    const COMMITMENT_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();

    const latestCharMsg = [...messages]
      .reverse()
      .find(m => {
        if (m.sender_type !== 'character' || m.is_narrative) return false;
        if (dismissedCommitmentIds.has(m.id)) return false;
        // Reject messages older than 30 minutes — prevents stale cards on re-mount
        const msgTime = m.timestamp ? new Date(m.timestamp).getTime() : 0;
        if (msgTime && (now - msgTime) > COMMITMENT_MAX_AGE_MS) return false;
        return true;
      });
    
    if (!latestCharMsg?.content) return null;

    const content = latestCharMsg.content.toLowerCase();

    // Exact phrase list per system spec
    const commitmentPhrases = [
      /\bi'?m\s+on\s+my\s+way\b/i,
      /\bi'?m\s+leaving\s+(now|right\s+now)?\b/i,
      /\bi'?m\s+(heading|coming|going)\s+(there|over|out|to\s+you)\b/i,
      /\bi'?m\s+about\s+to\s+(leave|head\s+out|go)\b/i,
      /\bi\s+need\s+to\s+(go|leave|head\s+out)\b/i,
      /\bi'?ll\s+meet\s+you\s+there\b/i,
      /\bi'?m\s+coming\b/i,
      /\bi'?ll\s+be\s+there\s+in\s+\d+/i,
      /\bheading\s+out\s+now\b/i,
      /\bjust\s+left\b/i,
      /\bsee\s+you\s+(in\s+\d+|soon|there)\b/i,
      /\bi'?ll\s+(come|head|stop|swing|drop)\s+(over|by|there)\b/i,
    ];

    const matched = commitmentPhrases.some(p => p.test(content));
    if (!matched) return null;

    // Extract raw destination text from message (may be vague or proper name)
    const destMatch = latestCharMsg.content.match(/(?:to|at|heading\s+to|going\s+to|meet\s+(?:you\s+)?at)\s+([A-Za-z0-9][^.!?,\n]{2,40}?)(?:\s+in\s+\d|\s+at\s+\d|[.!?,]|$)/i);
    const timeMatch = content.match(/in\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)/i);

    const rawDestination = destMatch?.[1]?.trim() || null;
    const rawMinutes = timeMatch?.[1] ? parseInt(timeMatch[1]) : null;
    const isHours = timeMatch?.[2]?.startsWith('h');
    const minutes = rawMinutes ? (isHours ? rawMinutes * 60 : rawMinutes) : 15;
    // Anchor ETA to message send time, not current time — prevents ETA drift on re-mount
    const msgTime = latestCharMsg.timestamp ? new Date(latestCharMsg.timestamp).getTime() : now;
    const scheduledArrivalTime = new Date(msgTime + minutes * 60000).toISOString();

    return {
      messageId: latestCharMsg.id,
      rawDestination,
      etaMinutes: minutes,
      scheduledArrivalTime,
      characterName: character?.name || latestCharMsg.character_name,
    };
  }, [messages, dismissedCommitmentIds, character]);

  const handleLoadOlder = async () => {
    if (isLoadingOlder || !onLoadOlderMessages) return;
    setIsLoadingOlder(true);
    try {
      await onLoadOlderMessages();
    } finally {
      setIsLoadingOlder(false);
    }
  };
  const itemsWithSeparators = injectDateSeparators(messages);
  if (messages.length > 0) console.log(`[CHAT_TIMING] ChatMessageList_RENDER n=${messages.length} at=${Date.now()}`);

  const activeCommitment = pinTriggeredCommitment || detectedCommitment;

  return (
    <div className="flex-1 relative flex flex-col min-h-0">
    <div className="flex-1 overflow-y-auto py-4 space-y-4 px-4" data-chat-container="true">
      {/* Load older messages button — only shown when more history exists */}
      {hasOlderMessages && onLoadOlderMessages && (
        <div className="flex justify-center pt-2 pb-1">
          <button
            onClick={handleLoadOlder}
            disabled={isLoadingOlder}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-secondary border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            {isLoadingOlder
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading older…</>
              : <><ChevronUp className="w-3.5 h-3.5" /> Load older messages</>
            }
          </button>
        </div>
      )}

      {/* ArchiveNotice — only shown when genuinely archived messages exist */}
      {conversationId && character && (
        <ArchiveNotice
          conversationId={conversationId}
          characterId={characterId}
          characterName={character?.name}
        />
      )}

      {/* MessageCountDisplay — shows active message count and limit info when approaching limit */}
      {conversationId && (
        <MessageCountDisplay conversationId={conversationId} />
      )}

      <AnimatePresence>
        {itemsWithSeparators.map((item) => {
          if (item._isDateSeparator) {
            return <DateSeparator key={item.id} label={item.label} />;
          }
          const msg = item;
          return (
            <MessageBubble
               key={msg.id}
               message={msg}
               character={character}
               onReact={onReact}
               onDelete={onDelete}
               onDeleteImage={onDeleteImage}
               onPlayVoice={
                 msg.sender_type !== "user" && !msg.is_narrative
                   ? () => onPlayVoice(msg.id, msg.content, character, userSettings, true)
                   : null
               }
               isPlayingVoice={playingAudioId === msg.id}
               voiceError={voiceErrors[msg.id]}
               onForward={!msg.is_narrative ? (m) => onForward(m) : null}
               onImageLoaded={onImageLoaded}
               onLocationSignal={msg.sender_type === "character" && !msg.is_narrative && onLocationSignal ? onLocationSignal : null}
               onMovementCommitment={msg.sender_type === "character" && !msg.is_narrative ? handleMovementCommitmentFromPin : null}
               onShareNarrative={msg.is_narrative && onShareNarrative ? (m) => onShareNarrative(m) : null}
             />
          );
        })}
      </AnimatePresence>

      <AnimatePresence>
        {isTyping && character && (
          <TypingIndicator name={character.name} avatarUrl={character.avatar_url} />
        )}
      </AnimatePresence>

      {/* sendError intentionally removed from conversation stream — errors are handled
          via character fallback responses or silent retry. No system banners in chat. */}

      <div ref={bottomRef} />
    </div>

    {/* Movement Commitment Prompt — fixed overlay, always visible regardless of scroll position.
        Priority: pin-triggered (user clicked a specific message) > auto-detected (latest message). */}
    <AnimatePresence>
      {activeCommitment && (
        <div className="absolute bottom-0 left-0 right-0 z-40 px-4 pb-2 bg-gradient-to-t from-background via-background/95 to-transparent pt-6 pointer-events-none">
          <div className="pointer-events-auto">
            <MovementCommitmentPromptWithResolver
              rawDestination={activeCommitment.rawDestination}
              characterName={activeCommitment.characterName || character?.name}
              characterId={characterId}
              currentCharacter={character}
              etaMinutes={activeCommitment.etaMinutes}
              scheduledTime={activeCommitment.scheduledArrivalTime}
              recentMessages={messages.slice(-15)}
              conversationId={conversationId}
              messageId={activeCommitment.messageId}
              onConfirm={() => dismissCommitment(activeCommitment.messageId)}
              onCancel={() => dismissCommitment(activeCommitment.messageId)}
            />
          </div>
        </div>
      )}
    </AnimatePresence>
    </div>
  );
}