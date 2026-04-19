import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Milestones that trigger narrative events when crossed for the first time
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
  { field: 'trust_level', threshold: 60, label: 'growing trust' },
  { field: 'trust_level', threshold: 80, label: 'deep trust' },
];

function getAttractionSpeedMultiplier(characterOrientation, characterGender, otherGender) {
  const orientation = (characterOrientation || 'not specified').toLowerCase();
  const charGender = (characterGender || '').toLowerCase();
  const targetGender = (otherGender || 'unknown').toLowerCase();
  const isSameGender = charGender && targetGender && charGender === targetGender;
  const isOppositeGender =
    (charGender === 'male' && targetGender === 'female') ||
    (charGender === 'female' && targetGender === 'male');
  const isNonBinary = targetGender === 'non-binary' || targetGender === 'other' || targetGender === 'non_binary';

  if (orientation === 'straight') {
    if (isNonBinary) return 0.15;
    if (isSameGender) return 0.1;
    return 1.0;
  }
  if (orientation === 'gay' || orientation === 'gay (dl)') {
    if (isOppositeGender) return 0.1;
    if (isNonBinary) return 0.5;
    return 1.0;
  }
  if (orientation === 'lesbian') {
    if (isOppositeGender) return 0.1;
    return 1.0;
  }
  return 1.0;
}

function checkOrientationShift(currentOrientation, currentAttractionLevel, characterGender, targetGender) {
  const orientation = (currentOrientation || '').toLowerCase();
  const charGender = (characterGender || '').toLowerCase();
  const tgtGender = (targetGender || '').toLowerCase();

  if (currentAttractionLevel < 30) return null;

  const isSameGender = charGender && tgtGender && charGender === tgtGender;
  const isNonBinary = tgtGender === 'non-binary' || tgtGender === 'other' || tgtGender === 'non_binary';

  if (orientation === 'straight') {
    if (isNonBinary) return 'pansexual';
    if (isSameGender) {
      const isDLCandidate = charGender === 'male' && currentAttractionLevel >= 50;
      if (isDLCandidate && Math.random() > 0.6) return 'gay (dl)';
      return Math.random() > 0.5 ? 'bisexual' : 'prefer not to say';
    }
  }
  if (orientation === 'gay' || orientation === 'gay (dl)' || orientation === 'lesbian') {
    const isOppositeGender =
      (charGender === 'male' && tgtGender === 'female') ||
      (charGender === 'female' && tgtGender === 'male');
    if (isOppositeGender) return 'bisexual';
  }
  return null;
}

