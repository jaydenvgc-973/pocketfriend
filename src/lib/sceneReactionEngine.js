// ── SCENE REACTION ENGINE ─────────────────────────────────────────────────────
// Translates relationship bars + emotional state + personality + location
// into narrative-driven physical presence directives.
//
// Output is injected into narrative/scene prompts (generateNarrative, submitNarrative).
// This is NOT decorative. It governs body language, pacing, silence, positioning,
// and environmental interaction as behavioral outputs.
// ─────────────────────────────────────────────────────────────────────────────

// ── BODY LANGUAGE ─────────────────────────────────────────────────────────────
function getBodyLanguage(bars, emotionalState) {
  const trust = bars.trust_level ?? 50;
  const romance = bars.romantic_level ?? 0;
  const attraction = bars.attraction_level ?? 0;
  const respect = bars.user_respect_level ?? 50;
  const rj = bars.relational_jealousy ?? 0;

  const cues = [];

  // Trust axis
  if (trust >= 70) {
    cues.push('posture is open and relaxed — no defensive tension');
  } else if (trust <= 30) {
    cues.push('posture stays guarded — arms close, movements measured, nothing fully released');
  } else {
    cues.push('posture is neutral — present but not fully open');
  }

  // Romance + attraction axis
  if (romance >= 65 || attraction >= 65) {
    cues.push('shifts closer without thinking about it — proximity feels natural, not deliberate');
    if (romance >= 80) cues.push('gestures soften — movements slow slightly when near them');
  } else if (romance <= 20 && attraction <= 20) {
    cues.push('no pull toward closeness — body stays at comfortable, neutral distance');
  }

  // Relational jealousy axis
  if (rj >= 65) {
    cues.push('eyes track subtle shifts — who they look at, who looks at them — reactive posture, harder to settle');
  } else if (rj >= 40) {
    cues.push('awareness sharpens around the edges — noticing more than they let on');
  }

  // Respect axis
  if (respect <= 30) {
    cues.push('attention drifts — barely looks up when they speak — engagement is surface-level at best');
  } else if (respect >= 75) {
    cues.push('turns toward them when they speak — body follows attention');
  }

  // Emotional state overlays
  const emotionCues = {
    anxious: 'small movements — tapping, adjusting things nearby, can\'t fully settle',
    defensive: 'weight shifts back slightly — body language closes',
    irritated: 'jaw tightens almost imperceptibly — stillness with edge in it',
    reflective: 'quieter in the body — slower movements, less reactive',
    'closed-off': 'physically present but the energy has pulled back',
    flirtatious: 'deliberate proximity — eye contact held a beat longer than necessary',
    overwhelmed: 'movements lose their usual precision — something is spilling',
    sad: 'posture carries weight — gravity is different',
    excited: 'energy is in the body — harder to stay still',
  };

  const emotionCue = emotionCues[emotionalState];
  if (emotionCue) cues.push(emotionCue);

  return cues;
}

// ── PACING ────────────────────────────────────────────────────────────────────
function getPacing(bars, emotionalState, personality) {
  const trust = bars.trust_level ?? 50;
  const romance = bars.romantic_level ?? 0;
  const rj = bars.relational_jealousy ?? 0;

  // Emotional state is the primary pacing driver
  const fastStates = ['irritated', 'excited', 'anxious', 'defensive', 'overwhelmed'];
  const slowStates = ['reflective', 'sad', 'closed-off', 'calm'];
  const interruptedStates = ['jealousy', 'defensive', 'irritated'];

  if (fastStates.includes(emotionalState) || rj >= 65) {
    return {
      type: 'fast',
      directive: 'responds quickly — thoughts arrive before they\'re fully formed — urgency underneath even casual exchanges',
    };
  }

  if (slowStates.includes(emotionalState) || trust <= 30) {
    return {
      type: 'slow',
      directive: 'takes a beat before answering — pauses carry weight — responses arrive fully considered',
    };
  }

  if (personality === 'anxious' && rj >= 40) {
    return {
      type: 'interrupted',
      directive: 'starts to respond, shifts — thoughts reroute mid-sentence — thread gets picked up then dropped then picked up again',
    };
  }

  if (personality === 'avoidant' && romance >= 40) {
    return {
      type: 'slow',
      directive: 'unhurried on the surface — the pace is deliberate, not absent — each response chosen carefully',
    };
  }

  return {
    type: 'normal',
    directive: 'pacing is natural — no urgency, no excessive hesitation',
  };
}

