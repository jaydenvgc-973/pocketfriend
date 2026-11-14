import { Link } from "react-router-dom";
import { BookOpen, Trash2 } from "lucide-react";

export default function NovelCard({ novel, onDelete }) {
  const chapters = novel.chapter_count || 0;

  return (
    <div className="flex gap-3 p-3 rounded-xl bg-secondary/40 border border-border/60 hover:border-primary/30 transition-colors">
      <Link
        to={`/novel/${novel.id}`}
        className="w-14 h-20 rounded-md overflow-hidden bg-gradient-to-br from-primary/25 via-secondary to-background flex items-center justify-center flex-shrink-0"
      >
        {novel.cover_image_url ? (
          <img src={novel.cover_image_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <BookOpen className="w-5 h-5 text-primary/70" />
        )}
      </Link>

      <div className="flex-1 min-w-0">
        <Link to={`/novel/${novel.id}`} className="block">
          <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{novel.title}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {chapters} {chapters === 1 ? "chapter" : "chapters"}
            {novel.perspective === "outside_narrator" ? " · outside narrator" : " · first person"}
          </p>
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <Link to={`/novel/${novel.id}`} className="text-[11px] font-medium text-primary hover:underline">
            Open &amp; read
          </Link>
          <button
            onClick={() => onDelete(novel)}
            className="text-[11px] text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors"
          >
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}