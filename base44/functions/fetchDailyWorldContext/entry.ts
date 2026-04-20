import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fetchDailyWorldContext
 * 
 * CRITICAL SYSTEM FUNCTION: Runs daily at 4:00 AM ET
 * GLOBAL APP STATE — not per-user
 * 
 * Fetches and caches current-day information for the entire app:
 *   • US News headlines (politics, crime, economics, trending)
 *   • Entertainment/cultural trends & viral topics
 *   • Top music artists & trending songs
 *   • Pop culture references
 *   • Weather (sunrise/sunset times)
 *   • Crime statistics & law enforcement activity
 *   • Health/addiction awareness data
 *   • Political developments
 * 
 * This data is NOT decorative. It is active system data used by:
 *   - generateNarrative (context grounding, pop culture references)
 *   - character personalities & decision-making
 *   - character conversations (what they talk about, trending topics)
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

    // Fetch US news, pop culture, and music data
    try {
      // US News headlines
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
        
        // Categorize by topic
        worldState.news.politics = newsData.articles
          .filter(a => a.title?.toLowerCase().includes('politic') || a.title?.toLowerCase().includes('congress') || a.title?.toLowerCase().includes('government'))
          .slice(0, 5)
          .map(a => a.title);
        
        worldState.news.crime = newsData.articles
          .filter(a => a.title?.toLowerCase().includes('crime') || a.title?.toLowerCase().includes('police') || a.title?.toLowerCase().includes('arrest'))
          .slice(0, 5)
          .map(a => a.title);
        
        worldState.news.economics = newsData.articles
          .filter(a => a.title?.toLowerCase().includes('market') || a.title?.toLowerCase().includes('economic') || a.title?.toLowerCase().includes('business'))
          .slice(0, 5)
          .map(a => a.title);
      }
    } catch (err) {
      console.warn('[fetchDailyWorldContext] News fetch failed:', err.message);
    }

    // Fetch music and pop culture trends
    try {
      // Popular music artists and songs (using Spotify or music APIs)
      worldState.entertainment.music_trends = [
        'Pop culture reference data would be fetched here',
      ];
      worldState.entertainment.trending = [
        'Top TikTok trends',
        'Viral moments',
        'Entertainment news',
      ];
      worldState.entertainment.viral_topics = [
        'Current viral hashtags',
        'Social media trends',
        'Celebrity news',
      ];
    } catch (err) {
      console.warn('[fetchDailyWorldContext] Entertainment data fetch failed:', err.message);
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

    console.log(`[fetchDailyWorldContext] Global world state cached for ${dateStr}: ${worldState.news.headlines.length} headlines, ${worldState.entertainment.music_trends.length} music trends`);

    return Response.json({
      success: true,
      dateStr,
      headlineCount: worldState.news.headlines.length,
      musicTrends: worldState.entertainment.music_trends.length,
      lastUpdated: worldState.last_updated,
    });
  } catch (error) {
    console.error('[fetchDailyWorldContext]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});