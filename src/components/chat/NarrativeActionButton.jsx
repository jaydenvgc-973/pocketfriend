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

      // Context tier
      let contextTier = "low";
      if (hasRomantic || (romanticLevel >= 60 && hasFlirt)) contextTier = "high";
      else if (hasFlirt || hasEmotional || romanticLevel >= 30) contextTier = "medium";

      // Relationship gating
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
      const romanticOk = !isFamilial && !isMentor && attractionLevel >= 20 && (intent === 'flirt' || contextTier !== 'low' || romanticLevel >= 30);

      // Intent descriptions (per-button locked behavior)
      const intentMap = {
        action: contextTier === "high"
          ? "a natural context-driven action that continues the current moment — follow the emotional momentum, which is currently HIGH (passionate/romantic buildup)"
          : contextTier === "medium"
          ? "a natural context-driven action that continues the current moment — follow the emotional momentum, which is currently MEDIUM (warmth, tension, or flirtation building)"
          : "a natural context-driven action that continues the current moment — follow the emotional momentum, which is currently LOW (neutral or just warming up). Small presence, light gesture, no escalation.",
        comfort: "a warm, emotionally supportive moment — physical comfort like a grounding hug, hand on shoulder, sitting close, protective presence. Comfort is NOT flirtation. Do not escalate into romance unless attraction is very high and context already supports it.",
        flirt: romanticOk
          ? "a playful or romantically charged moment — teasing, light touch, lingering eye contact, subtle tension. Suggestive but not explicit. Brief kiss only if relationship and attraction support it."
          : "playful light energy — keep it fun and warm but NOT physical. No kissing or romantic touch since attraction level does not yet support it.",
        confront: "tension, confrontation, and emotional pressure — this is CONFLICT, NOT romance. Step closer to challenge, block movement, grab arm non-romantically, tighten voice, sharp eye contact. Remove all kissing, romantic touching, and sensual metaphor entirely.",
        spend_time: "a relaxed, low-intensity shared presence — casual interaction, sitting together, walking, light environment use. Do NOT escalate. This is not flirtation, conflict, or intense emotional scenes.",
        check_in: "an attentive, observant, emotionally aware moment — noticing their mood, asking quietly, soft tone, slight physical grounding. Observational, not action-heavy. Do NOT escalate physically or jump into intensity.",
      };

      // Tier instructions
      const tierInstructions = contextTier === "high"
        ? `CONTEXT TIER: HIGH. The conversation has clearly built toward romantic/passionate territory. Use strong physical closeness, kissing, pulling closer, hands moving with intention. Include environmental disruption. Intensify with metaphor. Keep it non-explicit but immersive.`
        : contextTier === "medium"
        ? `CONTEXT TIER: MEDIUM. There is growing warmth, flirtation, or emotional openness. Use moderate physical closeness. Include a small environmental detail. Let the metaphor deepen the tone.`
        : `CONTEXT TIER: LOW. The conversation is relatively neutral or just warming up. Do NOT jump to romantic or passionate actions. Use a soft, grounding action. Let imagination do the work.`;

      // Intent type classification
      const intentTypeMap = {
        action: romanticOk ? 'ROMANTIC' : 'FRIENDSHIP',
        comfort: 'FRIENDSHIP',
        flirt: romanticOk ? 'ROMANTIC' : 'FRIENDSHIP',
        confront: 'CONFLICT',
        spend_time: 'FRIENDSHIP',
        check_in: 'FRIENDSHIP',
      };
      const intentType = isFamilial ? 'FAMILIAL' : isMentor ? 'MENTORSHIP' : (intentTypeMap[intent] || 'FRIENDSHIP');

      const prompt = `You are writing a SHORT third-person narrative scene (2-4 sentences) for ${character.name}.

CHARACTER: ${character.name}
Personality: ${character.personality_summary || "unknown"}
Emotional state: ${emotionalState}
Location: ${location}
Relationship — Friendship: ${friendshipLevel}/100, Romantic: ${romanticLevel}/100, Attraction: ${attractionLevel}/100

RECENT CONVERSATION:
${recentContext || "(no recent messages)"}

${tierInstructions}

INTENT: Generate ${intentMap[intent] || intentMap.action}.

---
🔴 INTENT TYPE: ${intentType}

BEFORE WRITING, enforce these rules:

INTENSITY ≠ ROMANCE. Intensity describes emotional energy. Relationship type determines how it is expressed.

${isFamilial ? `FAMILY BOUNDARY — HARD BLOCK: This character has a familial relationship. Romantic or sexual behavior is NEVER allowed. No kissing, no romantic touching, no sensual metaphor. Allowed: non-romantic hugs, emotional comfort, protective actions, everyday interaction only.` : ''}

${isMentor ? `MENTORSHIP BOUNDARY: This is a mentor/authority relationship. Romantic or flirtatious behavior is NEVER allowed. Allowed: firm correction, grounded presence, controlled eye contact. Never: flirting, kissing, sensual touch, romantic metaphors.` : ''}

${intentType === 'CONFLICT' ? `CONFLICT INTENT: Generate tension, confrontation, emotional pressure. NOT romance. Actions: stepping into space, blocking movement, grabbing arm (non-romantic), sharp tone, controlled aggression. Remove all kissing, romantic touching, and sensual metaphor.` : ''}

${intentType === 'FRIENDSHIP' ? `FRIENDSHIP INTENT: Emotional closeness is allowed. Touch must NOT be romantic in tone. Allowed: grabbing arm to stop them, non-romantic hug, sitting close, shoulder-to-shoulder. Never: kissing, romantic body alignment, waist/face touching in a romantic way.` : ''}

${intentType === 'ROMANTIC' ? `ROMANTIC INTENT: Romantic and physical escalation is allowed because attraction level (${attractionLevel}/100) and relationship context support it. Scale to context tier.` : ''}

CONSENT CHECK: Before any physical escalation, evaluate whether the other person is receptive.
- Both engaged and receptive → allow escalation.
- Hesitation present → reduce intensity, show a mixed moment.
- Clear resistance → block escalation entirely.

---
STYLE RULES:
- Third person only ("${character.name} reaches...", "He looks up...")
- ONE continuous paragraph, no double spacing, no em dashes mid-sentence, clean punctuation
- Clearly state what the character is physically doing — metaphor must intensify the action, NOT replace it
- 2-4 sentences max. Tight. Cinematic. Real.
- No explicit content — suggestive and emotionally charged is fine
- One short quoted line of dialogue is allowed if it fits, but not required

ENVIRONMENT VARIATION ENGINE (ANTI-REPETITION):
Every narrative MUST include at least one grounded environmental interaction. Do NOT repeat the same environmental detail. Rotate from: SURFACE, OBJECTS, FABRIC, SOUND, LIGHT, MOVEMENT, TEMPERATURE, CONSTRAINT.
Do NOT default to "sheets crumpling." Choose something specific to the actual location.

ROOM TRANSITION RULE:
If the scene shifts location, show the movement. Never teleport characters.

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