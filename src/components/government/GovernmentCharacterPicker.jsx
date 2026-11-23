import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import CrossAccountCharacterList from "@/components/chat/CrossAccountCharacterList";

/**
 * GovernmentCharacterPicker — the participant selector used by every City Hall and
 * Courthouse setup field.
 *
 * It follows the organization Pocketfriend already uses everywhere characters are
 * picked: the account's own characters first, alphabetically, then the characters
 * from other accounts the user already knows, alphabetically, clearly marked as
 * cross-account (the same CrossAccountCharacterList used by the gallery and sharing
 * flows). Selection is by authoritative character ID, so two people with the same
 * name stay distinct.
 *
 * A character already committed to another role is shown disabled rather than
 * silently duplicated into a conflicting role.
 */
export default function GovernmentCharacterPicker({
  characters = [],
  crossAccountCharacters = [],
  selectedIds = [],
  onToggle,
  multiple = false,
  disabledIds = [],
  clearLabel = null,
  onClear,
  emptyLabel = "No characters available.",
  placeholder = "Search characters…",
  maxHeightClass = "max-h-56",
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const own = useMemo(
    () => (characters || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [characters]
  );
  const cross = useMemo(
    () => (crossAccountCharacters || []).slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [crossAccountCharacters]
  );

  const matches = (c) => !q || (c.name || "").toLowerCase().includes(q);
  const disabled = new Set(disabledIds);
  const filteredOwn = own.filter(matches);
  // A cross-account person already committed to another role is not offered again: the
  // cross-account row has no disabled state of its own, so it is left out of this list
  // rather than shown as a click that does nothing.
  const filteredCross = cross.filter(matches).filter((c) => !disabled.has(c.id));

  const row = (char) => {
    const isSelected = selectedIds.includes(char.id);
    const isDisabled = !isSelected && disabled.has(char.id);
    return (
      <button
        key={char.id}
        onClick={() => { if (!isDisabled) onToggle?.(char.id); }}
        disabled={isDisabled}
        title={isDisabled ? `${char.name} is already in another role` : char.name}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left border-b border-border last:border-b-0 transition-colors ${
          isDisabled ? "opacity-40 cursor-not-allowed" : isSelected ? "bg-primary/10" : "hover:bg-secondary/60"
        }`}
      >
        <span className={`w-3.5 h-3.5 rounded ${multiple ? "" : "rounded-full"} border flex items-center justify-center text-[9px] flex-shrink-0 ${
          isSelected ? "bg-primary border-primary text-primary-foreground" : "border-border"
        }`}>{isSelected ? "✓" : ""}</span>
        {char.avatar_url ? (
          <img src={char.avatar_url} alt={char.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" onError={(e) => { e.target.style.display = "none"; }} />
        ) : (
          <span className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold text-muted-foreground flex-shrink-0">{(char.name || "?")[0]}</span>
        )}
        <span className={`text-xs truncate ${isSelected ? "text-primary font-medium" : "text-foreground"}`}>{char.name}</span>
        {isDisabled && <span className="ml-auto text-[9px] text-muted-foreground uppercase tracking-wider">In another role</span>}
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full h-9 pl-9 pr-3 rounded-xl bg-secondary border border-border text-xs text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      <div className={`rounded-xl border border-border overflow-y-auto ${maxHeightClass}`}>
        {!multiple && clearLabel && (
          <button
            onClick={() => onClear?.()}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left border-b border-border transition-colors ${selectedIds.length === 0 ? "bg-primary/10" : "hover:bg-secondary/60"}`}
          >
            <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center text-[9px] flex-shrink-0 ${selectedIds.length === 0 ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>{selectedIds.length === 0 ? "✓" : ""}</span>
            <span className="text-xs text-muted-foreground">{clearLabel}</span>
          </button>
        )}

        {filteredOwn.length > 0 && (
          <>
            <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground bg-secondary/40">Your characters</p>
            {filteredOwn.map(row)}
          </>
        )}

        {filteredCross.length > 0 && (
          <CrossAccountCharacterList
            characters={filteredCross}
            selectedIds={selectedIds}
            onToggle={(id) => { if (!disabled.has(id)) onToggle?.(id); }}
          />
        )}

        {filteredOwn.length === 0 && filteredCross.length === 0 && (
          <p className="px-3 py-3 text-xs text-muted-foreground text-center">
            {query ? "No characters match that search." : emptyLabel}
          </p>
        )}
      </div>
    </div>
  );
}