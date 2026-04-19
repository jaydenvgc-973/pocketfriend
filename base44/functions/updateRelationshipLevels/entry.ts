import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── MILESTONES ────────────────────────────────────────────────────────────────
const MILESTONES = [
  { field: 'friendship_level', threshold: 25, label: 'budding friendship' },
  { field: 'friendship_level', threshold: 50, label: 'genuine friendship' },
  { field: 'friendship_level', threshold: 75, label: 'deep friendship' },
  { field: 'romantic_level', threshold: 25, label: 'romantic spark' },
  { field: 'romantic_level', threshold: 50, label: 'romantic feelings' },
  { field: 'romantic_level', threshold: 75, label: 'deep romantic bond' },
  { field: 'chosen_family_level', threshold: 25, label: 'feeling like family' },
  { field: 'chosen_family_level', threshold: 50, label: 'chosen family bond' },
  { field: 'chosen_family_level', threshold: 75, label: 'unbreakable family bond' },
  { field: 'attraction_level', threshold: 30, label: 'noticeable attraction' },
  { field: 'attraction_level', threshold: 60, label: 'strong attraction' },
  { field: 'trust_level', threshold: 50, label: 'genuine trust' },
  { field: 'trust_level', threshold: 75, label: 'deep trust' },
];

// ── ATTRACTION ORIENTATION MULTIPLIER ────────────────────────────────────────
function getAttractionSpeedMultiplier(characterOrientation, characterGender, otherGender) {
  const orientation = (characterOrientation || 'not specified').toLowerCase();
  const charGender = (characterGender || '').toLowerCase();
  const targetGender = (otherGender || 'unknown').toLowerCase();
  const isSameGender = charGender && targetGender && charGender === targetGender;
  const isOppositeGender = (charGender === 'male' && targetGender === 'female') || (charGender === 'female' && targetGender === 'male');
  const isNonBinary = targetGender === 'non-binary' || targetGender === 'other' || targetGender === 'non_binary';
  if (orientation === 'straight') { if (isNonBinary) return 0.15; if (isSameGender) return 0.1; return 1.0; }
  if (orientation === 'gay' || orientation === 'gay (dl)') { if (isOppositeGender) return 0.1; if (isNonBinary) return 0.5; return 1.0; }
  if (orientation === 'lesbian') { if (isOppositeGender) return 0.1; return 1.0; }
  return 1.0;
}

// ── ORIENTATION SHIFT ─────────────────────────────────────────────────────────
function checkOrientationShift(currentOrientation, currentAttractionLevel, characterGender, targetGender) {
  const orientation = (currentOrientation || '').toLowerCase();
  const charGender = (characterGender || '').toLowerCase();
  const tgtGender = (targetGender || '').toLowerCase();
  if (currentAttractionLevel < 30) return null;
  const isSameGender = charGender && tgtGender && charGender === tgtGender;
  const isNonBinary = tgtGender === 'non-binary' || tgtGender === 'other' || tgtGender === 'non_binary';
  if (orientation === 'straight') {
    if (isNonBinary) return 'pansexual';
    if (isSameGender) { const isDLCandidate = charGender === 'male' && currentAttractionLevel >= 50; if (isDLCandidate && Math.random() > 0.6) return 'gay (dl)'; return Math.random() > 0.5 ? 'bisexual' : 'prefer not to say'; }
  }
  if (orientation === 'gay' || orientation === 'gay (dl)' || orientation === 'lesbian') {
    const isOppositeGender = (charGender === 'male' && tgtGender === 'female') || (charGender === 'female' && tgtGender === 'male');
    if (isOppositeGender) return 'bisexual';
  }
  return null;
}

// ── TRUST → RELATIONAL JEALOUSY MODULATION ───────────────────────────────────
// High trust dampens insecurity-driven relational jealousy.
// Low trust amplifies it. Does NOT affect envy jealousy.
function modulateRelationalJealousy(rawRelationalJealousy, trustLevel, romanticLevel) {
  // Only applies meaningfully in romantic/attached dynamics
  const isRomantic = romanticLevel >= 20;
  if (!isRomantic) return rawRelationalJealousy;
  // Trust modifier: 0–100 trust maps to +20% to -20% jealousy intensity
  const trustMod = (50 - trustLevel) / 250; // -0.2 at trust=100, +0.2 at trust=0
  const modulated = rawRelationalJealousy * (1 + trustMod);
  return Math.min(100, Math.max(0, Math.round(modulated)));
}

