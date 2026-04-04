import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * CHARACTER MEDIA KNOWLEDGE BUILDER
 * 
 * Converts deep research + media understanding into a character-specific knowledge object.
 * This is what gets injected into the character's context when they receive media.
 * 
 * Allows characters to:
 * - Know track meanings beyond titles
 * - Understand artist intent
 * - Reference contextual information
 * - React emotionally from informed position
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { character, mediaObject, understanding, deepResearch } = await req.json();

    if (!character || !mediaObject) {
      return Response.json({ error: 'character and mediaObject required' }, { status: 400 });
    }

    const knowledge = buildCharacterKnowledge(character, mediaObject, understanding, deepResearch);

    return Response.json({ success: true, knowledge });
  } catch (error) {
    console.error('[buildCharacterMediaKnowledge] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * BUILD CHARACTER-SPECIFIC KNOWLEDGE FROM ALL RESEARCH LAYERS
 */
function buildCharacterKnowledge(character, mediaObject, understanding, deepResearch) {
  const knowledge = {
    mediaId: mediaObject.spotify_id || mediaObject.destinationId,
    mediaTitle: mediaObject.title,
    mediaArtist: mediaObject.artist,
    destinationType: mediaObject.destinationType,
    
    // What the character knows about the music itself
    musicUnderstanding: understanding || null,
    
    // What the character knows about context & creator intent
    contextualKnowledge: buildContextualKnowledge(deepResearch),
    
    // Character-specific resonance: does this speak to them?
    personalResonance: buildPersonalResonance(character, mediaObject, understanding, deepResearch),
    
    // What the character can reference in conversation
    conversationHooks: buildConversationHooks(character, mediaObject, understanding, deepResearch),
    
    // Knowledge completeness for this character
    knowledgeLevel: calculateCharacterKnowledgeLevel(understanding, deepResearch),
  };

  return knowledge;
}

/**
 * CONTEXTUAL KNOWLEDGE: Artist intent, release story, production choices
 */
function buildContextualKnowledge(deepResearch) {
  if (!deepResearch) {
    return {
      artistIntent: null,
      releaseNarrative: null,
      trackContexts: [],
      culturalContext: null,
    };
  }

  return {
    artistIntent: deepResearch.artistContext?.background || null,
    releaseNarrative: deepResearch.releaseContext?.details || null,
    trackContexts: (deepResearch.trackInsights || []).map(insight => ({
      trackName: insight.trackName,
      artistCommentary: insight.analysis,
    })),
    culturalContext: deepResearch.contextualArticles?.[0]?.summary || null,
  };
}

/**
 * PERSONAL RESONANCE: Does this music speak to the character's emotional state, personality, or history?
 */
function buildPersonalResonance(character, mediaObject, understanding, deepResearch) {
  const resonance = {
    emotionalAlignment: null,
    thematicAlignment: null,
    personalConnections: [],
    likelyInterpretation: null,
  };

  if (!understanding) return resonance;

  // Emotional alignment: does the music's mood match or contrast with character's current state?
  const charMood = character.emotional_state || 'neutral';
  const musicMoods = understanding.overallMood || [];
  
  resonance.emotionalAlignment = {
    characterMood: charMood,
    musicMoods,
    alignment: assessMoodAlignment(charMood, musicMoods),
    reason: buildMoodAlignmentReason(charMood, musicMoods),
  };

  // Thematic alignment: do the music's themes connect to character's life/personality?
  const musicThemes = understanding.themes || [];
  const charThemes = extractCharacterThemes(character);
  
  resonance.thematicAlignment = {
    characterThemes: charThemes,
    musicThemes,
    overlaps: musicThemes.filter(t => charThemes.includes(t)),
    resonanceScore: calculateThematicResonance(charThemes, musicThemes),
  };

  // Personal connections: specific track or thematic hooks
  if (deepResearch?.trackInsights) {
    resonance.personalConnections = deepResearch.trackInsights
      .slice(0, 3)
      .map(track => ({
        trackName: track.trackName,
        whyRelevant: inferTrackRelevance(character, track),
      }))
      .filter(conn => conn.whyRelevant);
  }

  // Likely interpretation: how this character would frame/understand the music
  resonance.likelyInterpretation = buildCharacterInterpretation(character, understanding, deepResearch);

  return resonance;
}

/**
 * CONVERSATION HOOKS: Specific references character can make naturally
 */
function buildConversationHooks(character, mediaObject, understanding, deepResearch) {
  const hooks = {
    directReferences: [],
    thematicOpeners: [],
    artistOpeners: [],
    trackSpecificComments: [],
  };

  // Direct references the character might make
  if (understanding?.themes) {
    hooks.directReferences = understanding.themes.slice(0, 3).map(theme => ({
      theme,
      example: `You mentioned themes of ${theme} in this...`,
    }));
  }

  // Thematic conversation starters
  if (understanding?.characterExperienceHooks?.socialUse) {
    hooks.thematicOpeners = [
      `This is perfect for ${understanding.characterExperienceHooks.socialUse[0]}`,
      `I'm getting a ${understanding.overallMood?.[0] || 'vibe'} from this`,
    ];
  }

  // Artist-specific comments (if research available)
  if (deepResearch?.artistContext?.background) {
    hooks.artistOpeners = [
      `Given what I know about ${mediaObject.artist}, this makes sense...`,
      `${mediaObject.artist} has always been about [inferred theme]...`,
    ];
  }

  // Track-specific knowledge
  if (deepResearch?.trackInsights) {
    hooks.trackSpecificComments = deepResearch.trackInsights
      .slice(0, 5)
      .map(track => ({
        trackName: track.trackName,
        reference: `The way "${track.trackName}" is structured...`,
      }));
  }

  return hooks;
}

/**
 * HELPER: Assess mood alignment
 */
function assessMoodAlignment(characterMood, musicMoods) {
  const moodMap = {
    calm: ['peaceful', 'mellow', 'reflective'],
    joyful: ['happy', 'energetic', 'uplifting'],
    anxious: ['tense', 'unsettling', 'complex'],
    sad: ['melancholic', 'aching', 'reflective'],
    angry: ['aggressive', 'intense', 'raw'],
  };

  const charMoodMatches = moodMap[characterMood] || [];
  const overlap = musicMoods.filter(m => charMoodMatches.includes(m)).length;

  return overlap > 0 ? 'aligned' : 'contrasting';
}

function buildMoodAlignmentReason(characterMood, musicMoods) {
  const moodStr = musicMoods.join(', ') || 'emotionally mixed';
  
  if (characterMood === 'sad' && musicMoods.includes('melancholic')) {
    return `The melancholy in this resonates with how you're feeling right now`;
  }

  if (characterMood === 'calm' && musicMoods.includes('peaceful')) {
    return `This aligns perfectly with your current headspace`;
  }

  if (characterMood === 'joyful' && musicMoods.includes('energetic')) {
    return `This amplifies the energy you're carrying`;
  }

  return `The ${moodStr} tone of this fits with your current mood`;
}

/**
 * HELPER: Extract themes from character's history and personality
 */
function extractCharacterThemes(character) {
  const themes = [];

  const personality = (character.personality_summary || '').toLowerCase();
  if (personality.includes('love') || personality.includes('romantic')) themes.push('love');
  if (personality.includes('struggle') || personality.includes('fight')) themes.push('struggle');
  if (personality.includes('growth') || personality.includes('change')) themes.push('growth');
  if (personality.includes('loss') || personality.includes('grief')) themes.push('loss');
  if (personality.includes('freedom') || personality.includes('rebel')) themes.push('freedom');

  const background = (character.background_story || '').toLowerCase();
  if (background.includes('family')) themes.push('family');
  if (background.includes('heartbreak')) themes.push('heartbreak');
  if (background.includes('triumph')) themes.push('achievement');

  const triggers = character.emotional_triggers_deep || [];
  themes.push(...triggers.map(t => t.toLowerCase().split(' ')[0]));

  return [...new Set(themes)];
}

function calculateThematicResonance(characterThemes, musicThemes) {
  if (characterThemes.length === 0 || musicThemes.length === 0) return 0;

  const overlap = musicThemes.filter(t => characterThemes.includes(t)).length;
  return Math.min(overlap / Math.max(characterThemes.length, musicThemes.length), 1.0);
}

function inferTrackRelevance(character, track) {
  // Simple heuristic: if track name contains emotional keywords that match character
  const trackLower = (track.trackName || '').toLowerCase();
  const charThemes = extractCharacterThemes(character);

  if (charThemes.some(theme => trackLower.includes(theme))) {
    return `This track "${track.trackName}" seems to speak directly to your experience with ${charThemes.find(t => trackLower.includes(t))}`;
  }

  return null;
}

function buildCharacterInterpretation(character, understanding, deepResearch) {
  const parts = [];

  const charPersonality = character.personality_summary || '';
  const musicThemes = understanding?.themes || [];
  const artistIntent = deepResearch?.artistContext?.background;

  parts.push(`As someone who ${charPersonality}, you would likely hear this as...`);

  if (musicThemes.length > 0) {
    parts.push(`An exploration of ${musicThemes.slice(0, 2).join(' and ')}`);
  }

  if (artistIntent) {
    parts.push(`...with the depth of intention ${deepResearch.artistContext.artist} brings to their work.`);
  }

  const energy = understanding?.energyProfile || 'medium';
  if (energy === 'high') {
    parts.push(`The energy would likely feel cathartic or validating.`);
  } else if (energy === 'low') {
    parts.push(`The intimacy would likely feel introspective and clarifying.`);
  }

  return parts.join(' ');
}

/**
 * KNOWLEDGE LEVEL: How well does the character understand this media?
 */
function calculateCharacterKnowledgeLevel(understanding, deepResearch) {
  let level = 'basic'; // title + artist + basic mood
  let confidence = 0.4;

  if (understanding?.analysisConfidence >= 0.5) {
    level = 'informed';
    confidence += 0.2;
  }

  if (deepResearch?.artistContext?.queried) {
    level = 'deep';
    confidence += 0.15;
  }

  if (deepResearch?.trackInsights?.length > 0) {
    level = 'detailed';
    confidence += 0.15;
  }

  if (deepResearch?.contextualArticles?.length > 0) {
    level = 'expert';
    confidence = 1.0;
  }

  return {
    level,
    confidence: Math.min(confidence, 1.0),
    description: `The character has a ${level} understanding of this media, built from ${deepResearch?.sourcesQueried?.length || 0} research angles.`,
  };
}