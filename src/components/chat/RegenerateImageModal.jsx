import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, AlertTriangle, UserX, ThumbsDown, Loader2, PenLine } from "lucide-react";

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
    description: "Generate something completely different",
    color: "text-muted-foreground",
    bg: "bg-secondary border-border hover:border-primary/40",
  },
  {
    id: "custom_prompt",
    icon: PenLine,
    label: "Use my own prompt",
    description: "Describe exactly what you want",
    color: "text-primary",
    bg: "bg-primary/10 border-primary/30 hover:border-primary/60",
  },
];

export default function RegenerateImageModal({ isOpen, onClose, onSelect, isRegenerating, error }) {
  const [customPrompt, setCustomPrompt] = useState("");
  const [showPromptInput, setShowPromptInput] = useState(false);

  const handleSelect = (id) => {
    if (id === "custom_prompt") {
      setShowPromptInput(true);
      return;
    }
    setShowPromptInput(false);
    onSelect(id, null);
  };

  const handleCustomSubmit = () => {
    if (!customPrompt.trim()) return;
    onSelect("custom_prompt", customPrompt.trim());
    setCustomPrompt("");
    setShowPromptInput(false);
  };

  const handleClose = () => {
    setShowPromptInput(false);
    setCustomPrompt("");
    onClose();
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-[60] flex items-end justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">
                {showPromptInput ? "Describe what you want" : "Why regenerate?"}
              </h3>
              <button onClick={handleClose} className="p-1 hover:bg-secondary rounded-lg transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {showPromptInput ? (
              <div className="p-4 space-y-3">
                <textarea
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  placeholder="e.g. 'at the beach, golden hour, smiling' or 'in the kitchen cooking, casual outfit'"
                  rows={3}
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-xl bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowPromptInput(false)}
                    className="flex-1 py-2.5 rounded-2xl border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleCustomSubmit}
                    disabled={!customPrompt.trim() || isRegenerating}
                    className="flex-1 py-2.5 rounded-2xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isRegenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Generate
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="p-4 space-y-2">
                  {REASONS.map((r) => {
                    const Icon = r.icon;
                    return (
                      <button
                        key={r.id}
                        onClick={() => handleSelect(r.id)}
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
                {error && (
                  <p className="text-xs text-destructive text-center px-4 pb-2">{error}</p>
                )}
                <p className="text-[10px] text-muted-foreground/50 text-center pb-4">Your feedback helps generate a better image</p>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}