// ── SILENCE VS RESPONSE ───────────────────────────────────────────────────────
function getSilenceMode(bars, emotionalState) {
  const trust = bars.trust_level ?? 50;
  const respect = bars.user_respect_level ?? 50;
  const romance = bars.romantic_level ?? 0;

  const highEmotionStates = ['overwhelmed', 'sad', 'grief', 'defensive', 'reflective'];

  if (highEmotionStates.includes(emotionalState)) {
    return 'silence is active — lets the moment sit before responding — the gap means something';
  }

  if (trust <= 25) {
    return 'chooses words carefully — pauses before answering — not withholding, but not rushing either';
  }

  if (respect <= 25) {
    return 'no urgency to fill the silence — lets it pass — does not feel compelled to respond quickly';
  }

  if (respect >= 75) {
    return 'gives full space before responding — takes in what was said — doesn\'t rush to fill quiet';
  }

  if (romance >= 70 && trust >= 70) {
    return 'comfortable with silence between them — it doesn\'t need to be filled';
  }

  return null; // no special silence mode — default response timing
}

// ── PHYSICAL POSITIONING ──────────────────────────────────────────────────────
function getPositioning(bars, emotionalState) {
  const trust = bars.trust_level ?? 50;
  const romance = bars.romantic_level ?? 0;
  const attraction = bars.attraction_level ?? 0;

  if ((romance >= 65 || attraction >= 65) && trust >= 55) {
    return 'close proximity — stays within their space — doesn\'t create distance';
  }

  if (trust <= 30 || ['defensive', 'closed-off'].includes(emotionalState)) {
    return 'creates space — doesn\'t close the gap — distance is chosen, not accidental';
  }

  if (emotionalState === 'irritated' || emotionalState === 'defensive') {
    return 'shifts slightly back — body creates the distance that words haven\'t said yet';
  }

  return 'neutral distance — neither closing nor creating space — just present';
}

// ── ENVIRONMENTAL INTERACTION ─────────────────────────────────────────────────
function getEnvironmentMode(bars, emotionalState) {
  const trust = bars.trust_level ?? 50;
  const romance = bars.romantic_level ?? 0;
  const rj = bars.relational_jealousy ?? 0;
  const respect = bars.user_respect_level ?? 50;

  if (romance >= 70 && trust >= 65) {
    return 'surroundings become secondary — environment fades into background — the space narrows to this';
  }

  if (rj >= 60 || ['anxious', 'defensive', 'irritated'].includes(emotionalState)) {
    return 'attention fragments — surroundings pull focus — harder to stay fully in the moment';
  }

  if (respect <= 25 || emotionalState === 'bored') {
    return 'environment becomes background noise — barely registers the space — attention is somewhere else entirely';
  }

  if (['calm', 'content', 'reflective'].includes(emotionalState) && trust >= 55) {
    return 'settles into surroundings naturally — occupies the space without tension';
  }

  return 'present in the environment — neither absorbed by it nor ignoring it';
}

