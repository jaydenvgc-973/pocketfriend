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

      // Relationship type detection — these are HARD gates
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

      // Romantic content is only permitted when neither familial nor mentor, and attraction supports it
      const romanticOk = !isFamilial && !isMentor && attractionLevel >= 20 && (intent === 'flirt' || romanticLevel >= 30);

      // Context tier only meaningful for romantic-eligible relationships
      let contextTier = "low";
      if (romanticOk) {
        if (hasRomantic || (romanticLevel >= 60 && hasFlirt)) contextTier = "high";
        else if (hasFlirt || hasEmotional || romanticLevel >= 30) contextTier = "medium";
      }

      // Determine top-level intent classification
      const intentType = isFamilial ? 'FAMILIAL'
        : isMentor ? 'MENTORSHIP'
        : intent === 'confront' ? 'CONFLICT'
        : romanticOk ? 'ROMANTIC'
        : 'FRIENDSHIP';

      // Hard boundary block — placed at the very top of the prompt for maximum enforcement
      let hardBoundary = "";
      if (isFamilial) {
        hardBoundary = `
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!! ABSOLUTE HARD BLOCK — FAMILIAL RELATIONSHIP      !!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
This character has a FAMILY relationship with the user.
This rule OVERRIDES every other instruction in this prompt, including intent, context tier, and conversation history.

PROHIBITED — no exceptions, no approximations, no "subtle" versions:
- Romantic content of ANY kind
- Kissing, romantic touching, sensual metaphor, romantic tension
- Physical closeness that reads as romantic
- Flirting, suggestive language, or charged atmosphere

ALLOWED:
- Non-romantic hugs, emotional comfort, protective gestures
- Sibling/parent/family-appropriate everyday interactions
- Warm, caring, platonic presence

If the chosen intent was "flirt" — generate a warm platonic moment instead.
Any violation of this boundary is a critical generation error.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
`;
      } else if (isMentor) {
        hardBoundary = `
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!! ABSOLUTE HARD BLOCK — MENTORSHIP RELATIONSHIP    !!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
This character is a mentor, teacher, coach, or authority figure.
This rule OVERRIDES every other instruction in this prompt.

PROHIBITED — no exceptions:
- Romantic content, kissing, flirtation, sensual touch
- Romantic tension or charged atmosphere of any kind

ALLOWED:
- Firm correction, grounded authority, controlled eye contact
- Professional closeness, encouragement, coaching presence

If the chosen intent was "flirt" — generate a grounded professional moment instead.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
`;
      }

      // Intent action descriptions
      const intentDescriptions = {
        action: contextTier === "high"
          ? "a natural context-driven action following HIGH emotional momentum (passionate/romantic buildup)"
          : contextTier === "medium"
          ? "a natural context-driven action following MEDIUM emotional momentum (warmth or flirtation building)"
          : "a natural context-driven action with LOW emotional momentum — small gesture, light presence, no escalation",
        comfort: "a warm, emotionally supportive moment — grounding hug, hand on shoulder, sitting close, protective presence. Comfort is NOT flirtation. Do not escalate into romance.",
        flirt: romanticOk
          ? "a playful or romantically charged moment — teasing, light touch, lingering eye contact, subtle tension. Brief kiss only if relationship and attraction support it."
          : "playful warm energy — fun and light but NOT physical. No kissing or romantic touch.",
        confront: "CONFLICT — tension, confrontation, emotional pressure. NOT romance. Actions: stepping into space, blocking movement, grabbing arm non-romantically, sharp tone. Absolutely NO kissing, romantic touching, or sensual metaphor.",
        spend_time: "a relaxed, low-intensity shared presence — casual interaction, sitting together, walking. Do NOT escalate. This is not flirtation, conflict, or intense emotion.",
        check_in: "an attentive, emotionally aware moment — noticing their mood, asking quietly, soft tone. Observational, not action-heavy. Do NOT escalate physically.",
      };

      // Context tier instruction
      const tierInstruction = (isFamilial || isMentor)
        ? "CONTEXT TIER: IGNORED — relationship type enforces non-romantic content regardless of conversation history."
        : contextTier === "high"
          ? "CONTEXT TIER: HIGH — strong physical closeness, kissing, pulling closer allowed. Keep non-explicit but immersive."
          : contextTier === "medium"
          ? "CONTEXT TIER: MEDIUM — moderate physical closeness allowed. Let metaphor deepen the tone."
          : "CONTEXT TIER: LOW — do NOT jump to romantic or passionate actions. Use soft, grounding actions only.";

      // Intent type enforcement rules
      const intentEnforcement = {
        CONFLICT: "Generate tension and confrontation — NOT romance. Stepping into space, blocking movement, grabbing arm non-romantically, sharp tone, controlled aggression. NO kissing, romantic touch, or sensual metaphor.",
        FRIENDSHIP: "Emotional closeness is fine. Touch must NOT be romantic. Allowed: non-romantic hug, sitting close, shoulder contact, grabbing arm to stop them. Never: kissing, romantic body alignment, romantic face/waist touching.",
        ROMANTIC: `Romantic and physical escalation is allowed — attraction (${attractionLevel}/100) and relationship support it. Scale intensity to context tier.`,
        FAMILIAL: "See ABSOLUTE HARD BLOCK above. No exceptions whatsoever.",
        MENTORSHIP: "See ABSOLUTE HARD BLOCK above. No exceptions whatsoever.",
      };

      const prompt = `${hardBoundary}
You are writing a SHORT third-person narrative scene (2-4 sentences) for ${character.name}.

CHARACTER: ${character.name}
Personality: ${character.personality_summary || "unknown"}
Emotional state: ${emotionalState}
Location: ${location}
Relationship type: ${intentType}
Friendship: ${friendshipLevel}/100 | Romantic: ${romanticLevel}/100 | Attraction: ${attractionLevel}/100

RECENT CONVERSATION:
${recentContext || "(no recent messages)"}

${tierInstruction}

INTENT: Generate ${intentDescriptions[intent] || intentDescriptions.action}

INTENT TYPE — ${intentType}:
${intentEnforcement[intentType] || ""}

CONSENT CHECK: If the other person shows hesitation → reduce intensity. If clear resistance → block escalation entirely.

STYLE RULES:
- Third person only ("${character.name} reaches...", "He looks up...")
- ONE continuous paragraph, clean punctuation, no em dashes mid-sentence
- State what the character is physically doing — metaphor intensifies action, does NOT replace it
- 2-4 sentences max. Tight. Cinematic. Real.
- No explicit content — suggestive and emotionally charged is fine
- One short quoted line of dialogue allowed if it fits naturally
- Include one grounded environmental detail specific to the actual location. Rotate from: SURFACE, OBJECTS, FABRIC, SOUND, LIGHT, MOVEMENT, TEMPERATURE, CONSTRAINT. Do NOT default to "sheets crumpling."

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