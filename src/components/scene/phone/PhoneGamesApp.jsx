import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import GameLauncher from "@/components/games/GameLauncher";
import { resolveOrCreateConversation } from "@/lib/conversationResolver";

/**
 * PhoneGamesApp — the phone's games app.
 *
 * The games are the app's existing ones (the same GameLauncher the Chat page opens, with
 * its existing GameContainer / ChemistryGame and their existing records). Choosing who to
 * play with only picks the partner from the people already in this scene; nothing is added
 * to the scene and nobody is moved. The partner's existing conversation is reused so a
 * finished game is remembered exactly as it is from Chat.
 */
export default function PhoneGamesApp({ characters = [], currentUser, onBack }) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [isOpening, setIsOpening] = useState(null);

  const openWith = async (character) => {
    setIsOpening(character.id);
    try {
      const convId = currentUser?.email
        ? await resolveOrCreateConversation({
            characterId: character.id,
            characterName: character.name,
            chatType: "direct",
            ownerEmail: currentUser.email,
          }).catch(() => null)
        : null;
      setConversationId(convId);
      setActive(character);
    } finally {
      setIsOpening(null);
    }
  };

  if (active) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-1 py-1">
        <GameLauncher
          embedded
          character={active}
          conversationId={conversationId}
          externalTrigger
          onExternalClose={() => { setActive(null); setConversationId(null); }}
          onGameEnd={() => queryClient.invalidateQueries({ queryKey: ["character", active.id] })}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-2 border-b border-white/10">
        <button onClick={onBack} className="p-1 text-white/70 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <p className="text-[11px] font-semibold text-white">Games</p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        <p className="text-[9px] text-white/50 px-1 pb-1">Play with someone here</p>
        {characters.length === 0 && (
          <p className="text-[10px] text-white/50 py-3 text-center">No one is in this scene to play with.</p>
        )}
        {characters.map((c) => (
          <button
            key={c.id}
            onClick={() => openWith(c)}
            disabled={!!isOpening}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-left transition-colors disabled:opacity-50"
          >
            <div className="w-6 h-6 rounded-full bg-white/20 overflow-hidden flex items-center justify-center flex-shrink-0">
              {c.avatar_url
                ? <img src={c.avatar_url} alt={c.name} className="w-full h-full object-cover" />
                : <span className="text-[9px] font-bold text-white">{(c.name || "?").charAt(0).toUpperCase()}</span>}
            </div>
            <span className="text-[11px] text-white truncate flex-1">{c.name}</span>
            {isOpening === c.id && <Loader2 className="w-3 h-3 animate-spin text-white/60" />}
          </button>
        ))}
      </div>
    </div>
  );
}