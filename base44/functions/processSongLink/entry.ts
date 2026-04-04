import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, songLink, isVideo } = await req.json();

    if (!characterId || !songLink) {
      return Response.json({ error: 'characterId and songLink are required' }, { status: 400 });
    }

    let character = null;
    try {
      const chars = await base44.asServiceRole.entities.Character.filter({ id: characterId });
      character = chars?.[0] || null;
    } catch (_) {}

    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const detectPlatform = (url) => {
      if (/spotify\.com/.test(url)) return 'spotify';
      if (/apple\.com|music\.apple\.com/.test(url)) return 'apple';
      if (/youtube\.com|youtu\.be|music\.youtube\.com/.test(url)) return 'youtube';
      if (/tidal\.com/.test(url)) return 'tidal';
      if (/soundcloud\.com/.test(url)) return 'soundcloud';
      if (/bandcamp\.com/.test(url)) return 'bandcamp';
      if (/amazon\.com.*music|music\.amazon\.com/.test(url)) return 'amazon';
      if (/vimeo\.com/.test(url)) return 'vimeo';
      if (/tiktok\.com/.test(url)) return 'tiktok';
      return 'generic';
    };

    const isVideoLink = isVideo || /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|instagram\.com.*video|instagram\.com.*reel/.test(songLink);
    const platform = detectPlatform(songLink);

    // ── VIDEO PATH ──────────────────────────────────────────────────────
    if (isVideoLink) {
      let title = 'Shared Video';
      let creator = 'Unknown';
      let thumbnail = null;
      let description = '';
      let duration = '';

      // YouTube oEmbed (no auth required)
      if (platform === 'youtube') {
        try {
          const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(songLink)}&format=json`;
          const res = await fetch(oembedUrl);
          if (res.ok) {
            const data = await res.json();
            title = data.title || title;
            creator = data.author_name || creator;
            thumbnail = data.thumbnail_url || null;
          }
        } catch (_) {}
      }

      // Vimeo oEmbed (no auth required)
      if (platform === 'vimeo') {
        try {
          const oembedUrl = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(songLink)}`;
          const res = await fetch(oembedUrl);
          if (res.ok) {
            const data = await res.json();
            title = data.title || title;
            creator = data.author_name || creator;
            thumbnail = data.thumbnail_url || null;
            duration = data.duration ? `${Math.floor(data.duration / 60)}:${String(data.duration % 60).padStart(2, '0')}` : '';
          }
        } catch (_) {}
      }

      const newVideo = {
        title,
        creator,
        description,
        platform,
        duration,
        thumbnail,
        link: songLink,
        added_date: new Date().toISOString(),
      };

      const videosWatched = character.videos_watched || [];
      await base44.asServiceRole.entities.Character.update(characterId, {
        videos_watched: [...videosWatched, newVideo],
      });

      return Response.json({
        success: true,
        is_video: true,
        platform,
        video: newVideo,
      });
    }

    // ── SPOTIFY PATH ────────────────────────────────────────────────────
    if (platform === 'spotify') {
      try {
        const trackMatch = songLink.match(/track\/([a-zA-Z0-9]+)/);
        const playlistMatch = songLink.match(/playlist\/([a-zA-Z0-9]+)/);
        const albumMatch = songLink.match(/album\/([a-zA-Z0-9]+)/);

        const spotifyId = trackMatch?.[1] || playlistMatch?.[1] || albumMatch?.[1];

        if (!spotifyId) {
          return Response.json({ error: 'Could not parse Spotify link', success: false }, { status: 422 });
        }

        let title = trackMatch ? 'Song shared' : playlistMatch ? 'Playlist shared' : 'Album shared';
        let artist = 'Unknown Artist';
        let coverArt = null;

        // Fetch Spotify metadata via LLM with web search
        try {
          const metadataRes = await base44.integrations.Core.InvokeLLM({
            prompt: `Look up this Spotify ${trackMatch ? 'track' : albumMatch ? 'album' : 'playlist'} link and extract metadata: ${songLink}

Return ONLY JSON (no markdown, no explanation):
{
  "name": "exact name from Spotify",
  "artist": "primary artist/creator",
  "image_url": "direct image URL from Spotify CDN"
}`,
            add_context_from_internet: true,
            response_json_schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                artist: { type: "string" },
                image_url: { type: "string" }
              }
            }
          });
          if (metadataRes && typeof metadataRes === 'object') {
            title = metadataRes.name || title;
            artist = metadataRes.artist || artist;
            coverArt = metadataRes.image_url || null;
          }
        } catch (_) {}

        const embedUrl = trackMatch
          ? `https://open.spotify.com/embed/track/${spotifyId}`
          : playlistMatch
          ? `https://open.spotify.com/embed/playlist/${spotifyId}`
          : `https://open.spotify.com/embed/album/${spotifyId}`;

        const newSong = {
          title,
          artist,
          lyrics_excerpt: '',
          full_lyrics: '',
          spotify_id: spotifyId,
          spotify_embed_url: embedUrl,
          cover_art: coverArt,
          preview_url: '',
          platform: 'spotify',
          link: songLink,
          added_date: new Date().toISOString(),
        };

        const songsHeard = character.songs_heard || [];
        await base44.asServiceRole.entities.Character.update(characterId, {
          songs_heard: [...songsHeard, newSong],
        });

        return Response.json({
          success: true,
          is_playlist: !trackMatch,
          platform: 'spotify',
          song: newSong,
        });
      } catch (err) {
        console.error('[processSongLink] Spotify error:', err.message);
        return Response.json({ error: 'Failed to process Spotify link: ' + err.message, success: false }, { status: 500 });
      }
    }

    // ── SOUNDCLOUD oEmbed ───────────────────────────────────────────────
    if (platform === 'soundcloud') {
      let title = 'Song shared';
      let artist = 'SoundCloud';
      let coverArt = null;
      try {
        const oembedUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(songLink)}&format=json`;
        const res = await fetch(oembedUrl);
        if (res.ok) {
          const data = await res.json();
          const rawTitle = data.title || '';
          if (rawTitle.includes(' by ')) {
            const parts = rawTitle.split(' by ');
            title = parts[0].trim();
            artist = parts[1].trim();
          } else {
            title = rawTitle || title;
          }
          coverArt = data.thumbnail_url || null;
        }
      } catch (_) {}

      const newSong = {
        title,
        artist,
        cover_art: coverArt,
        lyrics_excerpt: '',
        full_lyrics: '',
        spotify_id: '',
        preview_url: '',
        platform,
        link: songLink,
        added_date: new Date().toISOString(),
      };

      const songsHeard = character.songs_heard || [];
      await base44.asServiceRole.entities.Character.update(characterId, {
        songs_heard: [...songsHeard, newSong],
      });

      return Response.json({ success: true, is_playlist: false, platform, song: newSong });
    }

    // ── OTHER PLATFORMS ─────────────────────────────────────────────────
    const newSong = {
      title: 'Song shared',
      artist: 'Unknown Artist',
      lyrics_excerpt: '',
      full_lyrics: '',
      spotify_id: '',
      preview_url: '',
      platform,
      link: songLink,
      added_date: new Date().toISOString(),
    };

    const songsHeard = character.songs_heard || [];
    await base44.asServiceRole.entities.Character.update(characterId, {
      songs_heard: [...songsHeard, newSong],
    });

    return Response.json({ success: true, is_playlist: false, platform, song: newSong });

  } catch (error) {
    console.error('[processSongLink] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});