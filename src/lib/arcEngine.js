// ── ARC ENGINE ────────────────────────────────────────────────────────────────
// Tracks long-term relationship patterns, trajectories, and turning points.
// Translates history into behavior modifiers — so characters remember patterns,
// not just isolated moments.
//
// Used by: updateRelationshipLevels (bar change modifiers + arc state)
//          buildSystemPrompt (arc context injection)
//          generateCharacterFeelings (pattern-aware self-reflection)
// ─────────────────────────────────────────────────────────────────────────────

// ── MEMORY WEIGHT CONSTANTS ───────────────────────────────────────────────────
export const MEMORY_WEIGHTS = {
  small_interaction:  1,
  emotional_moment:   2,
  repeated_pattern:   3,
  turning_point:      5,
};

// ── ARC STATE FLAGS ───────────────────────────────────────────────────────────
// Each relationship carries one of these — drives dialogue tone + tolerance
export const ARC_STATES = {
  growing:              'growing',
  stable:               'stable',
  volatile:             'volatile',
  declining:            'declining',
  fractured:            'fractured',
  recovering:           'recovering',
  fragile:              'fragile',
  strained:             'strained',
  toxic_pattern:        'toxic_pattern_detected',
};

// ── DERIVE ARC STATE FROM BAR HISTORY ────────────────────────────────────────
// Takes current bars + recent delta history to produce an arc state flag.
// deltaHistory: array of { field, delta, event_size, timestamp } (most recent first)
export function deriveArcState(bars, deltaHistory = []) {
  const trust = bars.trust_level ?? 50;
  const respect = bars.user_respect_level ?? 50;
  const friendship = bars.friendship_level ?? 50;
  const rj = bars.relational_jealousy ?? 0;

  // Look at last 10 events for pattern detection
  const recent = (deltaHistory || []).slice(0, 10);

  // Count positive vs negative trust events
  const trustDeltas = recent.filter(d => d.field === 'trust_level');
  const negativeTrustCount = trustDeltas.filter(d => d.delta < -5).length;
  const positiveTrustCount = trustDeltas.filter(d => d.delta > 3).length;

  // Conflict-then-repair pattern
  const allDeltas = recent.map(d => d.delta);
  let repairPattern = false;
  for (let i = 0; i < allDeltas.length - 1; i++) {
    if (allDeltas[i] < -5 && allDeltas[i + 1] > 3) { repairPattern = true; break; }
  }

  // Toxic loop: repeated negative trust followed by partial recovery
  let toxicLoopScore = 0;
  for (const d of trustDeltas) {
    if (d.delta < -8) toxicLoopScore += 2;
    else if (d.delta > 2 && d.delta < 6) toxicLoopScore += 1; // partial repair
  }

  // Avoidance: no recent meaningful events
  const meaningfulEvents = recent.filter(d => Math.abs(d.delta) > 3).length;

  // ── PRIORITY ORDER FOR STATE ASSIGNMENT ──────────────────────────────────
  if (toxicLoopScore >= 5 && negativeTrustCount >= 2) return ARC_STATES.toxic_pattern;
  if (trust < 25 && respect < 30) return ARC_STATES.fractured;
  if (trust < 40 && negativeTrustCount >= 2 && positiveTrustCount === 0) return ARC_STATES.declining;
  if (trust < 45 && rj > 55) return ARC_STATES.strained;
  if (repairPattern && trust >= 40) return ARC_STATES.recovering;
  if (trust < 45 && meaningfulEvents < 2) return ARC_STATES.fragile;
  if (positiveTrustCount >= 2 && trust >= 55 && friendship >= 55) return ARC_STATES.growing;

  // High variance = volatile
  if (trustDeltas.length >= 3) {
    const vals = trustDeltas.map(d => d.delta);
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    if (max - min > 20) return ARC_STATES.volatile;
  }

  return ARC_STATES.stable;
}

