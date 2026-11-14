export default function NovelTableOfContents({ chapters = [], activeNumber, onSelect }) {
  if (chapters.length === 0) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Contents</p>
      <div className="space-y-0.5">
        {chapters.map((c) => {
          const active = c.chapter_number === activeNumber;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.chapter_number)}
              className={`w-full text-left px-2 py-1.5 rounded-lg transition-colors ${active ? "bg-primary/15" : "hover:bg-secondary/60"}`}
            >
              <span className={`text-[11px] ${active ? "text-primary" : "text-muted-foreground"}`}>
                Chapter {c.chapter_number}
              </span>
              <span className={`block text-xs truncate ${active ? "text-foreground font-medium" : "text-foreground/80"}`}>
                {c.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}