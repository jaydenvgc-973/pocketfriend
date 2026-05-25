import React, { useState, useMemo } from "react";
import { Search, Check } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";

/**
 * Grouped character selector with avatars (no checkboxes).
 * Matches TravelCharacterSelector pattern: click row to select/deselect.
 */
export default function GroupedCharacterSelector({
  allCharacters = [],
  selectedIds = [],
  onSelect,
  placeholder = "Search characters...",
  getCharacterAvailability = null, // optional: (char) => { status, allJobs, isOnShiftNow }
}) {
  const [searchQuery, setSearchQuery] = useState("");

  // Group and sort characters — legacy characters (no character_type) fall into active_created_character
  const { activeCreated, npcFictitious, npcFamily } = useMemo(() => {
    const active = [];
    const fictitious = [];
    const family = [];
    allCharacters.forEach(c => {
      const type = c.character_type || "active_created_character";
      if (type === "npc_fictitious") fictitious.push(c);
      else if (type === "npc_family_member") family.push(c);
      else active.push(c); // active_created_character + any legacy/unknown type
    });
    const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
    active.sort(byName);
    fictitious.sort(byName);
    family.sort(byName);
    return { activeCreated: active, npcFictitious: fictitious, npcFamily: family };
  }, [allCharacters]);

  // Filter by search across all groups
  const q = searchQuery.toLowerCase();
  const filterChars = (chars) =>
    chars.filter(c => (c.name || "").toLowerCase().includes(q));

  const filteredActive = filterChars(activeCreated);
  const filteredFictitious = filterChars(npcFictitious);
  const filteredFamily = filterChars(npcFamily);

  const renderCharRow = (char) => {
    const isSelected = selectedIds.includes(char.id);
    const charTypeName =
      char.character_type === "active_created_character"
        ? "Active Created"
        : char.character_type === "npc_fictitious"
        ? "NPC Fictitious"
        : "NPC Family Member";

    // Availability info — only shown when getCharacterAvailability is provided (worker picker)
    const avail = getCharacterAvailability ? getCharacterAvailability(char) : null;
    const availColor =
      avail?.status === "available" ? "text-emerald-400" :
      avail?.status === "busy" ? "text-amber-400" :
      avail?.status === "conflict" ? "text-destructive" : null;
    const availLabel =
      avail?.status === "available" ? "Available" :
      avail?.status === "busy" ? "Currently on shift" :
      avail?.status === "conflict" ? "⚠ Schedule conflict" : null;

    return (
      <button
        key={char.id}
        onClick={() => onSelect(char.id, !isSelected)}
        className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
          isSelected
            ? "bg-primary/10 border-primary/40"
            : "bg-card border-border hover:border-primary/30"
        }`}
      >
        <CharacterAvatar character={char} size="md" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{char.name}</p>
          {avail ? (
            <div className="space-y-0.5">
              {availLabel && <p className={`text-xs font-medium ${availColor}`}>{availLabel}</p>}
              {avail.allJobs?.map((job, i) => (
                <p key={i} className="text-[10px] text-muted-foreground truncate">
                  📍 {job.name}{job.title ? ` · ${job.title}` : ''}{job.shift ? ` · ${job.shift}` : ''}
                </p>
              ))}
              {avail.allJobs?.length === 0 && <p className="text-[10px] text-muted-foreground">No current job</p>}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{charTypeName}</p>
          )}
        </div>
        <div
          className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
            isSelected ? "bg-primary border-primary" : "border-border"
          }`}
        >
          {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
        </div>
      </button>
    );
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      <div className="space-y-4 max-h-80 overflow-y-auto">
        {/* Active Created Characters */}
        {filteredActive.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
              Active Created Characters
            </p>
            <div className="space-y-2">{filteredActive.map(renderCharRow)}</div>
          </div>
        )}

        {/* NPC Fictitious */}
        {filteredFictitious.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
              NPC Fictitious
            </p>
            <div className="space-y-2">{filteredFictitious.map(renderCharRow)}</div>
          </div>
        )}

        {/* NPC Family Members */}
        {filteredFamily.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
              NPC Family Members
            </p>
            <div className="space-y-2">{filteredFamily.map(renderCharRow)}</div>
          </div>
        )}

        {/* Empty state */}
        {filteredActive.length === 0 &&
          filteredFictitious.length === 0 &&
          filteredFamily.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              No characters found
            </p>
          )}
      </div>
    </div>
  );
}