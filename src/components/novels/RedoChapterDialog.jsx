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

export default function RedoChapterDialog({ chapter, onCancel, onConfirm }) {
  return (
    <AlertDialog open={!!chapter} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rewrite chapter {chapter?.chapter_number}?</AlertDialogTitle>
          <AlertDialogDescription>
            A new version of “{chapter?.title}” will be written from the character's current records
            and the chapters around it. The new version replaces this chapter's text and
            illustrations. The other chapters stay as they are.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Rewrite chapter</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}