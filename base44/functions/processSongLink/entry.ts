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

    const character = await base44.asServiceRole.entities.Character.get(characterId);
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Detect if this is a playlist link
    const isPlaylist =
      /[?&]list=/.test(songLink) ||
      /playlist/i.test(songLink) ||
      /album/i.test(songLink) ||
      /soundcloud\.com\/[^/]+\/sets\//.test(songLink);

    if (isPlaylist) {
      // ── PLAYLIST PATH ────────────────────────────────────────────────────────
      const playlistPrompt = `This is a music playlist/album link: ${songLink}

Identify the playlist or album and return a list of up to 10 songs from it.
For each song include: title, artist, and a brief lyric excerpt (1 line).
If it's a well-known album or playlist, list the actual tracks. If unknown, make a best-effort guess based on the URL.

Return JSON with fields:
- playlist_name: string
- songs: array of { title, artist, lyric_excerpt }`;

      const playlistData = await base44.integrations.Core.InvokeLLM({
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
                  lyric_excerpt: { type: 'string' }
                }
              }
            }
          }
        }
      });

      const songsHeard = character.songs_heard || [];
      const now = new Date().toISOString();

      const newSongs = (playlistData.songs || []).map(s => ({
        title: s.title,
        artist: s.artist,
        lyrics_excerpt: s.lyric_excerpt || '',
        full_lyrics: '',
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
    const extractionPrompt = `Extract song information from this music link: ${songLink}

This could be from Spotify, Apple Music, YouTube Music, Amazon Music, Tidal, SoundCloud, or any other platform.

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
    } catch (_) {
      fullLyrics = response.summary;
    }

    const newSong = {
      title: response.title,
      artist: response.artist,
      lyrics_excerpt: response.lyric_excerpt,
      full_lyrics: fullLyrics,
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
      message: `${character.name} just listened to "${response.title}" by ${response.artist}`,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});