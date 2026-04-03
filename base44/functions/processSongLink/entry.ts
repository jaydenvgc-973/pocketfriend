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
    } catch (_) {
      // filter can throw on invalid IDs
    }
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Detect platform from URL
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

    // VIDEO LINK PATH
    if (isVideoLink) {
      // Extract basic info from URL without web context
      const urlObj = new URL(songLink);
      const hostname = urlObj.hostname;
      
      let title = 'Unknown Video';
      let creator = 'Unknown Creator';
      let platformName = platform;

      // Try to extract from URL parameters
      if (platform === 'youtube') {
        title = decodeURIComponent(urlObj.searchParams.get('v') || 'YouTube Video');
        platformName = 'YouTube';
      } else if (platform === 'vimeo') {
        title = 'Vimeo Video';
        platformName = 'Vimeo';
      } else if (platform === 'tiktok') {
        title = 'TikTok Video';
        platformName = 'TikTok';
      }

      const newVideo = {
        title: title,
        creator: creator,
        description: 'Video shared',
        platform: platformName,
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
        message: `${character.name} shared a video from ${platform}`,
      });
    }

    // MUSIC PATH (single song or playlist)
    // Extract minimal info from URL
    const isPlaylist =
      /[?&]list=/.test(songLink) ||
      /playlist/i.test(songLink) ||
      /album/i.test(songLink) ||
      /soundcloud\.com\/[^/]+\/sets\//.test(songLink);

    if (isPlaylist) {
      // For playlists, create a placeholder song entry
      const newSong = {
        title: 'Playlist shared',
        artist: 'Unknown Artist',
        lyrics_excerpt: '',
        full_lyrics: 'Playlist shared',
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
        is_playlist: true,
        platform: platform,
        playlist_name: 'Shared Playlist',
        songs_added: 1,
        songs: [newSong],
        message: `${character.name} shared a playlist from ${platform}`,
      });
    }

    // SINGLE SONG PATH
    const newSong = {
      title: 'Song shared',
      artist: 'Unknown Artist',
      lyrics_excerpt: '',
      full_lyrics: 'Song shared',
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
      message: `${character.name} shared a song from ${platform}`,
    });

  } catch (error) {
    console.error('[processSongLink] Unexpected error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});