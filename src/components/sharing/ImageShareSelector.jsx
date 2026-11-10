import React from "react";
import { Check, UserRound } from "lucide-react";

/**
 * ImageShareSelector
 *
 * The image-sharing selection interface used when sending a generated image
 * from Scenes and Gathering Rooms.
 *
 * - Sender selection mirrors the existing Media Gallery behavior: the user, or
 *   one of their own characters.
 * - Recipients are alphabetical, and characters belonging to another account are
 *   labelled so they are identifiable without opening a profile.
 */

function PersonAvatar({ url, name, isUser }) {
  if (url) {
    return <img src={url} alt={name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />;
  }
  return (
    <div className="w-7 h-7 rounded-full bg-secondary border border-border flex items-center justify-center flex-shrink-0">
      {isUser
        ? <UserRound className="w-3.5 h-3.5 text-primary" />
        : <span className="text-[10px] font-bold text-foreground">{(name || "?").trim().charAt(0).toUpperCase()}</span>}
    </div>
  );
}

export default function ImageShareSelector({
  senders = [],
  senderId,
  onSenderChange,
  ownCharacters = [],
  otherAccountCharacters = [],
  selectedIds = [],
  onToggle,
  disabled = false,
  userLabel = "You",
}) {
  const userIsSender = senderId === "user";

  const renderRecipient = (person) => {
    const isSender = person.id === senderId;
    const selected = selectedIds.includes(person.id);
    const blockedByAccount = person.is_other_account && userIsSender;
    const blocked = disabled || isSender || blockedByAccount;
    return (
      <button
        key={person.id}
        onClick={() => { if (!blocked) onToggle(person.id); }}
        disabled={blocked}
        title={
          blockedByAccount
            ? "Send as one of your characters to reach a character on another account"
            : person.is_other_account
              ? `${person.name} — belongs to another account`
              : person.name
        }
        className={`w-full flex items-center gap-2 px-2.5 py-2 text-left border-b border-border/50 last:border-b-0 transition-colors ${blocked ? "opacity-45 cursor-not-allowed" : "hover:bg-secondary/50"} ${selected ? "bg-primary/10" : ""}`}
      >
        <PersonAvatar url={person.avatar_url} name={person.name} />
        <span className={`flex-1 min-w-0 truncate text-xs ${selected ? "text-primary font-medium" : "text-foreground"}`}>{person.name}</span>
        {person.is_other_account && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30 flex-shrink-0">Other account</span>
        )}
        {isSender
          ? <span className="text-[9px] text-muted-foreground flex-shrink-0">sender</span>
          : selected ? <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" /> : null}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {/* SENDER */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Send as</p>
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-1">
          {senders.map((sender) => {
            const isActive = senderId === sender.id;
            return (
              <button
                key={sender.id}
                onClick={() => onSenderChange(sender.id)}
                disabled={disabled}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs whitespace-nowrap transition-colors flex-shrink-0 ${isActive ? "bg-primary/10 border-primary text-primary font-medium" : "bg-card border-border text-muted-foreground"}`}
              >
                <PersonAvatar url={sender.avatar_url} name={sender.name} isUser={sender.id === "user"} />
                <span className="max-w-[120px] truncate">{sender.id === "user" ? userLabel : sender.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* RECIPIENTS */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Send to</p>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {ownCharacters.length > 0 && (
            <div className="px-2.5 py-1.5 bg-secondary/40 border-b border-border">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Your characters</p>
            </div>
          )}
          {ownCharacters.map(renderRecipient)}
          {ownCharacters.length === 0 && (
            <p className="px-2.5 py-3 text-xs text-muted-foreground">No characters available.</p>
          )}

          {otherAccountCharacters.length > 0 && (
            <>
              <div className="px-2.5 py-1.5 bg-purple-500/10 border-y border-border">
                <p className="text-[10px] font-semibold text-purple-300 uppercase tracking-wider">Other accounts</p>
              </div>
              {otherAccountCharacters.map(renderRecipient)}
              {userIsSender && (
                <p className="px-2.5 py-1.5 text-[10px] text-muted-foreground border-t border-border">
                  Choose one of your characters as the sender to reach these.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}