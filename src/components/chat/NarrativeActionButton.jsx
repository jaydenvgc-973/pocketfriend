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

---
STYLE RULES:
- Third person only ("${character.name} reaches...", "He looks up...")
- ONE continuous paragraph, no double spacing, no em dashes mid-sentence, clean punctuation
- Clearly state what the character is physically doing — metaphor must intensify the action, NOT replace it
- 2-4 sentences max. Tight. Cinematic. Real.
- The action must feel like the NEXT CORRECT CHAPTER, not a random scene change
- HARD BLOCK: If the recent conversation is neutral/work/daily life, do NOT write romantic or passionate content
- No explicit content — suggestive and emotionally charged is fine, imagination fills the gaps
- One short quoted line of dialogue is allowed if it fits, but not required

---
ACTION RULE:
The narrative must clearly name what the character is physically doing. Examples: pulling them closer, touching their face, holding them, gripping their wrist gently, guiding them by the waist, kissing, resting their forehead against theirs, brushing fingers along their arm or back, sitting down together, wrapping arms around each other. The metaphor must intensify the action, never replace it.

---
ENVIRONMENT VARIATION ENGINE (ANTI-REPETITION):
Every narrative MUST include at least one grounded environmental interaction. You MUST NOT repeat the same environmental detail across scenes. Rotate from the following categories — use 2-4 different category types per scene, never just one:

- SURFACE: edge of mattress dipping, pressed against dresser, counter pressing into their back, railing contact, desk edge catching movement, couch dipping, leaning into headboard
- OBJECTS: lamp flickering, phone sliding off nightstand, papers scattering, pen rolling off desk, glass shifting on table, folded clothes slipping, detergent shifting, folders spilling
- FABRIC: shirt pulled aside or falling, jacket pushed free, blanket dragged halfway, rug bunching underfoot, fabric stretching
- SOUND: chair scraping floor, soft thud on carpet, machine hum underfoot, bed frame creaking, footsteps going quiet, something tapping a surface, breath filling a small space
- LIGHT: window light shifting across bodies, lamp casting uneven shadows, streetlights flickering through windows, mirror reflecting movement in fragments, overhead light humming, windows fogging from inside
- MOVEMENT: footing shifting, balance adjusting toward the other person, weight transferring unevenly, knees pressing together
- TEMPERATURE: cool surface contrast against warm bodies, night air sharpening the warmth between them
- CONSTRAINT: tight space forcing closeness, limited room leaving no hesitation, open space making the moment pull inward

Do NOT overload the scene. Use 1-2 strong environment interactions and 1 subtle sensory layer. Do not default to "sheets crumpling" or "sheets twisting" — these are overused. Choose something physically specific to the actual current location.

---
ROOM TRANSITION RULE:
If the scene shifts location mid-narrative, characters CANNOT teleport. Movement between rooms must be shown: walking, guiding, pulling, leading, following, shifting together through space. Each room must have at least one environmental cue. Movement must feel like part of the moment — not a pause or scene break. Keep momentum continuous.

EXAMPLE (correct): He pulls them off the couch, their feet catching slightly on the rug as he guides them back into the hallway where the space tightens, then into the bedroom where the edge of the bed meets them before they stop.
EXAMPLE (wrong): They were suddenly in the bedroom.

---
STYLE REFERENCE EXAMPLES (do not copy — use as tone guide only):

LOW: He does not interrupt the flow of the conversation. He just steps a little closer, close enough that the tone changes without either of them having to name it. His hand brushes theirs for a second, light and almost absentminded, but it lingers just long enough to feel intentional. The room stays quiet around them, the kind of quiet that settles when something small shifts and both people notice it.

LOW-MEDIUM: He looks at them a second longer than usual, then closes the distance by half a step, not enough to overwhelm the moment, just enough to change it. His fingers graze their wrist before settling there properly, warm and certain, and when he speaks again it is softer than before. Something on the table beside them shifts when he leans in, barely enough to matter, but it makes the air feel smaller.

MEDIUM (comfort): He reaches for them without making a performance out of it, one hand settling at their side as he pulls them into him. Their bodies settle against each other and the couch dips under the added weight, his hand moving once along their back in a quiet rhythm that says more than any line of dialogue could.

MEDIUM (flirt): He catches their hand before they can pull it back, using the contact to guide them closer until their bodies nearly meet. When he kisses them it starts brief and teasing, and the edge of the desk presses lightly against them as papers slide out of place behind the movement. He does not let the space return when he pulls back.

HIGH (bedroom, varied): He pulls them closer by the waist and their kiss lands soft, then deepens, and somewhere in it he pushes his shirt up and off without looking. The edge of the mattress dips unevenly as they move, the curtains stirring slightly from the air shifting through the room. They hold onto each other tighter after that, bodies aligning, finding rhythm, like something pulling them into the same current.

HIGH (dresser/mirror): He turns with them, guiding them back until they meet the edge of the dresser, the surface pressing into their lower back. The mirror behind them catches just enough of the movement to reflect it back in fragments. Something small rattles on the dresser top before settling, and the moment keeps building, their bodies pressing together like waves folding into each other.

HIGH (kitchen): He pulls them toward him near the counter and the shift presses them lightly against it, the surface cool against their back in contrast to everything building between them. A utensil shifts somewhere behind them, metal tapping softly before settling. They kiss, deeper now, his hand sliding along their side, the overhead light humming steadily while everything beneath it feels anything but.

HIGH (car): He leans across the seat, pulling them closer until the limited space leaves no room for hesitation. Their knees press together, the seat creaking slightly under the movement, and the windows begin to fog faintly, softening the outside world into something distant. Inside, everything feels contained, like a storm building quietly in a place that does not have room to release it.

HIGH (office): He turns them toward the desk in one smooth motion and papers slide loose the second their bodies meet the edge. The chair rolls back behind them with a soft scrape, a stack of folders tipping sideways and spilling to the floor forgotten. The tension between them rises like pressure against a dam until it feels as if the whole space is holding its breath.

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