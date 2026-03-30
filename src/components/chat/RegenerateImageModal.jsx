import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, AlertTriangle, UserX, ThumbsDown, Loader2 } from "lucide-react";

const REASONS = [
  {
    id: "flawed",
    icon: AlertTriangle,
    label: "Image is flawed",
    description: "Wrong anatomy, artifacts, or generation errors",
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/30 hover:border-amber-500/60",
  },
  {
    id: "no_avatar",
    icon: UserX,
    label: "Doesn't look like them",
    description: "Doesn't match the character's reference photos",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/30 hover:border-blue-500/60",
  },
  {
    id: "dont_like",
    icon: ThumbsDown,
    label: "Don't like it",
    description: "Just want a different version",
    color: "text-muted-foreground",
    bg: "bg-secondary border-border hover:border-primary/40",
  },
];

export default function RegenerateImageModal({ isOpen, onClose, onSelect, isRegenerating }) {
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-[60] flex items-end justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Why regenerate?</h3>
              <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            <div className="p-4 space-y-2">
              {REASONS.map((r) => {
                const Icon = r.icon;
                return (
                  <button
                    key={r.id}
                    onClick={() => onSelect(r.id)}
                    disabled={isRegenerating}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left disabled:opacity-50 ${r.bg}`}
                  >
                    <Icon className={`w-5 h-5 flex-shrink-0 ${r.color}`} />
                    <div>
                      <p className="text-sm font-medium text-foreground">{r.label}</p>
                      <p className="text-xs text-muted-foreground">{r.description}</p>
                    </div>
                    {isRegenerating && <Loader2 className="w-4 h-4 ml-auto animate-spin text-muted-foreground" />}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground/50 text-center pb-4">Your feedback helps generate a better image</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}