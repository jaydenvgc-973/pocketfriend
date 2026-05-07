/**
 * DYNAMIC RELATIONSHIP LABEL RESOLVER
 *
 * Derives a visible, human-readable relationship label from score bars —
 * NOT from static internal tags. Internal tags exist for system routing only.
 * What the character actually calls someone in speech must sound natural.
 *
 * Priority order:
 *   1. Blood/family tags — always preserved, never overridden by scores
 *   2. Negative/conflict states — trust < 20 or respect < 15 → hostile labels
 *   3. Romantic states — romantic >= 20 AND attraction >= 20 → relationship labels
 *   4. Friendship progression — friendship score drives social label
 *   5. Chosen family — high chosen_family_level regardless of friendship
 *   6. Fallback — Acquaintance / Known Contact
 *
 * ASYMMETRY: this resolver is intentionally one-directional.
 * Character A may resolve to "Best Friend" while Character B resolves to "Friend".
 * That is realistic and correct.
 *
 * NATURAL SPEECH MAPPING:
 * resolveNaturalSpeechLabel() returns how a character would ACTUALLY refer to someone,
 * not the clinical tag. Used for LLM prompt injection.
 */

// ── BLOOD / PROTECTED FAMILY TAGS (never overridden by score logic) ───────────
const BLOOD_TAGS = new Set([
  'mother','father','son','daughter','sister','brother',
  'grandmother','grandfather','granddaughter','grandson',
  'aunt','uncle','niece','nephew','cousin',
  'half-sister','half-brother','step-mother','step-father',
  'step-sister','step-brother','step-son','step-daughter',
]);

function isBloodFamily(relationshipType) {
  if (!relationshipType) return false;
  const lower = relationshipType.toLowerCase().trim();
  return BLOOD_TAGS.has(lower) || lower.includes('mother') || lower.includes('father') ||
    lower.includes('sister') || lower.includes('brother') || lower.includes('grandm') ||
    lower.includes('grandf') || lower.includes('grandmother') || lower.includes('grandfather');
}

// ── SCORE-DRIVEN LABEL RESOLUTION ────────────────────────────────────────────
/**
 * Resolves the best visible relationship label from score bars.
 *
 * @param {object} scores — { friendship_level, trust_level, romantic_level,
 *                            attraction_level, chosen_family_level,
 *                            relational_jealousy, envy_jealousy, user_respect_level }
 * @param {string|null} existingTag — the current relationship_type internal tag
 * @param {object} opts — { characterPersonality, interactionCount, hasBetrayal }
 * @returns {{ label: string, category: string, naturalSpeech: string[], confidence: 'high'|'medium'|'low' }}
 */
