import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * DEEP MEDIA RESEARCH LAYER
 * 
 * Conducts multi-angle research on albums, playlists, and tracks:
 * - Artist biography & intent
 * - Track-by-track mood/theme analysis
 * - Artist commentary on specific tracks
 * - Contextual articles & interviews
 * - Release context & critical reception
 * 
 * Returns a rich understanding object for character knowledge.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { mediaObject, tracks = [] } = await req.json();

    if (!mediaObject) {
      return Response.json({ error: 'mediaObject required' }, { status: 400 });
    }

    const deepResearch = await conductDeepMediaResearch(mediaObject, tracks);

    return Response.json({ success: true, deepResearch });
  } catch (error) {
    console.error('[deepMediaResearch] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * MAIN ENTRY: Conduct comprehensive research across all angles
 */
async function conductDeepMediaResearch(mediaObject, tracks = []) {
  const research = {
    mediaId: mediaObject.spotify_id || mediaObject.destinationId,
    title: mediaObject.title,
    artist: mediaObject.artist,
    destinationType: mediaObject.destinationType,
    
    artistContext: null,
    releaseContext: null,
    trackInsights: [],
    thematicOverview: null,
    contextualArticles: [],
    
    researchCompleteness: 0,
    sourcesQueried: [],
  };

  // Parallel research gathering
  const [artistInfo, releaseInfo, trackAnalysis, articles] = await Promise.all([
    gatherArtistContext(mediaObject),
    gatherReleaseContext(mediaObject),
    analyzeTrackLevelMoods(mediaObject, tracks),
    gatherContextualArticles(mediaObject),
  ]);

  research.artistContext = artistInfo;
  research.releaseContext = releaseInfo;
  research.trackInsights = trackAnalysis;
  research.contextualArticles = articles;

  // Build thematic overview from all sources
  research.thematicOverview = buildThematicNarrative(research);

  // Calculate research completeness
  research.researchCompleteness = calculateCompleteness(research);
  research.sourcesQueried = [
    artistInfo ? 'artist_biography' : null,
    releaseInfo ? 'release_context' : null,
    trackAnalysis?.length > 0 ? 'track_analysis' : null,
    articles?.length > 0 ? 'contextual_articles' : null,
  ].filter(Boolean);

  return research;
}

/**
 * ARTIST CONTEXT: Biography, Style, Intent
 */
async function gatherArtistContext(mediaObject) {
  const artistName = mediaObject.artist || 'Unknown';

  try {
    // Use LLM to research artist's background, style, and intent
    const artistResearch = await base44.integrations.Core.InvokeLLM({
      prompt: `Research the artist "${artistName}". Provide:
1. Musical background and evolution
2. Signature style and influences
3. Known creative themes and recurring motifs
4. Typical emotional or thematic focus
5. How this artist approaches album/song construction

Be concise and factual. If you don't have reliable information, say so.`,
      add_context_from_internet: true,
      model: 'gemini_3_flash',
    });

    return {
      artist: artistName,
      background: artistResearch || null,
      queried: true,
    };
  } catch (err) {
    console.error('[gatherArtistContext] Research failed:', err.message);
    return {
      artist: artistName,
      background: null,
      queried: false,
    };
  }
}

/**
 * RELEASE CONTEXT: Album meaning, production notes, critical reception
 */
async function gatherReleaseContext(mediaObject) {
  const title = mediaObject.title || 'Unknown';
  const artist = mediaObject.artist || 'Unknown';
  const destinationType = mediaObject.destinationType || 'SONG';

  if (destinationType === 'SONG') {
    return null; // Skip for individual songs
  }

  try {
    const releaseResearch = await base44.integrations.Core.InvokeLLM({
      prompt: `Research "${title}" ${destinationType.toLowerCase()} by ${artist}. Provide:
1. Release date and label
2. Creative vision / concept behind the album/playlist
3. Notable production or instrumentation choices
4. Key themes or narrative arc
5. Critical reception or notable praise
6. Context of when/how it was made

Be factual and concise.`,
      add_context_from_internet: true,
      model: 'gemini_3_flash',
    });

    return {
      title,
      releaseType: destinationType,
      details: releaseResearch || null,
      queried: true,
    };
  } catch (err) {
    console.error('[gatherReleaseContext] Research failed:', err.message);
    return {
      title,
      releaseType: destinationType,
      details: null,
      queried: false,
    };
  }
}

/**
 * TRACK-LEVEL ANALYSIS: Per-track mood, themes, artist commentary
 */
async function analyzeTrackLevelMoods(mediaObject, tracks = []) {
  if (!tracks || tracks.length === 0) {
    return [];
  }

  const insights = [];

  for (const track of tracks.slice(0, 15)) { // Limit to first 15 to avoid timeouts
    try {
      const trackAnalysis = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze the song "${track.name}" by ${mediaObject.artist || 'unknown artist'}. Provide:
1. Inferred mood and emotional tone
2. Key lyrical or musical themes
3. Probable listener experience or intended effect
4. Musical style or production approach
5. Any known artist commentary about this specific track

Be concise. If you don't have detailed knowledge, make educated inference from the title and artist style.`,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
      });

      insights.push({
        trackName: track.name,
        analysis: trackAnalysis || null,
        artist: mediaObject.artist,
        queried: true,
      });
    } catch (err) {
      console.error(`[analyzeTrackLevelMoods] Failed for "${track.name}":`, err.message);
      insights.push({
        trackName: track.name,
        analysis: null,
        queried: false,
      });
    }

    // Add small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  return insights;
}

/**
 * CONTEXTUAL ARTICLES: Reviews, interviews, think pieces
 */
async function gatherContextualArticles(mediaObject) {
  const title = mediaObject.title || 'Unknown';
  const artist = mediaObject.artist || 'Unknown';

  try {
    const articlesResearch = await base44.integrations.Core.InvokeLLM({
      prompt: `Find notable articles or interviews about "${title}" by ${artist}. List:
1. Critical reviews (mood/vibe they highlight)
2. Artist interviews (what they said about the music)
3. Think pieces about themes or impact
4. Fan/listener reactions that reveal emotional resonance

Provide 3-5 concise bullet points with source type.`,
      add_context_from_internet: true,
      model: 'gemini_3_flash',
    });

    return articlesResearch
      ? [{ summary: articlesResearch, queried: true }]
      : [];
  } catch (err) {
    console.error('[gatherContextualArticles] Research failed:', err.message);
    return [];
  }
}

/**
 * BUILD THEMATIC NARRATIVE: Synthesize all research into character-ready understanding
 */
function buildThematicNarrative(research) {
  const parts = [];

  if (research.artistContext?.background) {
    parts.push(`Artist context: ${research.artistContext.background}`);
  }

  if (research.releaseContext?.details) {
    parts.push(`Release context: ${research.releaseContext.details}`);
  }

  if (research.trackInsights && research.trackInsights.length > 0) {
    const trackSummary = research.trackInsights
      .slice(0, 3)
      .map(t => `"${t.trackName}": ${t.analysis ? t.analysis.substring(0, 100) : 'no analysis'}`)
      .join(' | ');
    parts.push(`Track insights: ${trackSummary}`);
  }

  if (research.contextualArticles && research.contextualArticles.length > 0) {
    parts.push(`Context: ${research.contextualArticles[0]?.summary?.substring(0, 150)}`);
  }

  return parts.length > 0
    ? parts.join('\n\n')
    : 'Deep research is still being gathered. Character understanding building.';
}

/**
 * CALCULATE RESEARCH COMPLETENESS: How well did we gather info?
 */
function calculateCompleteness(research) {
  let score = 0.3; // Base

  if (research.artistContext?.queried) score += 0.15;
  if (research.releaseContext?.queried) score += 0.15;
  if (research.trackInsights?.length > 0) score += 0.2;
  if (research.contextualArticles?.length > 0) score += 0.15;

  return Math.min(score, 1.0);
}