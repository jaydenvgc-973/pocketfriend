import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

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
];

// Determines if the genders are compatible with the character's orientation for normal attraction speed
function getAttractionSpeedMultiplier(characterOrientation, characterGender, otherGender) {
  const orientation = (characterOrientation || 'not specified').toLowerCase();
  const charGender = (characterGender || '').toLowerCase();
  const targetGender = (otherGender || 'unknown').toLowerCase();

  // User gender is not stored — treat user as unknown gender for now
  // This function is primarily used for inter-character logic
  // For user-character: orientation still matters but we don't know the user's gender

  const isSameGender = charGender && targetGender && charGender === targetGender;
  const isOppositeGender =
    (charGender === 'male' && targetGender === 'female') ||
    (charGender === 'female' && targetGender === 'male');
  const isNonBinary =
    targetGender === 'non-binary' || targetGender === 'other' ||
    targetGender === 'non_binary';

  if (orientation === 'straight') {
    if (isNonBinary) return 0.15;
    if (isSameGender) return 0.1;
    return 1.0;
  }

  if (orientation === 'gay') {
    if (isOppositeGender) return 0.1;
    if (isNonBinary) return 0.5;
    return 1.0;
  }

  // Gay (DL): primarily attracted to same gender but hides it — full same-gender attraction, very slow opposite
  if (orientation === 'gay (dl)') {
    if (isOppositeGender) return 0.05; // extremely slow — maintains straight-presenting facade
    if (isNonBinary) return 0.4;
    return 1.0;
  }

  if (orientation === 'lesbian') {
    if (isOppositeGender) return 0.1;
    return 1.0;
  }

  // Bisexual (DL): attracted to both but keeps same-sex side hidden — moderate dampener on same gender visibility
  if (orientation === 'bisexual (dl)') {
    return 0.8; // slight dampener — still attracted but guarded
  }

  // bisexual, pansexual, queer, asexual, prefer not to say — full speed
  return 1.0;
}

