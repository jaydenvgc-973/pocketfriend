import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, X, BookUser } from "lucide-react";
import { useNPCEvolutionTracker } from "@/hooks/useNPCEvolutionTracker";

/**
 * NPCEvolutionTracker — UI-only component.
 *
 * All logic lives in hooks/useNPCEvolutionTracker.js.
 * This component only renders prompts/modals and wires user actions back to the hook.
 *
 * Scene page contract:
 *   <NPCEvolutionTracker
 *     messages={messages}
 *     selectedNpcs={selectedNpcs}
 *     currentUser={currentUser}
 *     locationName={location.name}
 *     onNpcSaved={(name) => { ... }}
 *   />
 */
export default function NPCEvolutionTracker({ messages, selectedNpcs, currentUser, locationName, onNpcSaved }) {
  const {
    npcState,
    promotionCandidate,
    duplicateResolution,
    casualContactCandidate,
    isSaving,
    savedConfirmation,
    processMessages,
    maybeShowPromotionPrompt,
    handleRememberIntent,
    resolveCasualContactDuplicate,
    handleSaveAsCharacter,
    resolveCharacterDuplicate,
    dismissPromotionPrompt,
  } = useNPCEvolutionTracker({ messages, selectedNpcs, currentUser, locationName });

  // Process new messages whenever the messages array grows
  useEffect(() => {
    processMessages();
  }, [messages.length]);

  // Check whether a Level 4 promotion prompt should surface
  useEffect(() => {
    maybeShowPromotionPrompt();
  }, [npcState]);

  // Notify parent when a save completes
  useEffect(() => {
    if (savedConfirmation) onNpcSaved?.(savedConfirmation);
  }, [savedConfirmation]);

  // Nothing visible to render if no prompts are active
  const hasAnything = promotionCandidate || duplicateResolution || casualContactCandidate || savedConfirmation;
  if (!hasAnything) return null;

  return (
    <>
      {/* ── LEVEL 4: SAVE AS CHARACTER PROMPT ─────────────────────────────── */}
      <AnimatePresence>
        {promotionCandidate && !duplicateResolution && (
          <motion.div
            key="promotion-prompt"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-24 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none"
          >
            <div className="w-full max-w-sm bg-card border border-primary/30 rounded-2xl shadow-2xl p-4 pointer-events-auto">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <UserPlus className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {promotionCandidate.name} seems like someone who could be part of your world.
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Do you want to save them as a character?
                  </p>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={handleSaveAsCharacter}
                      disabled={isSaving}
                      className="flex-1 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {isSaving ? "Checking..." : "Yes, save them"}
                    </button>
                    <button
                      onClick={dismissPromotionPrompt}
                      className="flex-1 py-1.5 rounded-xl bg-secondary text-muted-foreground text-xs font-medium hover:text-foreground transition-colors"
                    >
                      Not now
                    </button>
                    <button
                      onClick={dismissPromotionPrompt}
                      className="py-1.5 px-2 rounded-xl text-muted-foreground hover:text-foreground transition-colors"
                      title="Dismiss"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── DUPLICATE CHARACTER RESOLUTION MODAL ──────────────────────────── */}
      <AnimatePresence>
        {duplicateResolution?.mode === 'character' && (
          <motion.div
            key="char-duplicate-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-24 bg-black/40 pointer-events-auto"
          >
            <motion.div
              initial={{ y: 40 }}
              animate={{ y: 0 }}
              exit={{ y: 40 }}
              className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-4"
            >
              <p className="text-sm font-semibold text-foreground">
                You already have a character named "{duplicateResolution.name}".
              </p>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                Is this the same person, or someone new?
              </p>
              {duplicateResolution.existingMatches.slice(0, 2).map(m => (
                <div key={m.id} className="text-xs text-muted-foreground bg-secondary px-3 py-1.5 rounded-lg mb-2">
                  {m.label}{m.context ? ` — ${m.context}` : ''}
                </div>
              ))}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => resolveCharacterDuplicate('same')}
                  className="flex-1 py-1.5 rounded-xl bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
                >
                  Same person
                </button>
                <button
                  onClick={() => resolveCharacterDuplicate('new')}
                  className="flex-1 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
                >
                  New person
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── CASUALCONTACT DUPLICATE RESOLUTION MODAL ──────────────────────── */}
      <AnimatePresence>
        {casualContactCandidate && (
          <motion.div
            key="contact-duplicate-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center px-4 pb-24 bg-black/40 pointer-events-auto"
          >
            <motion.div
              initial={{ y: 40 }}
              animate={{ y: 0 }}
              exit={{ y: 40 }}
              className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <BookUser className="w-4 h-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">
                  You might already know a "{casualContactCandidate.name}".
                </p>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Is this the same person or someone new?
              </p>
              {casualContactCandidate.existingMatches.slice(0, 2).map(m => (
                <div key={m.id} className="text-xs text-muted-foreground bg-secondary px-3 py-1.5 rounded-lg mb-2">
                  {m.label}{m.context ? ` — ${m.context}` : ''}
                </div>
              ))}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => resolveCasualContactDuplicate('same')}
                  className="flex-1 py-1.5 rounded-xl bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
                >
                  Same person
                </button>
                <button
                  onClick={() => resolveCasualContactDuplicate('new')}
                  className="flex-1 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
                >
                  New person
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── SAVED CONFIRMATION TOAST ───────────────────────────────────────── */}
      <AnimatePresence>
        {savedConfirmation && !promotionCandidate && !duplicateResolution && !casualContactCandidate && (
          <motion.div
            key="saved-toast"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-24 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none"
          >
            <div className="bg-card border border-green-500/30 rounded-full px-4 py-2 shadow-lg flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
              <p className="text-xs text-foreground font-medium">{savedConfirmation}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}