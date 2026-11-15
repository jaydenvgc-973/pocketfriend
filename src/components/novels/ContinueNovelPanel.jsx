import { useState } from "react";
import { ChevronDown, Feather, Users } from "lucide-react";
import NovelFocusPicker from "./NovelFocusPicker";
import useNovelCharacterCandidates from "@/hooks/useNovelCharacterCandidates";

/**
 * Instructions for the next chapter: what it should be about, and who it is about.
 *
 * The people chosen here belong to THIS chapter only. They are picked from the same
 * eligible list the novel was started from — the user's own characters plus the
 * connected characters of other accounts — and never permanently change the novel's
 * cast. Leaving the list empty is a valid answer: the chapter follows what it needs.
 */
export default function ContinueNovelPanel({
  nextChapterNumber,
  onGenerate,
  busy = false,
  error = null,
  character = null,
  characters = [],
}) {
  const [direction, setDirection] = useState("");
  const [focusIds, setFocusIds] = useState([]);
  const [showFocus, setShowFocus] = useState(false);

  const { connectedIds, crossAccountCharacters, isLoading } =
    useNovelCharacterCandidates(character?.id, showFocus && !!character?.id);

  const others = characters.filter((c) => c.id !== character?.id);
  const chosenNames = [...others, ...crossAccountCharacters]
    .filter((c) => focusIds.includes(c.id))
    .map((c) => c.name)
    .filter(Boolean);

  return (
    <div className="mt-10 pt-6 border-t border-border">
      <div className="flex items-center gap-2 mb-1">
        <Feather className="w-3.5 h-3.5 text-primary" />
        <p className="text-sm font-medium text-foreground">Continue this novel</p>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Chapter {nextChapterNumber} will pick up from where this one ends, following whatever you say here.
      </p>
      <textarea
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
        rows={3}
        placeholder="Optional: where should this chapter go?"
        className="w-full px-3 py-2 rounded-lg bg-secondary/60 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none font-sans"
      />

      <button
        type="button"
        onClick={() => setShowFocus((v) => !v)}
        className={`mt-2 w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors ${
          showFocus || focusIds.length ? "border-primary/50 bg-primary/10" : "border-border bg-secondary/40"
        }`}
      >
        <Users className="w-3.5 h-3.5 text-primary flex-shrink-0" />
        <span className="flex-1 min-w-0">
          <span className="block text-xs text-foreground">Characters in this chapter</span>
          <span className="block text-[10px] text-muted-foreground leading-tight truncate">
            {chosenNames.length ? chosenNames.join(", ") : "Optional — pick who it should be about"}
          </span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showFocus ? "rotate-180" : ""}`} />
      </button>

      {showFocus && (
        <div className="mt-2">
          <NovelFocusPicker
            characters={others}
            crossAccount={crossAccountCharacters}
            connectedIds={connectedIds}
            centralName={character?.name || "them"}
            selectedIds={focusIds}
            isLoading={isLoading}
            onToggle={(id) => setFocusIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
          />
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground italic">
            {character?.name || "The central character"} stays at the centre. Anyone you choose here is central
            to this chapter only — leave it empty and the chapter follows what it needs.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
      <button
        onClick={() => onGenerate(direction.trim(), { focusIds })}
        disabled={busy}
        className="mt-3 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {busy ? "Writing…" : `Write chapter ${nextChapterNumber}`}
      </button>
    </div>
  );
}