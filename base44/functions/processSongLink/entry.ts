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
      return 'generic';
    };

    const isVideoLink = isVideo || /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|instagram\.com.*video|instagram\.com.*reel/.test(songLink);
    const platform = detectPlatform(songLink);

    // VIDEO PATH
    if (isVideoLink) {
      const newVideo = {
        title: 'Video shared',
        creator: 'Unknown Creator',
        description: 'Video shared',
        platform: platform,
        duration: 'Unknown',
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
        platform: platform,
        video: newVideo,
      });
    }

    // SPOTIFY PATH
    if (platform === 'spotify') {
      try {
        // Extract ID from Spotify URL
        const trackMatch = songLink.match(/track\/([a-zA-Z0-9]+)/);
        const playlistMatch = songLink.match(/playlist\/([a-zA-Z0-9]+)/);
        const albumMatch = songLink.match(/album\/([a-zA-Z0-9]+)/);
        
        const spotifyId = trackMatch?.[1] || playlistMatch?.[1] || albumMatch?.[1];

        if (!spotifyId) {
          return Response.json({ error: 'Could not parse Spotify link', success: false }, { status: 422 });
        }

        // Use embed API which doesn't require auth
        const embedUrl = trackMatch 
          ? `https://open.spotify.com/embed/track/${spotifyId}`
          : playlistMatch 
          ? `https://open.spotify.com/embed/playlist/${spotifyId}`
          : `https://open.spotify.com/embed/album/${spotifyId}`;

        const embedRes = await fetch(embedUrl);
        if (!embedRes.ok) {
          return Response.json({ error: 'Could not fetch Spotify data', success: false }, { status: 422 });
        }

        // For now, store with basic info — the character will see it was shared
        const newSong = {
          title: trackMatch ? 'Song shared' : playlistMatch ? 'Playlist shared' : 'Album shared',
          artist: 'Spotify',
          lyrics_excerpt: '',
          full_lyrics: '',
          spotify_id: spotifyId,
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

    // OTHER PLATFORMS - placeholder
    const newSong = {
      title: 'Song shared',
      artist: 'Unknown Artist',
      lyrics_excerpt: '',
      full_lyrics: '',
      spotify_id: '',
      preview_url: '',
      platform: platform,
      link: songLink,
      added_date: new Date().toISOString(),
    };

    const songsHeard = character.songs_heard || [];
    await base44.asServiceRole.entities.Character.update(characterId, {
      songs_heard: [...songsHeard, newSong],
    });

    return Response.json({
      success: true,
      is_playlist: false,
      platform: platform,
      song: newSong,
    });

  } catch (error) {
    console.error('[processSongLink] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});