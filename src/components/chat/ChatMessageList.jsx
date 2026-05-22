import React, { useState, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import MessageBubble from "@/components/chat/MessageBubble";
import TypingIndicator from "@/components/chat/TypingIndicator";
import ArchiveNotice from "@/components/chat/ArchiveNotice";
import DateSeparator from "@/components/chat/DateSeparator";
import { injectDateSeparators } from "@/lib/messageDateGrouping";
import { ChevronUp, Loader2 } from "lucide-react";
import MovementCommitmentPrompt from "@/components/chat/MovementCommitmentPrompt";

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
  const [dismissedCommitmentIds, setDismissedCommitmentIds] = useState(new Set());

  // Detect movement commitment in latest character message
  const detectedCommitment = useMemo(() => {
    const latestCharMsg = [...messages]
      .reverse()
      .find(m => m.sender_type === 'character' && !m.is_narrative && !dismissedCommitmentIds.has(m.id));
    
    if (!latestCharMsg?.content) return null;

    const content = latestCharMsg.content.toLowerCase();
    const patterns = [
      /(?:i'll|i will|i'm|i am).*?(?:be|go|head|get).*?(?:there|to|at).+?(?:in|at|in about|within|around|in\s+\d+)/i,
      /(?:i'll|i will).*?(?:there|go).*?(?:in|at|within|about|around)\s+(?:about\s+)?(\d+)\s*(?:minutes?|mins?|hours?|hour)/i,
      /(?:getting|heading|going).*?to\s+(.+?)\s+(?:in|at|within).+?(?:\d+\s*(?:minutes?|mins?|hours?))/i,
    ];

    const matches = patterns.some(p => p.test(content));
    if (!matches) return null;

    // Extract destination and time estimate
    const destMatch = content.match(/(?:to|at|in)\s+([A-Z][^.!?]*?(?:Bar|Park|Home|Shop|Café|Restaurant|Store|Location|Hall|Office|Gym))/i);
    const timeMatch = content.match(/(?:in|at|within|around|in\s+about)\s+(?:about\s+)?(\d+)\s*(?:minutes?|mins?|hours?)/i);

    const destination = destMatch?.[1]?.trim() || null;
    const minutes = timeMatch?.[1] ? parseInt(timeMatch[1]) : 10;

    return {
      messageId: latestCharMsg.id,
      destination,
      etaMinutes: minutes,
      characterName: character?.name || latestCharMsg.character_name
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

  return (
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

      {messages.length > 0 && (
        <ArchiveNotice
          conversationId={conversationId}
          characterId={characterId}
          characterName={character?.name}
        />
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

      {/* Movement Commitment Prompt */}
      <AnimatePresence>
        {detectedCommitment && (
          <MovementCommitmentPrompt
            characterName={detectedCommitment.characterName}
            characterId={characterId}
            destination={detectedCommitment.destination || "their destination"}
            etaMinutes={detectedCommitment.etaMinutes}
            conversationId={conversationId}
            messageId={detectedCommitment.messageId}
            onConfirm={() => {
              setDismissedCommitmentIds(prev => new Set([...prev, detectedCommitment.messageId]));
            }}
            onCancel={() => {
              setDismissedCommitmentIds(prev => new Set([...prev, detectedCommitment.messageId]));
            }}
          />
        )}
      </AnimatePresence>

      {/* sendError intentionally removed from conversation stream — errors are handled
          via character fallback responses or silent retry. No system banners in chat. */}

      <div ref={bottomRef} />
    </div>
  );
}