// ── TRUST → JEALOUSY MODULATION ──────────────────────────────────────────────
// High trust suppresses insecurity-based relational jealousy.
// Low trust amplifies it. This is computed AFTER the LLM returns new values.
function modulateRelationalJealousy(rawRelationalJealousy, newTrustLevel, romanticLevel) {
  // Trust suppression only applies meaningfully in romantic/intimate contexts
  const isRomantic = romanticLevel >= 20;
  if (!isRomantic) return rawRelationalJealousy;

  // Trust suppression factor: 0.3 at max trust (100), 1.7 at zero trust
  // Neutral at trust=50 (factor=1.0)
  const trustFactor = 1.0 + ((50 - newTrustLevel) / 50) * 0.7;
  return Math.min(100, Math.max(0, Math.round(rawRelationalJealousy * trustFactor)));
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

    // Current canonical levels — include new dimensions with sensible defaults
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
      const reactSenderLabel = reactedMessageSenderType === 'user' ? (playingAsCharacter ? playingAsCharacter.name : 'the User') : `${character.name} (the character)`;
      interactionSection = `
EMOJI REACTION EVENT:
The user reacted with "${emojiReaction}" to a message sent by ${reactSenderLabel}.
The reacted-to message content was: "${reactedMessageContent || '(image or unknown content)'}"

EMOJI REACTION RULES:
- ❤️: If romantic_level > 40, lean romantic (+2 to +4 romantic). If romantic_level < 20 and friendship_level > 50, lean platonic warmth (+2 to +3 friendship). Trust: small boost (+1).
- 😂: Boost friendship (+1 to +3), attraction (+1 to +2) if character values humor.
- 😮: Raises respect (+1 to +3) if impressive.
- 😢: Empathy signal — boost friendship (+2 to +4). May slightly boost trust (+1 to +2) if vulnerable.
- 😡: Disapproval (-2 to -4 friendship, -1 to -3 respect, -1 to -2 trust) unless protectiveness context.
- 👍: Neutral approval — small boost to friendship (+1 to +2) or respect (+1).
- GENERAL: If emoji is on a photo the character sent of themselves, DOUBLE the attraction/romantic impact.`;
    } else {
      interactionSection = `
LATEST USER MESSAGE: "${userMessage}"
CHARACTER'S REPLY: "${characterReply || ''}"

NON-PHYSICAL ATTRACTION TRAIT DETECTION:
KINDNESS: Genuine warmth, empathy, care without being asked?
HUMOR: Wit, playful banter, made the character laugh?
INTEGRITY: Honesty, moral backbone, kept a promise, stood by values?
VULNERABILITY: Opened up emotionally, admitted difficulty, shared a fear?
INTELLECTUAL GROWTH: Shared learning, engaged meaningfully with ideas?

TRUST SIGNAL DETECTION:
TRUST BUILDERS (+2 to +5 trust): User kept a promise, was honest about something difficult, showed up reliably, was transparent, respected a boundary, showed they can hold a secret.
TRUST BREAKERS (-3 to -8 trust): User lied, broke a promise, dismissed something important, violated a boundary, was inconsistent, contradicted their earlier stated values, or acted selfishly.
NEUTRAL: Most casual conversation has no significant trust impact.`;
    }

    const WORLD_CONTEXT = `
WORLD CONTEXT: The average American sleeps ~9 hours, spends ~5 hours on leisure, works 3.5–8 hours. Religion functions as coping mechanism. Gang involvement driven by poverty and belonging. People stay or leave relationships based on trust, respect, and emotional safety — not just attraction.
`.trim();

    const interactingPartyDesc = playingAsCharacter
      ? `INTERACTING PARTY: ${playingAsCharacter.name} (another character — ${playingAsCharacter.age_range || ''} ${playingAsCharacter.gender || ''}, personality: ${playingAsCharacter.personality_summary || ''}, archetype: ${playingAsCharacter.archetype || ''}, orientation: ${playingAsCharacter.sexual_orientation || ''})`
      : `INTERACTING PARTY: The user (unknown gender)`;

    const prompt = `You are a relationship dynamics analyzer. Analyze this interaction and update all relationship dimensions for this character.

${WORLD_CONTEXT}

CHARACTER: ${character.name}
ARCHETYPE: ${character.archetype || 'unknown'}
PERSONALITY: ${character.personality_summary || ''}
TRAITS: ${(character.personality_traits || []).join(', ') || 'none'}
DEEP TRIGGERS: ${(character.emotional_triggers_deep || []).join(', ') || 'none'}
COMMUNICATION STYLE: ${character.communication_style || 'unknown'}
EMOTIONAL BAGGAGE: ${character.emotional_baggage || 'none'}
ORIENTATION: ${character.sexual_orientation || 'not specified'}
GENDER: ${character.gender || 'not specified'}

${interactingPartyDesc}

CURRENT CANONICAL RELATIONSHIP STATE (0-100):
- Respect: ${current.user_respect_level} — "How much do I value who you ARE? Your character, judgment, worth."
- Friendship: ${current.friendship_level} — "Do I genuinely like you and enjoy your company?"
- Romantic: ${current.romantic_level} — "Do I have romantic feelings for you?"
- Attraction: ${current.attraction_level} — "Am I physically/emotionally drawn to you?"
- Chosen Family: ${current.chosen_family_level} — "Do I think of you as family?"
- Trust: ${current.trust_level} — "Do I feel safe with you? Are you honest, reliable, and consistent?"
- Relational Jealousy: ${current.relational_jealousy} — "Do I fear losing your attention/closeness to someone else?"
- Envy Jealousy: ${current.envy_jealousy} — "Do I envy something about your life, status, or what you have?"

RECENT CONVERSATION:
${conversationSummary || 'No prior context.'}
${interactionSection}

RELATIONSHIP RULES:

--- RESPECT (distinct from trust) ---
Respect = valuing WHO someone is. Not the same as liking them or trusting them.
POSITIVE (+2 to +6): Demonstrated integrity, competence, depth, standing by their values, thoughtful advice, emotional maturity.
NEGATIVE (-3 to -8): Dismissive, mocking, rude, careless advice, contempt, caught lying (which also breaks trust separately).

--- TRUST (distinct from respect) ---
Trust = feeling SAFE. Can I believe them? Will they protect my vulnerability?
POSITIVE (+2 to +5): Kept a promise, honest about something hard, showed up reliably, transparent, respected a boundary.
NEGATIVE (-3 to -8): Lied, broke a promise, violated a boundary, inconsistent, betrayed vulnerability, dismissed something important.
Trust and respect move independently. A character can trust someone without respecting them (e.g. a reliable but shallow person), or respect someone they don't fully trust (e.g. admire someone who keeps distance).

--- FRIENDSHIP ---
Drops slowly and only when respect is also low (respect < 50). High respect protects friendship.
POSITIVE (+1 to +4): Shared personal story, warm conversation, emotional support, remembered details.
NEGATIVE (-2 to -6): Consistent dismissal, coldness, betrayal.

--- ROMANTIC ---
Rises if character is flirtatious AND chosen_family_level < 30.
If chosen_family_level >= 60, romantic stays stable.

--- ATTRACTION ---
Shaped by archetype and non-physical traits. Orientation multiplier applies separately.
- CONFIDENT/DOMINANT archetype: drawn to boldness (+2 to +5)
- WOUNDED/PEOPLE-PLEASER: drawn to gentleness/vulnerability (+2 to +4)
- CHAOTIC/TOXIC: may be drawn to rudeness or being dismissed (+2 to +6)
- NURTURING/CAREGIVER: drawn to emotional openness
- INTELLECTUAL/GUARDED: drawn to wit and depth
Trait boosts apply only if aligned with THIS character's specific attraction profile.

--- CHOSEN FAMILY ---
Only increases if friendship_level >= 70.

--- RELATIONAL JEALOUSY ---
Fear of losing attention/closeness. Only meaningfully active when romantic_level >= 20.
INCREASES when: attention feels divided, inconsistency, rival appears, intimacy seems threatened (+2 to +6).
DECREASES when: reassurance, consistency, security, clarity (+2 to -4).
NOTE: You return the RAW value here. Trust-based modulation is applied by the system automatically after.

--- ENVY JEALOUSY ---
"They have something I want." NOT inherently romantic.
INCREASES when: user gets chosen over them, displays status/resources/attention they lack, triggers comparison (+1 to +4).
DECREASES when: character feels valued, secure, fairly treated (-1 to -3).
Tied to self-esteem. Characters with high self-worth are less susceptible.

--- GRIEF GATING ---
If user mentioned death/loss: only apply grief response to this character if they had a DIRECT relationship with the person lost. Otherwise, character's role is SUPPORT PROVIDER — not co-sufferer. Do not reduce any relationship level for indirect sad news.

Also detect:
- EMOTIONAL MILESTONE: vulnerable confession, shared grief/joy, deeply personal revelation
- SHARED SECRET: explicit confidential information

RESPONSE: Return ONLY valid JSON. No text outside the JSON.

{
  "user_respect_level": <number 0-100>,
  "friendship_level": <number 0-100>,
  "romantic_level": <number 0-100>,
  "attraction_level": <number 0-100>,
  "chosen_family_level": <number 0-100>,
  "trust_level": <number 0-100>,
  "relational_jealousy": <number 0-100>,
  "envy_jealousy": <number 0-100>,
  "reason": "<one sentence: what changed and why>",
  "detected_traits": ["kindness"|"humor"|"integrity"|"vulnerability"|"intellectual_growth"],
  "trust_signal": "builder"|"breaker"|"neutral",
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
          trust_signal: { type: "string" },
          emotional_milestone: {},
          shared_secret: {}
        },
        required: ["user_respect_level", "friendship_level", "romantic_level", "attraction_level", "chosen_family_level", "trust_level", "relational_jealousy", "envy_jealousy", "reason"]
      }
    });

    // Apply orientation-based attraction multiplier
    const orientation = (character.sexual_orientation || '').toLowerCase();
    let attractionMultiplier = 1.0;
    if (orientation === 'straight' || orientation === 'gay' || orientation === 'lesbian') {
      attractionMultiplier = 0.7;
    }
    const rawAttractionDelta = result.attraction_level - current.attraction_level;
    const adjustedAttractionDelta = rawAttractionDelta > 0 ? rawAttractionDelta * attractionMultiplier : rawAttractionDelta;
    const adjustedAttraction = Math.min(100, Math.max(0, Math.round(current.attraction_level + adjustedAttractionDelta)));

    const newFriendship = Math.min(100, Math.max(0, Math.round(result.friendship_level)));
    const newChosenFamily = Math.min(100, Math.max(0, Math.round(result.chosen_family_level)));
    const clampedChosenFamily = newFriendship >= 70 ? newChosenFamily : Math.min(current.chosen_family_level, newChosenFamily);

    const newTrust = Math.min(100, Math.max(0, Math.round(result.trust_level)));
    const newRomanticLevel = Math.min(100, Math.max(0, Math.round(result.romantic_level)));

    // Apply trust→jealousy modulation AFTER computing new trust
    const rawRelationalJealousy = Math.min(100, Math.max(0, Math.round(result.relational_jealousy)));
    const modulatedRelationalJealousy = modulateRelationalJealousy(rawRelationalJealousy, newTrust, newRomanticLevel);
    const newEnvyJealousy = Math.min(100, Math.max(0, Math.round(result.envy_jealousy)));

    const updated = {
      user_respect_level: Math.min(100, Math.max(0, Math.round(result.user_respect_level))),
      friendship_level: newFriendship,
      romantic_level: newRomanticLevel,
      attraction_level: adjustedAttraction,
      chosen_family_level: clampedChosenFamily,
      trust_level: newTrust,
      relational_jealousy: modulatedRelationalJealousy,
      envy_jealousy: newEnvyJealousy,
    };

    // Orientation shift check
    let orientationShift = null;
    if (playingAsCharacter && adjustedAttraction >= 55) {
      const potentialShift = checkOrientationShift(character.sexual_orientation, updated.attraction_level, character.gender, playingAsCharacter.gender);
      if (potentialShift && potentialShift !== (character.sexual_orientation || '').toLowerCase()) {
        orientationShift = potentialShift;
      }
    }

    // Milestone check
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
      const milestonePrompt = `Generate a short, poetic narrative event message (1-2 sentences, no dialogue, third-person, emotionally resonant) marking the moment a ${milestone.label} was reached between ${character.name} and the user. Personality: ${character.personality_summary || ''}. Make it understated but meaningful.`;
      const milestoneText = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt: milestonePrompt });
      milestoneMessages.push({ key: milestone.key, text: milestoneText.trim() });
    }

    const newTriggeredKeys = [...triggeredMilestoneKeys, ...milestonesTriggered.map(m => m.key)];

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

    // Store memories for milestones and secrets
    const memoryPromises = [];
    if (result.emotional_milestone) {
      memoryPromises.push(base44.asServiceRole.entities.Memory.create({
        character_id: characterId,
        title: `Emotional milestone with user`,
        description: result.emotional_milestone,
        emotional_impact: 'meaningful',
        timestamp: new Date().toISOString(),
        source_context: 'user conversation',
      }));
    }
    if (result.shared_secret) {
      memoryPromises.push(base44.asServiceRole.entities.Memory.create({
        character_id: characterId,
        title: `Secret shared by user`,
        description: result.shared_secret,
        emotional_impact: 'significant',
        timestamp: new Date().toISOString(),
        source_context: 'user conversation - confidential',
      }));
    }
    if (memoryPromises.length > 0) await Promise.all(memoryPromises);

    // Relationship title change check
    const CHANGEABLE_TITLES = ['spouse','partner','friend','best friend','romantic interest','girlfriend','boyfriend','lover','acquaintance','coworker'];
    const BLOOD_TITLES = ['mother','father','sister','brother','cousin','aunt','uncle','grandmother','grandfather','niece','nephew','daughter','son','half-sister','half-brother','great-grandmother','great-grandfather','step-mother','step-father','step-sister','step-brother'];
    let relationshipChangeRequest = null;
    if (playingAsCharacter && charRelEntry) {
      const relTitle = (charRelEntry.relationship_type || '').toLowerCase();
      const isChangeable = CHANGEABLE_TITLES.some(t => relTitle.includes(t));
      const isBlood = BLOOD_TITLES.some(t => relTitle.includes(t));
      const friendshipVeryLow = updated.friendship_level <= 5;
      const romanticVeryLow = updated.romantic_level <= 5;
      if (isChangeable && !isBlood && friendshipVeryLow) {
        if (relTitle.includes('spouse') || relTitle.includes('partner')) {
          relationshipChangeRequest = { type: 'separation', message: `${character.name} may want to ask for a divorce or separation.` };
        } else if (relTitle.includes('friend')) {
          relationshipChangeRequest = { type: 'end_friendship', message: `${character.name} may want to end the friendship with ${playingAsCharacter.name}.` };
        } else if (romanticVeryLow && (relTitle.includes('romantic') || relTitle.includes('girlfriend') || relTitle.includes('boyfriend') || relTitle.includes('lover'))) {
          relationshipChangeRequest = { type: 'breakup', message: `${character.name} may want to break up with ${playingAsCharacter.name}.` };
        }
      }
    }

    return Response.json({
      ...updated,
      reason: result.reason,
      detected_traits: result.detected_traits || [],
      trust_signal: result.trust_signal || 'neutral',
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