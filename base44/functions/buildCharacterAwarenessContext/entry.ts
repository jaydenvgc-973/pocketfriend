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
      profile = await base44.entities.CharacterAwarenessProfile.create({
        character_id: characterId,
        home_region: character.state || character.city || null,
        tracks_us_news: true,
        tracks_entertainment_news: true,
        tracks_regional_news: !!character.state,
        tracks_politics: false,
        tracks_finance: false,
        tracks_sports: false,
        tracks_music: character.personality_summary?.toLowerCase().includes('music'),
        favorite_celebrities: [],
        celebrity_reference_model: null,
        interest_tags: character.personality_traits || [],
        awareness_priority_level: 'medium',
      });
    }

    // ── AWARENESS ITEMS: self-awareness FIRST, world context after ─────────────
    const awarenessItems = [];

    // 1. SELF-AWARENESS — always first for celebrity-based characters
    // This character IS this public figure and must know their own life fully.
    if (profile.celebrity_reference_model) {
      try {
        const selfRes = await base44.integrations.Core.InvokeLLM({
          prompt: `Research everything currently happening with ${profile.celebrity_reference_model} as of ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}.

Provide a thorough, factual summary covering ALL of the following:
1. RECENT MUSIC: Latest releases, albums, singles, features, collaborations, streaming performance
2. CAREER & PERFORMANCES: Recent or upcoming tours, concerts, shows, TV appearances, award shows, festivals
3. BUSINESS & BRAND: Business ventures, brand deals, endorsements, fashion lines, other projects
4. PUBLIC PERCEPTION & REPUTATION: How they are currently viewed publicly, ongoing media narratives, fan sentiment, industry standing
5. PERSONAL LIFE (public knowledge only): Relationships, children, family updates, lifestyle stories publicly known
6. CONTROVERSIES & LEGAL: Any ongoing or recent legal situations, controversies, public disputes
7. INDUSTRY MOVEMENT: Collaborations with other artists, feuds, alignments, who they're in the studio with

Be thorough, current, and factual. Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.`,
          add_context_from_internet: true,
          model: 'gemini_3_flash',
        });
        if (selfRes) {
          awarenessItems.push(
            `YOUR OWN LIFE & CAREER — You ARE ${profile.celebrity_reference_model}. This is your lived reality. You know all of this intimately and speak about it naturally:\n\n${selfRes}`
          );
        }
      } catch (err) {
        console.error(`Self-awareness fetch failed for ${profile.celebrity_reference_model}:`, err.message);
      }
    }

    // 2. ENTERTAINMENT NEWS — what's happening in their industry world
    if (profile.tracks_entertainment_news) {
      try {
        const entRes = await base44.integrations.Core.InvokeLLM({
          prompt: `What are the top entertainment/celebrity/music industry news stories happening right now? Include major developments in R&B, hip-hop, pop, film, and celebrity culture. Be concise.`,
        });
        if (entRes) awarenessItems.push(`ENTERTAINMENT & MUSIC INDUSTRY NEWS:\n${entRes}`);
      } catch (err) {
        console.error('Entertainment news fetch failed:', err.message);
      }
    }

    // 3. MUSIC INDUSTRY — specific to their craft
    if (profile.tracks_music) {
      try {
        const musicRes = await base44.integrations.Core.InvokeLLM({
          prompt: `What are the most significant current developments in the music industry right now — new releases, chart movements, label news, streaming trends, notable artist activity? Be concise.`,
        });
        if (musicRes) awarenessItems.push(`MUSIC INDUSTRY DEVELOPMENTS:\n${musicRes}`);
      } catch (err) {
        console.error('Music news fetch failed:', err.message);
      }
    }

    // 4. CELEBRITY PEERS — what their circle is up to
    if (profile.favorite_celebrities && profile.favorite_celebrities.length > 0) {
      const peersToCheck = profile.favorite_celebrities.slice(0, 3);
      for (const celeb of peersToCheck) {
        try {
          const celebRes = await base44.integrations.Core.InvokeLLM({
            prompt: `What are the latest notable developments or news about ${celeb}? Brief and factual.`,
          });
          if (celebRes) awarenessItems.push(`ABOUT ${celeb.toUpperCase()}:\n${celebRes}`);
        } catch (err) {
          console.error(`Peer awareness failed for ${celeb}:`, err.message);
        }
      }
    }

    // 5. MAJOR U.S. NEWS — baseline world awareness
    if (profile.tracks_us_news) {
      try {
        const usRes = await base44.integrations.Core.InvokeLLM({
          prompt: `What are 2-3 major U.S. news stories happening right now? Focus on things a culturally aware person in their 30s living in LA would naturally know about. Be brief.`,
        });
        if (usRes) awarenessItems.push(`MAJOR NEWS:\n${usRes}`);
      } catch (err) {
        console.error('U.S. news fetch failed:', err.message);
      }
    }

    // 6. REGIONAL NEWS — LA/California
    if (profile.tracks_regional_news && profile.home_region) {
      try {
        const regionRes = await base44.integrations.Core.InvokeLLM({
          prompt: `What are current notable developments in ${profile.home_region}? Include culture, entertainment, local events someone living there would naturally know. Be brief.`,
        });
        if (regionRes) awarenessItems.push(`${profile.home_region.toUpperCase()} NEWS:\n${regionRes}`);
      } catch (err) {
        console.error('Regional news fetch failed:', err.message);
      }
    }

    // ── FORMAT FINAL AWARENESS CONTEXT ────────────────────────────────────────
    const awarenessContext = awarenessItems.length > 0
      ? `\n\n═══ CURRENT AWARENESS (as of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}) ═══\n\n${awarenessItems.join('\n\n─────\n\n')}\n\n═══ END AWARENESS ═══\n\nIMPORTANT: You know all of the above. Speak from this knowledge naturally. Do NOT force current events into every message. Reference them only when the topic comes up organically or when it genuinely fits.`
      : '';

    // Cache
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
        celebrity_reference_model: profile.celebrity_reference_model,
        favorite_celebrities: profile.favorite_celebrities,
        tracks: {
          us_news: profile.tracks_us_news,
          entertainment: profile.tracks_entertainment_news,
          regional: profile.tracks_regional_news,
          music: profile.tracks_music,
        },
      },
    });
  } catch (error) {
    console.error('buildCharacterAwarenessContext error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});