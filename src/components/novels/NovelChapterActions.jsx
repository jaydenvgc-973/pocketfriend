import { useState } from "react";
import { ImagePlus, RotateCcw, Trash2 } from "lucide-react";
import RedoChapterDialog from "@/components/novels/RedoChapterDialog";
import DeleteChapterDialog from "@/components/novels/DeleteChapterDialog";

/** Per-chapter controls: rewrite this chapter, delete this chapter, or draw its plates. */
export default function NovelChapterActions({ chapter, defaultPremise = "", onRedo, onDelete, onIllustrate = null, disabled = false, error = null }) {
  const [confirming, setConfirming] = useState(null);

  if (!chapter) return null;

  // Plates are drawn in a separate request; this retries them without touching the prose.
  const missingPlates = !(chapter.illustrations || []).length && (chapter.illustration_specs || []).length > 0;

  const confirm = (action) => {
    setConfirming(null);
    action();
  };

  return (
    <div className="mt-6 flex flex-col items-center gap-1">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setConfirming("redo")}
          disabled={disabled}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
        >
          <RotateCcw className="w-3 h-3" /> Redo chapter
        </button>
        {missingPlates && onIllustrate && (
          <>
            <span className="text-muted-foreground/30">·</span>
            <button
              onClick={onIllustrate}
              disabled={disabled}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            >
              <ImagePlus className="w-3 h-3" /> Create illustrations
            </button>
          </>
        )}
        <span className="text-muted-foreground/30">·</span>
        <button
          onClick={() => setConfirming("delete")}
          disabled={disabled}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-40 transition-colors"
        >
          <Trash2 className="w-3 h-3" /> Delete chapter
        </button>
      </div>
      {error && <p className="text-[11px] text-destructive text-center">{error}</p>}

      <RedoChapterDialog
        chapter={confirming === "redo" ? chapter : null}
        defaultPremise={defaultPremise}
        onCancel={() => setConfirming(null)}
        onConfirm={(premise) => confirm(() => onRedo(premise))}
      />
      <DeleteChapterDialog
        chapter={confirming === "delete" ? chapter : null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirm(onDelete)}
      />
    </div>
  );
}