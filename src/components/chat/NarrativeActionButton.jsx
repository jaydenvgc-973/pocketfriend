import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";

const COOLDOWN_SECONDS = 30;

const INTENT_OPTIONS = [
  { id: "action",       label: "Let Them Act",   emoji: "🎬", description: "Natural context-driven action" },
  { id: "comfort",      label: "Comfort Me",     emoji: "🤍", description: "Warmth, closeness, care" },
  { id: "flirt",        label: "Flirt",          emoji: "✨", description: "Playful or romantic tension" },
  { id: "confront",     label: "Confront",       emoji: "⚡", description: "Tension or emotional confrontation" },
  { id: "spend_time",   label: "Spend Time",     emoji: "🕰️", description: "Hang out, just be present" },
  { id: "check_in",     label: "Check In",       emoji: "💬", description: "See how you're doing" },
];

export default function NarrativeActionButton({
  character,
  conversationId,
  recentMessages = [],
  onNarrativeCreated,
  externalTrigger,
  onExternalClose,
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef(null);

  // Open when triggered externally
  useEffect(() => {
    if (externalTrigger) {
      setOpen(true);
      onExternalClose?.();
    }
  }, [externalTrigger]);

  // Close and clean up on unmount
  useEffect(() => {
    return () => {
      setOpen(false);
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(COOLDOWN_SECONDS);
    cooldownRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const triggerNarrative = async (intent) => {
    if (!character || !conversationId || loading || cooldown > 0) return;
    setOpen(false);
    setLoading(true);

    try {
      const recentContext = recentMessages.slice(-10).map(m =>
        `${m.sender_type === "user" ? "User" : character.name}: ${m.content || "(image)"}`
      ).join("\n");

      const intentMap = {
        action:     "a natural, context-driven action that fits the current moment — whatever feels most authentic given the situation",
        comfort:    "a comforting, warm, caring moment — physical closeness, reassurance, or emotional support",
        flirt:      "a playful, flirtatious, or romantically charged moment — subtle tension or bold intention",
        confront:   "an emotionally honest confrontation — unresolved tension surfacing, a feeling being named or acted on",
        spend_time: "a quiet, present moment — just existing together, doing something simple, no agenda",
        check_in:   "a genuine check-in — noticing something about the user, asking how they are, showing they care",
      };

      const prompt = `You are writing a SHORT third-person narrative scene (2-4 sentences) for ${character.name}.

CHARACTER: ${character.name}
Personality: ${character.personality_summary || "unknown"}
Emotional state: ${character.emotional_state || "calm"}
Location: ${character.resolved_current_location_name || character.city || "home"}
Relationship to user — Friendship: ${character.friendship_level ?? 75}/100, Romantic: ${character.romantic_level ?? 0}/100

RECENT CONVERSATION:
${recentContext || "(no recent messages)"}

INTENT: Generate ${intentMap[intent] || intentMap.action}.

STRICT RULES:
- Third person only ("${character.name} reaches...", "She looks up...")
- Physically grounded — describe posture, movement, proximity, sensation
- NO dialogue (character may say ONE short line max, in quotes)
- NO explicit content — suggestive and emotionally charged is fine
- Fits the current location — do NOT invent new locations
- 2-4 sentences max. Tight. Cinematic. Real.
- Do NOT be random. This must feel earned by the context above.

Return ONLY the narrative text. No labels, no JSON, no extra commentary.`;

      const result = await base44.integrations.Core.InvokeLLM({ prompt });

      if (!result || typeof result !== "string" || result.trim().length < 10) {
        throw new Error("Empty narrative returned");
      }

      const narrativeMsg = await base44.entities.Message.create({
        conversation_id: conversationId,
        sender_type: "character",
        character_id: character.id,
        character_name: character.name,
        content: result.trim(),
        is_narrative: true,
        is_read: true,
        timestamp: new Date().toISOString(),
      });

      await base44.entities.Conversation.update(conversationId, {
        last_message_preview: `✦ ${result.trim().substring(0, 80)}...`,
        last_message_date: new Date().toISOString(),
      }).catch(() => {});

      onNarrativeCreated?.(narrativeMsg);
      startCooldown();
    } catch (err) {
      console.error("[NarrativeButton] Failed:", err.message);
    } finally {
      setLoading(false);
    }
  };

  // Render nothing into the DOM flow — only a portal overlay when open
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-[200] bg-black/40" onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-[100px] left-1/2 -translate-x-1/2 z-[201] bg-card border border-border rounded-2xl shadow-2xl p-2 w-[min(260px,90vw)] max-h-[calc(100vh-160px)] overflow-y-auto"
          >
            <p className="text-[10px] text-muted-foreground px-2 pb-1.5 uppercase tracking-wider font-medium">
              What should they do?
            </p>
            {loading ? (
              <p className="text-xs text-muted-foreground px-2 py-3 text-center">Generating…</p>
            ) : (
              INTENT_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => triggerNarrative(opt.id)}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-secondary/70 transition-colors text-left group"
                >
                  <span className="text-base leading-none">{opt.emoji}</span>
                  <div>
                    <p className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground">{opt.description}</p>
                  </div>
                </button>
              ))
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}