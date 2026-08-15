import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Eastern Time — the authoritative timezone for this application
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    // Calculate current week (Monday to Sunday)
    const dayOfWeek = nowET.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(nowET);
    weekStart.setDate(nowET.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);
    const editionDate = nowET.toISOString().slice(0, 10);

    // Check for existing edition this week — never create duplicates
    const existing = await base44.asServiceRole.entities.WeeklyPublication.filter(
      { week_start: weekStartStr }, null, 1
    );
    if (existing[0]) {
      return Response.json({ success: true, message: 'Edition already exists for this week', edition: existing[0], created: false });
    }

    // Load all PublicProfiles
    const allProfiles = await base44.asServiceRole.entities.PublicProfile.list('-last_public_impact_at', 200);

    // Collect public_record entries from this week
    const qualifyingEntries = [];
    for (const profile of allProfiles) {
      for (const entry of profile.public_record || []) {
        const entryDate = entry.designated_at || entry.event_date;
        if (!entryDate) continue;
        const entryTime = new Date(entryDate).getTime();
        if (entryTime >= weekStart.getTime() && entryTime <= weekEnd.getTime()) {
          qualifyingEntries.push({
            ...entry,
            character_id: profile.character_id,
            character_name: profile.character_name,
            owner_email: profile.owner_email,
          });
        }
      }
    }

    // Determine edition number
    const allEditions = await base44.asServiceRole.entities.WeeklyPublication.list('-edition_number', 1);
    const editionNumber = (allEditions[0]?.edition_number || 0) + 1;
    const nowIso = new Date().toISOString();

    // If insufficient material, publish a small edition — do NOT fabricate filler
    if (qualifyingEntries.length === 0) {
      const edition = await base44.asServiceRole.entities.WeeklyPublication.create({
        edition_number: editionNumber,
        edition_date: editionDate,
        week_start: weekStartStr,
        week_end: weekEndStr,
        headliner: null,
        sections: [],
        status: 'published',
        has_sufficient_material: false,
        created_at: nowIso,
        published_at: nowIso,
      });
      return Response.json({ success: true, edition, created: true, has_material: false });
    }

    // Use LLM to assemble the edition
    const llmPrompt = `You are the editor of a weekly world publication. Assemble an edition from the following qualifying public records from this week.

EDITORIAL RULES — VIOLATING THESE IS A SYSTEM FAILURE:
- Choose the most significant legitimate story as the headliner.
- Organize remaining stories into editorial sections: community_spotlight, campaign_watch, neighborhood_news.
- Do NOT invent material. Only use the provided records.
- If there are fewer stories than sections, leave sections empty — do NOT fabricate filler.
- The headliner is the strongest story; other stories are features, secondary, or minor mentions.
- A story about a group event does NOT need to center one character.
- Summaries should be concise, journalistic, and factual — 1-3 sentences.
- If no story is strong enough to be a headliner, set headliner to null.
- Categories: community_spotlight = community participation, local figures, achievements, activism, performances, fashion shows. campaign_watch = advertising campaigns, commercial work, marketing, promotional appearances, photo campaigns. neighborhood_news = community fairs, gatherings, neighborhood events, public activities.

Return JSON:
{
  "headliner": { "title": "...", "summary": "...", "category": "community_spotlight|campaign_watch|neighborhood_news", "character_ids": ["..."], "character_names": ["..."], "story_event_ids": ["..."] },
  "sections": [
    { "category": "community_spotlight|campaign_watch|neighborhood_news", "title": "...", "summary": "...", "character_ids": ["..."], "character_names": ["..."], "story_event_ids": ["..."], "impact_tier": "feature|secondary|minor_mention" }
  ]
}

Qualifying public records:
${JSON.stringify(qualifyingEntries, null, 2)}`;

    const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: llmPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          headliner: {
            type: "object",
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              category: { type: "string" },
              character_ids: { type: "array", items: { type: "string" } },
              character_names: { type: "array", items: { type: "string" } },
              story_event_ids: { type: "array", items: { type: "string" } }
            }
          },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string" },
                title: { type: "string" },
                summary: { type: "string" },
                character_ids: { type: "array", items: { type: "string" } },
                character_names: { type: "array", items: { type: "string" } },
                story_event_ids: { type: "array", items: { type: "string" } },
                impact_tier: { type: "string" }
              }
            }
          }
        }
      }
    });

    const editionData = llmResult;

    // Update last_publication_appearance_at for characters in the publication
    const allCharIds = new Set([
      ...(editionData.headliner?.character_ids || []),
      ...editionData.sections.flatMap(s => s.character_ids || []),
    ]);
    for (const charId of allCharIds) {
      const profile = allProfiles.find(p => p.character_id === charId);
      if (profile) {
        await base44.asServiceRole.entities.PublicProfile.update(profile.id, {
          last_publication_appearance_at: nowIso,
        });
      }
    }

    const edition = await base44.asServiceRole.entities.WeeklyPublication.create({
      edition_number: editionNumber,
      edition_date: editionDate,
      week_start: weekStartStr,
      week_end: weekEndStr,
      headliner: editionData.headliner || null,
      sections: editionData.sections || [],
      status: 'published',
      has_sufficient_material: true,
      created_at: nowIso,
      published_at: nowIso,
    });

    return Response.json({ success: true, edition, created: true, has_material: true });
  } catch (error) {
    console.error('generateWeeklyPublication error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});