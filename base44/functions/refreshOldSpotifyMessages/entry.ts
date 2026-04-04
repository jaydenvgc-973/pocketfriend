import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Find all messages with Spotify songs
    const allMessages = await base44.asServiceRole.entities.Message.list('-created_date', 500);

    const fallbackTitles = ['Album shared', 'Playlist shared', 'Song shared'];
    const toUpdate = allMessages.filter(m => 
      m.songs_heard?.some(s => fallbackTitles.includes(s.title) && s.link && s.platform === 'spotify')
    );

    let updated = 0;
    const results = [];

    for (const msg of toUpdate) {
      for (const song of msg.songs_heard || []) {
        if (!fallbackTitles.includes(song.title) || !song.link) continue;

        try {
          // Fetch Spotify page metadata
          const pageRes = await fetch(song.link);
          if (!pageRes.ok) continue;

          const html = await pageRes.text();
          const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
          const imageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);

          if (titleMatch) {
            const fullTitle = titleMatch[1];
            let newTitle = fullTitle;
            let newArtist = song.artist;

            if (fullTitle.includes(' by ')) {
              const parts = fullTitle.split(' by ');
              newTitle = parts[0].trim();
              newArtist = parts[1].trim();
            }

            song.title = newTitle;
            song.artist = newArtist;
            if (imageMatch) {
              song.cover_art = imageMatch[1];
            }

            // Update message
            await base44.asServiceRole.entities.Message.update(msg.id, {
              songs_heard: msg.songs_heard,
            });

            updated++;
            results.push({ messageId: msg.id, newTitle, newArtist });
          }
        } catch (err) {
          // Silently skip this song
        }
      }
    }

    return Response.json({
      success: true,
      checked: toUpdate.length,
      updated,
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});