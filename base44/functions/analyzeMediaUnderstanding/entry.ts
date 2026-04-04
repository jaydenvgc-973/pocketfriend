import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * MUSIC UNDERSTANDING ANALYSIS ENGINE
 * 
 * Extends media link parsing by analyzing:
 * - Metadata (genre, tempo, duration, release info)
 * - Lyrics (mood, themes, emotional arc)
 * - Audio descriptors (if available)
 * - User comments/context
 * 
 * Returns a structured understanding object for character reactions.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { mediaObject, sources = {} } = await req.json();

    if (!mediaObject) {
      return Response.json({ error: 'mediaObject required' }, { status: 400 });
    }

    const understanding = await buildMusicUnderstanding(mediaObject, sources);

    return Response.json({ success: true, understanding });
  } catch (error) {
    console.error('[analyzeMediaUnderstanding] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * MAIN ENTRY: Build complete music understanding from available sources
 */
async function buildMusicUnderstanding(mediaObject, sources = {}) {
  const understanding = {
    mediaId: mediaObject.spotify_id || mediaObject.destinationId || null,
    provider: mediaObject.platform || 'unknown',
    destinationType: mediaObject.destinationType || 'SONG',
    title: mediaObject.title || 'Unknown',
    artist: mediaObject.artist || 'Unknown Artist',
    duration: mediaObject.duration || null,

    analysisConfidence: 0,
    sourceTypesUsed: {
      metadata: !!mediaObject,
      lyrics: !!sources.lyrics,
      transcript: !!sources.transcript,
      audio: !!sources.audio,
      comments: !!sources.comments,
    },

    // Emotional + thematic analysis
    overallMood: [],
    energyProfile: 'medium',
    emotionalArc: [],
    themes: [],
    sensoryDescriptors: [],
    narrativeSummary: '',

    // Character reaction hooks
    characterExperienceHooks: {
      goodFor: [],
      likelyReactions: [],
      socialUse: [],
    },
  };

  // HIGHEST CONFIDENCE: LYRICS + METADATA
  if (sources.lyrics || sources.transcript) {
    const textAnalysis = analyzeTextualContent({
      lyrics: sources.lyrics,
      transcript: sources.transcript,
      metadata: mediaObject,
      comments: sources.comments,
    });

    understanding.overallMood = textAnalysis.overallMood;
    understanding.energyProfile = textAnalysis.energyProfile;
    understanding.emotionalArc = textAnalysis.emotionalArc;
    understanding.themes = textAnalysis.themes;
    understanding.sensoryDescriptors = textAnalysis.sensoryDescriptors;
    understanding.narrativeSummary = textAnalysis.narrativeSummary;
    understanding.analysisConfidence = 0.70;
  }
  // MID CONFIDENCE: METADATA + GENRE + PLAYLIST CONTEXT
  else if (mediaObject.cover_art || mediaObject.genre || sources.playlistContext) {
    const metadataAnalysis = analyzeMetadata(mediaObject, sources);

    understanding.overallMood = metadataAnalysis.overallMood;
    understanding.energyProfile = metadataAnalysis.energyProfile;
    understanding.emotionalArc = metadataAnalysis.emotionalArc;
    understanding.themes = metadataAnalysis.themes;
    understanding.sensoryDescriptors = metadataAnalysis.sensoryDescriptors;
    understanding.narrativeSummary = metadataAnalysis.narrativeSummary;
    understanding.analysisConfidence = 0.50;
  }
  // LOW CONFIDENCE: TITLE + ARTIST ONLY
  else {
    const titleAnalysis = analyzeTitleOnly(mediaObject);
    understanding.overallMood = titleAnalysis.overallMood;
    understanding.energyProfile = titleAnalysis.energyProfile;
    understanding.themes = titleAnalysis.themes;
    understanding.sensoryDescriptors = titleAnalysis.sensoryDescriptors;
    understanding.narrativeSummary = titleAnalysis.narrativeSummary;
    understanding.analysisConfidence = 0.30;
  }

  // Always build character experience hooks
  understanding.characterExperienceHooks = buildCharacterExperienceHooks(understanding);

  return understanding;
}

/**
 * TEXTUAL ANALYSIS: Lyrics + Transcript
 */
function analyzeTextualContent({ lyrics, transcript, metadata, comments }) {
  const fullText = [lyrics, transcript, comments].filter(Boolean).join('\n\n');

  // Extract mood keywords
  const moodKeywords = {
    reflective: ['think', 'feel', 'wonder', 'remember', 'introspect'],
    melancholic: ['sad', 'blue', 'alone', 'lonely', 'aching', 'hurt', 'pain'],
    hopeful: ['hope', 'light', 'bright', 'shine', 'tomorrow', 'forward', 'rise'],
    angry: ['hate', 'rage', 'furious', 'mad', 'angry', 'sick of'],
    joyful: ['happy', 'joy', 'celebrate', 'love', 'smile', 'laugh'],
    vulnerable: ['weak', 'break', 'fall', 'fear', 'scared', 'naked'],
    defiant: ['never', 'refuse', 'won\'t', 'stand up', 'fight back'],
    nostalgic: ['remember', 'used to', 'back then', 'nostalgia', 'old days'],
  };

  const detectedMoods = [];
  for (const [mood, keywords] of Object.entries(moodKeywords)) {
    const textLower = fullText.toLowerCase();
    const matchCount = keywords.filter(kw => textLower.includes(kw)).length;
    if (matchCount >= 2) detectedMoods.push(mood);
  }

  // Infer energy from structure
  const lines = fullText.split('\n').filter(l => l.trim());
  const shortLines = lines.filter(l => l.length < 50).length;
  const avgLineLength = lines.reduce((a, b) => a + b.length, 0) / (lines.length || 1);
  const energyProfile =
    avgLineLength > 100 ? 'low' :
    avgLineLength > 70 ? 'medium' :
    'high';

  // Build emotional arc (simple 3-phase)
  const thirdMark = Math.floor(fullText.length / 3);
  const arc = [
    {
      phase: 'beginning',
      start: 0,
      end: 33,
      mood: detectedMoods[0] || 'setup',
      energy: energyProfile,
    },
    {
      phase: 'middle',
      start: 33,
      end: 66,
      mood: detectedMoods[Math.floor(detectedMoods.length / 2)] || 'development',
      energy: energyProfile,
    },
    {
      phase: 'end',
      start: 66,
      end: 100,
      mood: detectedMoods[detectedMoods.length - 1] || 'resolution',
      energy: energyProfile,
    },
  ];

  const themes = inferThemesFromText(fullText);
  const descriptors = inferDescriptorsFromText(fullText, metadata);

  return {
    overallMood: [...new Set(detectedMoods)].slice(0, 5),
    energyProfile,
    emotionalArc: arc,
    themes,
    sensoryDescriptors: descriptors,
    narrativeSummary: writeSummaryFromAnalysis(detectedMoods, themes, energyProfile),
  };
}

/**
 * METADATA ANALYSIS: Title, Genre, Duration
 */
function analyzeMetadata(mediaObject, sources) {
  const genreToMood = {
    'hip-hop': ['energetic', 'bold'],
    'rap': ['intense', 'sharp'],
    'pop': ['upbeat', 'catchy'],
    'rock': ['powerful', 'raw'],
    'metal': ['aggressive', 'intense'],
    'jazz': ['sophisticated', 'reflective'],
    'classical': ['elegant', 'contemplative'],
    'electronic': ['modern', 'experimental'],
    'ambient': ['atmospheric', 'calming'],
    'folk': ['storytelling', 'intimate'],
    'country': ['nostalgic', 'heartfelt'],
    'indie': ['introspective', 'quirky'],
    'soul': ['emotional', 'soulful'],
    'r&b': ['smooth', 'sensual'],
    'emo': ['vulnerable', 'melancholic'],
    'punk': ['rebellious', 'energetic'],
    'lo-fi': ['mellow', 'chill'],
  };

  const genre = (mediaObject.genre || '').toLowerCase();
  const detectedMoods = [];

  for (const [genreKey, moods] of Object.entries(genreToMood)) {
    if (genre.includes(genreKey)) {
      detectedMoods.push(...moods);
    }
  }

  // Duration heuristic
  const duration = mediaObject.duration || 0;
  const energyProfile =
    duration > 300 ? 'low' : // Long songs tend to be slower
    duration > 180 ? 'medium' :
    'high'; // Short songs tend to be punchier

  // Fallbacks
  if (detectedMoods.length === 0) {
    detectedMoods.push('atmospheric');
  }

  const themes = inferThemesFromMetadata(mediaObject);
  const descriptors = [genre || 'musical', ...inferDescriptorsFromMetadata(mediaObject)];

  return {
    overallMood: [...new Set(detectedMoods)].slice(0, 5),
    energyProfile,
    emotionalArc: [
      {
        phase: 'full',
        start: 0,
        end: 100,
        mood: detectedMoods[0] || 'atmospheric',
        energy: energyProfile,
      },
    ],
    themes,
    sensoryDescriptors: [...new Set(descriptors)].slice(0, 10),
    narrativeSummary: `This ${genre || 'musical composition'} carries an ${energyProfile} energy and suggests themes of ${themes.join(', ') || 'artistic expression'}.`,
  };
}

/**
 * TITLE ONLY ANALYSIS: Fallback for minimal data
 */
function analyzeTitleOnly(mediaObject) {
  const title = (mediaObject.title || '').toLowerCase();
  const artist = (mediaObject.artist || '').toLowerCase();

  const sadKeywords = ['sad', 'blue', 'lonely', 'aching', 'loss', 'goodbye', 'never'];
  const happyKeywords = ['happy', 'love', 'joy', 'sunshine', 'celebrate', 'smile'];
  const energyKeywords = ['rush', 'run', 'jump', 'fly', 'electric', 'wild'];

  let detectedMood = 'atmospheric';
  if (sadKeywords.some(kw => title.includes(kw) || artist.includes(kw))) {
    detectedMood = 'melancholic';
  } else if (happyKeywords.some(kw => title.includes(kw))) {
    detectedMood = 'joyful';
  }

  const energyProfile = energyKeywords.some(kw => title.includes(kw)) ? 'high' : 'medium';

  return {
    overallMood: [detectedMood],
    energyProfile,
    emotionalArc: [],
    themes: inferThemesFromTitle(title),
    sensoryDescriptors: ['unconfirmed', 'title-derived'],
    narrativeSummary: `Based on the title alone, this appears to carry a ${detectedMood} emotional tone. More detailed analysis would require additional context.`,
  };
}

/**
 * HELPER FUNCTIONS: Theme & Descriptor Inference
 */

function inferThemesFromText(text) {
  const themes = [];
  const textLower = text.toLowerCase();

  const themePatterns = {
    love: ['love', 'heart', 'beloved', 'romantic'],
    heartbreak: ['heartbreak', 'broken', 'lost you', 'without you'],
    growth: ['grow', 'change', 'evolve', 'become', 'stronger'],
    loss: ['lose', 'gone', 'left', 'goodbye', 'farewell'],
    hope: ['hope', 'tomorrow', 'future', 'believe'],
    memory: ['remember', 'memory', 'remind', 'nostalgic'],
    identity: ['who am i', 'myself', 'self', 'identity'],
    struggle: ['struggle', 'fight', 'battle', 'overcome'],
    freedom: ['free', 'liberate', 'break chains', 'fly'],
  };

  for (const [theme, keywords] of Object.entries(themePatterns)) {
    if (keywords.some(kw => textLower.includes(kw))) {
      themes.push(theme);
    }
  }

  return [...new Set(themes)].slice(0, 8);
}

function inferDescriptorsFromText(text, metadata) {
  const descriptors = [];
  const textLower = text.toLowerCase();

  if (textLower.includes('dream') || textLower.includes('night')) descriptors.push('dreamy');
  if (textLower.includes('dark') || textLower.includes('black')) descriptors.push('dark');
  if (textLower.includes('bright') || textLower.includes('light')) descriptors.push('bright');
  if (textLower.includes('slow') || text.split('\n').some(l => l.length > 100)) descriptors.push('slow-burn');
  if (text.split('\n').length > 50) descriptors.push('detailed');
  if (textLower.includes('dance') || textLower.includes('move')) descriptors.push('rhythmic');

  if (metadata?.genre) descriptors.push(metadata.genre.toLowerCase());

  return [...new Set(descriptors)].slice(0, 10);
}

function inferThemesFromMetadata(mediaObject) {
  const themes = [];

  const genre = (mediaObject.genre || '').toLowerCase();
  if (genre.includes('soul') || genre.includes('r&b')) themes.push('emotional depth');
  if (genre.includes('rock')) themes.push('raw emotion');
  if (genre.includes('folk')) themes.push('storytelling');
  if (genre.includes('electronic')) themes.push('modern innovation');
  if (genre.includes('jazz')) themes.push('sophisticated expression');

  return themes.length ? themes : ['artistic expression'];
}

function inferDescriptorsFromMetadata(mediaObject) {
  const descriptors = [];

  const genre = (mediaObject.genre || '').toLowerCase();
  if (genre.includes('ambient')) descriptors.push('atmospheric');
  if (genre.includes('lo-fi')) descriptors.push('mellow');
  if (genre.includes('punk')) descriptors.push('rebellious');
  if (genre.includes('classical')) descriptors.push('elegant');

  return descriptors;
}

function inferThemesFromTitle(title) {
  const themes = [];

  if (title.includes('love')) themes.push('romance');
  if (title.includes('night') || title.includes('midnight')) themes.push('nocturnal');
  if (title.includes('dream')) themes.push('aspiration');
  if (title.includes('memory') || title.includes('remember')) themes.push('reflection');

  return themes.length ? themes : ['unresolved'];
}

function writeSummaryFromAnalysis(moods, themes, energy) {
  const moodStr = moods.join(', ') || 'emotionally complex';
  const themeStr = themes.join(', ') || 'varied themes';
  const energyStr = energy === 'high' ? 'energetic and driving' : energy === 'low' ? 'slow and contemplative' : 'steady';

  return `This piece carries a ${moodStr} emotional tone, is ${energyStr}, and explores themes of ${themeStr}. The emotional flow should be treated as progressive, not flat.`;
}

/**
 * CHARACTER EXPERIENCE HOOKS
 */

function buildCharacterExperienceHooks(understanding) {
  const { energyProfile, overallMood, themes } = understanding;

  return {
    goodFor: inferGoodForMoments(understanding),
    likelyReactions: inferLikelyReactions(understanding),
    socialUse: inferSocialUse(understanding),
  };
}

function inferGoodForMoments(understanding) {
  const moods = understanding.overallMood || [];
  const energy = understanding.energyProfile || 'medium';

  const goodFor = [];

  if (moods.includes('reflective') || moods.includes('melancholic')) {
    goodFor.push('late night alone', 'emotional processing', 'deep conversation');
  }

  if (energy === 'high') {
    goodFor.push('workout energy', 'party vibe', 'getting pumped');
  }

  if (moods.includes('joyful') || moods.includes('hopeful')) {
    goodFor.push('uplifting moments', 'celebrate', 'good mood');
  }

  return goodFor.length ? goodFor : ['casual listening', 'background'];
}

function inferLikelyReactions(understanding) {
  const reactions = [];

  const themes = understanding.themes || [];
  const moods = understanding.overallMood || [];

  if (themes.includes('heartbreak') || themes.includes('loss')) {
    reactions.push('nostalgic', 'empathetic');
  }

  if (themes.includes('hope') || moods.includes('hopeful')) {
    reactions.push('inspired', 'comforted');
  }

  if (moods.includes('angry') || themes.includes('struggle')) {
    reactions.push('cathartic', 'validated');
  }

  if (understanding.energyProfile === 'high') {
    reactions.push('energized', 'adrenaline');
  }

  return reactions.length ? reactions : ['interested'];
}

function inferSocialUse(understanding) {
  const energy = understanding.energyProfile || 'medium';
  const moods = understanding.overallMood || [];

  if (energy === 'high') {
    return ['party', 'group energy', 'celebration', 'motivation'];
  }

  if (moods.includes('reflective') || moods.includes('vulnerable')) {
    return ['intimate setting', 'deep listening', 'one-on-one'];
  }

  return ['flexible', 'background listening', 'any setting'];
}