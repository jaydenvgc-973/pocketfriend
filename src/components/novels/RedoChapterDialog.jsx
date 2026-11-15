import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Redo Chapter confirmation, with the chapter's own premise in an editable box.
 *
 * The box is filled from the instructions this chapter was actually written from —
 * its stored direction, or the novel's premise when this chapter never had one of its
 * own. Opening this dialog does nothing; nothing is generated until Confirm & Redo.
 */
export default function RedoChapterDialog({ chapter, defaultPremise = "", onCancel, onConfirm }) {
  const [premise, setPremise] = useState("");

  useEffect(() => {
    if (chapter) setPremise(defaultPremise || "");
    // The box belongs to the chapter being redone — never carried over from another.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id]);

  return (
    <AlertDialog open={!!chapter} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rewrite chapter {chapter?.chapter_number}?</AlertDialogTitle>
          <AlertDialogDescription>
            This is the premise “{chapter?.title}” was written from. Keep it, or edit it and the new
            version will follow what you write here. Nothing changes until the new version is
            written: if it fails, this chapter and its illustrations stay exactly as they are.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor="redo-premise" className="text-xs text-muted-foreground">
            Chapter premise
          </Label>
          <Textarea
            id="redo-premise"
            value={premise}
            onChange={(event) => setPremise(event.target.value)}
            rows={7}
            placeholder="What this chapter is about."
            className="text-sm leading-relaxed"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(premise.trim())}>Confirm &amp; Redo</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}