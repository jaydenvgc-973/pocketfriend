import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * StoryEventSuggestionPrompt
 *
 * Optional post-event prompt shown after a confirmed life event (housing,
 * marriage, birth) completes via the existing approval or housing modal
 * pathway. Offers to open StoryEventCreator pre-filled with the event
 * context. Reuses the existing StoryEvent creation component — no new
 * backend, classifier, listener, or polling.
 */
export default function StoryEventSuggestionPrompt({ suggestion, onAccept, onDismiss }) {
  if (!suggestion) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) onDismiss(); }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="bg-card border border-purple-500/30 rounded-2xl p-5 shadow-2xl w-full max-w-sm"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                <Star className="w-4 h-4 text-purple-400" />
              </div>
              <p className="text-sm font-semibold text-foreground">Create a Story Event?</p>
            </div>
            <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-foreground mb-1 font-medium">
            {suggestion.characterName ? `${suggestion.characterName} — ` : ''}{suggestion.title}
          </p>
          {suggestion.description && (
            <p className="text-xs text-muted-foreground/70 mb-4 leading-relaxed">{suggestion.description}</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onDismiss} className="flex-1 h-9 text-xs rounded-xl">
              Not now
            </Button>
            <Button size="sm" onClick={onAccept} className="flex-1 h-9 text-xs rounded-xl gap-1">
              <Star className="w-3.5 h-3.5" />Create Story Event
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}