export function resolveRelationshipLabel(scores, existingTag = null, opts = {}) {
  const {
    friendship_level: f = 50,
    trust_level: t = 50,
    romantic_level: r = 0,
    attraction_level: a = 0,
    chosen_family_level: cf = 0,
    user_respect_level: resp = 50,
  } = scores || {};

  const tag = (existingTag || '').toLowerCase().trim();

  // ── LAYER 1: Blood family — always preserved ─────────────────────────────
  if (isBloodFamily(tag)) {
    return {
      label: existingTag,
      category: 'family',
      naturalSpeech: [existingTag],
      confidence: 'high',
    };
  }

  // ── LAYER 2: Negative / conflict states ──────────────────────────────────
  // Trust collapse + respect collapse = hostile state
  if (t <= 10 && resp <= 15) {
    return { label: 'Enemy', category: 'conflict', naturalSpeech: ['someone I want nothing to do with', 'someone I can\'t stand', 'not someone I trust'], confidence: 'high' };
  }
  if (t <= 15 && f <= 15) {
    return { label: 'Estranged', category: 'conflict', naturalSpeech: ['someone I used to know', 'we\'re not really talking', 'it\'s complicated'], confidence: 'high' };
  }
  if (t <= 25 && resp <= 20 && f <= 25) {
    return { label: 'Distrustful', category: 'conflict', naturalSpeech: ['someone I keep at a distance', 'not really my person', 'we have history'], confidence: 'medium' };
  }
  if (t <= 30 && f <= 30) {
    return { label: 'Distant', category: 'conflict', naturalSpeech: ['an old connection', 'we\'ve drifted', 'not really close anymore'], confidence: 'medium' };
  }

  // ── LAYER 3: Romantic states ─────────────────────────────────────────────
  // Only if romantic AND attraction are meaningfully present
  if (r >= 80 && t >= 70) {
    // Deeply committed — use natural partner labels based on tag hint if available
    if (tag.includes('spouse') || tag.includes('married') || tag.includes('husband') || tag.includes('wife')) {
      return { label: 'Spouse', category: 'romantic', naturalSpeech: ['my husband', 'my wife', 'my spouse', 'my partner'], confidence: 'high' };
    }
    if (tag.includes('fiancé') || tag.includes('engage')) {
      return { label: 'Fiancé(e)', category: 'romantic', naturalSpeech: ['my fiancé', 'my fiancée', 'we\'re engaged'], confidence: 'high' };
    }
    return { label: 'Partner', category: 'romantic', naturalSpeech: ['my partner', 'my boyfriend', 'my girlfriend', 'my person', 'someone I\'m serious about'], confidence: 'high' };
  }
  if (r >= 60 && t >= 55 && a >= 40) {
    return { label: 'Dating', category: 'romantic', naturalSpeech: ['someone I\'m seeing', 'we\'re together', 'my boyfriend', 'my girlfriend', 'we\'re dating'], confidence: 'high' };
  }
  if (r >= 40 && a >= 30) {
    if (f >= 60) {
      return { label: 'Situationship', category: 'romantic', naturalSpeech: ['we\'re talking', 'it\'s complicated', 'we\'re seeing each other', 'nothing official yet'], confidence: 'medium' };
    }
    return { label: 'Romantic Interest', category: 'romantic', naturalSpeech: ['someone I like', 'a person I\'m interested in', 'someone I have feelings for'], confidence: 'medium' };
  }
  if (r >= 20 && a >= 20 && f >= 50) {
    return { label: 'Crush', category: 'romantic', naturalSpeech: ['someone I like', 'it\'s nothing yet', 'I don\'t know, I like them'], confidence: 'low' };
  }
  if (r <= 5 && a <= 5 && (tag.includes('ex') || tag.includes('former'))) {
    return { label: 'Ex', category: 'romantic', naturalSpeech: ['my ex', 'we used to be together', 'an ex of mine', 'someone I was with'], confidence: 'high' };
  }
  // Ex with lingering feelings
  if (tag.includes('ex') && (r > 20 || a > 20)) {
    return { label: 'Ex (unresolved)', category: 'romantic', naturalSpeech: ['my ex', 'someone I used to be with', 'it\'s complicated'], confidence: 'medium' };
  }

  // ── LAYER 4: Chosen family (high bond regardless of romance) ─────────────
  if (cf >= 75 && f >= 65 && t >= 60) {
    return { label: 'Chosen Family', category: 'bond', naturalSpeech: ['family to me', 'basically family', 'someone I\'d do anything for', 'like a sibling to me'], confidence: 'high' };
  }
  if (cf >= 50 && f >= 60) {
    return { label: 'Like Family', category: 'bond', naturalSpeech: ['like family', 'one of the people I trust most', 'basically my family'], confidence: 'medium' };
  }

  // ── LAYER 5: Friendship progression ──────────────────────────────────────
  if (f >= 90 && t >= 75) {
    return { label: 'Best Friend', category: 'social', naturalSpeech: ['my best friend', 'my day one', 'my ride or die', 'we\'re best friends'], confidence: 'high' };
  }
  if (f >= 75 && t >= 60) {
    return { label: 'Close Friend', category: 'social', naturalSpeech: ['a close friend', 'one of my good friends', 'someone I\'m close with'], confidence: 'high' };
  }
  if (f >= 60 && t >= 45) {
    return { label: 'Friend', category: 'social', naturalSpeech: ['a friend', 'someone I know', 'a good person I know'], confidence: 'high' };
  }
  if (f >= 40) {
    return { label: 'Friendly', category: 'social', naturalSpeech: ['someone I\'m cool with', 'a person I know', 'we\'re friendly'], confidence: 'medium' };
  }
  if (f >= 25) {
    return { label: 'Acquaintance', category: 'social', naturalSpeech: ['someone I know', 'an acquaintance', 'we\'ve met'], confidence: 'medium' };
  }

  // ── LAYER 6: Work/structural fallback (preserve tag if work-type) ─────────
  if (tag && ['coworker','boss','employee','manager','supervisor','business_partner','mentor','mentee'].some(k => tag.includes(k))) {
    return { label: existingTag, category: 'work', naturalSpeech: [existingTag], confidence: 'medium' };
  }

  // ── LAYER 7: Fallback ─────────────────────────────────────────────────────
  if (f < 25) {
    return { label: 'Known Contact', category: 'social', naturalSpeech: ['someone I know of', 'a person I\'ve crossed paths with'], confidence: 'low' };
  }

  return { label: 'Acquaintance', category: 'social', naturalSpeech: ['someone I know', 'an acquaintance'], confidence: 'low' };
}

/**
 * Checks if the scores contradict the stored tag in a meaningful way.
 * Returns a recommendation if realignment is warranted.
 *
 * Used by the auto-realignment engine to detect stale/contradictory states.
 *
 * @returns {{ contradicted: boolean, reason: string, recommended: string } | null}
 */
