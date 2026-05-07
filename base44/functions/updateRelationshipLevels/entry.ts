import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── ARC ENGINE (inlined — Deno cannot import local lib files) ─────────────────
const ARC_STATES = {
  growing: 'growing', stable: 'stable', volatile: 'volatile',
  declining: 'declining', fractured: 'fractured', recovering: 'recovering',
  fragile: 'fragile', strained: 'strained', toxic_pattern: 'toxic_pattern_detected',
};

function deriveArcState(bars, deltaHistory = []) {
  const trust = bars.trust_level ?? 50;
  const respect = bars.user_respect_level ?? 50;
  const friendship = bars.friendship_level ?? 50;
  const rj = bars.relational_jealousy ?? 0;
  const recent = (deltaHistory || []).slice(0, 10);
  const trustDeltas = recent.filter(d => d.field === 'trust_level');
  const negativeTrustCount = trustDeltas.filter(d => d.delta < -5).length;
  const positiveTrustCount = trustDeltas.filter(d => d.delta > 3).length;
  let repairPattern = false;
  const allDeltas = recent.map(d => d.delta);
  for (let i = 0; i < allDeltas.length - 1; i++) {
    if (allDeltas[i] < -5 && allDeltas[i + 1] > 3) { repairPattern = true; break; }
  }
  let toxicLoopScore = 0;
  for (const d of trustDeltas) {
    if (d.delta < -8) toxicLoopScore += 2;
    else if (d.delta > 2 && d.delta < 6) toxicLoopScore += 1;
  }
  const meaningfulEvents = recent.filter(d => Math.abs(d.delta) > 3).length;
  if (toxicLoopScore >= 5 && negativeTrustCount >= 2) return ARC_STATES.toxic_pattern;
  if (trust < 25 && respect < 30) return ARC_STATES.fractured;
  if (trust < 40 && negativeTrustCount >= 2 && positiveTrustCount === 0) return ARC_STATES.declining;
  if (trust < 45 && rj > 55) return ARC_STATES.strained;
  if (repairPattern && trust >= 40) return ARC_STATES.recovering;
  if (trust < 45 && meaningfulEvents < 2) return ARC_STATES.fragile;
  if (positiveTrustCount >= 2 && trust >= 55 && friendship >= 55) return ARC_STATES.growing;
  if (trustDeltas.length >= 3) {
    const vals = trustDeltas.map(d => d.delta);
    if (Math.max(...vals) - Math.min(...vals) > 20) return ARC_STATES.volatile;
  }
  return ARC_STATES.stable;
}

function getArcModifiers(arcState) {
  const m = { trust_gain: 1.0, trust_loss: 1.0, forgiveness: 0, patience_penalty: 0, rj_floor: 0, respect_repair: 1.0 };
  switch (arcState) {
    case ARC_STATES.growing:      m.trust_gain = 1.2; m.forgiveness = 5; m.respect_repair = 1.2; break;
    case ARC_STATES.recovering:   m.trust_gain = 1.15; m.trust_loss = 1.2; m.forgiveness = 8; break;
    case ARC_STATES.fragile:      m.trust_loss = 1.3; m.patience_penalty = 10; break;
    case ARC_STATES.strained:     m.trust_gain = 0.8; m.trust_loss = 1.3; m.rj_floor = 8; m.patience_penalty = 15; break;
    case ARC_STATES.declining:    m.trust_gain = 0.6; m.trust_loss = 1.4; m.patience_penalty = 20; m.rj_floor = 10; break;
    case ARC_STATES.fractured:    m.trust_gain = 0.4; m.trust_loss = 1.5; m.patience_penalty = 30; m.rj_floor = 15; m.respect_repair = 0.5; break;
    case ARC_STATES.volatile:     m.trust_gain = 0.9; m.trust_loss = 1.3; m.patience_penalty = 15; m.rj_floor = 5; break;
    case ARC_STATES.toxic_pattern: m.trust_gain = 0.3; m.trust_loss = 1.6; m.patience_penalty = 35; m.rj_floor = 20; m.forgiveness = -10; m.respect_repair = 0.3; break;
  }
  return m;
}

function applyArcModifiers(current, proposed, arcState) {
  const mods = getArcModifiers(arcState);
  const result = { ...proposed };
  const trustDelta = proposed.trust_level - current.trust_level;
  if (trustDelta > 0) {
    result.trust_level = Math.min(100, Math.max(0, Math.round(current.trust_level + trustDelta * mods.trust_gain + mods.forgiveness)));
  } else if (trustDelta < 0) {
    result.trust_level = Math.min(100, Math.max(0, Math.round(current.trust_level + trustDelta * mods.trust_loss)));
  }
  const respectDelta = proposed.user_respect_level - current.user_respect_level;
  if (respectDelta > 0) {
    result.user_respect_level = Math.min(100, Math.max(0, Math.round(current.user_respect_level + respectDelta * mods.respect_repair)));
  }
  if (mods.rj_floor > 0) {
    result.relational_jealousy = Math.min(100, Math.max(mods.rj_floor, result.relational_jealousy));
  }
  return result;
}

