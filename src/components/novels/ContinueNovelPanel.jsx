import { useState } from "react";
import { Feather } from "lucide-react";

export default function ContinueNovelPanel({ nextChapterNumber, onGenerate, busy = false, error = null }) {
  const [direction, setDirection] = useState("");

  return (
    <div className="mt-10 pt-6 border-t border-border">
      <div className="flex items-center gap-2 mb-1">
        <Feather className="w-3.5 h-3.5 text-primary" />
        <p className="text-sm font-medium text-foreground">Continue this novel</p>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Chapter {nextChapterNumber} will pick up from where this one ends, using anything recorded since.
      </p>
      <textarea
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
        rows={3}
        placeholder="Optional: where should this chapter go?"
        className="w-full px-3 py-2 rounded-lg bg-secondary/60 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none font-sans"
      />
      {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
      <button
        onClick={() => onGenerate(direction.trim())}
        disabled={busy}
        className="mt-3 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {busy ? "Writing…" : `Write chapter ${nextChapterNumber}`}
      </button>
    </div>
  );
}