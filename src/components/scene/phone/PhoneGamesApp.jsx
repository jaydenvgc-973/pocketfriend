import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import GameLauncher from "@/components/games/GameLauncher";
import { resolveOrCreateConversation } from "@/lib/conversationResolver";

/**
 * PhoneGamesApp — the phone's games app.
 *
 * A phone is a communication and entertainment device, so its games are not limited to
 * whoever is standing in the current scene. The opponent list is the account's own
 * character directory (the same records and eligibility rules Pocket Message uses),
 * alphabetically sorted and searchable. Playing with someone who is elsewhere does not
 * move them, does not add them to the scene, and does not invent a meeting: the game
 * runs through the existing GameLauncher / GameContainer and its existing records, and
 * the partner's existing conversation carries the result and the memory exactly as it
 * does from Chat.
 */
export default function PhoneGamesApp({ currentUser, onBack, onExit }) {
  const queryClient = useQueryClient();
  const [characters, setCharacters] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [isOpening, setIsOpening] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!currentUser?.email) { setIsLoading(false); return; }
    base44.entities.Character.filter({ owner_email: currentUser.email }, "name", 300)
      .then((rows) => {
        if (cancelled) return;
        setCharacters((rows || [])
          .filter((c) => c.id && !c.is_user
            && !["deleted", "soft_deleted", "merged"].includes(c.status)
            && c.life_status !== "deceased")
          .sort((a, b) => (a.name || "").localeCompare(b.name || "")));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [currentUser?.email]);

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
          // A game that ends or is closed has finished with the phone's Games app: control
          // goes back to the launcher instead of leaving this app on an empty screen.
          onGameClosed={() => { setActive(null); setConversationId(null); onExit?.(); }}
          onGameEnd={() => queryClient.invalidateQueries({ queryKey: ["character", active.id] })}
        />
      </div>
    );
  }

  const visible = search.trim()
    ? characters.filter((c) => (c.name || "").toLowerCase().includes(search.trim().toLowerCase()))
    : characters;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-2 py-2 border-b border-white/10">
        <button onClick={onBack} className="p-1 text-white/70 hover:text-white">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <p className="text-[11px] font-semibold text-white">Games</p>
      </div>

      <div className="px-2 py-2">
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-white/10 border border-white/15">
          <Search className="w-3 h-3 text-white/50" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Play with anyone you know"
            className="flex-1 bg-transparent text-[11px] text-white placeholder:text-white/40 outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {isLoading && (
          <p className="text-[10px] text-white/60 flex items-center gap-1.5 py-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading people…
          </p>
        )}
        {!isLoading && visible.length === 0 && (
          <p className="text-[10px] text-white/50 py-3 text-center">
            {search.trim() ? "No one by that name." : "No one to play with yet."}
          </p>
        )}
        {visible.map((c) => (
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