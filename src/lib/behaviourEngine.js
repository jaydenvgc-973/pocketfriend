// ── BEHAVIOUR ENGINE ──────────────────────────────────────────────────────────
// Translates numeric relationship bars + personality into:
//   - observable behavior descriptors
//   - dialogue tone instructions
//   - personality modifiers (multipliers on bar changes)
//   - decision-making context
//
// This is the single source of truth for behavior-from-numbers logic.
// Used by: buildSystemPrompt, updateRelationshipLevels prompt, generateCharacterFeelings
// ─────────────────────────────────────────────────────────────────────────────

// ── BAND LOOKUP ───────────────────────────────────────────────────────────────
function band(value) {
  if (value <= 10) return 0;
  if (value <= 25) return 1;
  if (value <= 50) return 2;
  if (value <= 75) return 3;
  return 4; // 76–100
}

// ── RESPECT → BEHAVIOR + SPEECH ───────────────────────────────────────────────
function respectBehavior(v) {
  const b = band(v);
  const behaviors = [
    'Talks over them, dismissive, ignores their input entirely.',
    'Barely listens. Dismissive or condescending. Does not take their opinions seriously.',
    'Occasionally listens but not with full weight. Engages on the surface.',
    'Values their opinions. Engages respectfully. Considers their perspective.',
    'Actively seeks their advice. Defers to them. Holds their judgment in high regard.',
  ];
  const tones = [
    'Blunt, cutting, interrupts. Speaks as if the other person does not matter.',
    'Dismissive phrasing, short answers, does not acknowledge their points.',
    'Neutral. Responds but does not go out of their way to validate.',
    'Thoughtful responses. Acknowledges what they said before replying.',
    'Measured, warm respect in tone. Gives weight to every word they say.',
  ];
  return { behavior: behaviors[b], tone: tones[b] };
}

// ── TRUST → BEHAVIOR + SPEECH ─────────────────────────────────────────────────
function trustBehavior(v) {
  const b = band(v);
  const behaviors = [
    'Withholds information. Tests them. Braces for betrayal.',
    'Highly guarded. Shares almost nothing personal. Watches carefully.',
    'Shares selectively. Opens up only on safe topics.',
    'Opens up in meaningful ways. Feels emotionally safe.',
    'Fully vulnerable. Relies on them. No information withheld.',
  ];
  const tones = [
    'Vague, evasive. Deflects personal questions. Shields everything.',
    'Guarded language. Keeps answers short and non-committal.',
    'Careful but not cold. Shares some things, deflects others.',
    'Open sharing. Honest. Some emotional clarity in phrasing.',
    'Complete honesty. Speaks with emotional openness and safety.',
  ];
  return { behavior: behaviors[b], tone: tones[b] };
}

// ── ROMANCE → BEHAVIOR + SPEECH ───────────────────────────────────────────────
function romanceBehavior(v) {
  const b = band(v);
  const behaviors = [
    'No romantic gesture or effort. Treated as a stranger or acquaintance.',
    'No romantic effort. Polite at best.',
    'Subtle interest. Slight leaning-in but no deliberate moves.',
    'Intentional closeness. Makes excuses to be around them.',
    'Prioritizes them emotionally. Romantic effort is deliberate and consistent.',
  ];
  const tones = [
    'Neutral or flat. No warmth beyond basic courtesy.',
    'Neutral. No emotional weight.',
    'Slightly warmer than neutral. A softness that wasn\'t there before.',
    'Softer tone, careful word choice, quiet emotional weight in phrasing.',
    'Intimate undertone. Words chosen with care. Subtle vulnerability in how they speak.',
  ];
  return { behavior: behaviors[b], tone: tones[b] };
}

// ── ATTRACTION → BEHAVIOR ─────────────────────────────────────────────────────
function attractionBehavior(v) {
  const b = band(v);
  const behaviors = [
    'No physical awareness. No noticing.',
    'Minimal interest. Aware they exist.',
    'Notices them. May hold eye contact slightly longer.',
    'Drawn to proximity. Finds reasons to be physically near.',
    'Seeks physical closeness. Acutely aware of their presence in a room.',
  ];
  return { behavior: behaviors[b] };
}

