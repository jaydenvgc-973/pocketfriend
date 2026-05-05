import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, X, Clock } from "lucide-react";
import { base44 } from "@/api/base44Client";

/**
 * NPC EVOLUTION TRACKER
 *
 * Watches scene messages for background NPC interactions and manages
 * the 4-level evolution system:
 *
 * Level 1 — Background NPC: unnamed role, atmosphere only, never saved
 * Level 2 — Named Temporary NPC: name detected, still not saved, no prompt
 * Level 3 — Known Contact: meaningful interaction depth, saved to CasualContact
 * Level 4 — npc_fictitious: user explicitly confirms → creates Character record
 *
 * FADE RULE: If a named NPC is not interacted with meaningfully, they fade on scene exit.
 * SAFETY: No auto-promotion. No auto-save. User must confirm Level 4.
 */

// How many meaningful exchanges before Level 4 prompt is shown
const LEVEL_4_THRESHOLD = 3;

// Name extraction: look for "my name is X", "I'm X", "call me X", "name's X"
const NAME_PATTERNS = [
  /(?:my name(?:'s|s)? is|i(?:'m| am)|call me|they call me|you can call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  /(?:i(?:'m| am))\s+([A-Z][a-z]+)/i,
  /(?:name(?:'s|s)?)\s+([A-Z][a-z]+)/i,
];

function extractNameFromText(text) {
  for (const pattern of NAME_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const name = match[1].trim();
      // Reject common false positives (pronouns, generic words)
      const REJECT = new Set(['here', 'sorry', 'not', 'just', 'fine', 'good', 'okay', 'well', 'ready', 'sure', 'afraid', 'going', 'looking', 'trying']);
      if (!REJECT.has(name.toLowerCase())) return name;
    }
  }
  return null;
}

// Is this NPC a background/venue NPC (not a real character)?
function isVenueNpc(npc) {
  return npc?.isNpc === true || npc?.id?.startsWith('npc_');
}

export default function NPCEvolutionTracker({
  messages,
  selectedNpcs = [],
  currentUser,
  locationName,
  onNpcSaved,
}) {
  // npcState: { [npcId]: { name, role, interactionCount, nameDetected, level, promptDismissed } }
  const [npcState, setNpcState] = useState({});
  const [promotionCandidate, setPromotionCandidate] = useState(null); // { npcId, name, role }
  const [isSaving, setIsSaving] = useState(false);
  const [savedConfirmation, setSavedConfirmation] = useState(null); // name of just-saved NPC
  const processedMsgIds = useRef(new Set());

  // Watch for new character messages from venue NPCs
  useEffect(() => {
    const venueSpeakers = selectedNpcs.filter(isVenueNpc);
    if (venueSpeakers.length === 0) return;

    const newMessages = messages.filter(
      m => m.sender === 'character' && !processedMsgIds.current.has(m.id)
    );
    if (newMessages.length === 0) return;

    setNpcState(prev => {
      const next = { ...prev };

      for (const msg of newMessages) {
        processedMsgIds.current.add(msg.id);

        // Find which venue NPC sent this message
        const speaker = venueSpeakers.find(
          n => n.name === msg.senderName || n.id === msg.characterId
        );
        if (!speaker) continue;

        const existing = next[speaker.id] || {
          name: speaker.name,
          role: speaker.role || null,
          interactionCount: 0,
          nameDetected: false,
          level: 1,
          promptDismissed: false,
        };

        // Level 2: Detect if NPC named themselves in this message
        const detectedName = extractNameFromText(msg.content || '');
        const updatedName = detectedName || existing.name;
        const nameDetected = existing.nameDetected || !!detectedName;

        // Increment interaction depth
        const interactionCount = existing.interactionCount + 1;

        // Determine level
        let level = existing.level;
        if (nameDetected && level < 2) level = 2;
        if (interactionCount >= 2 && nameDetected) level = 3;
        if (interactionCount >= LEVEL_4_THRESHOLD && nameDetected) level = 4;

        next[speaker.id] = {
          ...existing,
          name: updatedName,
          nameDetected,
          interactionCount,
          level,
        };
      }

      return next;
    });
  }, [messages.length]);

  // When any NPC reaches Level 4 and hasn't been prompted yet, surface the promotion prompt
  useEffect(() => {
    if (promotionCandidate) return; // already showing one

    for (const [npcId, state] of Object.entries(npcState)) {
      if (state.level >= 4 && !state.promptDismissed) {
        setPromotionCandidate({ npcId, name: state.name, role: state.role });
        return;
      }
    }
  }, [npcState]);

  const handleDismiss = (saveForLater = false) => {
    if (!promotionCandidate) return;
    setNpcState(prev => ({
      ...prev,
      [promotionCandidate.npcId]: {
        ...prev[promotionCandidate.npcId],
        promptDismissed: true,
        // If "not yet", keep level 3 — they remain a known contact but don't get saved
        level: saveForLater ? 3 : prev[promotionCandidate.npcId]?.level,
      },
    }));
    setPromotionCandidate(null);
  };

  const handleSaveAsCharacter = async () => {
    if (!promotionCandidate || !currentUser?.email) return;
    setIsSaving(true);
    try {
      await base44.functions.invoke('createNPCCharacter', {
        name: promotionCandidate.name,
        role: promotionCandidate.role,
        locationName,
        ownerEmail: currentUser.email,
        characterType: 'npc_fictitious',
        sourceContext: `Met at ${locationName}`,
      });
      setSavedConfirmation(promotionCandidate.name);
      onNpcSaved?.(promotionCandidate.name);
      setNpcState(prev => ({
        ...prev,
        [promotionCandidate.npcId]: {
          ...prev[promotionCandidate.npcId],
          level: 4,
          promptDismissed: true,
          saved: true,
        },
      }));
      setPromotionCandidate(null);
      // Clear confirmation after 3s
      setTimeout(() => setSavedConfirmation(null), 3000);
    } catch (err) {
      console.error('[NPCEvolutionTracker] Failed to save NPC:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Nothing to render if no venue NPCs are being tracked
  const hasTrackedNpcs = Object.keys(npcState).length > 0;
  if (!hasTrackedNpcs && !promotionCandidate && !savedConfirmation) return null;

  return (
    <>
      {/* Level 4 Promotion Prompt */}
      <AnimatePresence>
        {promotionCandidate && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-24 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none"
          >
            <div
              className="w-full max-w-sm bg-card border border-primary/30 rounded-2xl shadow-2xl p-4 pointer-events-auto"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <UserPlus className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {promotionCandidate.name} seems like someone who may become part of your world.
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
                      {isSaving ? "Saving..." : "Yes, save them"}
                    </button>
                    <button
                      onClick={() => handleDismiss(true)}
                      className="flex-1 py-1.5 rounded-xl bg-secondary text-muted-foreground text-xs font-medium hover:text-foreground transition-colors"
                    >
                      Not yet
                    </button>
                    <button
                      onClick={() => handleDismiss(false)}
                      className="py-1.5 px-2 rounded-xl text-muted-foreground hover:text-foreground transition-colors"
                      title="No, keep them temporary"
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

      {/* Saved confirmation toast */}
      <AnimatePresence>
        {savedConfirmation && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-24 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none"
          >
            <div className="bg-card border border-green-500/30 rounded-full px-4 py-2 shadow-lg flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
              <p className="text-xs text-foreground font-medium">{savedConfirmation} saved to your world</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}