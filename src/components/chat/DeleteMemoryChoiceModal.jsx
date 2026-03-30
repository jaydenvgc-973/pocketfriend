import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, EyeOff, X } from "lucide-react";

export default function DeleteMemoryChoiceModal({ message, isOpen, onRemember, onForget, onCancel }) {
  if (!isOpen || !message) return null;

  const preview = message.content?.trim()
    ? `"${message.content.substring(0, 80)}${message.content.length > 80 ? "…" : ""}"`
    : "(image)";

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4"
          onClick={onCancel}
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-card border border-border rounded-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-3 border-b border-border">
              <p className="text-xs text-muted-foreground mb-1">Deleting from thread</p>
              <p className="text-sm text-foreground font-medium line-clamp-2">{preview}</p>
            </div>

            {/* Prompt */}
            <div className="px-5 py-3">
              <p className="text-sm text-muted-foreground">
                Should the character still remember this after deletion?
              </p>
            </div>

            {/* Choices */}
            <div className="px-4 pb-4 space-y-2">
              <button
                onClick={onRemember}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Brain className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Remember this</p>
                  <p className="text-xs text-muted-foreground">Hidden from thread · still in memory</p>
                </div>
              </button>

              <button
                onClick={onForget}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary hover:bg-secondary/80 border border-border transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <EyeOff className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Forget this</p>
                  <p className="text-xs text-muted-foreground">Removed from thread · erased from memory</p>
                </div>
              </button>

              <button
                onClick={onCancel}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors text-sm"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}