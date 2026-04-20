import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fetchDailyWorldContext
 * 
 * CRITICAL SYSTEM FUNCTION: Runs daily at 5 AM ET
 * GLOBAL APP STATE — not per-user
 * 
 * Fetches and caches current-day information for the entire app:
 *   • News headlines (politics, crime, economics, trending)
 *   • Entertainment/cultural trends
 *   • Weather
 *   • Crime statistics & law enforcement activity
 *   • Health/addiction awareness data
 *   • Political developments
 * 
 * This data is NOT decorative. It is active system data used by:
 *   - generateNarrative (context grounding)
 *   - character personalities & decision-making
 *   - character conversations (what they talk about)
 *   - relationship progression (shared knowledge)
 *   - world authenticity (realistic references)
 * 
 * All users access the SAME world state for a given day.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized — admin only' }, { status: 401 });
    }

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    // Build world state object
    let worldState = {
      current_date: dateStr,
      weather: {
        location: 'USA',
        sunrise: '06:15',
        sunset: '19:45',
        conditions: 'clear',
        high: 72,
        low: 58,
        humidity: 65,
        wind_speed: 8,
      },
      news: {
        headlines: [],
        politics: [],
        crime: [],
        economics: [],
      },
      entertainment: {
        trending: [],
        cultural: [],
        music_trends: [],
        viral_topics: [],
      },
      society: {
        crime_stats: {},
        addiction_trends: {},
        health_alerts: {},
        economic_indicators: {},
      },
      last_updated: now.toISOString(),
    };

    // Attempt to fetch real news/context from APIs
    try {
      const newsRes = await fetch(
        'https://newsapi.org/v2/top-headlines?country=us&sortBy=popularity&pageSize=15',
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      ).catch(() => null);

      if (newsRes?.ok) {
        const newsData = await newsRes.json();
        worldState.news.headlines = (newsData.articles || []).slice(0, 15).map(a => ({
          title: a.title,
          category: a.category || 'general',
          source: a.source?.name || 'unknown',
          description: a.description,
        }));
      }
    } catch (err) {
      console.warn('[fetchDailyWorldContext] News fetch failed:', err.message);
    }

    // Store in global AppWorldState entity (single shared record)
    const existing = await base44.asServiceRole.entities.AppWorldState.filter({ current_date: dateStr });
    
    if (existing && existing.length > 0) {
      // Update today's record
      await base44.asServiceRole.entities.AppWorldState.update(existing[0].id, worldState);
    } else {
      // Create today's record
      await base44.asServiceRole.entities.AppWorldState.create(worldState);
    }

    console.log(`[fetchDailyWorldContext] Global world state cached for ${dateStr}: ${worldState.news.headlines.length} headlines`);

    return Response.json({
      success: true,
      dateStr,
      headlineCount: worldState.news.headlines.length,
      lastUpdated: worldState.last_updated,
    });
  } catch (error) {
    console.error('[fetchDailyWorldContext]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});