// ── ARC STATE → BEHAVIOR MODIFIERS ───────────────────────────────────────────
// Returns multipliers and tolerance adjustments for bar changes
export function getArcModifiers(arcState) {
  const mods = {
    trust_gain_multiplier:    1.0,  // scales positive trust changes
    trust_loss_multiplier:    1.0,  // scales negative trust changes
    forgiveness_bonus:        0,    // flat bonus to trust recovery after conflict
    patience_penalty:         0,    // reduces tolerance threshold before reactions
    jealousy_baseline_add:    0,    // persistent jealousy floor addition
    respect_repair_multiplier: 1.0, // how fast respect can recover
  };

  switch (arcState) {
    case ARC_STATES.growing:
      mods.trust_gain_multiplier = 1.2;
      mods.forgiveness_bonus = 5;
      mods.respect_repair_multiplier = 1.2;
      break;
    case ARC_STATES.stable:
      // no modifications — baseline behavior
      break;
    case ARC_STATES.recovering:
      mods.trust_gain_multiplier = 1.15;
      mods.trust_loss_multiplier = 1.2; // still sensitive — healing is fragile
      mods.forgiveness_bonus = 8;
      break;
    case ARC_STATES.fragile:
      mods.trust_loss_multiplier = 1.3;
      mods.patience_penalty = 10;
      break;
    case ARC_STATES.strained:
      mods.trust_gain_multiplier = 0.8;
      mods.trust_loss_multiplier = 1.3;
      mods.jealousy_baseline_add = 8;
      mods.patience_penalty = 15;
      break;
    case ARC_STATES.declining:
      mods.trust_gain_multiplier = 0.6;
      mods.trust_loss_multiplier = 1.4;
      mods.patience_penalty = 20;
      mods.jealousy_baseline_add = 10;
      break;
    case ARC_STATES.fractured:
      mods.trust_gain_multiplier = 0.4; // trust rebuilds very slowly after fracture
      mods.trust_loss_multiplier = 1.5;
      mods.patience_penalty = 30;
      mods.jealousy_baseline_add = 15;
      mods.respect_repair_multiplier = 0.5;
      break;
    case ARC_STATES.volatile:
      mods.trust_gain_multiplier = 0.9;
      mods.trust_loss_multiplier = 1.3;
      mods.patience_penalty = 15;
      mods.jealousy_baseline_add = 5;
      break;
    case ARC_STATES.toxic_pattern:
      mods.trust_gain_multiplier = 0.3; // near-impossible to rebuild naturally
      mods.trust_loss_multiplier = 1.6;
      mods.patience_penalty = 35;
      mods.jealousy_baseline_add = 20;
      mods.forgiveness_bonus = -10; // forgiveness actually harder
      mods.respect_repair_multiplier = 0.3;
      break;
  }

  return mods;
}

// ── APPLY ARC MODIFIERS TO BAR DELTAS ────────────────────────────────────────
// Called after personality multipliers, before final clamp
export function applyArcModifiers(current, proposed, arcState) {
  const mods = getArcModifiers(arcState);
  const result = { ...proposed };

  // Trust: scale gains and losses separately
  const trustDelta = proposed.trust_level - current.trust_level;
  if (trustDelta > 0) {
    const modifiedGain = trustDelta * mods.trust_gain_multiplier + mods.forgiveness_bonus;
    result.trust_level = Math.min(100, Math.max(0, Math.round(current.trust_level + modifiedGain)));
  } else if (trustDelta < 0) {
    const modifiedLoss = trustDelta * mods.trust_loss_multiplier;
    result.trust_level = Math.min(100, Math.max(0, Math.round(current.trust_level + modifiedLoss)));
  }

  // Respect repair modifier
  const respectDelta = proposed.user_respect_level - current.user_respect_level;
  if (respectDelta > 0) {
    result.user_respect_level = Math.min(100, Math.max(0,
      Math.round(current.user_respect_level + respectDelta * mods.respect_repair_multiplier)
    ));
  }

  // Jealousy baseline floor (arc adds persistent floor — can't go below it naturally)
  if (mods.jealousy_baseline_add > 0) {
    result.relational_jealousy = Math.min(100, Math.max(
      mods.jealousy_baseline_add,
      result.relational_jealousy
    ));
  }

  return result;
}

