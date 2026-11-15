import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Last-resort clipboard write for a browser that refuses the async clipboard. */
function writeWithSelection(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

/**
 * Confirmation for the undisclosed press-and-hold on a chapter title.
 *
 * Copies the chapter's own prose — every paragraph of it, in the order written — and
 * nothing else: no illustration, caption, chapter number, title or interface text.
 */
export default function ChapterCopyDialog({ chapter, open, onClose }) {
  const [busy, setBusy] = useState(false);
  const text = (chapter?.content || "").trim();

  const copy = async () => {
    if (!text) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else writeWithSelection(text);
    } catch {
      writeWithSelection(text);
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Copy the full text of this chapter?</AlertDialogTitle>
          <AlertDialogDescription>
            The whole chapter will be copied to your device, ready to paste anywhere.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => { event.preventDefault(); copy(); }}
            disabled={busy}
          >
            Copy
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}