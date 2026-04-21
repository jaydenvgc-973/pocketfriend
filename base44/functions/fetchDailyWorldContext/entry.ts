import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fetchDailyWorldContext
 *
 * GLOBAL APP STATE — runs daily (scheduled at 5 AM ET).
 * Fetches and caches real-world conditions that characters must respond to:
 *   • News headlines (crime, economics, politics)
 *   • Health alerts, STI/disease trends, mental health conditions
 *   • Substance/addiction environment
 *   • Economic stress indicators
 *   • Entertainment / pop culture trends
 *
 * This data is ACTIVE. It is fed into evolveCharacterLife as behavioral drivers.
 * Characters do not recite stats — they respond through behavior, tone, and decisions.
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

    // Build world state with LLM + internet for rich, current data
    const worldState = {
      current_date: dateStr,
      news: { headlines: [], politics: [], crime: [], economics: [] },
      entertainment: { trending: [], cultural: [], music_trends: [] },
      society: { crime_stats: {}, addiction_trends: {}, health_alerts: {}, economic_indicators: {} },
      last_updated: now.toISOString(),
    };

    // ── FETCH IN PARALLEL ──────────────────────────────────────────────────────
    const [newsRes, healthRes, entertainmentRes, economicsRes, crimeRes] = await Promise.allSettled([

      // US news headlines
      base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `What are the top 5 most impactful US news headlines right now today (${dateStr})? Include politics, social issues, major events. Return as a JSON array of objects with fields: title, category (politics|crime|economics|health|social), description.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: 'object',
          properties: {
            headlines: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  category: { type: 'string' },
                  description: { type: 'string' },
                }
              }
            }
          }
        },
        model: 'gemini_3_flash',
      }),

      // Health, STI, mental health, disease conditions
      base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `What are the current public health conditions in the United States as of ${dateStr}? Include: (1) any ongoing STI/HIV/disease outbreaks or elevated rates, (2) mental health crisis conditions (depression, anxiety, stress levels), (3) any seasonal health alerts or wellness trends, (4) substance use / addiction trends currently in the news. Be factual and concise. Return as a JSON object.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: 'object',
          properties: {
            health_alerts: {
              type: 'object',
              properties: {
                sti_hiv: { type: 'string' },
                mental_health: { type: 'string' },
                seasonal_health: { type: 'string' },
                disease_outbreaks: { type: 'string' },
              }
            },
            addiction_trends: {
              type: 'object',
              properties: {
                substances: { type: 'string' },
                alcohol: { type: 'string' },
                opioids: { type: 'string' },
              }
            },
          }
        },
        model: 'gemini_3_flash',
      }),

      // Entertainment / pop culture
      base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `What are the top trending entertainment, music, and pop culture topics in the US right now (${dateStr})? Include viral moments, trending artists, TV/film releases, celebrity news. Return as a JSON array of strings.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: 'object',
          properties: {
            trending: { type: 'array', items: { type: 'string' } },
            music_trends: { type: 'array', items: { type: 'string' } },
          }
        },
        model: 'gemini_3_flash',
      }),

      // Economic stress
      base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `What is the current US economic situation as of ${dateStr}? Include: cost of living pressures, job market conditions, inflation, housing costs, financial stress indicators. Be realistic and concise. Return a JSON object.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: 'object',
          properties: {
            cost_of_living: { type: 'string' },
            job_market: { type: 'string' },
            inflation: { type: 'string' },
            housing: { type: 'string' },
            overall_stress_level: { type: 'string', enum: ['low', 'moderate', 'high', 'very_high'] },
          }
        },
        model: 'gemini_3_flash',
      }),

      // Crime / safety
      base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `What are the current crime and public safety conditions in the US as of ${dateStr}? Include: crime trends in major cities, any notable incidents, safety concerns people should be aware of, whether crime rates are up or down. Return as a JSON object.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: 'object',
          properties: {
            urban_crime: { type: 'string' },
            trends: { type: 'string' },
            notable_incidents: { type: 'string' },
            safety_level: { type: 'string', enum: ['low', 'moderate', 'elevated', 'high'] },
          }
        },
        model: 'gemini_3_flash',
      }),
    ]);

    // Populate news headlines
    if (newsRes.status === 'fulfilled' && newsRes.value?.headlines) {
      const headlines = newsRes.value.headlines;
      worldState.news.headlines = headlines;
      worldState.news.crime = headlines.filter(h => h.category === 'crime').map(h => h.title);
      worldState.news.politics = headlines.filter(h => h.category === 'politics').map(h => h.title);
      worldState.news.economics = headlines.filter(h => h.category === 'economics').map(h => h.title);
    }

    // Populate health / addiction data
    if (healthRes.status === 'fulfilled') {
      const hd = healthRes.value;
      worldState.society.health_alerts = hd.health_alerts || {};
      worldState.society.addiction_trends = hd.addiction_trends || {};
    }

    // Populate entertainment trends
    if (entertainmentRes.status === 'fulfilled') {
      const ed = entertainmentRes.value;
      worldState.entertainment.trending = ed.trending || [];
      worldState.entertainment.music_trends = ed.music_trends || [];
    }

    // Populate economic indicators
    if (economicsRes.status === 'fulfilled') {
      worldState.society.economic_indicators = economicsRes.value || {};
    }

    // Populate crime stats
    if (crimeRes.status === 'fulfilled') {
      worldState.society.crime_stats = crimeRes.value || {};
      // Also add crime summary to news.crime if not already populated
      if (worldState.news.crime.length === 0 && crimeRes.value?.urban_crime) {
        worldState.news.crime = [crimeRes.value.urban_crime];
      }
    }

    // Store in global AppWorldState entity (single shared record per day)
    const existing = await base44.asServiceRole.entities.AppWorldState.filter({ current_date: dateStr });
    if (existing && existing.length > 0) {
      await base44.asServiceRole.entities.AppWorldState.update(existing[0].id, worldState);
    } else {
      await base44.asServiceRole.entities.AppWorldState.create(worldState);
    }

    console.log(`[fetchDailyWorldContext] World state cached for ${dateStr}: ${worldState.news.headlines.length} headlines`);

    return Response.json({
      success: true,
      dateStr,
      headlineCount: worldState.news.headlines.length,
      healthAlerts: Object.keys(worldState.society.health_alerts).length,
      crimeStats: Object.keys(worldState.society.crime_stats).length,
      trendingCount: worldState.entertainment.trending.length,
      lastUpdated: worldState.last_updated,
    });
  } catch (error) {
    console.error('[fetchDailyWorldContext]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});