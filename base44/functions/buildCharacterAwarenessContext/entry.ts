import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterId } = await req.json();

    if (!characterId) {
      return Response.json({ error: 'Missing characterId' }, { status: 400 });
    }

    // Fetch character
    const chars = await base44.entities.Character.filter({ id: characterId });
    const character = chars[0];
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // Fetch or create awareness profile
    const profiles = await base44.entities.CharacterAwarenessProfile.filter({ character_id: characterId });
    let profile = profiles[0];

    if (!profile) {
      // Create default profile based on character attributes
      profile = await base44.entities.CharacterAwarenessProfile.create({
        character_id: characterId,
        home_region: character.state || character.city || null,
        tracks_us_news: true,
        tracks_entertainment_news: true,
        tracks_regional_news: !!character.state,
        tracks_politics: character.personality_summary?.toLowerCase().includes('political'),
        tracks_finance: character.personality_summary?.toLowerCase().includes('finance') || character.personality_summary?.toLowerCase().includes('business'),
        tracks_sports: character.personality_summary?.toLowerCase().includes('sports'),
        tracks_music: character.personality_summary?.toLowerCase().includes('music'),
        favorite_celebrities: [],
        celebrity_reference_model: null,
        interest_tags: character.personality_traits || [],
        awareness_priority_level: 'medium',
      });
    }

    // Build awareness context based on profile
    const awarenessItems = [];

    // Major U.S. news (baseline)
    if (profile.tracks_us_news) {
      try {
        const usNewsRes = await base44.integrations.Core.InvokeLLM({
          prompt: `What are the top 2-3 most significant U.S. news developments happening right now (today: ${new Date().toLocaleDateString()})? Focus on stories a reasonably informed person would naturally know about. Be brief and factual.`,
        });
        if (usNewsRes) awarenessItems.push(`MAJOR U.S. NEWS: ${usNewsRes}`);
      } catch (err) {
        console.error('Failed to fetch U.S. news:', err.message);
      }
    }

    // Regional news if applicable
    if (profile.tracks_regional_news && profile.home_region) {
      try {
        const regionNewsRes = await base44.integrations.Core.InvokeLLM({
          prompt: `What are important current news developments in or around ${profile.home_region}, USA right now? Include local issues, events, or regional developments someone living there would naturally know about. Be brief.`,
        });
        if (regionNewsRes) awarenessItems.push(`REGIONAL NEWS (${profile.home_region}): ${regionNewsRes}`);
      } catch (err) {
        console.error('Failed to fetch regional news:', err.message);
      }
    }

    // Entertainment news
    if (profile.tracks_entertainment_news) {
      try {
        const entNewsRes = await base44.integrations.Core.InvokeLLM({
          prompt: `What are the top entertainment/celebrity news stories happening right now? Include major celebrity, TV, film, music industry developments. Be brief.`,
        });
        if (entNewsRes) awarenessItems.push(`ENTERTAINMENT NEWS: ${entNewsRes}`);
      } catch (err) {
        console.error('Failed to fetch entertainment news:', err.message);
      }
    }

    // Celebrity-specific awareness
    if (profile.favorite_celebrities && profile.favorite_celebrities.length > 0) {
      for (const celebrity of profile.favorite_celebrities.slice(0, 2)) {
        try {
          const celebRes = await base44.integrations.Core.InvokeLLM({
            prompt: `What are the current notable developments or recent news about ${celebrity}? Include recent projects, announcements, or relevant events. Be brief and factual.`,
          });
          if (celebRes) awarenessItems.push(`ABOUT ${celebrity.toUpperCase()}: ${celebRes}`);
        } catch (err) {
          console.error(`Failed to fetch ${celebrity} awareness:`, err.message);
        }
      }
    }

    // Celebrity-based character reference
    if (profile.celebrity_reference_model) {
      try {
        const refRes = await base44.integrations.Core.InvokeLLM({
          prompt: `What are the major current developments or recent news about ${profile.celebrity_reference_model}? Include recent projects, career updates, or significant events. Be brief.`,
        });
        if (refRes) awarenessItems.push(`REFERENCE (You are based on ${profile.celebrity_reference_model}): ${refRes}`);
      } catch (err) {
        console.error(`Failed to fetch reference model awareness:`, err.message);
      }
    }

    // Politics awareness
    if (profile.tracks_politics) {
      try {
        const polRes = await base44.integrations.Core.InvokeLLM({
          prompt: `What are the most significant U.S. political developments happening right now? Include major political news, elections, policy debates, and notable figures. Be brief and balanced.`,
        });
        if (polRes) awarenessItems.push(`POLITICAL DEVELOPMENTS: ${polRes}`);
      } catch (err) {
        console.error('Failed to fetch political news:', err.message);
      }
    }

    // Finance/business awareness
    if (profile.tracks_finance) {
      try {
        const finRes = await base44.integrations.Core.InvokeLLM({
          prompt: `What are the most significant financial/economic/business developments happening right now? Include market trends, major business news, and economic updates. Be brief.`,
        });
        if (finRes) awarenessItems.push(`FINANCIAL/BUSINESS NEWS: ${finRes}`);
      } catch (err) {
        console.error('Failed to fetch finance news:', err.message);
      }
    }

    // Sports awareness
    if (profile.tracks_sports) {
      try {
        const sportRes = await base44.integrations.Core.InvokeLLM({
          prompt: `What are major sports developments happening right now? Include significant games, player news, and sports headlines. Be brief.`,
        });
        if (sportRes) awarenessItems.push(`SPORTS NEWS: ${sportRes}`);
      } catch (err) {
        console.error('Failed to fetch sports news:', err.message);
      }
    }

    // Music industry
    if (profile.tracks_music) {
      try {
        const musicRes = await base44.integrations.Core.InvokeLLM({
          prompt: `What are significant music industry developments happening right now? Include new releases, artist news, and music events. Be brief.`,
        });
        if (musicRes) awarenessItems.push(`MUSIC/AUDIO NEWS: ${musicRes}`);
      } catch (err) {
        console.error('Failed to fetch music news:', err.message);
      }
    }

    // Build final awareness context string
    const awarenessContext = awarenessItems.length > 0
      ? `\n\nCURRENT WORLD AWARENESS (what you know is happening right now):\n${awarenessItems.join('\n\n')}\n\nUse this awareness naturally in conversation. You know these things, but do NOT force them into dialogue randomly. Only reference them when they fit the conversation naturally.`
      : '';

    // Cache the awareness context for future use
    if (profile.id) {
      await base44.entities.CharacterAwarenessProfile.update(profile.id, {
        cached_awareness_context: awarenessContext,
        last_awareness_refresh_at: new Date().toISOString(),
      });
    }

    return Response.json({
      character_id: characterId,
      awareness_context: awarenessContext,
      profile: {
        home_region: profile.home_region,
        favorite_celebrities: profile.favorite_celebrities,
        celebrity_reference_model: profile.celebrity_reference_model,
        tracks: {
          us_news: profile.tracks_us_news,
          entertainment: profile.tracks_entertainment_news,
          regional: profile.tracks_regional_news,
          politics: profile.tracks_politics,
          finance: profile.tracks_finance,
          sports: profile.tracks_sports,
          music: profile.tracks_music,
        },
      },
    });
  } catch (error) {
    console.error('buildCharacterAwarenessContext error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});