export function detectLabelContradiction(scores, existingTag) {
  if (!existingTag || isBloodFamily(existingTag)) return null;

  const tag = existingTag.toLowerCase();
  const { friendship_level: f = 50, trust_level: t = 50, romantic_level: r = 0 } = scores || {};

  // "Best Friend" with very low scores
  if ((tag.includes('best friend') || tag === 'best_friend') && f < 30) {
    return { contradicted: true, reason: `Friendship (${f}) is too low to support "Best Friend"`, recommended: resolveRelationshipLabel(scores, null).label };
  }
  // "Partner/spouse" with no romance
  if ((tag.includes('partner') || tag.includes('spouse') || tag.includes('boyfriend') || tag.includes('girlfriend')) && r < 15 && t < 25) {
    return { contradicted: true, reason: `Romance (${r}) and trust (${t}) too low to support committed relationship`, recommended: 'Ex' };
  }
  // "Acquaintance" with very high friendship
  if (tag.includes('acquaintance') && f >= 75) {
    return { contradicted: true, reason: `Friendship (${f}) is too high for "Acquaintance"`, recommended: resolveRelationshipLabel(scores, null).label };
  }
  // "Friend" with hostile scores
  if (tag.includes('friend') && !tag.includes('ex') && t <= 15 && f <= 20) {
    return { contradicted: true, reason: `Trust (${t}) and friendship (${f}) indicate hostility`, recommended: 'Estranged' };
  }

  return null;
}

/**
 * Generates a natural speech context block for LLM prompts.
 * Prevents characters from using internal tag language in dialogue.
 *
 * @param {string} characterName
 * @param {object} relEntry — a fictional_relationships entry
 * @param {object} scores
 * @returns {string} — prompt injection block
 */
export function buildNaturalRelationshipSpeechContext(characterName, relEntry, scores) {
  if (!relEntry) return '';

  const resolved = resolveRelationshipLabel(scores, relEntry.relationship_type);
  const examples = resolved.naturalSpeech.slice(0, 3).join('" / "');

  return `
RELATIONSHIP LANGUAGE RULE for ${characterName}:
- Internal tag: "${relEntry.relationship_type}" (for system use only — NEVER say this in dialogue)
- Dynamic label: "${resolved.label}" (context-aware label — use this for internal reasoning)
- Natural speech examples: "${examples}"
- When referring to this person, use language like the natural speech examples above.
- NEVER say "my romantic interest", "my situationship", "my best_friend", or any internal tag literally.
- Speak as a real person would, not as a system report.
`.trim();
}

/**
 * BETRAYAL EVENT CONSEQUENCE CALCULATOR
 * Returns suggested score deltas for betrayal-class events.
 * Severity: 'minor' | 'moderate' | 'major' | 'catastrophic'
 */
export function computeBetrayalConsequences(currentScores, severity = 'major', personalityProfile = 'secure') {
  const multipliers = {
    minor:        { trust: -8,  respect: -5,  friendship: -5,  romance: -6,  rj: +8,  attraction: -3 },
    moderate:     { trust: -15, respect: -10, friendship: -10, romance: -12, rj: +12, attraction: -6 },
    major:        { trust: -22, respect: -16, friendship: -14, romance: -18, rj: +18, attraction: -10 },
    catastrophic: { trust: -28, respect: -22, friendship: -20, romance: -25, rj: +22, attraction: -15 },
  };

  // Personality adjustments
  const personalityMod = {
    anxious:     { trust: 1.3, rj: 1.5 },
    avoidant:    { trust: 1.1, romance: 0.8, rj: 0.7 },
    secure:      { trust: 0.9, rj: 0.8 },
    protective:  { trust: 1.2, respect: 1.3, rj: 1.2 },
    impulsive:   { trust: 1.0, rj: 1.4 },
    competitive: { respect: 1.4, rj: 1.1 },
  };

  const base = multipliers[severity] || multipliers.major;
  const mod = personalityMod[personalityProfile] || {};

  const apply = (field, baseVal) => {
    const m = mod[field] || 1.0;
    return Math.round(baseVal * m);
  };

  return {
    trust_level:         Math.max(0, (currentScores.trust_level || 50) + apply('trust', base.trust)),
    user_respect_level:  Math.max(0, (currentScores.user_respect_level || 50) + apply('respect', base.respect)),
    friendship_level:    Math.max(0, (currentScores.friendship_level || 50) + apply('friendship', base.friendship)),
    romantic_level:      Math.max(0, (currentScores.romantic_level || 0) + apply('romance', base.romance)),
    attraction_level:    Math.max(0, (currentScores.attraction_level || 0) + apply('attraction', base.attraction)),
    relational_jealousy: Math.min(100, (currentScores.relational_jealousy || 0) + apply('rj', base.rj)),
    _severity: severity,
    _consequence_type: 'betrayal',
  };
}