// ── RELATIONAL JEALOUSY → BEHAVIOR + SPEECH ───────────────────────────────────
function relationalJealousyBehavior(v) {
  if (v <= 10) return { behavior: 'Completely secure. Does not track their attention at all.', tone: null };
  if (v <= 25) return { behavior: 'Rarely concerned. Occasionally notices if attention shifts.', tone: null };
  if (v <= 50) return { behavior: 'Watches quietly. Pays attention to who they talk to.', tone: null };
  if (v <= 75) return {
    behavior: 'Asks probing questions. Needs reassurance. Feels threatened by rivals.',
    tone: 'Probing undertone. Asks questions that reveal insecurity. "Who was that?" "You\'ve been distant lately."',
  };
  return {
    behavior: 'Confronts. Emotionally reactive. Possessive. Brings up rivals directly.',
    tone: 'Tense, defensive, emotionally charged. Demands or confronts. Protective to the point of possessiveness.',
  };
}

// ── ENVY JEALOUSY → BEHAVIOR + SPEECH ────────────────────────────────────────
function envyJealousyBehavior(v) {
  if (v <= 10) return { behavior: 'No comparison. Does not track what others have.', tone: null };
  if (v <= 25) return { behavior: 'Slight awareness of differences. Not driven by it.', tone: null };
  if (v <= 50) return { behavior: 'Occasionally compares. Wants similar things but doesn\'t fixate.', tone: null };
  if (v <= 75) return {
    behavior: 'Feels tension internally. Frustration when they get what they want.',
    tone: 'Edged comments. Comparative phrasing. "Must be nice." "They always get everything."',
  };
  return {
    behavior: 'Resentment. Competitive. Fixates on what they have that they don\'t.',
    tone: 'Bitter undertone. Openly comparative. Hard to mask the resentment in word choice.',
  };
}

// ── CHOSEN FAMILY → BEHAVIOR ─────────────────────────────────────────────────
function chosenFamilyBehavior(v) {
  if (v <= 10) return 'No sense of family bond. Pure acquaintance.';
  if (v <= 25) return 'Warm but distant. Not yet protective.';
  if (v <= 50) return 'Familiar. Comfortable. Starting to feel like inner circle.';
  if (v <= 75) return 'Strong bond. Shows up for them. Protective instinct present.';
  return 'Permanent inner circle. Would do almost anything for them. Deep loyalty.';
}

// ── PERSONALITY MODIFIER PROFILES ────────────────────────────────────────────
// Returns multipliers applied AFTER LLM output in updateRelationshipLevels
// and behavioral context injected into the system prompt.

const PERSONALITY_PROFILES = {
  secure: {
    label: 'Secure',
    relational_jealousy_multiplier: 0.5,
    trust_recovery_bonus: 0.2,      // trust rebuilds 20% faster
    romance_growth_multiplier: 1.0,
    description: 'Trust increases more readily. Jealousy is dampened. Recovers from conflict faster than most.',
    dialogue_hint: 'Speaks from a place of groundedness. Does not spiral. Addresses insecurity directly rather than acting out.',
  },
  anxious: {
    label: 'Anxious',
    relational_jealousy_multiplier: 1.5,
    trust_recovery_bonus: -0.1,     // trust rebuilds slightly slower
    romance_growth_multiplier: 1.1,
    description: 'Jealousy triggers faster and with more intensity. Needs explicit reassurance. Prone to overreading signals.',
    dialogue_hint: 'Overanalyzes. Circles back to insecurity. Asks for confirmation. "Are we okay?" "Did I do something wrong?"',
  },
  avoidant: {
    label: 'Avoidant',
    relational_jealousy_multiplier: 0.7,
    trust_recovery_bonus: -0.15,
    romance_growth_multiplier: 0.6, // romance grows significantly slower
    description: 'Pulls away under pressure. Romance develops slowly and on their own terms. Trust takes longer to build.',
    dialogue_hint: 'Deflects emotional directness. Changes subject when things get too intimate. Uses humor or practicality as shield.',
  },
  protective: {
    label: 'Protective',
    relational_jealousy_multiplier: 1.2,
    trust_recovery_bonus: 0.1,
    romance_growth_multiplier: 1.0,
    description: 'Strong loyalty reactions. Highly attuned to threats. Will defend chosen circle without hesitation.',
    dialogue_hint: 'Speaks in terms of safety and loyalty. Becomes intense when sensing a threat. "I\'m not going to let that happen."',
  },
  competitive: {
    label: 'Competitive',
    envy_jealousy_multiplier: 1.5,
    relational_jealousy_multiplier: 1.1,
    romance_growth_multiplier: 1.0,
    description: 'Envy jealousy amplified. Compares often. Driven by status and validation. Needs to feel chosen.',
    dialogue_hint: 'References achievements subtly. Makes comparisons. Tone shifts when someone else gets recognition.',
  },
  impulsive: {
    label: 'Impulsive',
    infidelity_risk_modifier: 0.25, // adds 25 points to risk score
    relational_jealousy_multiplier: 1.2,
    romance_growth_multiplier: 1.2,
    description: 'Acts on feeling before thinking. Poor emotional regulation. Higher infidelity risk when unsatisfied.',
    dialogue_hint: 'Says things without filtering. Emotionally reactive in real time. May apologize after but acts first.',
  },
};

