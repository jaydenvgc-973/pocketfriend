import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, spotifyLink } = await req.json();

    if (!characterId || !spotifyLink) {
      return Response.json({ error: 'characterId and spotifyLink are required' }, { status: 400 });
    }

    // Extract track info from Spotify link
    const spotifyIdMatch = spotifyLink.match(/track\/([a-zA-Z0-9]+)/);
    const spotifyId = spotifyIdMatch ? spotifyIdMatch[1] : null;

    if (!spotifyId) {
      return Response.json({ error: 'Invalid Spotify link format' }, { status: 400 });
    }

    // Use LLM to extract song/artist info and fetch lyrics
    const extractionPrompt = `Extract song information from this Spotify URL: ${spotifyLink}

The URL contains a track ID: ${spotifyId}

Please provide:
1. The song title
2. The artist name
3. A brief summary of what the song is about (2-3 sentences)
4. Key lyrics or a notable lyric excerpt from the song

Return as JSON with fields: title, artist, summary, lyric_excerpt`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt: extractionPrompt,
      add_context_from_internet: true,
      model: 'gemini_3_flash',
      response_json_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          artist: { type: 'string' },
          summary: { type: 'string' },
          lyric_excerpt: { type: 'string' }
        }
      }
    });

    // Get full lyrics
    const lyricsPrompt = `Get the full lyrics for the song "${response.title}" by ${response.artist}. Return only the lyrics, line by line.`;
    
    let fullLyrics = '';
    try {
      fullLyrics = await base44.integrations.Core.InvokeLLM({
        prompt: lyricsPrompt,
        add_context_from_internet: true,
        model: 'gemini_3_flash'
      });
    } catch (err) {
      fullLyrics = response.summary;
    }

    // Add song to character's heard songs
    const character = await base44.entities.Character.filter({ id: characterId }, null, 1).then(c => c?.[0]);
    
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const newSong = {
      title: response.title,
      artist: response.artist,
      spotify_id: spotifyId,
      lyrics_excerpt: response.lyric_excerpt,
      full_lyrics: fullLyrics,
      added_date: new Date().toISOString()
    };

    const songsHeard = character.songs_heard || [];
    const updatedSongs = [...songsHeard, newSong];

    await base44.entities.Character.update(characterId, {
      songs_heard: updatedSongs
    });

    return Response.json({
      success: true,
      song: newSong,
      message: `${character.name} just listened to "${response.title}" by ${response.artist}`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});