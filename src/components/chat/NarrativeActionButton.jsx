import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { buildStyleMotifContext } from "@/lib/narrativeScenarioExamples";
import { buildExtendedNarrativeExampleContext } from "@/lib/narrativeScenarioExamplesExtended";

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
  userSettings = null,
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef(null);

  useEffect(() => {
    if (externalTrigger) {
      setOpen(true);
    } else {
      setOpen(false);
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
    onExternalClose?.();
    setLoading(true);

    try {
      // ── CONTEXT RETRIEVAL — THREE MOST RECENT ENTRIES ARE AUTHORITATIVE ──────
      // The three most recent chronological conversation entries (messages OR
      // narratives, regardless of which Action category generated them) establish
      // the immediate conversational context. The selected Action determines the
      // TYPE of narrative to generate, NOT which previous conversation to
      // continue from. Older history must never override the latest conversation.

      // Recent window — the current conversation slice
      const recentWindow = recentMessages.slice(-15);

      const recentContext = recentWindow.map(m =>
        `${m.sender_type === "user" ? "User" : character.name}: ${m.content || "(image)"}`
      ).join("\n");

      // THREE MOST RECENT CHRONOLOGICAL ENTRIES — the immediate conversation state.
      // These may be ordinary text messages, character responses, user messages,
      // or previously generated narratives. They are interpreted together in
      // their actual conversational order regardless of type or category.
      const threeMostRecent = recentWindow.slice(-3);

      const currentMomentBlock = threeMostRecent.length > 0
        ? `\n\n════════════════════════════════════
CURRENT MOMENT — THREE MOST RECENT ENTRIES (AUTHORITATIVE — CONTINUE FROM HERE)
These are the three most recent chronological conversation entries on this page.
They may be messages, character responses, or narratives from ANY Action category.
The new narrative MUST begin from the state these entries establish RIGHT NOW.

DO NOT continue from any older scene, narrative, or situation.
DO NOT retrieve an earlier same-category narrative and resume that scene.
DO NOT ignore these entries in favor of older history.
════════════════════════════════════
${threeMostRecent.map((m, i) => {
  const label = m.sender_type === "user" ? "User" : character.name;
  const typeTag = m.is_narrative ? " [narrative]" : "";
  return `ENTRY ${i + 1}${typeTag}: ${label}: "${(m.content || "(image)").substring(0, 250)}"`;
}).join("\n")}
════════════════════════════════════`
        : "";

      // Extract recent narrative blocks ONLY from the current conversation window.
      // Previously this pulled from the full recentMessages array, which could
      // include narratives from days ago — causing the LLM to resume an outdated
      // scene instead of the current conversation. Now restricted to recentWindow.
      const allRecentNarratives = recentWindow
        .filter(m => m.is_narrative && m.sender_type === "character" && m.content?.trim())
        .slice(-6);
      
      const recentActionNarratives = allRecentNarratives
        .slice(-3)
        .map(m => m.content)
        .join("\n---\n");
      
      const narrativeContinuityBlock = allRecentNarratives.length > 0
        ? `\n\n════════════════════════════════════
NARRATIVE CONTINUITY — BEATS FROM THE CURRENT CONVERSATION (read before generating)
These narrative beats already happened WITHIN the current conversation window.
DO NOT repeat or contradict them. Continue FROM the emotional/physical state
they left the scene in. If the CURRENT MOMENT entries above conflict with these
beats, the CURRENT MOMENT entries take priority — they are more recent.
════════════════════════════════════
${allRecentNarratives.map((m, i) => `BEAT ${i + 1}:\n"${m.content}"`).join("\n\n")}

CONTINUATION RULES:
• The above beats are ALREADY IN CANON. They happened.
• Do NOT restate, re-describe, or reset them.
• Continue from the CURRENT emotional/physical state they established.
• If the last beat established tension — maintain or escalate it, do not suddenly reset to calm.
• If the last beat established calm — do not suddenly inject unearned drama.
• If the last beat ended with a physical action — begin from AFTER that action resolves.
• These beats are from the CURRENT conversation only. Do NOT retrieve or resume
  scenes from older conversations, earlier days, or different locations.
════════════════════════════════════`
        : "";

      const actionMemory = recentActionNarratives 
        ? `\nRECENT ACTIONS TO AVOID REPEATING:\n${recentActionNarratives}\n\nDo NOT start with the same action or gesture as above. Choose a completely different approach.`
        : "";

      // ── USER PRESENCE TRUTH BLOCK ─────────────────────────────────────────
      // Determine if the user is physically co-present with the character or remote.
      const userLocationId = userSettings?.user_current_location_id || null;
      const userPresenceStatus = userSettings?.user_presence_status || 'away';
      const charLocationId = character.resolved_current_location_id || null;
      const userIsCoPresent = !!(
        userPresenceStatus === 'present' &&
        userLocationId &&
        charLocationId &&
        userLocationId === charLocationId
      );

      const userWorldName = userSettings?.fictional_world_name || 'the user';

      const userPresenceBlock = userIsCoPresent
        ? `\n\n════════════════════════════════════
USER PRESENCE — PHYSICALLY CO-PRESENT
════════════════════════════════════
"${userWorldName}" is currently AT THE SAME LOCATION as ${character.name}.
Physical co-presence IS confirmed. The following are ALLOWED:
• ${character.name} can look at, react to, or physically interact with ${userWorldName}
• Shared environmental experience (both in the same space)
• Eye contact, handing objects, physical proximity descriptions
════════════════════════════════════`
        : `\n\n════════════════════════════════════
USER PRESENCE — REMOTE / NOT CO-PRESENT
════════════════════════════════════
"${userWorldName}" is NOT physically present with ${character.name} right now.
This is a TEXT/PHONE interaction — the user is remote.

ABSOLUTE PROHIBITIONS — these are generation errors:
✗ "${character.name} glanced over at you"
✗ "You sat together" / "You stood beside him/her"
✗ "He/She watched you leave"
✗ "You could feel the tension between you"
✗ Any description implying the user is in the same physical space

ALLOWED — remote-only framing:
✓ ${character.name} thinking about the user / missing the user
✓ Referencing a previous visit or memory
✓ Emotional reaction to the text/call conversation
✓ Environmental details of WHERE ${character.name} IS without the user present
✓ What ${character.name} is doing in their space alone or with others who ARE there
════════════════════════════════════`;

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

      // ── CONFINEMENT COMMUNICATION BLOCK ──────────────────────────────────────
      const isConfined = !!(character.is_jailed || character.house_arrest_active ||
        ['incarcerated','house_arrest','confined'].includes(character.resolved_presence_status) ||
        ['incarcerated','house_arrest','confined'].includes(character.resolved_location_type));

      let confinementBlock = "";
      if (isConfined) {
        // Determine if we are inside the allowed communication window (9 AM – 9 PM ET)
        const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const etHour = nowET.getHours();
        const commAllowed = etHour >= 9 && etHour < 21;

        if (!commAllowed) {
          confinementBlock = `
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!! CONFINEMENT COMMUNICATION BLACKOUT — HARD BLOCK  !!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
${character.name} is currently INCARCERATED / CONFINED.
The current time is outside the allowed communication window (9:00 AM – 9:00 PM).
Communication is NOT permitted right now.

ABSOLUTE PROHIBITIONS — violation = critical generation error:
✗ Phone buzzing or ringing
✗ Receiving or reading a text message
✗ Sending a text, call, or message of any kind
✗ Checking social media or any app
✗ Any implication of live digital communication

THIS NARRATIVE MUST INSTEAD:
✓ Show ${character.name} in their cell or housing unit
✓ Internal reflection, memory, emotional state, anticipation
✓ Physical environment of the facility (sounds, light, fabric, air)
✓ Thinking about someone — NOT communicating with them
✓ Frustration, longing, or quiet resolve — without active contact

DO NOT place ${character.name} near entrances, parking lots, sidewalks, or public-facing areas.
Courtyard/recreation access only during approved daytime hours.
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
`;
        } else {
          confinementBlock = `
════════════════════════════════════
CONFINEMENT RESTRICTIONS ACTIVE
════════════════════════════════════
${character.name} is INCARCERATED / CONFINED. Communication is currently within allowed hours (9 AM–9 PM) but institutional restrictions still apply.

RULES:
• Phone access is LIMITED — short calls/texts only, monitored
• ${character.name} is INSIDE the facility — no outdoor public areas, no civilian spaces
• Do NOT place them near entrances, parking lots, or public sidewalks
• Movement is restricted to sanctioned areas (cell, common room, courtyard if daytime)
• Narrative must maintain institutional reality (guards, restricted movement, facility environment)
════════════════════════════════════
`;
        }
      }

      // ── PROGRESSION + MOTIF ───────────────────────────────────────────────────
      // Silent imperatives that shape generation without exposing meta-logic.
      // The narrative IS the response — the next thing that happens.
      const progressionBlock = `
════════════════════════════════════════════════════════════
PROGRESSION
════════════════════════════════════════════════════════════
Continue from the established state. Do not restart, restate, or reset.
Carry forward the existing emotional momentum unless this action naturally changes it.
Fold this interaction into the current emotional/physical state — do not erase what came before.
Advance the moment. Do not rewrite the same beat with different adjectives.

CONTINUITY — THE SELECTED ACTION CHANGES DIRECTION, NOT REALITY:
• The selected Action changes the emotional or behavioral DIRECTION of the interaction.
• It does NOT restart the scene, change the location, erase the preceding interaction,
  reset the character's emotional condition, or authorize unrelated events.
• The character remains where they are, in the physical position and circumstances
  established by the CURRENT MOMENT entries, unless a believable progression explains
  movement or change.
• Time progresses naturally. Characters may move, change activities, react, and
  experience developments — but those developments must follow the established
  sequence and the amount of time that has reasonably elapsed.

REPEATED SELECTIONS DEVELOP THE INTERACTION:
• When an Action is selected repeatedly during an ongoing interaction, each narrative
  must account for what happened in the immediately preceding messages and narratives.
• Repeated selection may naturally develop or intensify the interaction depending on
  the current emotional momentum, character responses, and circumstances.
• This does NOT mean every repeated selection automatically increases intensity.
  Characters retain their personalities, emotional states, and ability to respond.
• Do NOT restart the interaction with introductory gestures each time.
• Do NOT mechanically escalate without considering context.

ONE CONTINUOUS CONTEXT ACROSS ALL CATEGORIES:
• All six Action options share the same current conversation timeline.
• A narrative generated by one Action is immediate context for the next selected Action,
  regardless of category.
• Switching categories changes the TYPE of interaction while preserving narrative
  continuity — it does not create a separate reality.
════════════════════════════════════════════════════════════

════════════════════════════════════════════════════════════
`;

      // Motif pool — only for romantic-eligible intents where escalation is permitted
      const motifBlock = (romanticOk && (intent === 'flirt' || intent === 'spend_time' || intent === 'comfort' || (intent === 'action' && contextTier !== 'low')))
        ? `
════════════════════════════════════════════════════════════
ROMANTIC STYLE MOTIF POOL (draw from naturally — do NOT label which technique is in use):
${buildStyleMotifContext()}
════════════════════════════════════════════════════════════
`
        : "";

      // Engine guidance + A–CN example library — additive, applies to ALL intents
      const engineGuidanceBlock = buildExtendedNarrativeExampleContext();

      // Intent action descriptions — each must produce RECOGNIZABLE behavior.
      // The selected Action changes the emotional/behavioral DIRECTION of the
      // interaction. It does NOT restart the scene, change the location, erase
      // the preceding interaction, or reset the character's emotional condition.
      const intentDescriptions = {
        action: contextTier === "high"
          ? "LET THEM ACT — the character independently chooses what to do based on personality, current mood, circumstances, and the ongoing conversation. Follow HIGH emotional momentum naturally. The character has agency — they may flirt, confront, comfort, withdraw, or continue an activity. Do NOT default to a generic neutral action."
          : contextTier === "medium"
          ? "LET THEM ACT — the character independently chooses what to do based on personality, current mood, circumstances, and the ongoing conversation. Follow MEDIUM emotional momentum. The character has agency — do NOT force a predetermined emotional category."
          : "LET THEM ACT — the character independently chooses what to do based on personality, current mood, circumstances, and the ongoing conversation. LOW emotional momentum — small gesture, light presence. The character has agency — do NOT default to a generic neutral action.",
        comfort: "COMFORT ME — generate a genuinely comforting narrative appropriate to the present situation. Comfort through tenderness, supportive dialogue, reassurance, affection, attentive behavior, or physical closeness where appropriate. Express comfort through actual character BEHAVIOR, not by claiming the character is comforting. Comfort is NOT flirtation. Do not escalate into romance.",
        flirt: romanticOk
          ? "FLIRT — generate recognizable flirtation. Playful dialogue, teasing, suggestive humor, meaningful glances, attraction, romantic tension, affectionate gestures. Intensity reflects the current conversation and relationship. Subtle, moderate, or intense — but it MUST actually be flirtatious."
          : "FLIRT — playful warm energy — fun and light but NOT physical. No kissing or romantic touch. Still recognizable flirtation through tone, teasing, and playful energy.",
        confront: "CONFRONT — introduce or develop meaningful confrontation related to the current circumstances. Disagreement, frustration, emotional challenges, difficult questions, interpersonal tension, resistance. NOT romance. NOT shouting automatically — expression depends on personality and situation. Actions: stepping into space, blocking movement, sharp tone, controlled aggression. Absolutely NO kissing, romantic touching, or sensual metaphor.",
        spend_time: "SPEND TIME — generate a narrative where the character meaningfully spends time with the user or engages in shared presence. Conversation, companionship, quiet moments, shared activities, attentiveness. Do NOT leave the current scene, begin an unrelated activity alone, or force a dramatic event. Develop the current interaction into a recognizable moment of companionship.",
        check_in: "CHECK IN — generate a meaningful check-in relating to the current conversation, circumstances, or emotional condition. The character demonstrates interest in how the user is doing, feeling, or coping. Gentle, casual, serious, affectionate, or concerned depending on personality and context. Do NOT ask a question that ignores information already provided in the conversation. Do NOT restart the same inquiry if already asked.",
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

      const prompt = `${hardBoundary}${confinementBlock}

You are writing a SHORT third-person narrative scene (2-4 sentences) for ${character.name}.

CHARACTER: ${character.name}
Personality: ${character.personality_summary || "unknown"}
Emotional state: ${emotionalState}
Location: ${location}
Relationship type: ${intentType}
Friendship: ${friendshipLevel}/100 | Romantic: ${romanticLevel}/100 | Attraction: ${attractionLevel}/100
${userPresenceBlock}
${currentMomentBlock}
${narrativeContinuityBlock}
${progressionBlock}${motifBlock}

${engineGuidanceBlock}

RECENT CONVERSATION (current window — for reference only; the CURRENT MOMENT block above is authoritative):
${recentContext || "(no recent messages)"}${actionMemory}

════════════════════════════════════
MANDATORY ENGINE — EXECUTE BEFORE WRITING (all 4 steps required)
════════════════════════════════════
STEP 1 — CONFIRM INTERACTION TYPE: ${intent.toUpperCase()} (${intentType})

STEP 2 — SELECT ONE BEHAVIOR PATTERN (choose from the correct library, never repeat the same pattern twice):
${intent === 'flirt' || (intent === 'action' && contextTier !== 'low' && romanticOk) ? `
  FLIRT PATTERNS — select ONE:
  close without touching | playful challenge | accidental contact | low voice moment | testing the line | shared recognition | inside language | confidence shift | energy matching | subtle claim` : ''}
${intent === 'comfort' ? `
  COMFORT PATTERNS — select ONE:
  quiet presence | soft redirect | protective energy | validation without fixing | physical reassurance | seen without explaining | identity affirmation | after a long day | protective check-in | rebuilding after hurt` : ''}
${intent === 'check_in' ? `
  REASSURE or CHECK-IN PATTERNS — select ONE:
  emotional validation + grounding | reframing fear into manageable | tone softness and pacing | safety through presence | open-ended question with real attention behind it | non-verbal cue detection | emotional temperature reading` : ''}
${intent === 'confront' ? `
  CONFLICT PATTERNS — select ONE:
  emotional build-up before release | specific vs vague confrontation | who controls the floor | power dynamic shift | resolution path (explode / simmer / walk away)` : ''}
${intent === 'spend_time' ? `
  SPEND TIME PATTERNS — select ONE:
  shared activity together | comfortable silence with no urgency | background environment shaping the moment | time passing naturally | subtle bonding through small things` : ''}
${intent === 'action' ? `
  LET THEM ACT PATTERNS — select ONE:
  environmental interaction with objects | micro-behaviors (glance, posture shift, physical tell) | time progression awareness | reaction to background stimuli | silent action that carries meaning` : ''}

STEP 3 — APPLY ONE VARIATION HOOK (required — scene without a hook is invalid):
${intent === 'flirt' ? `
  Choose one: interruption that breaks the moment | hesitation that changes direction | one person more aware than the other | escalation then deliberate pullback | signal that gets misread | external pressure at the wrong moment | timing emotionally off between them` : `
  Choose one: timing mismatch | emotional misread | expectation vs what actually happens | memory callback shaping the present | environment applying pressure | someone opens up more than intended | humor deflects before the real thing surfaces`}

STEP 4 — EMBED ONE ROOT THEME (weave naturally — never state it directly):
unspoken tension | timing mismatch | power imbalance shift | memory callback | environment pressure | internal vs external conflict | expectation vs reality | control vs vulnerability | guardedness giving way | micro-validation | chosen family energy | public vs private identity shift

════════════════════════════════════
${tierInstruction}

INTENT: Generate ${intentDescriptions[intent] || intentDescriptions.action}

INTENT TYPE — ${intentType}:
${intentEnforcement[intentType] || ""}

CONSENT CHECK: If the other person shows hesitation → reduce intensity. If clear resistance → block escalation entirely.

LGBTQ+ RULE: All patterns apply identically regardless of gender combination. No tone changes based on pairing. Pronouns from profile only.

STYLE RULES:
- Third person only ("${character.name} reaches...", "He looks up...")
- ONE continuous paragraph, clean punctuation, no em dashes mid-sentence
- State what the character is physically doing — metaphor intensifies action, does NOT replace it
- 2-4 sentences max. Tight. Cinematic. Real.
- No explicit content — suggestive and emotionally charged is fine
- One short quoted line of dialogue allowed if it fits naturally
- Include one grounded environmental detail. Rotate from: SURFACE, OBJECTS, FABRIC, SOUND, LIGHT, MOVEMENT, TEMPERATURE, CONSTRAINT.
- Do NOT repeat descriptive patterns from recent outputs. Vary the sensory entry point each time.

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
      // Always reset external trigger so Action can be reopened
      onExternalClose?.();
    }
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-[200] bg-black/40" onClick={() => { onExternalClose?.(); }} />
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