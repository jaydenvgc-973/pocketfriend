import React, { useState } from "react";
import { AnimatePresence } from "framer-motion";
import MessageBubble from "@/components/chat/MessageBubble";
import TypingIndicator from "@/components/chat/TypingIndicator";
import ArchiveNotice from "@/components/chat/ArchiveNotice";
import DateSeparator from "@/components/chat/DateSeparator";
import { injectDateSeparators } from "@/lib/messageDateGrouping";
import { ChevronUp, Loader2 } from "lucide-react";

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

      {/* sendError intentionally removed from conversation stream — errors are handled
          via character fallback responses or silent retry. No system banners in chat. */}

      <div ref={bottomRef} />
    </div>
  );
}