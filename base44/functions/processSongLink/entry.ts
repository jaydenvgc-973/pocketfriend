import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, songLink } = await req.json();

    if (!characterId || !songLink) {
      return Response.json({ error: 'characterId and songLink are required' }, { status: 400 });
    }

    // Use filter instead of get — more reliable across SDK versions
    let character = null;
    try {
      const chars = await base44.asServiceRole.entities.Character.filter({ id: characterId });
      character = chars?.[0] || null;
    } catch (_) {
      // filter can throw on invalid IDs
    }
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Detect if this is a playlist/album link
    const isPlaylist =
      /[?&]list=/.test(songLink) ||
      /playlist/i.test(songLink) ||
      /album/i.test(songLink) ||
      /soundcloud\.com\/[^/]+\/sets\//.test(songLink);

    if (isPlaylist) {
      // ── PLAYLIST PATH ────────────────────────────────────────────────────────
      const playlistPrompt = `You have access to the internet. Look up this exact music playlist/album URL: ${songLink}

Search the web for this URL and return the REAL tracklist with actual song titles and artist names.

For EACH song (up to 10) provide:
- title: the exact song title (REQUIRED — must be a real song name)
- artist: the artist/band name (REQUIRED)
- spotify_id: the Spotify track ID if available (from the URL or API)
- preview_url: the 30-second preview URL from Spotify if available
- lyric_excerpt: a real, memorable lyric line from the song
- mood: 2-3 words describing the feel/vibe (e.g. "melancholic, romantic", "upbeat, danceable")

Also provide:
- playlist_name: the actual album or playlist name

IMPORTANT: Return real song data from actually searching the URL. Do not make up song names.

Return valid JSON only:
{
  "playlist_name": "...",
  "songs": [
    { "title": "...", "artist": "...", "spotify_id": "...", "preview_url": "...", "lyric_excerpt": "...", "mood": "..." }
  ]
}`;

      let playlistData = null;
      try {
        playlistData = await base44.integrations.Core.InvokeLLM({
          prompt: playlistPrompt,
          add_context_from_internet: true,
          model: 'gemini_3_flash',
          response_json_schema: {
            type: 'object',
            properties: {
              playlist_name: { type: 'string' },
              songs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    artist: { type: 'string' },
                    spotify_id: { type: 'string' },
                    preview_url: { type: 'string' },
                    lyric_excerpt: { type: 'string' },
                    mood: { type: 'string' }
                  },
                  required: ['title', 'artist']
                }
              }
            },
            required: ['playlist_name', 'songs']
          }
        });
      } catch (llmErr) {
        console.error('[processSongLink] Playlist LLM error:', llmErr.message);
        return Response.json({ error: 'Failed to identify playlist songs: ' + llmErr.message }, { status: 500 });
      }

      // Validate we got real songs back
      if (!playlistData?.songs?.length) {
        return Response.json({ error: 'Could not identify songs in this playlist. Try a different link.' }, { status: 422 });
      }

      const songsHeard = character.songs_heard || [];
      const now = new Date().toISOString();

      const newSongs = playlistData.songs
        .filter(s => s.title && s.artist) // only valid entries
        .map(s => ({
          title: s.title,
          artist: s.artist,
          lyrics_excerpt: s.lyric_excerpt || '',
          full_lyrics: s.mood ? `Mood/vibe: ${s.mood}` : '',
          spotify_id: s.spotify_id || '',
          preview_url: s.preview_url || '',
          added_date: now,
        }));

      // Dedupe: skip songs the character already knows
      const existingKeys = new Set(songsHeard.map(s => `${s.title}|${s.artist}`.toLowerCase()));
      const uniqueNewSongs = newSongs.filter(s => !existingKeys.has(`${s.title}|${s.artist}`.toLowerCase()));

      await base44.asServiceRole.entities.Character.update(characterId, {
        songs_heard: [...songsHeard, ...uniqueNewSongs],
      });

      return Response.json({
        success: true,
        is_playlist: true,
        playlist_name: playlistData.playlist_name || 'Playlist',
        songs_added: uniqueNewSongs.length,
        songs: uniqueNewSongs,
        message: `${character.name} just listened to "${playlistData.playlist_name || 'a playlist'}" — ${uniqueNewSongs.length} new songs added`,
      });
    }

    // ── SINGLE SONG PATH ─────────────────────────────────────────────────────
    const extractionPrompt = `You have access to the internet. Look up this music link and identify the song: ${songLink}

Search the web for this URL and return the REAL song title and artist.

Return:
1. title: the exact song title (REQUIRED)
2. artist: the artist name (REQUIRED)
3. spotify_id: the Spotify track ID if available
4. preview_url: the 30-second preview URL from Spotify if available
5. summary: what the song is about (2-3 sentences)
6. lyric_excerpt: a real, memorable lyric line
7. mood: 2-3 words for the vibe (e.g. "melancholic, romantic")

Return valid JSON only:
{
  "title": "...",
  "artist": "...",
  "spotify_id": "...",
  "preview_url": "...",
  "summary": "...",
  "lyric_excerpt": "...",
  "mood": "..."
}`;

    let songData = null;
    try {
      songData = await base44.integrations.Core.InvokeLLM({
        prompt: extractionPrompt,
        add_context_from_internet: true,
        model: 'gemini_3_flash',
        response_json_schema: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            artist: { type: 'string' },
            spotify_id: { type: 'string' },
            preview_url: { type: 'string' },
            summary: { type: 'string' },
            lyric_excerpt: { type: 'string' },
            mood: { type: 'string' }
          },
          required: ['title', 'artist']
        }
      });
    } catch (llmErr) {
      console.error('[processSongLink] Song LLM error:', llmErr.message);
      return Response.json({ error: 'Failed to identify song: ' + llmErr.message }, { status: 500 });
    }

    if (!songData?.title || !songData?.artist) {
      return Response.json({ error: 'Could not identify song from this link. Try a different link.' }, { status: 422 });
    }

    // Get full lyrics (fire-and-forget style — don't crash if this fails)
    let fullLyrics = songData.summary || '';
    try {
      const lyricsResult = await base44.integrations.Core.InvokeLLM({
        prompt: `Get the full lyrics for "${songData.title}" by ${songData.artist}. Return only the lyrics, line by line. No headers, no commentary.`,
        add_context_from_internet: true,
        model: 'gemini_3_flash'
      });
      if (lyricsResult && typeof lyricsResult === 'string' && lyricsResult.trim().length > 20) {
        fullLyrics = lyricsResult.trim();
      }
    } catch (_) {
      // Lyrics fetch failed — use summary as fallback
    }

    const newSong = {
      title: songData.title,
      artist: songData.artist,
      lyrics_excerpt: songData.lyric_excerpt || '',
      full_lyrics: fullLyrics + (songData.mood ? `\n\nMood/vibe: ${songData.mood}` : ''),
      spotify_id: songData.spotify_id || '',
      preview_url: songData.preview_url || '',
      added_date: new Date().toISOString(),
    };

    const songsHeard = character.songs_heard || [];
    await base44.asServiceRole.entities.Character.update(characterId, {
      songs_heard: [...songsHeard, newSong],
    });

    return Response.json({
      success: true,
      is_playlist: false,
      song: newSong,
      message: `${character.name} just listened to "${songData.title}" by ${songData.artist}`,
    });

  } catch (error) {
    console.error('[processSongLink] Unexpected error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});