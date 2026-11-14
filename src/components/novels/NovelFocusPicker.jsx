import { useMemo, useState } from "react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";

export default function NovelFocusPicker({ characters = [], selectedIds = [], onToggle }) {
  const [query, setQuery] = useState("");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters
      .filter((c) => c && c.id && c.status !== "deleted" && c.life_status !== "deceased")
      .filter((c) => !q || (c.name || "").toLowerCase().includes(q))
      .slice(0, 60);
  }, [characters, query]);

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search characters"
        className="w-full mb-2 px-3 py-2 rounded-lg bg-secondary/60 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
        {list.length === 0 && <p className="text-xs text-muted-foreground italic">No characters found.</p>}
        {list.map((c) => {
          const selected = selectedIds.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onToggle(c.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                selected ? "bg-primary/15 border border-primary/40" : "border border-transparent hover:bg-secondary/60"
              }`}
            >
              <CharacterAvatar character={c} size="sm" />
              <span className="text-xs text-foreground flex-1 truncate">{c.name}</span>
              {selected && <span className="text-[10px] text-primary font-semibold">Included</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}