// ── UNIVERSAL SCALE BANDS ─────────────────────────────────────────────────────
// Range → Behavior label (used in LLM context to prevent semantic drift)
const SCALE_BANDS = {
  respect: [
    [0,10,'Contempt/dismissive'],
    [11,25,'Belittling/not taken seriously'],
    [26,40,'Doubtful/low regard'],
    [41,60,'Neutral/situational respect'],
    [61,75,'Values opinions/listens'],
    [76,90,'Admiration/strong regard'],
    [91,100,'Deep admiration/looks up to them'],
  ],
  trust: [
    [0,10,'Expects betrayal'],
    [11,25,'Highly suspicious'],
    [26,40,'Guarded/cautious'],
    [41,60,'Conditional trust'],
    [61,75,'Comfortable opening up'],
    [76,90,'Strong emotional safety'],
    [91,100,'Complete trust/full vulnerability'],
  ],
  friendship: [
    [0,10,'Avoids interaction'],
    [11,25,'Dislikes presence'],
    [26,40,'Distant/minimal bonding'],
    [41,60,'Casual friendliness'],
    [61,75,'Enjoys time together'],
    [76,90,'Close friend'],
    [91,100,'Best friend level'],
  ],
  romance: [
    [0,10,'No romantic feeling'],
    [11,25,'Disinterest'],
    [26,40,'Slight curiosity'],
    [41,60,'Growing feelings'],
    [61,75,'Emotional attachment'],
    [76,90,'Strong romantic bond'],
    [91,100,'Deep love/defining attachment'],
  ],
  attraction: [
    [0,10,'No attraction'],
    [11,25,'Minimal interest'],
    [26,40,'Mild attraction'],
    [41,60,'Noticeable pull'],
    [61,75,'Strong attraction'],
    [76,90,'Intense desire'],
    [91,100,'Magnetic/overwhelming'],
  ],
  relational_jealousy: [
    [0,10,'Completely secure'],
    [11,25,'Rare concern'],
    [26,40,'Mild sensitivity'],
    [41,60,'Notices attention shifts'],
    [61,75,'Feels threatened sometimes'],
    [76,90,'Reactive/protective'],
    [91,100,'Possessive/highly insecure'],
  ],
  envy_jealousy: [
    [0,10,'No comparison'],
    [11,25,'Slight awareness'],
    [26,40,'Occasional comparison'],
    [41,60,'Wants similar things'],
    [61,75,'Frustration/desire'],
    [76,90,'Resentment/fixation'],
    [91,100,'Obsessive comparison'],
  ],
  chosen_family: [
    [0,10,'No bond'],
    [11,25,'Acquaintance'],
    [26,40,'Light connection'],
    [41,60,'Familiar'],
    [61,75,'Strong bond'],
    [76,90,'Deep loyalty'],
    [91,100,'Permanent inner circle'],
  ],
};

function getBandLabel(dimension, value) {
  const bands = SCALE_BANDS[dimension];
  if (!bands) return '';
  const band = bands.find(([lo, hi]) => value >= lo && value <= hi);
  return band ? band[2] : '';
}

// ── CHANGE MAGNITUDE LIMITS PER EVENT SIZE ───────────────────────────────────
// Small: ±1–3 | Meaningful: ±4–8 | Major: ±9–15 | Defining: ±16–25
const MAX_SINGLE_TURN_DELTA = 25; // hard cap — no 0→100 jumps ever

function clampDelta(proposed, current, max = MAX_SINGLE_TURN_DELTA) {
  const delta = proposed - current;
  const clamped = Math.sign(delta) * Math.min(Math.abs(delta), max);
  return Math.min(100, Math.max(0, Math.round(current + clamped)));
}

// ── TRUST SLOW-REBUILD GATE ───────────────────────────────────────────────────
// After betrayal (trust < 30), recovery is capped at +3/turn until rebuilt
function clampTrustRebuild(proposed, current) {
  const delta = proposed - current;
  if (current < 30 && delta > 3) {
    return Math.min(100, Math.round(current + 3));
  }
  return clampDelta(proposed, current);
}

// ── TRUST → RELATIONAL JEALOUSY MODULATION ───────────────────────────────────
// Higher trust dampens insecurity-driven relational jealousy.
// Only applies meaningfully when romantically attached.
function modulateRelationalJealousy(rawRJ, trust, romantic) {
  if (romantic < 20) return rawRJ;
  // trust=100 → -20% | trust=50 → 0% | trust=0 → +20%
  const mod = (50 - trust) / 250;
  return Math.min(100, Math.max(0, Math.round(rawRJ * (1 + mod))));
}

// ── INFIDELITY RISK (derived, not stored) ────────────────────────────────────
// Score = (100-respect)*0.35 + (100-trust)*0.30 + externalAttraction*0.20 + resentment*0.15
function computeInfidelityRisk(respect, trust, externalAttraction = 0, resentment = 0) {
  const score = (100 - respect) * 0.35 + (100 - trust) * 0.30 + externalAttraction * 0.20 + resentment * 0.15;
  if (score <= 25) return 'very_low';
  if (score <= 50) return 'low';
  if (score <= 70) return 'moderate';
  if (score <= 85) return 'high';
  return 'very_high';
}