// ── DERIVED INFIDELITY RISK (not stored, returned for LLM context only) ──────
function computeInfidelityRisk(respect, trust, romantic, commitment, resentment) {
  if (respect >= 70 && trust >= 70) return 'low';
  const riskScore = (100 - respect) * 0.35 + (100 - trust) * 0.30 + resentment * 0.20 + (100 - commitment) * 0.15;
  if (riskScore > 70) return 'elevated';
  if (riskScore > 45) return 'moderate';
  return 'low';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, userMessage, characterReply, recentMessages, emojiReaction, reactedMessageContent, reactedMessageSenderType, playingAsCharacterId } = await req.json();
    if (!characterId) return Response.json({ error: 'Missing required fields' }, { status: 400 });
    if (!userMessage && !emojiReaction) return Response.json({ error: 'Missing required fields' }, { status: 400 });

    const character = await base44.asServiceRole.entities.Character.get(characterId);
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    let playingAsCharacter = null;
    let charRelEntry = null;
    if (playingAsCharacterId) {
      playingAsCharacter = await base44.asServiceRole.entities.Character.get(playingAsCharacterId);
      if (playingAsCharacter) {
        charRelEntry = (character.fictional_relationships || []).find(r => r.related_character_id === playingAsCharacterId) || null;
      }
    }

    // ── CANONICAL CURRENT STATE (single source of truth) ─────────────────────
    const current = charRelEntry ? {
      user_respect_level: charRelEntry.user_respect_level ?? 50,
      friendship_level: charRelEntry.friendship_level ?? 75,
      romantic_level: charRelEntry.romantic_level ?? 0,
      attraction_level: charRelEntry.attraction_level ?? 0,
      chosen_family_level: charRelEntry.chosen_family_level ?? 0,
      trust_level: charRelEntry.trust_level ?? 50,
      relational_jealousy: charRelEntry.relational_jealousy ?? 0,
      envy_jealousy: charRelEntry.envy_jealousy ?? 0,
    } : {
      user_respect_level: character.user_respect_level ?? 50,
      friendship_level: character.friendship_level ?? 75,
      romantic_level: character.romantic_level ?? 0,
      attraction_level: character.attraction_level ?? 0,
      chosen_family_level: character.chosen_family_level ?? 0,
      trust_level: character.trust_level ?? 50,
      relational_jealousy: character.relational_jealousy ?? 0,
      envy_jealousy: character.envy_jealousy ?? 0,
    };

    const senderLabel = playingAsCharacter ? playingAsCharacter.name : 'User';
    const conversationSummary = (recentMessages || [])
      .slice(-10)
      .map(m => `${m.sender_type === 'user' ? senderLabel : character.name}: ${m.content}`)
      .join('\n');

    let interactionSection = '';
    if (emojiReaction) {
      const reactorLabel = reactedMessageSenderType === 'user' ? (playingAsCharacter ? playingAsCharacter.name : 'the User') : `${character.name} (the character)`;
      interactionSection = `
EMOJI REACTION EVENT:
The user reacted with "${emojiReaction}" to a message sent by ${reactorLabel}.
The reacted-to message content was: "${reactedMessageContent || '(image or unknown content)'}"

EMOJI REACTION RULES:
- ❤️: romantic (+2 to +4) if romantic_level > 40, else platonic warmth (+2 to +3 friendship). Trust slightly up (+1).
- 😂: friendship (+1 to +3), attraction (+1 to +2) if character values humor.
- 😮: respect (+1 to +3) if message was impressive.
- 😢: friendship (+2 to +4) via empathy. Trust slightly up (+1 to +2) — opening up signals safety.
- 😡: friendship (-2 to -4), respect (-1 to -3) unless protectiveness context.
- 👍: friendship (+1 to +2) or respect (+1).
- If emoji is on a photo the character sent of themselves, DOUBLE attraction/romantic impact.`;
    } else {
      interactionSection = `
LATEST USER MESSAGE: "${userMessage}"
CHARACTER'S REPLY: "${characterReply || ''}"

NON-PHYSICAL ATTRACTION TRAIT DETECTION:
KINDNESS: Genuine warmth, empathy, or care without being asked?
HUMOR: Made the character laugh, showed wit, or playful banter?
INTEGRITY: Demonstrated honesty, moral backbone, stood by values when hard?
VULNERABILITY: Opened up emotionally, admitted something difficult?
INTELLECTUAL GROWTH: Shared something learned, engaged meaningfully with ideas?
RELIABILITY: Did they follow through on something, keep a promise, show consistency?
EMOTIONAL SAFETY: Did they make the character feel safe, unjudged, supported?

For attraction: only award boosts for traits this specific character would respond to based on their archetype.
For trust: RELIABILITY and EMOTIONAL SAFETY are primary trust signals. Honesty, consistency, vulnerability met with care all build trust.
For jealousy: scan for any mention of other people, rival attention, or comparison that might trigger relational or envy jealousy.`;
    }

    const WORLD_CONTEXT = `WORLD CONTEXT: The average American sleeps ~9 hours, spends ~5 hours on leisure, works 3.5–8 hours, checks their phone ~58 times/day. ~1 in 5 Americans has an STI at any given time. Religion functions as a coping mechanism under systemic stress. Youth gang involvement is driven by poverty, instability, and the pull of belonging.`;

    const interactingPartyDesc = playingAsCharacter
      ? `INTERACTING PARTY: ${playingAsCharacter.name} (another character — ${playingAsCharacter.age_range || ''} ${playingAsCharacter.gender || ''}, personality: ${playingAsCharacter.personality_summary || ''}, archetype: ${playingAsCharacter.archetype || ''}, orientation: ${playingAsCharacter.sexual_orientation || ''})`
      : `INTERACTING PARTY: The user (unknown gender)`;

    const prompt = `You are a relationship dynamics analyzer. Analyze this interaction and update all relationship dimensions.

${WORLD_CONTEXT}

CHARACTER: ${character.name}
ARCHETYPE: ${character.archetype || 'unknown'}
PERSONALITY: ${character.personality_summary || ''}
PERSONALITY TRAITS: ${(character.personality_traits || []).join(', ') || 'none'}
EMOTIONAL TRIGGERS: ${(character.emotional_triggers_deep || []).join(', ') || 'none'}
COMMUNICATION STYLE: ${character.communication_style || 'unknown'}
EMOTIONAL BAGGAGE: ${character.emotional_baggage || 'none'}
SEXUAL ORIENTATION: ${character.sexual_orientation || 'not specified'}
CHARACTER GENDER: ${character.gender || 'not specified'}
LOYALTY VIEW: ${character.loyalty_view || 'not specified'}

${interactingPartyDesc}

CURRENT CANONICAL RELATIONSHIP STATE (0-100):
- Respect: ${current.user_respect_level} — "How much do I value who you are?"
- Friendship: ${current.friendship_level}
- Romantic: ${current.romantic_level}
- Attraction: ${current.attraction_level}
- Chosen Family: ${current.chosen_family_level}
- Trust: ${current.trust_level} — "How safe and reliable do you feel to me?"
- Relational Jealousy: ${current.relational_jealousy} — "I fear losing your attention/closeness to someone else"
- Envy Jealousy: ${current.envy_jealousy} — "You have something I want / I feel compared"

RECENT CONVERSATION:
${conversationSummary || 'No prior context.'}
${interactionSection}

═══════════════════════════════════
RELATIONSHIP RULES — apply ALL of these:
═══════════════════════════════════

--- RESPECT (what do I value about who you ARE?) ---
POSITIVE (+2 to +6): Good advice, demonstrated competence, integrity, keeps promises, active listening, stands up for values.
NEGATIVE (-3 to -8): Dismissive, rude, mocking, caught lying, careless advice, disregards character's feelings.
Respect is NOT the same as attraction. A character can be attracted to someone they don't respect.

--- TRUST (how SAFE and RELIABLE do you feel?) ---
POSITIVE (+2 to +6): Kept a promise, showed consistency, made character feel emotionally safe, honored vulnerability, was honest when hard.
NEGATIVE (-4 to -10): Betrayal, lie caught, broke promise, dismissed shared vulnerability, was unreliable in a meaningful moment.
Trust is NOT the same as respect. A character can trust someone's honesty but not admire their character.
Trust is slow to rebuild: after a betrayal, recovery should be gradual (max +3/turn until fully repaired).

--- FRIENDSHIP ---
POSITIVE (+1 to +4): Shares personal story, warm conversation, offers support, remembers details.
NEGATIVE (-2 to -6): Betrays trust, goes cold, consistently dismisses feelings.
Friendship drops slowly IF respect >= 50.

--- ROMANTIC ---
POSITIVE: Tailored flirting, specific admiration, playful vulnerability.
NEGATIVE: Generic flirting, overtures that clash with values, pushing when character signals discomfort.
Romantic stays stable if chosen_family_level >= 60.

--- ATTRACTION (non-physical trait detection) ---
Apply based on archetype: CONFIDENT/DOMINANT → boldness, WOUNDED → softness, CHAOTIC → may be pulled by rudeness, INTELLECTUAL/GUARDED → wit/depth, NURTURING → emotional openness.
Only boost attraction for traits this specific character responds to.

--- CHOSEN FAMILY ---
Only increases if friendship_level >= 70.
Boosted by: advice, checking in, letting character vent, deep loyalty during hard moment.
Reduced by: breaking significant promise, disappearing after vulnerable moment.

--- RELATIONAL JEALOUSY (fear of losing their closeness to someone else) ---
INCREASES when: user mentions spending time with others, rival appears, attention feels inconsistent, exclusivity threatened, commitment uncertain.
DECREASES when: user gives reassurance, shows loyalty, demonstrates exclusivity, relationship clarity improves.
MODULATED by trust: high trust dampens reactive jealousy; low trust amplifies it.
This is NOT envy — it's attachment fear.

--- ENVY JEALOUSY (comparison — they have something I want) ---
INCREASES when: user mentions achievements, advantages, recognition, beauty, money, or opportunities the character lacks; character feels overlooked or passed over.
DECREASES when: character's own confidence improves, resentment resolves, fairness is acknowledged.
This is NOT relational jealousy — it's not about romantic attention.

--- GRIEF GATING ---
If user mentioned death/loss: only assign grief to ${character.name} if they had a DIRECT relationship with the person who died.
Otherwise, ${character.name}'s role is supportive — concern and empathy only, NOT grief.
DO NOT reduce relationship levels because of indirect sad news.
DO slightly boost friendship/chosen_family (+1 to +3) if character responds supportively.

Also detect:
- EMOTIONAL MILESTONE: vulnerable confession, shared grief/joy, deeply personal revelation
- SHARED SECRET: explicit confidential information shared

Respond with ONLY valid JSON:
{
  "user_respect_level": <number 0-100>,
  "friendship_level": <number 0-100>,
  "romantic_level": <number 0-100>,
  "attraction_level": <number 0-100>,
  "chosen_family_level": <number 0-100>,
  "trust_level": <number 0-100>,
  "relational_jealousy": <number 0-100>,
  "envy_jealousy": <number 0-100>,
  "reason": "<one sentence explaining the most significant change and why>",
  "detected_traits": ["kindness"|"humor"|"integrity"|"vulnerability"|"intellectual_growth"|"reliability"|"emotional_safety"],
  "emotional_milestone": "<description or null>",
  "shared_secret": "<description or null>"
}`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          user_respect_level: { type: "number" },
          friendship_level: { type: "number" },
          romantic_level: { type: "number" },
          attraction_level: { type: "number" },
          chosen_family_level: { type: "number" },
          trust_level: { type: "number" },
          relational_jealousy: { type: "number" },
          envy_jealousy: { type: "number" },
          reason: { type: "string" },
          detected_traits: { type: "array", items: { type: "string" } },
          emotional_milestone: {},
          shared_secret: {}
        },
        required: ["user_respect_level", "friendship_level", "romantic_level", "attraction_level", "chosen_family_level", "trust_level", "relational_jealousy", "envy_jealousy", "reason"]
      }
    });

    // ── APPLY ORIENTATION MULTIPLIER TO ATTRACTION ────────────────────────────
    const orientation = (character.sexual_orientation || '').toLowerCase();
    let attractionMultiplier = 1.0;
    if (orientation === 'straight' || orientation === 'gay' || orientation === 'lesbian') {
      attractionMultiplier = 0.7; // unknown user gender dampener
    }
    const rawAttractionDelta = result.attraction_level - current.attraction_level;
    const adjustedAttractionDelta = rawAttractionDelta > 0 ? rawAttractionDelta * attractionMultiplier : rawAttractionDelta;
    const adjustedAttraction = Math.min(100, Math.max(0, Math.round(current.attraction_level + adjustedAttractionDelta)));

    // ── CHOSEN FAMILY GATE ────────────────────────────────────────────────────
    const newFriendship = Math.min(100, Math.max(0, Math.round(result.friendship_level)));
    const newChosenFamily = Math.min(100, Math.max(0, Math.round(result.chosen_family_level)));
    const clampedChosenFamily = newFriendship >= 70 ? newChosenFamily : Math.min(current.chosen_family_level, newChosenFamily);

    // ── TRUST SLOW-REBUILD GATE ───────────────────────────────────────────────
    // If trust was previously very low (betrayal state), cap single-turn recovery
    const rawTrustDelta = result.trust_level - current.trust_level;
    const cappedTrustDelta = (current.trust_level < 30 && rawTrustDelta > 3) ? 3 : rawTrustDelta;
    const newTrust = Math.min(100, Math.max(0, Math.round(current.trust_level + cappedTrustDelta)));

    // ── TRUST → RELATIONAL JEALOUSY MODULATION ───────────────────────────────
    // Apply trust-based modulation AFTER LLM sets the raw relational jealousy value
    const rawRelationalJealousy = Math.min(100, Math.max(0, Math.round(result.relational_jealousy)));
    const modulatedRelationalJealousy = modulateRelationalJealousy(rawRelationalJealousy, newTrust, result.romantic_level);
    const newEnvyJealousy = Math.min(100, Math.max(0, Math.round(result.envy_jealousy)));

    const updated = {
      user_respect_level: Math.min(100, Math.max(0, Math.round(result.user_respect_level))),
      friendship_level: newFriendship,
      romantic_level: Math.min(100, Math.max(0, Math.round(result.romantic_level))),
      attraction_level: adjustedAttraction,
      chosen_family_level: clampedChosenFamily,
      trust_level: newTrust,
      relational_jealousy: modulatedRelationalJealousy,
      envy_jealousy: newEnvyJealousy,
    };

    // ── ORIENTATION SHIFT (inter-character only) ──────────────────────────────
    let orientationShift = null;
    if (playingAsCharacter && adjustedAttraction >= 55) {
      const potentialShift = checkOrientationShift(character.sexual_orientation, updated.attraction_level, character.gender, playingAsCharacter.gender);
      if (potentialShift && potentialShift !== (character.sexual_orientation || '').toLowerCase()) {
        orientationShift = potentialShift;
      }
    }

    // ── MILESTONES ────────────────────────────────────────────────────────────
    const milestonesTriggered = [];
    const triggeredMilestoneKeys = character.triggered_milestones || [];
    for (const milestone of MILESTONES) {
      const key = `${milestone.field}_${milestone.threshold}`;
      if (triggeredMilestoneKeys.includes(key)) continue;
      const before = current[milestone.field];
      const after = updated[milestone.field];
      if (before !== undefined && after !== undefined && before < milestone.threshold && after >= milestone.threshold) {
        milestonesTriggered.push({ ...milestone, key });
      }
    }
    const milestoneMessages = [];
    for (const milestone of milestonesTriggered) {
      const milestoneText = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `Generate a short, poetic narrative event message (1-2 sentences, no dialogue, third-person, emotionally resonant) marking the moment a ${milestone.label} was reached between ${character.name} and the user. Character personality: ${character.personality_summary || ''}. Meaningful but understated.`
      });
      milestoneMessages.push({ key: milestone.key, text: milestoneText.trim() });
    }
    const newTriggeredKeys = [...triggeredMilestoneKeys, ...milestonesTriggered.map(m => m.key)];

    // ── PERSIST ORIENTATION SHIFT MEMORY ─────────────────────────────────────
    if (orientationShift) {
      base44.asServiceRole.entities.Memory.create({
        character_id: characterId,
        title: `Orientation shift — feelings for ${playingAsCharacter.name}`,
        description: `${character.name} began to realize their feelings for ${playingAsCharacter.name} were shifting something they had always taken for granted about themselves.`,
        emotional_impact: 'significant internal shift',
        timestamp: new Date().toISOString(),
        source_context: 'relationship development',
      }).catch(() => {});
    }

    // ── BUILD CHARACTER UPDATE PAYLOAD ────────────────────────────────────────
    let characterUpdatePayload;
    if (playingAsCharacter && charRelEntry) {
      const updatedFictionalRels = (character.fictional_relationships || []).map(r =>
        r.related_character_id === playingAsCharacterId ? { ...r, ...updated } : r
      );
      characterUpdatePayload = {
        fictional_relationships: updatedFictionalRels,
        triggered_milestones: newTriggeredKeys,
        ...(orientationShift ? { sexual_orientation: orientationShift } : {}),
      };
    } else {
      characterUpdatePayload = {
        ...updated,
        triggered_milestones: newTriggeredKeys,
      };
    }

    await base44.asServiceRole.entities.Character.update(characterId, characterUpdatePayload);

    // ── STORE MILESTONES + SECRETS IN MEMORY ──────────────────────────────────
    const memoryPromises = [];
    if (result.emotional_milestone) {
      memoryPromises.push(base44.asServiceRole.entities.Memory.create({
        character_id: characterId, title: `Emotional milestone with user`,
        description: result.emotional_milestone, emotional_impact: 'meaningful',
        timestamp: new Date().toISOString(), source_context: 'user conversation',
      }));
    }
    if (result.shared_secret) {
      memoryPromises.push(base44.asServiceRole.entities.Memory.create({
        character_id: characterId, title: `Secret shared by user`,
        description: result.shared_secret, emotional_impact: 'significant',
        timestamp: new Date().toISOString(), source_context: 'user conversation - confidential',
      }));
    }
    if (memoryPromises.length > 0) await Promise.all(memoryPromises);

    // ── RELATIONSHIP TITLE CHANGE CHECK ──────────────────────────────────────
    const CHANGEABLE_TITLES = ['spouse', 'partner', 'friend', 'best friend', 'romantic interest', 'girlfriend', 'boyfriend', 'lover', 'acquaintance', 'coworker'];
    const BLOOD_TITLES = ['mother', 'father', 'sister', 'brother', 'cousin', 'aunt', 'uncle', 'grandmother', 'grandfather', 'niece', 'nephew', 'daughter', 'son', 'half-sister', 'half-brother', 'step-mother', 'step-father', 'step-sister', 'step-brother'];
    let relationshipChangeRequest = null;
    if (playingAsCharacter && charRelEntry) {
      const relTitle = (charRelEntry.relationship_type || '').toLowerCase();
      const isChangeable = CHANGEABLE_TITLES.some(t => relTitle.includes(t));
      const isBlood = BLOOD_TITLES.some(t => relTitle.includes(t));
      if (isChangeable && !isBlood && updated.friendship_level <= 5) {
        if (relTitle.includes('spouse') || relTitle.includes('partner')) {
          relationshipChangeRequest = { type: 'separation', message: `${character.name} may want to ask for a divorce or separation.` };
        } else if (relTitle.includes('friend')) {
          relationshipChangeRequest = { type: 'end_friendship', message: `${character.name} may want to end the friendship with ${playingAsCharacter.name}.` };
        } else if (updated.romantic_level <= 5 && (relTitle.includes('romantic') || relTitle.includes('girlfriend') || relTitle.includes('boyfriend') || relTitle.includes('lover'))) {
          relationshipChangeRequest = { type: 'breakup', message: `${character.name} may want to break up with ${playingAsCharacter.name}.` };
        }
      }
    }

    return Response.json({
      ...updated,
      reason: result.reason,
      detected_traits: result.detected_traits || [],
      milestone_messages: milestoneMessages,
      relationship_change_request: relationshipChangeRequest,
    });
  } catch (error) {
    if (error.message?.includes('Rate limit') || error.message?.includes('429') || error.status === 429) {
      return Response.json({ skipped: true, reason: 'Rate limit — no changes applied' });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
});