// Determine if orientation should shift based on attraction threshold
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
      // Could shift to bisexual or go DL depending on threshold
      return currentAttractionLevel >= 60 ? 'gay (dl)' : (Math.random() > 0.5 ? 'bisexual' : 'bisexual (dl)');
    }
  }

  if (orientation === 'gay' || orientation === 'lesbian') {
    const isOppositeGender =
      (charGender === 'male' && tgtGender === 'female') ||
      (charGender === 'female' && tgtGender === 'male');
    if (isOppositeGender) return 'bisexual';
  }

  // Gay (DL) with strong same-gender attraction that's been developing — may come out as gay
  if (orientation === 'gay (dl)' && currentAttractionLevel >= 75 && isSameGender) {
    return 'gay'; // gradually stops hiding
  }

  // Bisexual (DL) with very high romantic/attraction — may open up
  if (orientation === 'bisexual (dl)' && currentAttractionLevel >= 80) {
    return 'bisexual';
  }

  return null;
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

    // If the user is playing as another character, use that character's relationship entry
    let playingAsCharacter = null;
    let charRelEntry = null; // the fictional_relationships entry on `character` for the playing-as character
    if (playingAsCharacterId) {
      playingAsCharacter = await base44.asServiceRole.entities.Character.get(playingAsCharacterId);
      if (playingAsCharacter) {
        charRelEntry = (character.fictional_relationships || []).find(r => r.related_character_id === playingAsCharacterId) || null;
      }
    }

    // Current levels: use the fictional_relationship entry if playing as a character, else use top-level user levels
    const current = charRelEntry ? {
      user_respect_level: charRelEntry.user_respect_level ?? 50,
      friendship_level: charRelEntry.friendship_level ?? 75,
      romantic_level: charRelEntry.romantic_level ?? 0,
      attraction_level: charRelEntry.attraction_level ?? 0,
      chosen_family_level: charRelEntry.chosen_family_level ?? 0,
    } : {
      user_respect_level: character.user_respect_level ?? 50,
      friendship_level: character.friendship_level ?? 75,
      romantic_level: character.romantic_level ?? 0,
      attraction_level: character.attraction_level ?? 0,
      chosen_family_level: character.chosen_family_level ?? 0,
    };

    const senderLabel = playingAsCharacter ? playingAsCharacter.name : 'User';
    const conversationSummary = (recentMessages || [])
      .slice(-10)
      .map(m => `${m.sender_type === 'user' ? senderLabel : character.name}: ${m.content}`)
      .join('\n');

    let interactionSection = '';
    if (emojiReaction) {
      const senderLabel = reactedMessageSenderType === 'user' ? (playingAsCharacter ? playingAsCharacter.name : 'the User') : `${character.name} (the character)`;
      interactionSection = `
EMOJI REACTION EVENT:
The user reacted with "${emojiReaction}" to a message sent by ${senderLabel}.
The reacted-to message content was: "${reactedMessageContent || '(image or unknown content)'}"

EMOJI REACTION RULES — interpret this carefully:
- A single emoji is NOT a full message. Its meaning is heavily shaped by context.
- ❤️ (Heart): Could mean romantic interest, strong approval, warmth, or platonic love. If romantic_level > 40, lean romantic (+2 to +4 romantic). If romantic_level < 20 and friendship_level > 50, lean platonic warmth (+2 to +3 friendship).
- 😂 (Laughing): Signals the user finds the character funny or charming. Can boost friendship (+1 to +3) and attraction (+1 to +2) if the character values humor.
- 😮 (Surprised/Wow): Shows the user is impressed or caught off guard. Context-dependent — if impressive, raises respect (+1 to +3).
- 😢 (Sad/Crying): If reacting to something emotional the character shared, signals empathy (+2 to +4 friendship).
- 😡 (Angry): Signals disapproval (-2 to -4 friendship, -1 to -3 respect) unless context suggests protectiveness.
- 👍 (Like): Neutral approval. Small boost to friendship (+1 to +2) or respect (+1).
- GENERAL: If the emoji is used on a photo the character sent of themselves, DOUBLE the potential attraction/romantic impact.`;
    } else {
      interactionSection = `
LATEST USER MESSAGE: "${userMessage}"
CHARACTER'S REPLY: "${characterReply || ''}"

NON-PHYSICAL ATTRACTION TRAIT DETECTION — scan the user's message carefully:
Detect any of the following traits the user demonstrated. Each detected trait contributes to attraction_level based on whether it aligns with this character's specific attraction profile and archetype. Award +1 to +4 per trait detected, modified by the orientation multiplier.

KINDNESS: Did the user show genuine warmth, empathy, or care without being asked?
HUMOR: Did the user make the character laugh, show wit, or playful banter?
INTEGRITY: Did the user demonstrate honesty, moral backbone, or standing by their values even when it was hard?
VULNERABILITY: Did the user open up emotionally, admit something difficult, or share a fear/insecurity?
INTELLECTUAL GROWTH: Did the user share something they learned, engage in meaningful ideas, or stimulate the character intellectually?

For each trait detected — also consider: does this trait align with what THIS CHARACTER specifically finds attractive based on their archetype and personality? Only award attraction boosts for traits this specific character would respond to.`;
    }

    const WORLD_CONTEXT = `
WORLD CONTEXT (the real world these characters live in — use this to inform how people behave, what they care about, and what shapes their lives):
The average American sleeps ~9 hours, spends ~5 hours on leisure (TV, socializing, gaming), works 3.5–8 hours, does ~2 hours of chores, and checks their phone ~58 times/day. About 24% work remotely. 74% of high school seniors aspire to college but only ~61% enroll. Cost is the #1 barrier. ~1 in 5 Americans has an STI at any given time; ages 15–24 account for half of new STIs. The U.S. incarcerates over 2 million people; rights exist on paper but enforcement is inconsistent; innocent Black people are 7x more likely to be wrongly convicted of murder. Religion functions as a coping mechanism especially under systemic stress — people stay for meaning, community, and moral grounding; people leave due to trauma, hypocrisy, or identity conflict. Youth gang involvement is driven by poverty, neighborhood instability, weak school ties, and the pull of belonging and protection. The homelessness-jail cycle pushes unhoused people deeper into instability through fines, warrants, and property seizure.
`.trim();

    const interactingPartyDesc = playingAsCharacter
      ? `INTERACTING PARTY: ${playingAsCharacter.name} (another character — ${playingAsCharacter.age_range || ''} ${playingAsCharacter.gender || ''}, personality: ${playingAsCharacter.personality_summary || ''}, archetype: ${playingAsCharacter.archetype || ''}, orientation: ${playingAsCharacter.sexual_orientation || ''})`
      : `INTERACTING PARTY: The user (unknown gender)`;

    const prompt = `You are a relationship dynamics analyzer. Analyze this interaction and update the relationship levels between the two characters.

${WORLD_CONTEXT}

CHARACTER (whose feelings we are analyzing): ${character.name}
CHARACTER ARCHETYPE: ${character.archetype || 'unknown'}
CHARACTER PERSONALITY: ${character.personality_summary || ''}
PERSONALITY TRAITS: ${(character.personality_traits || []).join(', ') || 'none specified'}
EMOTIONAL TRIGGERS (what deeply affects this character): ${(character.emotional_triggers_deep || []).join(', ') || 'none specified'}
COMMUNICATION STYLE: ${character.communication_style || 'unknown'}
EMOTIONAL BAGGAGE: ${character.emotional_baggage || 'none specified'}
SEXUAL ORIENTATION: ${character.sexual_orientation || 'not specified'}
CHARACTER GENDER: ${character.gender || 'not specified'}
INTERESTS & HOBBIES: ${character.current_situation || 'not specified'}

${interactingPartyDesc}

CURRENT RELATIONSHIP LEVELS (0-100):
- Respect: ${current.user_respect_level}
- Friendship: ${current.friendship_level}
- Romantic: ${current.romantic_level}
- Attraction: ${current.attraction_level}
- Chosen Family: ${current.chosen_family_level}

RECENT CONVERSATION CONTEXT:
${conversationSummary || 'No prior context.'}
${interactionSection}

RELATIONSHIP RULES — apply these carefully:

--- FRIENDSHIP ---
1. FRIENDSHIP drops slowly and only when RESPECT is also low. If respect >= 50, friendship is resistant to drops.
   POSITIVE triggers (+1 to +4): User shares personal story, offers genuine emotional support, casual warm conversation, remembers something the character mentioned.
   NEGATIVE triggers (-2 to -6): Betrays trust, consistently dismisses character's feelings, goes cold without explanation.

--- RESPECT ---
2. RESPECT drops if the user is consistently dismissive, rude, or disrespectful.
   POSITIVE triggers (+2 to +6): Good thoughtful advice, demonstrated competence, integrity, keeps promises, active listening.
   NEGATIVE triggers (-3 to -8): Dismissive, rude, mocking, caught lying, gives careless advice.

--- ROMANTIC ---
3. ROMANTIC rises more easily if character is flirtatious by nature AND chosen_family_level < 30. If chosen_family_level >= 60, romantic stays stable.
   POSITIVE: User flirts referencing character's specific interests, expresses tailored admiration, creates playful vulnerability.
   NEGATIVE: Generic flirting, romantic overtures that clash with character's values, pushing when character signals discomfort.

--- ATTRACTION (NON-PHYSICAL TRAITS — CRITICAL SECTION) ---
4. ATTRACTION is shaped by archetype AND now importantly by demonstrated non-physical traits. The user's gender is unknown — focus on behavioral and personality-based attraction signals.
   ARCHETYPE-BASED ATTRACTION:
   - CONFIDENT or DOMINANT: drawn to boldness and assertiveness (+2 to +5).
   - WOUNDED or PEOPLE-PLEASER: drawn to softness, gentleness, or vulnerability (+2 to +4).
   - CHAOTIC, TOXIC, or SELF-DESTRUCTIVE: may be pulled in by rudeness or being dismissed (+2 to +6).
   - NURTURING or CAREGIVER: drawn to emotional openness and vulnerability.
   - INTELLECTUAL or GUARDED: drawn to wit, depth, mental stimulation.
   
   NON-PHYSICAL TRAIT REWARDS (applies on top of archetype, only if user demonstrated the trait):
   - KINDNESS detected → +1 to +3 if character is wounded/nurturing/caregiver archetype, +1 to +2 otherwise
   - HUMOR detected → +1 to +3 if character values levity or is charismatic/charmer type
   - INTEGRITY detected → +1 to +3 for characters with loyalty/respect-based values
   - VULNERABILITY detected → +1 to +4 for wounded/caregiver archetypes, +1 to +2 for guarded types
   - INTELLECTUAL GROWTH detected → +1 to +4 for intellectual/achiever/seeker archetypes
   
   IMPORTANT: If the detected traits do NOT align with this character's specific attraction profile, give minimal or zero attraction boost. Not every behavior attracts every character.

--- CHOSEN FAMILY ---
5. CHOSEN FAMILY: Only starts increasing once friendship_level >= 70.
   - Genuine thoughtful advice: +2 to +4
   - Checking in on how character feels: +2 to +5
   - Allowing the character to vent: +3 to +6
   - Consistent warmth: +1 to +2
   - Deep loyalty during hard moment: +3 to +6
   NEGATIVE: Breaking significant promise: -3 to -7. Disappearing after vulnerable moment: -2 to -5.
   If friendship_level < 70, chosen_family CANNOT increase.

--- GENERAL ---
6. DISRESPECT generally lowers respect -3 to -8. EXCEPTION: for toxic/chaotic archetypes, disrespect may raise attraction.
7. Changes should be small and realistic — max ±10 per interaction unless something dramatically significant happened.
8. Levels are clamped between 0 and 100.

Also detect if this interaction contained:
- An EMOTIONAL MILESTONE: a vulnerable confession, shared grief/joy, a deeply personal revelation
- A SHARED SECRET: explicit confidential information shared by the user

Respond with ONLY a valid JSON object in this exact format:
{
  "user_respect_level": <number>,
  "friendship_level": <number>,
  "romantic_level": <number>,
  "attraction_level": <number>,
  "chosen_family_level": <number>,
  "reason": "<one concise sentence explaining what changed and why>",
  "detected_traits": ["kindness"|"humor"|"integrity"|"vulnerability"|"intellectual_growth"],
  "emotional_milestone": "<brief description of milestone if detected, or null>",
  "shared_secret": "<brief description of the secret if detected, or null>"
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
          reason: { type: "string" },
          detected_traits: { type: "array", items: { type: "string" } },
          emotional_milestone: {},
          shared_secret: {}
        },
        required: ["user_respect_level", "friendship_level", "romantic_level", "attraction_level", "chosen_family_level", "reason"]
      }
    });

    // Apply orientation-based attraction multiplier
    // For user-character we don't know user's gender, so we use a neutral multiplier (0.7 for unknown) unless orientation is open
    const orientation = (character.sexual_orientation || '').toLowerCase();
    let attractionMultiplier = 1.0;
    if (orientation === 'straight' || orientation === 'gay' || orientation === 'lesbian') {
      attractionMultiplier = 0.7;
    } else if (orientation === 'gay (dl)') {
      // Very guarded about attraction — extra dampened with unknown user
      attractionMultiplier = 0.5;
    } else if (orientation === 'bisexual (dl)') {
      attractionMultiplier = 0.65;
    }

    // Calculate raw attraction delta and apply multiplier
    const rawAttractionDelta = result.attraction_level - current.attraction_level;
    const adjustedAttractionDelta = rawAttractionDelta > 0
      ? rawAttractionDelta * attractionMultiplier
      : rawAttractionDelta;
    const adjustedAttraction = Math.min(100, Math.max(0, Math.round(current.attraction_level + adjustedAttractionDelta)));

    const newFriendship = Math.min(100, Math.max(0, Math.round(result.friendship_level)));
    const newChosenFamily = Math.min(100, Math.max(0, Math.round(result.chosen_family_level)));
    const clampedChosenFamily = newFriendship >= 70
      ? newChosenFamily
      : Math.min(current.chosen_family_level, newChosenFamily);

    const updated = {
      user_respect_level: Math.min(100, Math.max(0, Math.round(result.user_respect_level))),
      friendship_level: newFriendship,
      romantic_level: Math.min(100, Math.max(0, Math.round(result.romantic_level))),
      attraction_level: adjustedAttraction,
      chosen_family_level: clampedChosenFamily,
    };

    // Check for orientation shift (user gender unknown — skip orientation shift for user-character)
    // Orientation shifts only apply in inter-character interactions where genders are known

    // Check for milestones crossed
    const milestonesTriggered = [];
    const triggeredMilestoneKeys = character.triggered_milestones || [];

    for (const milestone of MILESTONES) {
      const key = `${milestone.field}_${milestone.threshold}`;
      if (triggeredMilestoneKeys.includes(key)) continue;
      const before = current[milestone.field];
      const after = updated[milestone.field];
      if (before < milestone.threshold && after >= milestone.threshold) {
        milestonesTriggered.push({ ...milestone, key });
      }
    }

    // Generate milestone narrative messages
    const milestoneMessages = [];
    for (const milestone of milestonesTriggered) {
      const milestonePrompt = `Generate a short, poetic narrative event message (1-2 sentences, no dialogue, third-person, emotionally resonant) that marks the moment a ${milestone.label} was reached between ${character.name} and the user. The character's personality: ${character.personality_summary || ''}. Make it feel like a milestone was quietly crossed — meaningful but understated.`;
      const milestoneText = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt: milestonePrompt });
      milestoneMessages.push({ key: milestone.key, text: milestoneText.trim() });
    }

    // Persist milestones as narrative messages in the conversation (returned to caller to inject)
    const newTriggeredKeys = [...triggeredMilestoneKeys, ...milestonesTriggered.map(m => m.key)];

    let characterUpdatePayload;
    if (playingAsCharacter && charRelEntry) {
      // Update the fictional_relationships entry for the playing-as character on this character
      const updatedFictionalRels = (character.fictional_relationships || []).map(r =>
        r.related_character_id === playingAsCharacterId
          ? { ...r, ...updated }
          : r
      );
      characterUpdatePayload = {
        fictional_relationships: updatedFictionalRels,
        triggered_milestones: newTriggeredKeys,
      };

      // Also update the reverse relationship entry on the playing-as character
      const reverseRels = (playingAsCharacter.fictional_relationships || []);
      const reverseEntry = reverseRels.find(r => r.related_character_id === characterId);
      if (reverseEntry) {
        // Reverse: update the playing-as character's view of this character independently
        // We don't auto-mirror — each character has their own feelings
        // Just ensure the entry exists; actual updates happen when chat is initiated from playing-as side
      }
    } else {
      characterUpdatePayload = {
        ...updated,
        triggered_milestones: newTriggeredKeys,
      };
    }

    await base44.asServiceRole.entities.Character.update(characterId, characterUpdatePayload);

    // Store emotional milestone and shared secret in Memory
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

    // Check if a relationship title should change due to very low levels
    // Only applies to non-blood relationships (spouse, partner, friend, romantic interest)
    const CHANGEABLE_TITLES = ['spouse', 'partner', 'friend', 'best friend', 'romantic interest', 'girlfriend', 'boyfriend', 'lover', 'acquaintance', 'coworker'];
    const BLOOD_TITLES = ['mother', 'father', 'sister', 'brother', 'cousin', 'aunt', 'uncle', 'grandmother', 'grandfather', 'niece', 'nephew', 'daughter', 'son', 'half-sister', 'half-brother', 'great-grandmother', 'great-grandfather', 'step-mother', 'step-father', 'step-sister', 'step-brother'];

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
    } else if (!playingAsCharacter) {
      // User-character: check top-level levels
      const relWithUser = (character.fictional_relationships || []).find(r => !r.related_character_id);
      // No title change logic for user<->character — not applicable in same way
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