// ── DECAY SIMULATION (per cycle, called when relevant) ───────────────────────
// Trust: -1/cycle | Romance: -1 to -2 | Friendship: -1 | Jealousy: slow decay | Respect: stable
function applyDecay(current, hoursElapsed) {
  if (!hoursElapsed || hoursElapsed < 24) return current;
  const days = hoursElapsed / 24;
  return {
    trust_level: Math.max(0, Math.round(current.trust_level - days * 1)),
    romance: Math.max(0, Math.round(current.romantic_level - days * 1.5)),
    friendship: Math.max(0, Math.round(current.friendship_level - days * 1)),
    relational_jealousy: Math.max(0, Math.round(current.relational_jealousy - days * 0.5)),
    envy_jealousy: Math.max(0, Math.round(current.envy_jealousy - days * 0.5)),
  };
  // respect is NOT decayed — it's stable unless actively damaged
}

// ── MILESTONES ────────────────────────────────────────────────────────────────
const MILESTONES = [
  { field: 'friendship_level', threshold: 25, label: 'a budding friendship' },
  { field: 'friendship_level', threshold: 50, label: 'a genuine friendship' },
  { field: 'friendship_level', threshold: 75, label: 'a deep friendship' },
  { field: 'romantic_level', threshold: 25, label: 'a romantic spark' },
  { field: 'romantic_level', threshold: 50, label: 'real romantic feelings' },
  { field: 'romantic_level', threshold: 75, label: 'a deep romantic bond' },
  { field: 'chosen_family_level', threshold: 25, label: 'feeling like family' },
  { field: 'chosen_family_level', threshold: 50, label: 'a chosen family bond' },
  { field: 'chosen_family_level', threshold: 75, label: 'an unbreakable family bond' },
  { field: 'attraction_level', threshold: 30, label: 'noticeable attraction' },
  { field: 'attraction_level', threshold: 60, label: 'strong attraction' },
  { field: 'trust_level', threshold: 50, label: 'genuine trust' },
  { field: 'trust_level', threshold: 75, label: 'deep trust' },
];

// ── ATTRACTION ORIENTATION MULTIPLIER ────────────────────────────────────────
function getAttractionMultiplier(orientation, charGender, targetGender) {
  const o = (orientation || '').toLowerCase();
  const cg = (charGender || '').toLowerCase();
  const tg = (targetGender || 'unknown').toLowerCase();
  const same = cg && tg && cg === tg;
  const opposite = (cg === 'male' && tg === 'female') || (cg === 'female' && tg === 'male');
  const nb = tg === 'non-binary' || tg === 'other';
  if (o === 'straight') { if (nb) return 0.15; if (same) return 0.1; return 1.0; }
  if (o === 'gay' || o === 'gay (dl)') { if (opposite) return 0.1; if (nb) return 0.5; return 1.0; }
  if (o === 'lesbian') { if (opposite) return 0.1; return 1.0; }
  return 1.0;
}