// ── PERSONALITY NARRATIVE MODIFIER ───────────────────────────────────────────
function getPersonalityNarrativeHint(personality, bars) {
  const romance = bars.romantic_level ?? 0;
  const trust = bars.trust_level ?? 50;

  const hints = {
    secure: 'physical ease — no performed calm, just actual calm — moves like they have nothing to prove',
    anxious: 'small tells — energy that doesn\'t fully land anywhere — present but restless underneath',
    avoidant: romance >= 50
      ? 'the closeness is there but it cost something to allow it — you can feel the internal negotiation'
      : 'comfortable with the distance — not cold, just self-contained',
    protective: 'awareness that\'s always slightly outward — tracking more than just this conversation',
    competitive: 'a quality of appraisal in the stillness — they\'re always measuring something',
    impulsive: 'reactions arrive before the thought does — the body moves first',
  };

  return hints[personality] || null;
}

// ── MASTER SCENE REACTION BLOCK ───────────────────────────────────────────────
// Builds the full directive block to inject into narrative/scene prompts
export function buildSceneReactionBlock(character, bars, locationContext = null) {
  // Detect personality profile from character text
  const text = [
    character.archetype || '',
    character.personality_summary || '',
    (character.personality_traits || []).join(' '),
    character.emotional_baggage || '',
  ].join(' ').toLowerCase();

  const profileKeywords = {
    secure: ['secure','grounded','stable','confident','self-assured','balanced'],
    anxious: ['anxious','insecure','worried','overthinks','needy','fearful','clingy'],
    avoidant: ['avoidant','distant','guarded','closed off','independent','private','walls up','detached'],
    protective: ['protective','loyal','defender','guardian','family first','ride or die'],
    competitive: ['competitive','ambitious','driven','status','comparison','needs validation'],
    impulsive: ['impulsive','reckless','spontaneous','chaotic','hot-headed','reactive'],
  };
  const scores = {};
  for (const [p, words] of Object.entries(profileKeywords)) {
    scores[p] = words.filter(w => text.includes(w)).length;
  }
  const personality = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0];

  const emotionalState = character.emotional_state || 'calm';

  const bodyLang = getBodyLanguage(bars, emotionalState);
  const pacing = getPacing(bars, emotionalState, personality);
  const silence = getSilenceMode(bars, emotionalState);
  const positioning = getPositioning(bars, emotionalState);
  const envMode = getEnvironmentMode(bars, emotionalState);
  const personalityHint = getPersonalityNarrativeHint(personality, bars);

  const block = `
════════════════════════════════════
SCENE REACTION ENGINE — AUTHORITATIVE
════════════════════════════════════
The following governs how ${character.name} is PHYSICALLY AND EMOTIONALLY PRESENT in this scene.
These are not style suggestions. They are behavioral outputs derived from current relationship state.
Every narrative beat must be consistent with this profile.

BODY LANGUAGE:
${bodyLang.map(c => `  • ${c}`).join('\n')}

PACING (${pacing.type.toUpperCase()}):
  ${pacing.directive}

${silence ? `SILENCE MODE:\n  ${silence}\n` : ''}PHYSICAL POSITIONING:
  ${positioning}

ENVIRONMENTAL INTERACTION:
  ${envMode}

${personalityHint ? `PERSONALITY PHYSICAL SIGNATURE:\n  ${personalityHint}\n` : ''}${locationContext ? `LOCATION CONTEXT:\n  ${locationContext}\n` : ''}CONSISTENCY RULE:
  Before writing any narrative beat — verify it matches the above.
  Contradiction examples to avoid:
  • Relaxed open posture when trust = ${bars.trust_level ?? 50} ${(bars.trust_level ?? 50) <= 30 ? '← LOW (should be guarded)' : '← OK'}
  • Seeking closeness when romance = ${bars.romantic_level ?? 0} ${(bars.romantic_level ?? 0) <= 20 ? '← LOW (no pull toward proximity)' : '← OK'}
  • Dismissive behavior when respect = ${bars.user_respect_level ?? 50} ${(bars.user_respect_level ?? 50) >= 60 ? '← DECENT (should engage, not dismiss)' : '← OK'}
  Reuse of the same physical gesture twice in one scene is FORBIDDEN — vary the expression.
  Do NOT directly state emotions. Show them through the physical behaviors listed above.
════════════════════════════════════`;

  return block;
}