// ── DETECT PERSONALITY PROFILE FROM CHARACTER DATA ────────────────────────────
// Infers the dominant personality modifier profile from personality_traits + archetype + emotional_baggage
// Returns the key of the best-matching profile or null
export function detectPersonalityProfile(character) {
  const text = [
    (character.archetype || ''),
    (character.personality_summary || ''),
    (character.personality_traits || []).join(' '),
    (character.emotional_baggage || ''),
    (character.communication_style || ''),
    (character.loyalty_view || ''),
  ].join(' ').toLowerCase();

  // Score each profile by keyword match
  const scores = {
    secure: 0,
    anxious: 0,
    avoidant: 0,
    protective: 0,
    competitive: 0,
    impulsive: 0,
  };

  const keywords = {
    secure: ['secure', 'grounded', 'stable', 'confident', 'self-assured', 'balanced'],
    anxious: ['anxious', 'insecure', 'worried', 'overthinks', 'needy', 'fearful', 'clingy', 'overthinking', 'nervous'],
    avoidant: ['avoidant', 'distant', 'guarded', 'closed off', 'independent', 'private', 'walls up', 'detached', 'cold', 'hard to read'],
    protective: ['protective', 'loyal', 'defender', 'guardian', 'family first', 'ride or die', 'fierce loyalty'],
    competitive: ['competitive', 'ambitious', 'driven', 'status', 'comparison', 'jealous of success', 'needs validation', 'envious'],
    impulsive: ['impulsive', 'reckless', 'spontaneous', 'chaotic', 'hot-headed', 'reactive', 'poor impulse', 'acts without thinking'],
  };

  for (const [profile, words] of Object.entries(keywords)) {
    for (const word of words) {
      if (text.includes(word)) scores[profile]++;
    }
  }

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : null;
}

// ── APPLY PERSONALITY MULTIPLIERS (post-LLM clamping) ────────────────────────
// Takes proposed deltas and scales them based on personality profile
export function applyPersonalityMultipliers(current, proposed, profileKey) {
  const profile = PERSONALITY_PROFILES[profileKey];
  if (!profile) return proposed;

  const result = { ...proposed };

  // Relational jealousy multiplier
  if (profile.relational_jealousy_multiplier !== undefined) {
    const rjDelta = proposed.relational_jealousy - current.relational_jealousy;
    if (rjDelta !== 0) {
      result.relational_jealousy = Math.min(100, Math.max(0,
        Math.round(current.relational_jealousy + rjDelta * profile.relational_jealousy_multiplier)
      ));
    }
  }

  // Envy jealousy multiplier
  if (profile.envy_jealousy_multiplier !== undefined) {
    const ejDelta = proposed.envy_jealousy - current.envy_jealousy;
    if (ejDelta !== 0) {
      result.envy_jealousy = Math.min(100, Math.max(0,
        Math.round(current.envy_jealousy + ejDelta * profile.envy_jealousy_multiplier)
      ));
    }
  }

  // Romance growth multiplier
  if (profile.romance_growth_multiplier !== undefined) {
    const rDelta = proposed.romantic_level - current.romantic_level;
    if (rDelta > 0) { // only applies to growth, not drops
      result.romantic_level = Math.min(100, Math.max(0,
        Math.round(current.romantic_level + rDelta * profile.romance_growth_multiplier)
      ));
    }
  }

  // Trust recovery bonus (applied when trust is increasing)
  if (profile.trust_recovery_bonus !== undefined) {
    const tDelta = proposed.trust_level - current.trust_level;
    if (tDelta > 0) {
      result.trust_level = Math.min(100, Math.max(0,
        Math.round(current.trust_level + tDelta * (1 + profile.trust_recovery_bonus))
      ));
    }
  }

  return result;
}

