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
        let spotifyId = null;
        const trackMatch = songLink.match(/track\/([a-zA-Z0-9]+)/);
        const playlistMatch = songLink.match(/playlist\/([a-zA-Z0-9]+)/);
        const albumMatch = songLink.match(/album\/([a-zA-Z0-9]+)/);
        
        if (trackMatch) spotifyId = trackMatch[1];
        else if (playlistMatch) spotifyId = playlistMatch[1];
        else if (albumMatch) spotifyId = albumMatch[1];

        if (!spotifyId) {
          return Response.json({ error: 'Could not parse Spotify link', success: false }, { status: 422 });
        }

        // Fetch from Spotify API (public, no auth needed)
        let spotifyData = null;
        let isPlaylist = false;

        if (trackMatch) {
          const res = await fetch(`https://api.spotify.com/v1/tracks/${spotifyId}`);
          if (res.ok) {
            const data = await res.json();
            const newSong = {
              title: data.name || 'Unknown',
              artist: data.artists?.[0]?.name || 'Unknown Artist',
              lyrics_excerpt: '',
              full_lyrics: '',
              spotify_id: spotifyId,
              preview_url: data.preview_url || '',
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
              is_playlist: false,
              platform: 'spotify',
              song: newSong,
            });
          }
        } else if (playlistMatch || albumMatch) {
          const endpoint = playlistMatch ? `playlists/${spotifyId}` : `albums/${albumMatch[1]}`;
          const res = await fetch(`https://api.spotify.com/v1/${endpoint}`);
          if (res.ok) {
            const data = await res.json();
            const items = playlistMatch ? data.tracks?.items || [] : data.tracks?.items || [];
            
            const songs = items.slice(0, 20).map(item => ({
              title: item.name || 'Unknown',
              artist: item.artists?.[0]?.name || 'Unknown Artist',
              lyrics_excerpt: '',
              full_lyrics: '',
              spotify_id: item.id || '',
              preview_url: item.preview_url || '',
              platform: 'spotify',
              link: songLink,
              added_date: new Date().toISOString(),
            })).filter(s => s.title && s.artist);

            const songsHeard = character.songs_heard || [];
            await base44.asServiceRole.entities.Character.update(characterId, {
              songs_heard: [...songsHeard, ...songs],
            });

            return Response.json({
              success: true,
              is_playlist: true,
              platform: 'spotify',
              playlist_name: data.name || 'Playlist',
              songs_added: songs.length,
              songs: songs,
            });
          }
        }

        return Response.json({ error: 'Could not fetch Spotify data', success: false }, { status: 422 });
      } catch (err) {
        console.error('[processSongLink] Spotify API error:', err.message);
        return Response.json({ error: 'Failed to fetch Spotify data: ' + err.message, success: false }, { status: 500 });
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