// ── PATTERN RECOGNITION: detect arc patterns from memory titles/descriptions ──
// Called with an array of memory objects to surface recurring themes
export function detectPatterns(memories = []) {
  const patterns = {
    consistent_support: 0,
    repeated_betrayal: 0,
    conflict_repair_cycle: 0,
    avoidance: 0,
    emotional_growth: 0,
    trust_fracture: 0,
  };

  const PATTERN_KEYWORDS = {
    consistent_support: ['showed up', 'support', 'reliable', 'consistent', 'there for', 'helped', 'listened', 'defended'],
    repeated_betrayal: ['betrayal', 'cheated', 'lied', 'broke promise', 'hid', 'deceived', 'again', 'keeps happening', 'pattern'],
    conflict_repair_cycle: ['apologized', 'repaired', 'forgave', 'made up', 'resolved', 'after the fight', 'came back'],
    avoidance: ['avoided', 'ignored', 'silence', 'didn\'t address', 'let it pass', 'never said', 'distance'],
    emotional_growth: ['opened up', 'vulnerable', 'shared something', 'grew', 'changed', 'different now', 'deeper'],
    trust_fracture: ['trust broken', 'can\'t trust', 'don\'t believe', 'lied again', 'betrayed again', 'won\'t forget'],
  };

  for (const mem of memories) {
    const text = `${mem.title || ''} ${mem.description || ''} ${mem.emotional_impact || ''}`.toLowerCase();
    for (const [pattern, keywords] of Object.entries(PATTERN_KEYWORDS)) {
      for (const kw of keywords) {
        if (text.includes(kw)) { patterns[pattern]++; break; }
      }
    }
  }

  // Return detected patterns above threshold (score >= 2 = pattern, 1 = hint)
  return Object.entries(patterns)
    .filter(([, score]) => score >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([pattern, score]) => ({ pattern, score, strength: score >= 3 ? 'strong' : score >= 2 ? 'moderate' : 'emerging' }));
}

// ── SELF-AWARENESS LINES (character internal recognition of patterns) ─────────
// Returns a line the character might internally think — injected into prompts
// Only fires when patterns are strong (not every turn)
export function getSelfAwarenessLine(patterns = [], arcState, bars) {
  if (patterns.length === 0) return null;

  const strongPatterns = patterns.filter(p => p.strength === 'strong' || p.strength === 'moderate');
  if (strongPatterns.length === 0) return null;

  const top = strongPatterns[0].pattern;

  const lines = {
    consistent_support: "They've been consistent. That's not something they have to keep proving — it's already there.",
    repeated_betrayal: "This feels familiar. Not in a good way. The pattern is the same — different details, same result.",
    conflict_repair_cycle: "We've been here before. And we came back from it. That matters, even if it's hard right now.",
    avoidance: "There's something neither of us has said. It keeps not getting said. That's starting to mean something.",
    emotional_growth: "Something has shifted between us — not just surface level. It took time to get here.",
    trust_fracture: "I keep waiting for it to be different. It's not different. At some point that's the answer.",
  };

  // Arc state overrides for self-awareness tone
  if (arcState === ARC_STATES.toxic_pattern) {
    return "I keep coming back to the same place with them. I know this place. I know what it means.";
  }
  if (arcState === ARC_STATES.recovering && bars.trust_level > 50) {
    return "They've been different lately. I'm noticing. I'm not ready to say it out loud yet — but I'm noticing.";
  }
  if (arcState === ARC_STATES.fractured) {
    return "There's a version of this where I just stop expecting things to be different. I'm not there yet. But I can see it.";
  }

  return lines[top] || null;
}

