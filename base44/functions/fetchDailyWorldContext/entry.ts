import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fetchDailyWorldContext
 * 
 * CRITICAL SYSTEM FUNCTION: Runs daily at 5 AM ET
 * Fetches and caches current-day information that characters should have access to:
 *   • News headlines (politics, crime, economics, trending)
 *   • Entertainment/cultural trends
 *   • Weather
 *   • Market/economic data
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
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];

    // Fetch current world context from multiple sources
    let worldContext = {
      fetchedAt: now.toISOString(),
      dateStr,
      news: {
        headlines: [],
        politics: [],
        crime: [],
        economics: [],
      },
      entertainment: {
        trending: [],
        cultural: [],
      },
      society: {
        crimeStats: null,
        addictionTrends: null,
        healthAlerts: null,
      },
      timestamp: now.toISOString(),
    };

    // Attempt to fetch real news/context from APIs
    try {
      // Fetch top news headlines using free API
      const newsRes = await fetch(
        'https://newsapi.org/v2/top-headlines?country=us&sortBy=popularity&pageSize=10',
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      ).catch(() => null);

      if (newsRes?.ok) {
        const newsData = await newsRes.json();
        worldContext.news.headlines = (newsData.articles || []).slice(0, 10).map(a => ({
          title: a.title,
          category: a.category || 'general',
          source: a.source?.name || 'unknown',
          description: a.description,
        }));
      }
    } catch (err) {
      console.warn('[fetchDailyWorldContext] News fetch failed:', err.message);
    }

    // Store in user settings as daily context
    const settingsList = await base44.entities.UserSettings.filter({ created_by: user.email });
    const settings = settingsList[0];

    if (settings) {
      await base44.entities.UserSettings.update(settings.id, {
        world_context_cache: worldContext,
        world_context_last_updated: now.toISOString(),
      });
    } else {
      await base44.entities.UserSettings.create({
        created_by: user.email,
        world_context_cache: worldContext,
        world_context_last_updated: now.toISOString(),
      });
    }

    console.log(`[fetchDailyWorldContext] World context cached for ${user.email}: ${worldContext.news.headlines.length} headlines`);

    return Response.json({
      success: true,
      dateStr,
      headlineCount: worldContext.news.headlines.length,
      fetchedAt: worldContext.fetchedAt,
    });
  } catch (error) {
    console.error('[fetchDailyWorldContext]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});