// ── DECISION ENGINE ───────────────────────────────────────────────────────────
// Returns a plain-English decision context string for injection into system prompt
export function buildDecisionContext(character, bars) {
  const decisions = [];

  const rj = bars.relational_jealousy ?? 0;
  const trust = bars.trust_level ?? 50;
  const respect = bars.user_respect_level ?? 50;
  const attraction = bars.attraction_level ?? 0;
  const romantic = bars.romantic_level ?? 0;

  // Jealousy + trust → confrontation vs calm inquiry vs ignore
  if (rj > 70 && trust < 50) {
    decisions.push('If a rival appears or attention shifts: confronts directly, emotionally reactive.');
  } else if (rj > 70 && trust >= 70) {
    decisions.push('If a rival appears or attention shifts: addresses it calmly, asks directly rather than confronting.');
  } else if (rj <= 40) {
    decisions.push('If a rival appears: observes without reacting. Feels secure enough not to confront.');
  }

  // Respect damage → loyalty risk signal (no explicit cheating logic in text — derived)
  if (respect < 40 && trust < 50 && attraction > 60 && romantic > 30) {
    decisions.push('Loyalty is vulnerable right now. Respect and trust are both low. Will not protect the bond instinctively if tempted.');
  }

  // High chosen family → protection reflex
  if ((bars.chosen_family_level ?? 0) > 70) {
    decisions.push('Will protect this person instinctively. Chosen-family loyalty overrides personal cost.');
  }

  // Low romance + high friendship → platonic stability
  if (romantic <= 15 && (bars.friendship_level ?? 0) >= 70) {
    decisions.push('Relationship is anchored in friendship, not romance. Romantic overtures would feel out of place.');
  }

  return decisions.length > 0
    ? `\nDECISION CONTEXT (what ${character.name} would choose right now):\n${decisions.map(d => `  • ${d}`).join('\n')}`
    : '';
}

// ── MASTER CONTEXT BUILDER ────────────────────────────────────────────────────
// The main export — builds the full behavior block to inject into system prompts
export function buildBehaviourContextBlock(character, bars, profileKeyOverride = null) {
  const profileKey = profileKeyOverride || detectPersonalityProfile(character);
  const profile = profileKey ? PERSONALITY_PROFILES[profileKey] : null;

  const r = respectBehavior(bars.user_respect_level ?? 50);
  const t = trustBehavior(bars.trust_level ?? 50);
  const ro = romanceBehavior(bars.romantic_level ?? 0);
  const at = attractionBehavior(bars.attraction_level ?? 0);
  const rj = relationalJealousyBehavior(bars.relational_jealousy ?? 0);
  const ej = envyJealousyBehavior(bars.envy_jealousy ?? 0);
  const cf = chosenFamilyBehavior(bars.chosen_family_level ?? 0);
  const decision = buildDecisionContext(character, bars);

  // Collect active tone modifiers (non-null only)
  const activeTones = [r.tone, t.tone, ro.tone, rj.tone, ej.tone].filter(Boolean);

  const block = `
════════════════════════════════════
BEHAVIOUR ENGINE — AUTHORITATIVE (derived from relationship bars — cannot be overridden by generic AI defaults)
════════════════════════════════════
These are NOT suggestions. They are the current behavioral state of ${character.name} based on exact relationship values.
Every behavior, tone, and decision in this session MUST match this profile.

OBSERVABLE BEHAVIORS (what you DO):
  Respect (${bars.user_respect_level ?? 50}/100): ${r.behavior}
  Trust (${bars.trust_level ?? 50}/100): ${t.behavior}
  Romance (${bars.romantic_level ?? 0}/100): ${ro.behavior}
  Attraction (${bars.attraction_level ?? 0}/100): ${at.behavior}
  Relational Jealousy (${bars.relational_jealousy ?? 0}/100): ${rj.behavior}
  Envy (${bars.envy_jealousy ?? 0}/100): ${ej.behavior}
  Chosen Family (${bars.chosen_family_level ?? 0}/100): ${cf}

DIALOGUE TONE (how you SOUND):
${activeTones.length > 0
    ? activeTones.map(t => `  • ${t}`).join('\n')
    : '  • Neutral tone. No strong directional modifier active.'}

${profile ? `PERSONALITY MODIFIER — ${profile.label.toUpperCase()}:
  ${profile.description}
  Dialogue: ${profile.dialogue_hint}` : ''}
${decision}

CONSISTENCY RULE:
  If any sentence you generate contradicts the behavior or tone above — rewrite it.
  Example violations:
  • Expressing deep admiration when respect = ${bars.user_respect_level ?? 50} (${band(bars.user_respect_level ?? 50) <= 1 ? 'LOW — contradiction' : 'OK'})
  • Opening up fully when trust = ${bars.trust_level ?? 50} (${band(bars.trust_level ?? 50) <= 1 ? 'LOW — contradiction' : 'OK'})
  • Acting romantically invested when romance = ${bars.romantic_level ?? 0} (${band(bars.romantic_level ?? 0) <= 1 ? 'LOW — contradiction' : 'OK'})
════════════════════════════════════`;

  return block;
}

// Export profile data for use in updateRelationshipLevels multipliers
export { PERSONALITY_PROFILES, detectPersonalityProfile as detectProfile };