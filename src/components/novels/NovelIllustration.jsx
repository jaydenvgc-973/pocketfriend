import { RefreshCw } from "lucide-react";

/**
 * One illustrated plate in a chapter. The image keeps its place in the prose; its
 * Why Regenerate control corrects this plate alone, never the chapter.
 */
export default function NovelIllustration({ illustration, index, caption, onWhyRegenerate = null, busy = false }) {
  return (
    <figure className="my-6">
      <div className="relative">
        <img
          src={illustration.url}
          alt={caption || ""}
          className="w-full rounded-lg border border-border/60 object-cover"
          loading="lazy"
        />
        {onWhyRegenerate && (
          <button
            onClick={() => onWhyRegenerate(index)}
            disabled={busy}
            className="absolute bottom-2 right-2 flex items-center gap-1 px-2 py-1 rounded-lg bg-black/55 backdrop-blur text-[10px] font-medium text-white/90 hover:bg-black/70 disabled:opacity-60 transition-colors"
            title="Redraw only this illustration"
          >
            {busy
              ? <RefreshCw className="w-3 h-3 animate-spin" />
              : <RefreshCw className="w-3 h-3" />}
            Why regenerate
          </button>
        )}
      </div>
      {caption && (
        <figcaption className="mt-2 text-center text-[11px] italic text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}