// ── ORIENTATION SHIFT ─────────────────────────────────────────────────────────
function checkOrientationShift(orientation, attractionLevel, charGender, targetGender) {
  const o = (orientation || '').toLowerCase();
  const cg = (charGender || '').toLowerCase();
  const tg = (targetGender || '').toLowerCase();
  if (attractionLevel < 30) return null;
  const same = cg && tg && cg === tg;
  const nb = tg === 'non-binary' || tg === 'other';
  const opposite = (cg === 'male' && tg === 'female') || (cg === 'female' && tg === 'male');
  if (o === 'straight') {
    if (nb) return 'pansexual';
    if (same) return (cg === 'male' && attractionLevel >= 50 && Math.random() > 0.6) ? 'gay (dl)' : (Math.random() > 0.5 ? 'bisexual' : 'prefer not to say');
  }
  if (o === 'gay' || o === 'gay (dl)' || o === 'lesbian') {
    if (opposite) return 'bisexual';
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

    // CRITICAL VALIDATION: Character must exist and belong to current user
    // owner_email is the authoritative ownership field — created_by is legacy-only fallback
    let chars = await base44.asServiceRole.entities.Character.filter({
      id: characterId,
      owner_email: user.email
    });
    // Legacy fallback: older characters may have owner_email missing — try created_by
    if (!chars || chars.length === 0) {
      chars = await base44.asServiceRole.entities.Character.filter({
        id: characterId,
        created_by: user.email
      });
    }
    const character = chars?.[0];
    if (!character) {
      console.warn(`[updateRelationshipLevels] Character ${characterId} not found or not owned by ${user.email}`);
      return Response.json({ error: 'Character not found or access denied' }, { status: 404 });
    }

    // ── FETCH MEMORIES FOR ARC STATE DETECTION ────────────────────────────────
    const recentMemories = await base44.asServiceRole.entities.Memory.filter(
      { character_id: characterId }, '-timestamp', 20
    ).catch(() => []);

    let playingAsCharacter = null;
    let charRelEntry = null;
    if (playingAsCharacterId) {
      // VALIDATION: playingAsCharacter must belong to current user
      // owner_email is authoritative; legacy fallback to created_by
      let playingChars = await base44.asServiceRole.entities.Character.filter({ id: playingAsCharacterId, owner_email: user.email });
      if (!playingChars || playingChars.length === 0) {
        playingChars = await base44.asServiceRole.entities.Character.filter({ id: playingAsCharacterId, created_by: user.email });
      }
      playingAsCharacter = playingChars?.[0] || null;
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

    // ── BUILD BAND LABELS for LLM context ────────────────────────────────────
    const bandContext = `
CURRENT STATE WITH SEMANTIC MEANING (use this to prevent contradictions):
- Respect: ${current.user_respect_level}/100 → "${getBandLabel('respect', current.user_respect_level)}"
- Trust: ${current.trust_level}/100 → "${getBandLabel('trust', current.trust_level)}"
- Friendship: ${current.friendship_level}/100 → "${getBandLabel('friendship', current.friendship_level)}"
- Romantic: ${current.romantic_level}/100 → "${getBandLabel('romance', current.romantic_level)}"
- Attraction: ${current.attraction_level}/100 → "${getBandLabel('attraction', current.attraction_level)}"
- Relational Jealousy: ${current.relational_jealousy}/100 → "${getBandLabel('relational_jealousy', current.relational_jealousy)}"
- Envy Jealousy: ${current.envy_jealousy}/100 → "${getBandLabel('envy_jealousy', current.envy_jealousy)}"
- Chosen Family: ${current.chosen_family_level}/100 → "${getBandLabel('chosen_family', current.chosen_family_level)}"`;

    const senderLabel = playingAsCharacter ? playingAsCharacter.name : 'User';
    const conversationSummary = (recentMessages || [])
      .slice(-10)
      .map(m => `${m.sender_type === 'user' ? senderLabel : character.name}: ${m.content}`)
      .join('\n');

    let interactionSection = '';
    if (emojiReaction) {
      interactionSection = `
EMOJI REACTION EVENT:
Reactor reacted with "${emojiReaction}" to: "${reactedMessageContent || '(image)'}" (sent by ${reactedMessageSenderType === 'user' ? senderLabel : character.name})

EMOJI CHANGE RULES (small interactions — ±1 to ±3 max each):
- ❤️: +Trust 1–3, +Romance 2–4 if romance>40 else +Friendship 2–3
- 😂: +Friendship 1–3, +Attraction 1–2 if character values humor
- 😮: +Respect 1–3 if message was impressive/competent
- 😢: +Friendship 2–4 (empathy), +Trust 1–2 (opening up)
- 😡: -Friendship 2–4, -Respect 1–3
- 👍: +Friendship 1–2 or +Respect 1`;
    } else {
      interactionSection = `
LATEST USER MESSAGE: "${userMessage}"
CHARACTER'S REPLY: "${characterReply || ''}"

CHANGE MAGNITUDE RULES (strict — enforced by post-processing):
- Small interaction: ±1 to ±3
- Meaningful interaction: ±4 to ±8
- Major event (betrayal, deep confession, defense): ±9 to ±15
- Defining event (only rare, life-altering): ±16 to ±25
- HARD CAP: No single field may change more than ±25 in one turn. No 0→100 in one event.

TRIGGER TABLE (approximate values per event type):
POSITIVE:
  Emotional support → +Trust 5–10, +Friendship 4–8
  Deep conversation → +Trust 6–12, +Respect 3–6
  Consistent behavior → +Trust 2–5
  Showing competence → +Respect 4–10
  Defending them → +Respect 6–12, +Trust 5–8
  Loyalty moment → +Trust 8–15, +Respect 5–10
  Shared joy → +Friendship 5–10
  Romantic moment → +Romance 6–12, +Attraction 4–8
  Physical chemistry → +Attraction 6–12
  Reassurance → -Relational Jealousy 5–10, +Trust 4–8

NEGATIVE:
  Lying → -Trust 10–20
  Broken promise → -Trust 6–12
  Disrespect → -Respect 8–18
  Embarrassment (them) → -Respect 5–12, -Trust 3–6
  Ignoring → -Friendship 4–8, +Relational Jealousy 3–6
  Flirting with others → +Relational Jealousy 6–15, -Trust 4–10
  Emotional distance → -Romance 5–10, -Trust 3–6
  Betrayal → -Trust 15–30, -Respect 10–20 (capped at ±25)
  Comparison trigger → +Envy Jealousy 6–12
  Rival appears → +Relational Jealousy 8–18

COMPLEX:
  Trust ↓ → Relational Jealousy ↑ (system handles this automatically)
  Reassurance → Trust ↑, Jealousy ↓, Romance stabilizes
  Respect < 30 → Loyalty risk increases sharply (system derives this)

NON-PHYSICAL ATTRACTION TRAIT DETECTION:
  KINDNESS, HUMOR, INTEGRITY, VULNERABILITY, INTELLECTUAL_GROWTH, RELIABILITY, EMOTIONAL_SAFETY
  Only boost attraction for traits this character archetype responds to.`;
    }

    const interactingPartyDesc = playingAsCharacter
      ? `INTERACTING PARTY: ${playingAsCharacter.name} (another character — ${playingAsCharacter.age_range || ''} ${playingAsCharacter.gender || ''}, personality: ${playingAsCharacter.personality_summary || ''}, archetype: ${playingAsCharacter.archetype || ''}, orientation: ${playingAsCharacter.sexual_orientation || ''})`
      : `INTERACTING PARTY: The user (unknown gender)`;

    // ── DYNAMIC LABEL RESOLUTION (score-driven visible label) ────────────────
    // Derives what the relationship actually IS right now from scores,
    // not from static tags — prevents stale contradictions in LLM context.
    function resolveDynamicLabel(scores, existingTag) {
      const { friendship_level: f = 50, trust_level: t = 50, romantic_level: r = 0, attraction_level: a = 0, chosen_family_level: cf = 0, user_respect_level: resp = 50 } = scores || {};
      const tag = (existingTag || '').toLowerCase().trim();
      const bloodTags = new Set(['mother','father','son','daughter','sister','brother','grandmother','grandfather','aunt','uncle','niece','nephew','cousin','half-sister','half-brother','step-mother','step-father']);
      if (bloodTags.has(tag) || tag.includes('mother') || tag.includes('father') || tag.includes('sister') || tag.includes('brother')) return { label: existingTag, naturalSpeech: existingTag };
      if (t <= 10 && resp <= 15) return { label: 'Enemy', naturalSpeech: 'someone I want nothing to do with' };
      if (t <= 15 && f <= 15) return { label: 'Estranged', naturalSpeech: 'someone I used to know — we\'re not talking' };
      if (t <= 25 && resp <= 20 && f <= 25) return { label: 'Distrustful', naturalSpeech: 'someone I keep at a distance' };
      if (r >= 80 && t >= 70) { if (tag.includes('spouse') || tag.includes('married')) return { label: 'Spouse', naturalSpeech: 'my husband / my wife / my spouse' }; return { label: 'Partner', naturalSpeech: 'my partner / my boyfriend / my girlfriend / my person' }; }
      if (r >= 60 && t >= 55 && a >= 40) return { label: 'Dating', naturalSpeech: 'someone I\'m seeing / we\'re together / my boyfriend / my girlfriend' };
      if (r >= 40 && a >= 30) return { label: f >= 60 ? 'Situationship' : 'Romantic Interest', naturalSpeech: f >= 60 ? 'we\'re talking / it\'s complicated / we\'re seeing each other' : 'someone I have feelings for' };
      if (tag.includes('ex') && r <= 5) return { label: 'Ex', naturalSpeech: 'my ex / someone I used to be with' };
      if (cf >= 75 && f >= 65 && t >= 60) return { label: 'Chosen Family', naturalSpeech: 'basically family / someone I\'d do anything for' };
      if (f >= 90 && t >= 75) return { label: 'Best Friend', naturalSpeech: 'my best friend / my day one / my ride or die' };
      if (f >= 75 && t >= 60) return { label: 'Close Friend', naturalSpeech: 'a close friend / one of my good friends' };
      if (f >= 60 && t >= 45) return { label: 'Friend', naturalSpeech: 'a friend' };
      if (f >= 40) return { label: 'Friendly', naturalSpeech: 'someone I\'m cool with' };
      return { label: 'Acquaintance', naturalSpeech: 'someone I know' };
    }
    const dynamicLabel = resolveDynamicLabel(current, charRelEntry?.relationship_type || null);
    const naturalSpeechNote = `
RELATIONSHIP LANGUAGE ENFORCEMENT:
- Internal stored tag: "${charRelEntry?.relationship_type || 'none'}" (NEVER use this literal string in dialogue)
- Dynamic resolved label: "${dynamicLabel.label}" (use for reasoning — not for speech)
- Natural speech: use phrases like "${dynamicLabel.naturalSpeech}"
- NEVER say "my romantic interest", "situationship", or any internal tag key in character dialogue.
- Speak as a real human would, not a system report.`;

    const prompt = `You are a relationship dynamics engine. Output ONLY updated numeric values for all relationship dimensions.

CHARACTER: ${character.name}
ARCHETYPE: ${character.archetype || 'unknown'}
PERSONALITY: ${character.personality_summary || ''}
TRAITS: ${(character.personality_traits || []).join(', ') || 'none'}
EMOTIONAL TRIGGERS: ${(character.emotional_triggers_deep || []).join(', ') || 'none'}
COMMUNICATION STYLE: ${character.communication_style || 'unknown'}
EMOTIONAL BAGGAGE: ${character.emotional_baggage || 'none'}
SEXUAL ORIENTATION: ${character.sexual_orientation || 'not specified'}
CHARACTER GENDER: ${character.gender || 'not specified'}
LOYALTY VIEW: ${character.loyalty_view || 'not specified'}

${interactingPartyDesc}

${bandContext}
${naturalSpeechNote}

RECENT CONVERSATION:
${conversationSummary || 'No prior context.'}
${interactionSection}

═══════════════════════════════════
RELATIONSHIP RULES:
═══════════════════════════════════

RESPECT — "How much do I value who you ARE?"
  Positive: competence, integrity, keeping promises, active listening, standing by values → +Respect
  Negative: rudeness, mocking, lying, careless advice → -Respect
  Respect is NOT the same as attraction. Can be attracted to someone you don't respect.

TRUST — "How SAFE and RELIABLE do you feel?"
  Positive: kept promise, consistency, emotional safety, honoring vulnerability, honesty when hard → +Trust
  Negative: betrayal, caught lying, broke promise, dismissed vulnerability, unreliable → -Trust
  Trust is slow to rebuild after betrayal (max +3/turn when current < 30).
  Trust is NOT the same as respect.

FRIENDSHIP — Positive: warm exchanges, remembers details, genuine support. Negative: betrayal, coldness.
ROMANCE — Positive: tailored flirting, specific admiration, vulnerable moments. Negative: generic/pushy, clashes with values.
ATTRACTION — Based on personality archetype fit (see trait detection above).
CHOSEN FAMILY — Only increases if friendship_level >= 70.

RELATIONAL JEALOUSY — "I fear losing your attention to someone else."
  Increases: rival appears, attention shifts, exclusivity threatened, inconsistency.
  Decreases: reassurance, loyalty shown, clarity given.
  Modulated by trust: high trust dampens; low trust amplifies.

ENVY JEALOUSY — "You have something I want / comparison triggered."
  Increases: user mentions achievements, advantages, recognition they lack.
  Decreases: character's confidence improves, resentment resolves.
  NOT about romantic attention — about status/comparison.

GRIEF GATING:
  Only assign grief to ${character.name} for deaths they had a DIRECT relationship with.
  For indirect sad news: show concern/empathy only, slight +Friendship boost if supportive.
  Do NOT reduce relationship levels from indirect sad news.

SAFETY RULES:
  1. No single field changes more than ±25 in one turn (will be clamped anyway).
  2. Recent events > old events in weighting.
  3. Jealous archetypes can amplify jealousy gains; avoidant archetypes reduce romance gains.

Respond with ONLY valid JSON:
{
  "user_respect_level": <0-100>,
  "friendship_level": <0-100>,
  "romantic_level": <0-100>,
  "attraction_level": <0-100>,
  "chosen_family_level": <0-100>,
  "trust_level": <0-100>,
  "relational_jealousy": <0-100>,
  "envy_jealousy": <0-100>,
  "reason": "<one sentence — most significant change and why>",
  "event_size": "small|meaningful|major|defining",
  "detected_traits": [],
  "emotional_milestone": null,
  "shared_secret": null
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
          event_size: { type: "string" },
          detected_traits: { type: "array", items: { type: "string" } },
          emotional_milestone: {},
          shared_secret: {}
        },
        required: ["user_respect_level","friendship_level","romantic_level","attraction_level","chosen_family_level","trust_level","relational_jealousy","envy_jealousy","reason"]
      }
    });

    // ── DETECT PERSONALITY PROFILE ────────────────────────────────────────────
    const text = [
      character.archetype || '',
      character.personality_summary || '',
      (character.personality_traits || []).join(' '),
      character.emotional_baggage || '',
      character.communication_style || '',
      character.loyalty_view || '',
    ].join(' ').toLowerCase();

    const profileKeywords = {
      secure: ['secure','grounded','stable','confident','self-assured','balanced'],
      anxious: ['anxious','insecure','worried','overthinks','needy','fearful','clingy','nervous'],
      avoidant: ['avoidant','distant','guarded','closed off','independent','private','walls up','detached','cold','hard to read'],
      protective: ['protective','loyal','defender','guardian','family first','ride or die','fierce loyalty'],
      competitive: ['competitive','ambitious','driven','status','comparison','needs validation','envious'],
      impulsive: ['impulsive','reckless','spontaneous','chaotic','hot-headed','reactive','poor impulse'],
    };
    const profileScores = {};
    for (const [profile, words] of Object.entries(profileKeywords)) {
      profileScores[profile] = words.filter(w => text.includes(w)).length;
    }
    const detectedProfileKey = Object.entries(profileScores).sort((a, b) => b[1] - a[1])[0]?.[0];
    const profileMults = {
      secure:      { rj: 0.5,  ej: 1.0, romance: 1.0, trust_rb: 0.2  },
      anxious:     { rj: 1.5,  ej: 1.0, romance: 1.1, trust_rb: -0.1 },
      avoidant:    { rj: 0.7,  ej: 1.0, romance: 0.6, trust_rb: -0.15},
      protective:  { rj: 1.2,  ej: 1.0, romance: 1.0, trust_rb: 0.1  },
      competitive: { rj: 1.1,  ej: 1.5, romance: 1.0, trust_rb: 0.0  },
      impulsive:   { rj: 1.2,  ej: 1.0, romance: 1.2, trust_rb: 0.0  },
    };
    const pm = profileMults[detectedProfileKey] || { rj: 1.0, ej: 1.0, romance: 1.0, trust_rb: 0.0 };

    // ── POST-PROCESSING: ENFORCE ALL SAFETY RULES ────────────────────────────
    // 1. Map event_size → max allowed delta per field
    const eventSize = result.event_size || 'meaningful';
    const maxDelta = { small: 3, meaningful: 8, major: 15, defining: 25 }[eventSize] || 8;

    // 2. Apply clamped deltas (no 0→100 jumps, ever)
    const updated = {
      user_respect_level: clampDelta(result.user_respect_level, current.user_respect_level, maxDelta),
      friendship_level: clampDelta(result.friendship_level, current.friendship_level, maxDelta),
      romantic_level: clampDelta(result.romantic_level, current.romantic_level, maxDelta),
      attraction_level: clampDelta(result.attraction_level, current.attraction_level, maxDelta),
      chosen_family_level: clampDelta(result.chosen_family_level, current.chosen_family_level, maxDelta),
      trust_level: clampTrustRebuild(result.trust_level, current.trust_level),
      relational_jealousy: clampDelta(result.relational_jealousy, current.relational_jealousy, maxDelta),
      envy_jealousy: clampDelta(result.envy_jealousy, current.envy_jealousy, maxDelta),
    };

    // 2b. Apply personality multipliers on top of clamped values
    // Relational jealousy
    {
      const delta = updated.relational_jealousy - current.relational_jealousy;
      if (delta !== 0) updated.relational_jealousy = Math.min(100, Math.max(0, Math.round(current.relational_jealousy + delta * pm.rj)));
    }
    // Envy jealousy
    {
      const delta = updated.envy_jealousy - current.envy_jealousy;
      if (delta !== 0) updated.envy_jealousy = Math.min(100, Math.max(0, Math.round(current.envy_jealousy + delta * pm.ej)));
    }
    // Romance (only growth is modulated)
    {
      const delta = updated.romantic_level - current.romantic_level;
      if (delta > 0) updated.romantic_level = Math.min(100, Math.max(0, Math.round(current.romantic_level + delta * pm.romance)));
    }
    // Trust rebuild bonus (only when trust is increasing)
    {
      const delta = updated.trust_level - current.trust_level;
      if (delta > 0 && pm.trust_rb !== 0) updated.trust_level = Math.min(100, Math.max(0, Math.round(current.trust_level + delta * (1 + pm.trust_rb))));
    }

    // 3. Orientation multiplier on attraction delta
    const orientationMult = getAttractionMultiplier(character.sexual_orientation, character.gender, playingAsCharacter?.gender);
    const attractionDelta = updated.attraction_level - current.attraction_level;
    if (attractionDelta > 0 && orientationMult < 1.0) {
      updated.attraction_level = Math.min(100, Math.max(0, Math.round(current.attraction_level + attractionDelta * orientationMult)));
    }

    // 4. Chosen family gate: only increases if friendship >= 70
    if (updated.chosen_family_level > current.chosen_family_level && updated.friendship_level < 70) {
      updated.chosen_family_level = current.chosen_family_level;
    }

    // 5. Trust → Relational Jealousy modulation (after clamping)
    updated.relational_jealousy = modulateRelationalJealousy(
      updated.relational_jealousy, updated.trust_level, updated.romantic_level
    );

    // 6. Trust damage → automatic relational jealousy spike
    const trustDrop = current.trust_level - updated.trust_level;
    if (trustDrop >= 10 && updated.romantic_level >= 20) {
      const jealousySpike = Math.min(maxDelta, Math.round(trustDrop * 0.4));
      updated.relational_jealousy = Math.min(100, updated.relational_jealousy + jealousySpike);
    }

    // 6b. Apply arc modifiers (pattern history shapes how bars change)
    // Build a minimal delta history from recent memories as a proxy
    const arcDeltaHistory = recentMemories.slice(0, 10).map((m, i) => ({
      field: 'trust_level',
      delta: m.emotional_impact?.includes('betray') || m.emotional_impact?.includes('broke') ? -12
           : m.emotional_impact?.includes('meaningful') || m.emotional_impact?.includes('support') ? 6
           : 0,
      timestamp: m.timestamp,
    })).filter(d => d.delta !== 0);

    const arcState = deriveArcState(updated, arcDeltaHistory);
    const updatedWithArc = applyArcModifiers(current, updated, arcState);
    Object.assign(updated, updatedWithArc);

    // 7. Derive infidelity risk (for context — not stored)
    const infidelityRisk = computeInfidelityRisk(
      updated.user_respect_level,
      updated.trust_level,
      updated.attraction_level > 70 ? updated.attraction_level - 70 : 0
    );

    // ── ORIENTATION SHIFT CHECK ───────────────────────────────────────────────
    let orientationShift = null;
    if (playingAsCharacter && updated.attraction_level >= 55) {
      const shift = checkOrientationShift(character.sexual_orientation, updated.attraction_level, character.gender, playingAsCharacter.gender);
      if (shift && shift !== (character.sexual_orientation || '').toLowerCase()) {
        orientationShift = shift;
      }
    }

    // ── MILESTONES ────────────────────────────────────────────────────────────
    const fieldMap = {
      friendship_level: 'friendship_level',
      romantic_level: 'romantic_level',
      chosen_family_level: 'chosen_family_level',
      attraction_level: 'attraction_level',
      trust_level: 'trust_level',
    };
    const milestonesTriggered = [];
    const triggeredKeys = character.triggered_milestones || [];
    for (const milestone of MILESTONES) {
      const key = `${milestone.field}_${milestone.threshold}`;
      if (triggeredKeys.includes(key)) continue;
      const before = current[milestone.field];
      const after = updated[milestone.field];
      if (before !== undefined && after !== undefined && before < milestone.threshold && after >= milestone.threshold) {
        milestonesTriggered.push({ ...milestone, key });
      }
    }
    const milestoneMessages = [];
    for (const milestone of milestonesTriggered) {
      const text = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `Write a short narrative event (1–2 sentences, third-person, no dialogue, emotionally resonant) marking the moment "${milestone.label}" was reached between ${character.name} and the user. Character personality: ${character.personality_summary || ''}. Understated, not melodramatic.`
      });
      milestoneMessages.push({ key: milestone.key, text: text.trim() });
    }
    const newTriggeredKeys = [...triggeredKeys, ...milestonesTriggered.map(m => m.key)];

    // ── MEMORY: orientation shift ─────────────────────────────────────────────
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

    // ── BUILD UPDATE PAYLOAD ──────────────────────────────────────────────────
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

    // VALIDATION: Ensure character still exists before updating
    // owner_email is authoritative; fall back to created_by for legacy characters
    let validateChar = await base44.asServiceRole.entities.Character.filter({ id: characterId, owner_email: user.email });
    if (!validateChar || validateChar.length === 0) {
      validateChar = await base44.asServiceRole.entities.Character.filter({ id: characterId, created_by: user.email });
    }
    if (!validateChar || validateChar.length === 0) {
      console.error(`[updateRelationshipLevels] Character ${characterId} disappeared during processing (owned by ${user.email})`);
      return Response.json({ error: 'Character became unavailable during processing' }, { status: 410 });
    }
    await base44.asServiceRole.entities.Character.update(characterId, characterUpdatePayload);

    // ── MEMORY: milestones + secrets ──────────────────────────────────────────
    const memPromises = [];
    if (result.emotional_milestone) {
      memPromises.push(base44.asServiceRole.entities.Memory.create({
        character_id: characterId, title: 'Emotional milestone with user',
        description: result.emotional_milestone, emotional_impact: 'meaningful',
        timestamp: new Date().toISOString(), source_context: 'user conversation',
      }));
    }
    if (result.shared_secret) {
      memPromises.push(base44.asServiceRole.entities.Memory.create({
        character_id: characterId, title: 'Secret shared by user',
        description: result.shared_secret, emotional_impact: 'significant',
        timestamp: new Date().toISOString(), source_context: 'user conversation - confidential',
      }));
    }
    if (memPromises.length > 0) await Promise.all(memPromises);

    // ── DYNAMIC LABEL SHIFT DETECTION ────────────────────────────────────────
    // Check if the resolved label changed from pre-update to post-update scores
    const labelBefore = resolveDynamicLabel(current, charRelEntry?.relationship_type || null);
    const labelAfter  = resolveDynamicLabel(updated,  charRelEntry?.relationship_type || null);
    const dynamicLabelShifted = labelBefore.label !== labelAfter.label;

    // ── RELATIONSHIP TITLE CHANGE CHECK ──────────────────────────────────────
    const CHANGEABLE_TITLES = ['spouse','partner','friend','best friend','romantic interest','girlfriend','boyfriend','lover','acquaintance','coworker'];
    const BLOOD_TITLES = ['mother','father','sister','brother','cousin','aunt','uncle','grandmother','grandfather','niece','nephew','daughter','son','half-sister','half-brother','step-mother','step-father','step-sister','step-brother'];
    let relationshipChangeRequest = null;
    if (playingAsCharacter && charRelEntry) {
      const relTitle = (charRelEntry.relationship_type || '').toLowerCase();
      const isChangeable = CHANGEABLE_TITLES.some(t => relTitle.includes(t));
      const isBlood = BLOOD_TITLES.some(t => relTitle.includes(t));
      if (isChangeable && !isBlood && updated.friendship_level <= 5) {
        if (relTitle.includes('spouse') || relTitle.includes('partner')) {
          relationshipChangeRequest = { type: 'separation', message: `${character.name} may want to ask for a divorce or separation.` };
        } else if (relTitle.includes('friend')) {
          relationshipChangeRequest = { type: 'end_friendship', message: `${character.name} may want to end the friendship.` };
        } else if (updated.romantic_level <= 5 && (relTitle.includes('romantic') || relTitle.includes('girlfriend') || relTitle.includes('boyfriend') || relTitle.includes('lover'))) {
          relationshipChangeRequest = { type: 'breakup', message: `${character.name} may want to break up.` };
        }
      }
    }

    return Response.json({
      ...updated,
      reason: result.reason,
      event_size: eventSize,
      infidelity_risk: infidelityRisk,
      detected_traits: result.detected_traits || [],
      milestone_messages: milestoneMessages,
      relationship_change_request: relationshipChangeRequest,
      dynamic_label: labelAfter.label,
      dynamic_label_shifted: dynamicLabelShifted,
      dynamic_label_before: dynamicLabelShifted ? labelBefore.label : undefined,
    });

  } catch (error) {
    if (error.message?.includes('Rate limit') || error.message?.includes('429') || error.status === 429) {
      return Response.json({ skipped: true, reason: 'Rate limit — no changes applied' });
    }
    return Response.json({ error: error.message }, { status: 500 });
  }
});