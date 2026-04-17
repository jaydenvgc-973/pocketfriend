import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, EyeOff, X, AlertCircle, Zap } from "lucide-react";
import { base44 } from "@/api/base44Client";

export default function DeleteMemoryChoiceModal({ message, isOpen, onRemember, onForget, onCancel, onNonsense, onSleepViolation, characterId, conversationId }) {
  if (!isOpen || !message) return null;

  const preview = message.content?.trim()
    ? `"${message.content.substring(0, 80)}${message.content.length > 80 ? "…" : ""}"`
    : "(image)";

  // Correction handlers — delete the message and log the flag
  const handleNonsense = onNonsense || (async () => {
    onCancel?.();
    // Delete the message
    await base44.entities.Message.delete(message.id).catch(() => {});
    // Log correction flag (fire-and-forget)
    base44.functions.invoke('logNarrativeCorrectionFlag', {
      messageId: message.id,
      characterId,
      conversationId,
      correctionType: 'nonsense',
      narrativeContent: message.content || '(image)',
    }).catch(() => {});
  });

  const handleSleepViolation = onSleepViolation || (async () => {
    onCancel?.();
    // Delete the bad narrative
    await base44.entities.Message.delete(message.id).catch(() => {});
    
    // Generate a sleep-appropriate replacement narrative
    try {
      const sleepNarrative = await base44.integrations.Core.InvokeLLM({
        prompt: `Generate a single short sentence describing a character sleeping. Do NOT describe any actions or activities. Instead, describe: the physical state of sleep, room atmosphere, a brief dream fragment, or sensory details. Examples: "The room is cool and quiet. She sleeps deeply.", "He drifts in and out of dreams, the blankets twisted around him.", "The faint hum of the AC. Somewhere in a dream, voices fade in and out."
        
Write ONLY the sentence. No quotes, no labels. Just a vivid, brief sleep observation.`,
      });

      // Create a replacement message with the same timestamp
      await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: 'character',
        character_id: characterId,
        content: sleepNarrative?.trim() || "The room is quiet. Sleep continues.",
        is_narrative: true,
        is_read: true,
        timestamp: message.timestamp,
      }).catch(() => {});
    } catch (err) {
      console.error('[Sleep Violation] Failed to generate replacement narrative:', err.message);
    }

    // Log correction flag (fire-and-forget)
    base44.functions.invoke('logNarrativeCorrectionFlag', {
      messageId: message.id,
      characterId,
      conversationId,
      correctionType: 'sleep_violation',
      narrativeContent: message.content || '(image)',
    }).catch(() => {});
  });

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
                onClick={handleNonsense}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">This is nonsense</p>
                  <p className="text-xs text-muted-foreground">Logic failure · system learns stricter rules</p>
                </div>
              </button>

              <button
                onClick={handleSleepViolation}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 hover:bg-destructive/20 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0">
                  <Zap className="w-4 h-4 text-destructive" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Violates sleep state</p>
                  <p className="text-xs text-muted-foreground">Character was asleep · must be blocked</p>
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