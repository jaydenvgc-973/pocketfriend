import React from "react";
import { AnimatePresence } from "framer-motion";
import MessageBubble from "@/components/chat/MessageBubble";
import TypingIndicator from "@/components/chat/TypingIndicator";
import ArchiveNotice from "@/components/chat/ArchiveNotice";
import DateSeparator from "@/components/chat/DateSeparator";
import { injectDateSeparators } from "@/lib/messageDateGrouping";

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
}) {
  // Inject date separators — one per calendar day, based on message timestamps
  const itemsWithSeparators = injectDateSeparators(messages);

  return (
    <div className="flex-1 overflow-y-auto py-4 space-y-4 px-4" data-chat-container="true">
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
            />
          );
        })}
      </AnimatePresence>

      <AnimatePresence>
        {isTyping && character && (
          <TypingIndicator name={character.name} avatarUrl={character.avatar_url} />
        )}
      </AnimatePresence>

      {sendError && (
        <div className="text-center px-4 py-2">
          <p className="text-xs text-destructive bg-destructive/10 rounded-xl px-4 py-2 inline-block">
            {sendError}{" "}
            <button className="underline ml-1" onClick={() => setSendError(null)}>
              Dismiss
            </button>
          </p>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}