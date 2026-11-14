import { useMemo, useState } from "react";
import { Globe2, Link2 } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";

const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""));

function CharacterRow({ character, selected, connected, centralName, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(character.id)}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
        selected ? "bg-primary/15 border border-primary/40" : "border border-transparent hover:bg-secondary/60"
      }`}
    >
      <CharacterAvatar character={character} size="sm" />
      <span className="text-xs text-foreground flex-1 truncate">{character.name}</span>
      {connected && (
        <span title={`Already knows ${centralName}`} className="flex-shrink-0">
          <Link2 className="w-3 h-3 text-emerald-400" />
        </span>
      )}
      {selected && <span className="text-[10px] text-primary font-semibold flex-shrink-0">Included</span>}
    </button>
  );
}

export default function NovelFocusPicker({
  characters = [],
  crossAccount = [],
  connectedIds = new Set(),
  centralName = "them",
  selectedIds = [],
  onToggle,
  isLoading = false,
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const own = useMemo(
    () => characters.filter((c) => c?.id && c.status !== "deleted" && c.life_status !== "deceased")
      .filter((c) => !q || String(c.name || "").toLowerCase().includes(q))
      .slice()
      .sort(byName),
    [characters, q]
  );

  const accounts = useMemo(() => {
    const grouped = new Map();
    crossAccount
      .filter((c) => c?.id && (!q || String(c.name || "").toLowerCase().includes(q)))
      .forEach((c) => {
        const key = c.account_email || c.owner_email || "Other account";
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(c);
      });
    return [...grouped.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([account, list]) => ({ account, list: list.slice().sort(byName) }));
  }, [crossAccount, q]);

  const nothing = own.length === 0 && accounts.length === 0;

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search characters"
        className="w-full mb-2 px-3 py-2 rounded-lg bg-secondary/60 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
        {isLoading && <p className="text-[11px] text-muted-foreground italic">Looking for characters from other accounts…</p>}
        {nothing && !isLoading && <p className="text-xs text-muted-foreground italic">No characters found.</p>}

        {own.length > 0 && (
          <div>
            <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Your account
            </p>
            <div className="space-y-0.5">
              {own.map((c) => (
                <CharacterRow
                  key={c.id}
                  character={c}
                  selected={selectedIds.includes(c.id)}
                  connected={connectedIds.has(c.id)}
                  centralName={centralName}
                  onToggle={onToggle}
                />
              ))}
            </div>
          </div>
        )}

        {accounts.map(({ account, list }) => (
          <div key={account} className="pt-1 border-t border-dashed border-border">
            <p className="px-2 pb-1 pt-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <Globe2 className="w-3 h-3" /> {account}
            </p>
            <div className="space-y-0.5">
              {list.map((c) => (
                <CharacterRow
                  key={c.id}
                  character={c}
                  selected={selectedIds.includes(c.id)}
                  connected={connectedIds.has(c.id)}
                  centralName={centralName}
                  onToggle={onToggle}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
        <Link2 className="w-2.5 h-2.5 text-emerald-400" /> already knows {centralName}
      </p>
    </div>
  );
}