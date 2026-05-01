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

    // For non-video paths, character must exist (we need to save songs_heard)
    if (!character && !isVideoLink) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

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
        destinationType: 'VIDEO',
      };

      if (character) {
        const videosWatched = character.videos_watched || [];
        await base44.asServiceRole.entities.Character.update(characterId, {
          videos_watched: [...videosWatched, newVideo],
        }).catch(() => {});
      }

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
        let tracks = [];

        // Attempt 1: Fetch via authenticated API (production)
        try {
          const clientId = Deno.env.get('SPOTIFY_CLIENT_ID');
          const clientSecret = Deno.env.get('SPOTIFY_CLIENT_SECRET');

          if (clientId && clientSecret) {
            const authHeader = btoa(`${clientId}:${clientSecret}`);
            const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${authHeader}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: 'grant_type=client_credentials',
            });

            if (tokenRes.ok) {
              const tokenData = await tokenRes.json();
              const accessToken = tokenData.access_token;

              if (albumMatch) {
                const albumRes = await fetch(`https://api.spotify.com/v1/albums/${spotifyId}`, {
                  headers: { 'Authorization': `Bearer ${accessToken}` },
                });
                if (albumRes.ok) {
                  const albumData = await albumRes.json();
                  title = albumData.name || title;
                  artist = albumData.artists?.[0]?.name || artist;
                  coverArt = albumData.images?.[0]?.url || null;
                  tracks = (albumData.tracks?.items || []).map(t => ({
                    name: t.name,
                    artist: t.artists?.[0]?.name,
                  }));
                }
              }

              if (trackMatch) {
                const trackRes = await fetch(`https://api.spotify.com/v1/tracks/${spotifyId}`, {
                  headers: { 'Authorization': `Bearer ${accessToken}` },
                });
                if (trackRes.ok) {
                  const trackData = await trackRes.json();
                  title = trackData.name || title;
                  artist = trackData.artists?.[0]?.name || artist;
                  coverArt = trackData.album?.images?.[0]?.url || null;
                  tracks = [{ name: trackData.name, artist: trackData.artists?.[0]?.name }];
                }
              }

              if (playlistMatch) {
                const playlistRes = await fetch(`https://api.spotify.com/v1/playlists/${spotifyId}`, {
                  headers: { 'Authorization': `Bearer ${accessToken}` },
                });
                if (playlistRes.ok) {
                  const playlistData = await playlistRes.json();
                  title = playlistData.name || title;
                  coverArt = playlistData.images?.[0]?.url || null;
                  tracks = (playlistData.tracks?.items || []).map(t => ({
                    name: t.track?.name,
                    artist: t.track?.artists?.[0]?.name,
                  })).filter(t => t.name);
                }
              }
            }
          }
        } catch (err) {
          // Auth API failed, try fallback
        }

        // Attempt 2: Fallback to web scraping if API didn't work
        if (title === 'Album shared' || title === 'Playlist shared' || title === 'Song shared') {
          try {
            const spotifyPageRes = await fetch(songLink);
            if (spotifyPageRes.ok) {
              const html = await spotifyPageRes.text();
              // Try to extract title from og:title meta tag
              const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
              const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/);
              const imageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
              
              if (titleMatch) {
                const fullTitle = titleMatch[1];
                // Parse "Song Title by Artist" or "Album Title by Artist"
                if (fullTitle.includes(' by ')) {
                  const parts = fullTitle.split(' by ');
                  title = parts[0].trim();
                  artist = parts[1].trim();
                } else {
                  title = fullTitle;
                }
              }
              if (imageMatch) {
                coverArt = imageMatch[1];
              }
            }
          } catch (err) {
            // Scraping failed, use defaults
          }
        }

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
          destinationType: trackMatch ? 'SONG' : playlistMatch ? 'PLAYLIST' : 'ALBUM',
          tracks: tracks.length > 0 ? tracks : undefined,
        };

        const songsHeard = character.songs_heard || [];
        await base44.asServiceRole.entities.Character.update(characterId, {
          songs_heard: [...songsHeard, newSong],
        });

        // Trigger background analysis for character understanding (non-blocking)
        base44.asServiceRole.functions.invoke('analyzeMediaUnderstanding', {
          mediaObject: newSong,
          sources: {},
        }).then(res => {
          if (res?.data?.understanding) {
            // Store understanding on character for later access
            base44.asServiceRole.entities.Character.update(characterId, {
              songs_heard: character.songs_heard.map((s, idx) => 
                idx === character.songs_heard.length ? { ...s, _understanding: res.data.understanding } : s
              ),
            }).catch(() => {});
          }
        }).catch(() => {});

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
        destinationType: 'SONG',
      };

      const songsHeard = character.songs_heard || [];
      await base44.asServiceRole.entities.Character.update(characterId, {
        songs_heard: [...songsHeard, newSong],
      });

      // Trigger background analysis
      base44.asServiceRole.functions.invoke('analyzeMediaUnderstanding', {
        mediaObject: newSong,
        sources: {},
      }).catch(() => {});

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
      destinationType: 'SONG',
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