// ── ARC CONTEXT BLOCK (for system prompt injection) ───────────────────────────
export function buildArcContextBlock(character, memories = [], deltaHistory = [], arcStateOverride = null) {
  const bars = {
    trust_level: character.trust_level ?? 50,
    user_respect_level: character.user_respect_level ?? 50,
    friendship_level: character.friendship_level ?? 75,
    romantic_level: character.romantic_level ?? 0,
    relational_jealousy: character.relational_jealousy ?? 0,
  };

  const arcState = arcStateOverride || deriveArcState(bars, deltaHistory);
  const patterns = detectPatterns(memories);
  const selfAwareness = getSelfAwarenessLine(patterns, arcState, bars);
  const mods = getArcModifiers(arcState);

  const patternLines = patterns.slice(0, 3).map(p => {
    const labels = {
      consistent_support: 'Consistent support — they have shown up repeatedly',
      repeated_betrayal: 'Repeated betrayal pattern — this has happened before',
      conflict_repair_cycle: 'Conflict → repair cycle — they have come back from this',
      avoidance: 'Avoidance pattern — things keep not getting said',
      emotional_growth: 'Emotional growth — the relationship has genuinely deepened',
      trust_fracture: 'Trust fracture — broken more than once',
    };
    return `  • ${labels[p.pattern] || p.pattern} (${p.strength})`;
  });

  const trajectoryDesc = {
    [ARC_STATES.growing]:       'GROWING — trust, comfort, and stability are increasing over time',
    [ARC_STATES.stable]:        'STABLE — minimal fluctuation, predictable, established baseline',
    [ARC_STATES.volatile]:      'VOLATILE — high highs and low lows, unpredictable reactions',
    [ARC_STATES.declining]:     'DECLINING — trust falling, resentment building, distance increasing',
    [ARC_STATES.fractured]:     'FRACTURED — trust significantly damaged, recovery uncertain',
    [ARC_STATES.recovering]:    'RECOVERING — conflict has occurred, repair is in progress, still sensitive',
    [ARC_STATES.fragile]:       'FRAGILE — stability present but easily disrupted, low buffer',
    [ARC_STATES.strained]:      'STRAINED — tension active, patience reduced, conflict risk elevated',
    [ARC_STATES.toxic_pattern]: 'TOXIC PATTERN DETECTED — recurring cycle of damage, partial repair, repeat',
  };

  const behaviorMods = [];
  if (mods.trust_gain_multiplier < 1.0) behaviorMods.push(`Trust rebuilds ${Math.round((1 - mods.trust_gain_multiplier) * 100)}% slower than baseline`);
  if (mods.trust_gain_multiplier > 1.0) behaviorMods.push(`Trust rebuilds ${Math.round((mods.trust_gain_multiplier - 1) * 100)}% faster than baseline`);
  if (mods.patience_penalty > 0) behaviorMods.push(`Patience threshold reduced by ${mods.patience_penalty} points — reacts sooner`);
  if (mods.forgiveness_bonus > 0) behaviorMods.push(`Forgiveness comes more naturally — history of repair present`);
  if (mods.forgiveness_bonus < 0) behaviorMods.push(`Forgiveness is harder — trust has been damaged too many times`);
  if (mods.jealousy_baseline_add > 0) behaviorMods.push(`Jealousy floor raised by ${mods.jealousy_baseline_add} — persistent insecurity from arc`);

  const block = `
════════════════════════════════════
ARC ENGINE — RELATIONSHIP HISTORY (pattern-driven — overrides single-event reactions)
════════════════════════════════════
Arc State: ${trajectoryDesc[arcState] || arcState.toUpperCase()}

${patternLines.length > 0 ? `DETECTED PATTERNS:\n${patternLines.join('\n')}\n` : ''}${behaviorMods.length > 0 ? `ACTIVE ARC MODIFIERS:\n${behaviorMods.map(m => `  • ${m}`).join('\n')}\n` : ''}${selfAwareness ? `INTERNAL RECOGNITION (character privately notices this — surfaces rarely, only when pattern is strong):\n  "${selfAwareness}"\n` : ''}ARC RULES:
  • One moment cannot undo an established pattern. Trust fractured three times does not heal in one good conversation.
  • Consistent support history makes forgiveness more natural — this is not weakness, it is earned.
  • Repeated betrayal means suspicion returns faster — even with good behavior in the present.
  • Do not treat major past events as background noise. They are active weight in every interaction.
  • Self-awareness lines above should surface naturally when the moment calls for it — not forced, not every turn.
════════════════════════════════════`;

  return block;
}