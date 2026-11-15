import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/**
 * Direct text correction for one chapter.
 *
 * A small error in an otherwise good chapter must not cost the chapter: this edits the
 * saved prose in place, with no generation of any kind. The complete chapter is in the
 * box, not just the passage that was pressed, so a correction can be made anywhere.
 */
export default function ChapterEditDialog({ chapter, open, focusText = "", onClose, onSave }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const areaRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setText(chapter?.content || "");
    setSaving(false);
    setError(null);
  }, [open, chapter?.id, chapter?.content]);

  // Open the box on the passage that was held, with the whole chapter still in it.
  useEffect(() => {
    if (!open) return;
    const area = areaRef.current;
    if (!area) return;
    const value = area.value || "";
    const at = focusText ? value.indexOf(focusText) : -1;
    if (at < 0) return;
    area.focus({ preventScroll: true });
    area.setSelectionRange(at, at + focusText.length);
    const share = value.length ? at / value.length : 0;
    area.scrollTop = Math.max(0, share * area.scrollHeight - area.clientHeight / 2);
  }, [open, focusText]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(text);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "That correction could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <DialogContent className="max-w-3xl w-[95vw] p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Edit chapter text</DialogTitle>
          <DialogDescription className="text-[11px] leading-relaxed">
            Correct the chapter exactly as you want it read. Only the prose changes — nothing is
            regenerated, and the title, illustrations and every other chapter stay as they are.
          </DialogDescription>
        </DialogHeader>

        <textarea
          ref={areaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          disabled={saving}
          className="w-full h-[58vh] min-h-[220px] px-3 py-2 rounded-lg bg-secondary/60 border border-border text-[13px] leading-relaxed text-foreground font-serif focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />

        {error && <p className="text-[11px] text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !text.trim()}
            className="px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}