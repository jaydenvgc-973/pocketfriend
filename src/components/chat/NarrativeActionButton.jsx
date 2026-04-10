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

      const last5 = recentMessages.slice(-5).map(m => m.content || "").join(" ").toLowerCase();

      // Detect tone tier from recent messages
      const hasRomantic = /kiss|hold|closer|touch|pull|press|wrap|grip|lean|body|skin|breathe|heartbeat|forehead|cheek|waist|wrist|neck|lips|chest|hands/.test(last5);
      const hasFlirt = /flirt|tease|smile|wink|playful|tension|lingering|stare|gaze|electricity|charged|heat/.test(last5);
      const hasEmotional = /feel|hurt|cry|miss|scared|vulnerable|open|trust|honest|hard|difficult|breakdown|overwhelm|alone|together/.test(last5);
      const isNeutral = !hasRomantic && !hasFlirt && !hasEmotional;

      const friendshipLevel = character.friendship_level ?? 75;
      const romanticLevel = character.romantic_level ?? 0;
      const emotionalState = character.emotional_state || "calm";
      const location = character.resolved_current_location_name || character.city || "home";

      // Determine context tier
      let contextTier = "low";
      if (hasRomantic || (romanticLevel >= 60 && hasFlirt)) contextTier = "high";
      else if (hasFlirt || hasEmotional || romanticLevel >= 30) contextTier = "medium";

      const intentMap = {
        action: contextTier === "high"
          ? "a passionate, physically grounded action that feels earned by the buildup — pulling closer, kissing deeper, bodies meeting with intention"
          : contextTier === "medium"
          ? "a warm, emotionally charged physical action — touching their hand, guiding them closer, a brief kiss, leaning in with intention"
          : "a subtle but meaningful physical presence — stepping a little closer, a hand brushing theirs, sitting beside them, a lingering look that changes the tone",
        comfort: "a comforting, warm, caring moment — physical closeness, reassurance, or emotional support",
        flirt: "a playful, flirtatious, or romantically charged moment — subtle tension or bold intention",
        confront: "an emotionally honest confrontation — unresolved tension surfacing, a feeling being named or acted on",
        spend_time: "a quiet, present moment — just existing together, doing something simple, no agenda",
        check_in: "a genuine check-in — noticing something about the user, asking how they are, showing they care",
      };

      const tierInstructions = contextTier === "high"
        ? `CONTEXT TIER: HIGH. The conversation has clearly built toward romantic/passionate territory. Use strong physical closeness, kissing, pulling closer, hands moving with intention. Include environmental disruption (sheets shifting, papers falling, a door clicking shut). Intensify with metaphor (tidal waves, pressure against a dam, floodwater breaking through). Keep it non-explicit but immersive.`
        : contextTier === "medium"
        ? `CONTEXT TIER: MEDIUM. There is growing warmth, flirtation, or emotional openness. Use moderate physical closeness — touching a hand, guiding them in, a brief soft kiss, leaning in. Include a small environmental detail. Let the metaphor deepen the tone without overwhelming the moment.`
        : `CONTEXT TIER: LOW. The conversation is relatively neutral or just warming up. Do NOT jump to romantic or passionate actions. Use a soft, grounding action — stepping closer, a hand brushing theirs, sitting beside them, a lingering look. Let imagination do the work. Do not escalate.`;

      const prompt = `You are writing a SHORT third-person narrative scene (2-4 sentences) for ${character.name}.

CHARACTER: ${character.name}
Personality: ${character.personality_summary || "unknown"}
Emotional state: ${emotionalState}
Location: ${location}
Relationship — Friendship: ${friendshipLevel}/100, Romantic: ${romanticLevel}/100

RECENT CONVERSATION:
${recentContext || "(no recent messages)"}

${tierInstructions}

INTENT: Generate ${intentMap[intent] || intentMap.action}.

STYLE RULES:
- Third person only ("${character.name} reaches...", "He looks up...")
- ONE continuous paragraph, no double spacing, no em dashes mid-sentence
- Clearly state what the character is physically doing — do not hide action behind metaphor alone
- Include at least one grounded environmental detail (a pillow shifting, papers sliding, a chair scraping back, the couch dipping)
- After grounding the scene in action and environment, intensify with metaphor only if context tier supports it
- No dialogue (one short quoted line max)
- No explicit content — suggestive and emotionally charged is fine, imagination fills the gaps
- Fits the current location — do NOT invent new locations
- 2-4 sentences max. Tight. Cinematic. Real.
- The action must feel like the NEXT CORRECT CHAPTER, not a random scene change
- HARD BLOCK: If the recent conversation is neutral/work/daily life, do NOT write romantic or passionate content

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