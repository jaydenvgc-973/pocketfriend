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

      // Determine relationship context for intent gating
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
      const attractionLevel = character.attraction_level ?? 0;
      const romanticOk = !isFamilial && !isMentor && attractionLevel >= 20 && (intent === 'flirt' || contextTier !== 'low' || romanticLevel >= 30);

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

${isFamilial ? `FAMILY BOUNDARY — HARD BLOCK (HIGHEST PRIORITY): This character has a familial relationship. Romantic or sexual behavior is NEVER allowed under any circumstances. No kissing, no romantic touching, no sensual metaphor, no body-merging language. Allowed: hugs (non-romantic), emotional comfort, protective actions, everyday interaction only.` : ''}

${isMentor ? `MENTORSHIP BOUNDARY: This is a mentor/authority relationship. Romantic or flirtatious behavior is NEVER allowed. Allowed: firm correction, grounded presence, controlled eye contact, stopping someone non-intimately. Never: flirting, kissing, sensual touch, romantic metaphors.` : ''}

${intentType === 'CONFLICT' ? `CONFLICT INTENT: Generate tension, confrontation, emotional pressure. NOT romance. Actions: stepping into space, blocking movement, grabbing arm (non-romantic), sharp tone, controlled aggression. Remove all kissing, romantic touching, body-merging language, and sexual metaphor.` : ''}

${intentType === 'FRIENDSHIP' ? `FRIENDSHIP INTENT: Emotional closeness and strong connection are allowed. Physical presence is allowed. Touch must NOT be romantic in tone. Allowed: grabbing arm to stop them, non-romantic hug, sitting close, shoulder-to-shoulder, expressive gestures. Never: kissing, romantic body alignment, waist/face touching in a romantic way, romantic metaphors.` : ''}

${intentType === 'ROMANTIC' ? `ROMANTIC INTENT: Romantic and physical escalation is allowed because attraction level (${attractionLevel}/100) and relationship context support it. Scale to context tier.` : ''}

CONSENT CHECK: Before any physical escalation, evaluate whether the other person is receptive based on recent dialogue and tone.
- If both parties seem engaged and receptive → allow escalation.
- If hesitation or uncertainty is present → reduce intensity, show a mixed-intent moment where the character pauses or adjusts.
- If clear resistance is present → block escalation entirely.
Do not force actions onto a character showing discomfort. Generate a natural reaction.

---
STYLE RULES:
- Third person only ("${character.name} reaches...", "He looks up...")
- ONE continuous paragraph, no double spacing, no em dashes mid-sentence, clean punctuation
- Clearly state what the character is physically doing — metaphor must intensify the action, NOT replace it
- 2-4 sentences max. Tight. Cinematic. Real.
- The action must feel like the NEXT CORRECT CHAPTER, not a random scene change
- No explicit content — suggestive and emotionally charged is fine, imagination fills the gaps
- One short quoted line of dialogue is allowed if it fits, but not required

---
ACTION RULE:
Name the physical action clearly. The metaphor intensifies it, never replaces it.

---
ENVIRONMENT VARIATION ENGINE (ANTI-REPETITION):
Every narrative MUST include at least one grounded environmental interaction. Do NOT repeat the same environmental detail. Rotate from these categories — use 2-4 types per scene:

- SURFACE: edge of mattress dipping, pressed against dresser, counter pressing into their back, railing contact, desk edge catching movement, couch dipping
- OBJECTS: lamp flickering, phone sliding off nightstand, papers scattering, glass shifting, folded clothes slipping, folders spilling
- FABRIC: shirt pulled aside or falling, jacket pushed free, blanket dragged halfway, rug bunching underfoot
- SOUND: chair scraping floor, soft thud, machine hum underfoot, bed frame creaking, something tapping a surface, breath filling a small space
- LIGHT: window light shifting across bodies, lamp shadows, streetlights flickering through windows, mirror reflecting fragments, windows fogging
- MOVEMENT: footing shifting, balance adjusting, weight transferring unevenly, knees pressing together
- TEMPERATURE: cool surface contrast against warm bodies, night air sharpening the warmth between them
- CONSTRAINT: tight space forcing closeness, limited room leaving no hesitation

Do NOT default to "sheets crumpling" or "sheets twisting." Choose something specific to the actual location. Use 1-2 strong environment interactions and 1 subtle sensory layer.

---
ROOM TRANSITION RULE:
If the scene shifts location, show the movement (walking, guiding, pulling, leading). Never teleport characters. Each room needs at least one environmental cue. Keep momentum continuous.

---
INTENSITY BY RELATIONSHIP TYPE REFERENCE (do not copy — tone guide only):

FRIENDSHIP HIGH: He catches their arm before they can walk off, not gentle, just enough to stop them. His voice tightens as he steps closer, not invading, but not giving space either. The moment builds, grounded, like something that matters too much to let go casually.

CONFLICT HIGH: He steps in front of them, stopping their movement completely. His hand catches their arm, not rough, just enough to make them stay. His voice tightens and the air between them sharpens, like something that has been building finally refuses to stay quiet.

MENTORSHIP HIGH: He steps closer, not soft, just enough to make the point land. His voice lowers, controlled, like he expects them to listen this time. He does not reach for them, but he does not step back either. The space holds tension, but it stays exactly where it belongs.

ROMANTIC MEDIUM: He catches their hand before they can pull it back, using the contact to guide them closer until their bodies nearly meet. When he kisses them it starts brief and teasing, and the edge of the desk presses lightly against them as papers slide out of place. He does not let the space return when he pulls back.

ROMANTIC HIGH: He pulls them closer by the waist and their kiss lands soft, then deepens, his shirt falling wherever it lands without either of them looking. The edge of the mattress dips unevenly as they move, the curtains stirring from the air shifting through the room. They hold onto each other tighter, bodies aligning, finding rhythm, like something pulling them into the same current.

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