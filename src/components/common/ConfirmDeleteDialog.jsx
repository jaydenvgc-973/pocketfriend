import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ConfirmDeleteDialog
 *
 * The single confirmation step before any record is deleted. Nothing is removed until
 * the user confirms; canceling leaves the selected record exactly as it was.
 */
export default function ConfirmDeleteDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4"
          onClick={busy ? undefined : onCancel}
        >
          <motion.div
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 16, opacity: 0 }}
            className="w-full max-w-sm bg-card border border-border rounded-2xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-4 h-4 text-destructive" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                <p className="text-xs text-muted-foreground mt-1">{message}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onCancel} disabled={busy} className="flex-1 rounded-xl">
                Cancel
              </Button>
              <Button
                onClick={onConfirm}
                disabled={busy}
                className="flex-1 rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              >
                {busy ? "Deleting…" : confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}