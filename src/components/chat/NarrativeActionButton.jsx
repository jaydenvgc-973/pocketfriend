import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";

const COOLDOWN_SECONDS = 30;

const INTENT_OPTIONS = [
  { id: "action",     label: "Let Them Act", emoji: "🎬", description: "Natural context-driven action" },
  { id: "comfort",    label: "Comfort Me",   emoji: "🤍", description: "Warmth, closeness, care" },
  { id: "flirt",      label: "Flirt",        emoji: "✨", description: "Playful or romantic tension" },
  { id: "confront",   label: "Confront",     emoji: "⚡", description: "Tension or emotional confrontation" },
  { id: "spend_time", label: "Spend Time",   emoji: "🕰️", description: "Hang out, just be present" },
  { id: "check_in",   label: "Check In",     emoji: "💬", description: "See how you're doing" },
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

  useEffect(() => {
    if (externalTrigger) {
      setOpen(true);
      onExternalClose?.();
    }
  }, [externalTrigger]);

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

      const hasRomantic = /kiss|hold|closer|touch|pull|press|wrap|grip|lean|body|skin|breathe|heartbeat|forehead|cheek|waist|wrist|neck|lips|chest|hands/.test(last5);
      const hasFlirt = /flirt|tease|smile|wink|playful|tension|lingering|stare|gaze|electricity|charged|heat/.test(last5);
      const hasEmotional = /feel|hurt|cry|miss|scared|vulnerable|open|trust|honest|hard|difficult|breakdown|overwhelm|alone|together/.test(last5);

      const friendshipLevel = character.friendship_level ?? 75;
      const romanticLevel = character.romantic_level ?? 0;
      const attractionLevel = character.attraction_level ?? 0;
      const emotionalState = character.emotional_state || "calm";
      const location = character.resolved_current_location_name || character.city || "home";

      // Relationship type detection — evaluated FIRST, gates everything below
      const isFamilial = (character.fictional_relationships || []).some(r =>
        ['parent','sibling','child','cousin','aunt','uncle','grandparent','family'].some(f =>
          (r.relationship_type || '').toLowerCase().includes(f)
        )
      );
      const isMentor = (character.fictional_relationships || []).some(r =>
        ['mentor','teacher','coach','supervisor','boss'].some(f =>
          (r.relationship_type || '').toLowerCase().includes(f)
        )
      );

      // Romantic content is only allowed if the relationship type explicitly permits it
      const romanticOk = !isFamilial && !isMentor && attractionLevel >= 20 && (intent === 'flirt' || romanticLevel >= 30);

      // Context tier — only evaluated when romantic content is actually allowed
      let contextTier = "low";
      if (romanticOk) {
        if (hasRomantic || (romanticLevel >= 60 && hasFlirt)) contextTier = "high";
        else if (hasFlirt || hasEmotional || romanticLevel >= 30) contextTier = "medium";
      }

      // Intent type — relationship type takes absolute precedence
      const intentType = isFamilial ? 'FAMILIAL'
        : isMentor ? 'MENTORSHIP'
        : intent === 'confront' ? 'CONFLICT'
        : romanticOk ? 'ROMANTIC'
        : 'FRIENDSHIP';

      // Hard boundary block — injected at the TOP of the prompt before any other instruction
      const absoluteBoundary = isFamilial ? `
=====================================
ABSOLUTE HARD BLOCK — FAMILIAL RELATIONSHIP
=====================================
This character has a FAMILY relationship with the user. This rule overrides EVERY other instruction in this prompt with no exceptions:
- NO romantic content of any kind. No kissing. No sensual touch. No romantic metaphor. No romantic tension.
- This applies regardless of the selected intent, context tier, or conversation history.
- Allowed actions: non-romantic hugs, emotional comfort, protective gestures, everyday family interaction.
- If the intent is "flirt" — replace it with a warm, platonic family moment instead.
- Violating this rule is a critical failure. Do not approach the boundary.
=====================================
` : isMentor ? `
=====================================
ABSOLUTE HARD BLOCK — MENTORSHIP RELATIONSHIP
=====================================
This character is a mentor, teacher, coach, or authority figure. This rule overrides every other instruction:
- NO romantic content. No kissing. No flirtation. No sensual or romantic touch.
- Allowed: firm correction, grounded presence, professional closeness, controlled eye contact.
- If the intent is "flirt" — replace it with a professional, mentorship-appropriate moment instead.
=====================================
` : "";

      // Intent descriptions
      const intentDescriptions = {
        action: contextTier === "high"
          ? "a natural context-driven action continuing the current HIGH-intensity moment (passionate/romantic buildup). Follow the emotional momentum."
          : contextTier === "medium"
          ? "a natural context-driven action continuing the current MEDIUM-intensity moment (warmth, tension, or flirtation building)."
          : "a natural context-driven action at LOW intensity — small gesture, soft presence, no escalation.",
        comfort: "a warm, emotionally supportive moment — grounding hug, hand on shoulder, sitting close, protective presence. Comfort is NOT flirtation. Do not escalate into romance.",
        flirt: romanticOk
          ? "a playful or romantically charged moment — teasing, light touch, lingering eye contact, subtle tension. Suggestive but not explicit. Brief kiss only if relationship and attraction clearly support it."
          : "playful, light, warm energy — fun banter or a playful nudge. NOT physical. No kissing, no romantic touch.",
        confront: "tension and emotional confrontation — CONFLICT only, NOT romance. Step into space, block movement, grab arm non-romantically, sharpen voice, hard eye contact. Absolutely zero kissing, zero sensual touch, zero romantic metaphor.",
        spend_time: "a relaxed, low-intensity shared presence — casual togetherness, sitting nearby, walking, light environment use. No escalation. Not flirtatious, not intense.",
        check_in: "a quiet, attentive moment — noticing their mood, asking softly, gentle grounding. Observational and low-key. Do not escalate physically or emotionally.",
      };

      // Context tier instruction — overridden to neutral if relationship type blocks romance
      const tierInstruction = (isFamilial || isMentor)
        ? "CONTEXT TIER: OVERRIDDEN — relationship type enforces non-romantic content regardless of conversation history or tier."
        : contextTier === "high"
          ? "CONTEXT TIER: HIGH. Strong physical closeness, kissing, and passionate intensity are allowed. Keep it non-explicit but immersive."
          : contextTier === "medium"
          ? "CONTEXT TIER: MEDIUM. Growing warmth and emotional openness. Moderate physical closeness allowed."
          : "CONTEXT TIER: LOW. Conversation is neutral. Do not jump to romantic or passionate actions. Use a soft, grounding action only.";

      const prompt = `You are writing a SHORT third-person narrative scene (2-4 sentences) for ${character.name}.

${absoluteBoundary}
CHARACTER: ${character.name}
Personality: ${character.personality_summary || "unknown"}
Emotional state: ${emotionalState}
Location: ${location}
Relationship Type: ${intentType}
Friendship: ${friendshipLevel}/100 | Romantic: ${romanticLevel}/100 | Attraction: ${attractionLevel}/100

RECENT CONVERSATION:
${recentContext || "(no recent messages)"}

${tierInstruction}

INTENT: Generate ${intentDescriptions[intent] || intentDescriptions.action}

---
INTENT TYPE RULES (${intentType}):

${intentType === 'FAMILIAL' ? "FAMILIAL: The absolute hard block at the top of this prompt applies. No exceptions. Generate a warm, non-romantic family moment." : ""}
${intentType === 'MENTORSHIP' ? "MENTORSHIP: The absolute hard block at the top of this prompt applies. No exceptions. Generate a professional, grounded moment." : ""}
${intentType === 'CONFLICT' ? "CONFLICT: Tension and confrontation only. NOT romance. Physical actions must be non-romantic: stepping into space, blocking movement, grabbing arm to stop — not to pull close. Remove all kissing, sensual touch, and romantic metaphor." : ""}
${intentType === 'FRIENDSHIP' ? "FRIENDSHIP: Emotional closeness is fine. Touch must not be romantic in tone. Allowed: non-romantic hug, grabbing arm to stop someone, sitting shoulder-to-shoulder. Never: kissing, romantic body alignment, romantic face/waist touching." : ""}
${intentType === 'ROMANTIC' ? `ROMANTIC: Romantic and physical escalation is allowed — attraction level (${attractionLevel}/100) and relationship context support it. Scale intensity to the context tier above.` : ""}

CONSENT CHECK: If the other person shows hesitation, reduce intensity. If there is clear resistance, block escalation entirely.

---
STYLE RULES:
- Third person only ("${character.name} reaches...", "He looks up...")
- ONE continuous paragraph, no double spacing, no em dashes mid-sentence, clean punctuation
- Clearly state what the character is physically doing — metaphor intensifies the action, does NOT replace it
- 2-4 sentences max. Tight. Cinematic. Real.
- No explicit content — emotionally charged and suggestive is fine
- One short quoted line of dialogue is allowed if it fits naturally
- Include at least one grounded environmental detail specific to the actual location. Do NOT default to "sheets crumpling." Rotate from: SURFACE, OBJECTS, FABRIC, SOUND, LIGHT, MOVEMENT, TEMPERATURE, CONSTRAINT.

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
                  disabled={cooldown > 0}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-secondary/70 transition-colors text-left group disabled:opacity-40"
                >
                  <span className="text-base leading-none">{opt.emoji}</span>
                  <div>
                    <p className="text-xs font-medium text-foreground group-hover:text-primary transition-colors">{opt.label}</p>
                    <p className="text-[10px] text-muted-foreground">{opt.description}</p>
                  </div>
                </button>
              ))
            )}
            {cooldown > 0 && (
              <p className="text-[10px] text-muted-foreground text-center py-1">Cooldown: {cooldown}s</p>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}