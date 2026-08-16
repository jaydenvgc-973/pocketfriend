import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * generateWeeklyPublication
 *
 * Modes:
 *   official        — Scheduled Sunday publication. Covers the previous complete
 *                     7-day period. Creates a new numbered edition.
 *   manual_refresh  — User-requested up-to-date view. Covers this week's Sunday
 *                     through now. Updates the existing manual_refresh edition for
 *                     this week in place (does NOT create a new numbered edition).
 *
 * Source material: completed StoryEvents, CommunityEvents, EventParticipation,
 * and PublicProfile.public_record entries within the date window. No fabrication.
 *
 * Output: actual short newspaper articles with a required headline image.
 */

// Fictional reporter names for bylines
const REPORTER_NAMES = [
  'Jordan Price', 'Maya Carter', 'Devon Brooks', 'Aisha Patel',
  'Marcus Chen', 'Riley Foster', 'Nadia Kim', 'Trevor Hayes',
  'Lena Rodriguez', 'Caleb Wells',
];

function pickReporter() {
  return REPORTER_NAMES[Math.floor(Math.random() * REPORTER_NAMES.length)];
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    let payload = {};
    try { payload = await req.json(); } catch (_) {}
    const mode = payload.mode === 'manual_refresh' ? 'manual_refresh' : 'official';

    // ── EASTERN TIME DATE WINDOW ──────────────────────────────────────────
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfWeek = nowET.getDay(); // 0=Sun
    const thisSunday = new Date(nowET);
    thisSunday.setDate(nowET.getDate() - (dayOfWeek === 0 ? 0 : dayOfWeek));
    thisSunday.setHours(0, 0, 0, 0);

    let weekStart, weekEnd, editionDate;
    if (mode === 'manual_refresh') {
      // This week's Sunday through now
      weekStart = new Date(thisSunday);
      weekEnd = new Date(nowET);
      editionDate = thisSunday.toISOString().slice(0, 10);
    } else {
      // Official: previous complete 7-day period (previous Sunday through Saturday)
      weekStart = new Date(thisSunday);
      weekStart.setDate(thisSunday.getDate() - 7);
      weekEnd = new Date(thisSunday);
      weekEnd.setDate(thisSunday.getDate() - 1);
      weekEnd.setHours(23, 59, 59, 999);
      editionDate = thisSunday.toISOString().slice(0, 10);
    }

    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);
    const weekStartMs = weekStart.getTime();
    const weekEndMs = weekEnd.getTime();
    const nowIso = new Date().toISOString();

    // ── CHECK FOR EXISTING EDITION ────────────────────────────────────────
    if (mode === 'official') {
      // Don't create duplicate official editions for the same week
      const existing = await base44.asServiceRole.entities.WeeklyPublication.filter(
        { week_start: weekStartStr, publication_type: 'official' }, null, 1
      );
      if (existing[0]) {
        return Response.json({ success: true, message: 'Official edition already exists for this week', edition: existing[0], created: false });
      }
    }

    // ── LOAD SOURCE MATERIAL ──────────────────────────────────────────────
    // 1. Completed StoryEvents in the date window
    const allStoryEvents = await base44.asServiceRole.entities.StoryEvent.list('-created_date', 200);
    const qualifyingStoryEvents = allStoryEvents.filter(e => {
      if (e.status !== 'complete') return false;
      if (!e.event_date) return false;
      return e.event_date >= weekStartStr && e.event_date <= weekEndStr;
    });

    // 2. CommunityEvents in the date window
    let qualifyingCommunityEvents = [];
    try {
      const allCommunityEvents = await base44.asServiceRole.entities.CommunityEvent.list(null, 200);
      qualifyingCommunityEvents = allCommunityEvents.filter(e => {
        if (!e.is_active) return false;
        if (!e.start_date) return false;
        const eventMs = new Date(e.start_date).getTime();
        return eventMs >= weekStartMs && eventMs <= weekEndMs;
      });
    } catch (_) { /* non-fatal */ }

    // 3. EventParticipation in the date window
    let qualifyingParticipations = [];
    try {
      const allParticipations = await base44.asServiceRole.entities.EventParticipation.list('-participation_date', 200);
      qualifyingParticipations = allParticipations.filter(p => {
        if (!p.participation_date) return false;
        const partMs = new Date(p.participation_date).getTime();
        return partMs >= weekStartMs && partMs <= weekEndMs;
      });
    } catch (_) { /* non-fatal */ }

    // 4. PublicProfile.public_record entries in the date window
    const allProfiles = await base44.asServiceRole.entities.PublicProfile.list('-last_public_impact_at', 200);
    const qualifyingPublicRecords = [];
    for (const profile of allProfiles) {
      for (const entry of profile.public_record || []) {
        const entryDate = entry.designated_at || entry.event_date;
        if (!entryDate) continue;
        const entryMs = new Date(entryDate).getTime();
        if (entryMs >= weekStartMs && entryMs <= weekEndMs) {
          qualifyingPublicRecords.push({
            ...entry,
            character_id: profile.character_id,
            character_name: profile.character_name,
            owner_email: profile.owner_email,
          });
        }
      }
    }

    // ── LOAD PREVIOUSLY REPORTED STORY IDS ───────────────────────────────
    const allEditions = await base44.asServiceRole.entities.WeeklyPublication.list('-edition_date', 50);
    const previouslyReportedIds = new Set();
    const previousHeadlines = [];
    for (const ed of allEditions) {
      if (ed.headliner?.story_event_ids) {
        for (const id of ed.headliner.story_event_ids) previouslyReportedIds.add(id);
      }
      if (ed.headliner?.title) {
        previousHeadlines.push({ title: ed.headliner.title, edition: ed.edition_number, date: ed.edition_date });
      }
      for (const s of ed.sections || []) {
        if (s.story_event_ids) for (const id of s.story_event_ids) previouslyReportedIds.add(id);
      }
    }

    // ── CHECK FOR MANUAL REFRESH: NO NEW MATERIAL ────────────────────────
    // If manual refresh and there's no new material beyond what's already in the
    // existing edition, return the existing edition without creating a new one.
    if (mode === 'manual_refresh') {
      const existingRefresh = await base44.asServiceRole.entities.WeeklyPublication.filter(
        { week_start: weekStartStr, publication_type: 'manual_refresh' }, null, 1
      );
      const existingOfficial = await base44.asServiceRole.entities.WeeklyPublication.filter(
        { week_start: weekStartStr, publication_type: 'official' }, null, 1
      );
      const existing = existingRefresh[0] || existingOfficial[0];

      // Check if any source material is newer than the existing edition
      const existingPublishedMs = existing ? new Date(existing.published_at || existing.created_at).getTime() : 0;
      const hasNewerMaterial =
        qualifyingStoryEvents.some(e => new Date(e.updated_date || e.created_date).getTime() > existingPublishedMs) ||
        qualifyingPublicRecords.some(r => new Date(r.designated_at).getTime() > existingPublishedMs) ||
        qualifyingParticipations.some(p => new Date(p.participation_date).getTime() > existingPublishedMs);

      if (existing && !hasNewerMaterial && qualifyingStoryEvents.length === 0 && qualifyingPublicRecords.length === 0 && qualifyingParticipations.length === 0) {
        return Response.json({ success: true, message: 'No new material since last edition', edition: existing, created: false, up_to_date: true });
      }
    }

    // ── COMBINE ALL SOURCE MATERIAL FOR LLM ───────────────────────────────
    const allMaterial = [];

    for (const e of qualifyingStoryEvents) {
      // Pair each participant name with its ID so the LLM can return actual IDs
      const participantIds = e.participant_character_ids || [];
      const participantNames = e.participant_character_names || [];
      const participants = participantIds.map((id, i) => ({ id, name: participantNames[i] || '' }));
      const focusIds = e.focus_character_ids || [];
      const focusNames = e.focus_character_names || [];
      const focus_characters = focusIds.map((id, i) => ({ id, name: focusNames[i] || '' }));
      allMaterial.push({
        type: 'story_event',
        id: e.id,
        title: e.title,
        event_date: e.event_date,
        venue: e.venue_name || e.rabbit_hole_venue_name,
        plot: e.plot,
        narrative_preview: e.narrative_preview || (e.generated_narrative || '').slice(0, 500),
        participants,
        focus_characters,
        previously_reported: previouslyReportedIds.has(e.id),
      });
    }

    for (const e of qualifyingCommunityEvents) {
      allMaterial.push({
        type: 'community_event',
        id: e.id,
        title: e.name,
        event_date: e.start_date ? new Date(e.start_date).toISOString().slice(0, 10) : null,
        venue: e.location_name,
        description: e.description,
        event_type: e.event_type,
        vibe: e.vibe,
      });
    }

    for (const p of qualifyingParticipations) {
      allMaterial.push({
        type: 'event_participation',
        id: p.id,
        title: p.event_name,
        event_date: p.participation_date ? new Date(p.participation_date).toISOString().slice(0, 10) : null,
        character_id: p.character_id,
        character_name: p.character_name,
        participation_type: p.participation_type,
        notes: p.notes,
      });
    }

    for (const r of qualifyingPublicRecords) {
      allMaterial.push({
        type: 'public_record',
        id: r.story_event_id || r.id,
        title: r.event_title,
        event_date: r.event_date,
        character_id: r.character_id,
        character_name: r.character_name,
        public_category: r.public_category,
        exposure_scope: r.exposure_scope,
        impact_tier: r.impact_tier,
        impact_summary: r.impact_summary,
        role_description: r.role_description,
      });
    }

    // ── DETERMINE EDITION NUMBER ──────────────────────────────────────────
    let editionNumber;
    if (mode === 'manual_refresh') {
      // Reuse the latest official edition number — don't increment
      const latestOfficial = allEditions.find(e => e.publication_type === 'official' || !e.publication_type);
      editionNumber = latestOfficial?.edition_number || 1;
    } else {
      const latestOfficial = allEditions.find(e => e.publication_type === 'official' || !e.publication_type);
      editionNumber = (latestOfficial?.edition_number || 0) + 1;
    }

    // ── NO MATERIAL — PUBLISH QUIET WEEK ──────────────────────────────────
    if (allMaterial.length === 0) {
      if (mode === 'manual_refresh') {
        // Don't replace existing edition with empty one for manual refresh
        const existing = await base44.asServiceRole.entities.WeeklyPublication.filter(
          { week_start: weekStartStr }, null, 1
        );
        if (existing[0]) {
          return Response.json({ success: true, message: 'No new material — existing edition remains current', edition: existing[0], created: false, up_to_date: true });
        }
      }
      const edition = await base44.asServiceRole.entities.WeeklyPublication.create({
        edition_number: editionNumber,
        edition_date: editionDate,
        week_start: weekStartStr,
        week_end: weekEndStr,
        publication_type: mode,
        headliner: null,
        sections: [],
        around_town: [],
        status: 'published',
        has_sufficient_material: false,
        created_at: nowIso,
        published_at: nowIso,
        ...(mode === 'manual_refresh' ? { refreshed_at: nowIso } : {}),
      });
      return Response.json({ success: true, edition, created: true, has_material: false });
    }

    // ── LLM: WRITE ACTUAL NEWSPAPER ARTICLES ──────────────────────────────
    const llmPrompt = `You are the editor of a weekly community newspaper called "The Weekly." Your job is to write actual newspaper articles from the qualifying world events provided below.

EDITORIAL RULES — VIOLATING THESE IS A SYSTEM FAILURE:
1. Write ACTUAL NEWSPAPER ARTICLES, not summaries, database descriptions, or AI output. Articles should read like a real small-town newspaper written for people living in this world.
2. Use a BELIEVABLE NEWSPAPER VOICE. Explain what happened, who was involved, where and when (if relevant), and why the story is noteworthy. Write in third person, past tense.
3. Keep articles SHORT. This is a quick-read newspaper:
   - Headliner: 2-3 short paragraphs (3-5 sentences each)
   - Feature/secondary articles: 1-2 short paragraphs
   - Around Town items: 1 sentence each
4. Select the MOST NEWSWORTHY story as the headliner — based on the significance of what happened, NOT the fame of the character involved. A community event with broad impact is more newsworthy than a famous character's routine appearance.
5. DO NOT FABRICATE stories. Only use the provided events. If there isn't material for a section, leave that section's array empty.
6. DO NOT force every section to have content. Sections should be populated according to the actual qualifying activity.
6b. CHARACTER IDS: The source events include character_id fields with actual database IDs. You MUST return those exact ID values in the "character_ids" array — do NOT return character names as IDs. The character_ids array must contain the actual ID strings from the source data (e.g. "6a80c96f7df8aa5403dec235"), not names like "Ethan Thompson" or "Test Character A".
7. IMAGE GENERATION — IDENTITY-AWARE:
   For each article that has an image_prompt, set "image_depicts_characters" to true if the photograph is intended to visibly depict one or more of the established characters named in that article (e.g. a portrait, a photo of the character at an event, a character on a campaign shoot). Set it to false if the image is a general environmental/crowd photograph where no particular established character is intended to be identifiable (e.g. a wide shot of a festival, a building exterior, a crowd scene).
   When image_depicts_characters is true:
   - The image_prompt MUST describe the scene, activity, environment, location, pose, and editorial composition — WHAT is happening and WHERE.
   - The image_prompt MUST NOT describe the character's physical appearance (face, hair, build, race, age, etc.). Character visual identity is supplied separately from the character's authoritative reference imagery. Describing physical appearance in the prompt causes the image generator to invent a generic person.
   - The image_prompt MAY describe clothing when the article/event specifically establishes what the character is wearing (e.g. a campaign outfit, a performance costume). Otherwise leave clothing to the character's established appearance.
   When image_depicts_characters is false:
   - The image_prompt should describe the general event scene, atmosphere, and environment without claiming any particular person is an established character.
8. Generate a fictional byline (reporter name) and role for each article. Use realistic names, not character names from the world.
9. PREVIOUSLY REPORTED stories: if a story was previously reported and has a NEW DEVELOPMENT this week, write about the development — do NOT pretend the story just began. If there is no new development, exclude it.
10. Categories:
    - community_spotlight: community participation, local figures, achievements, activism, performances, charity, fashion shows
    - campaign_watch: advertising campaigns, commercial work, marketing, promotional appearances, photo campaigns
    - neighborhood_news: community fairs, gatherings, neighborhood events, public activities, local developments
11. Write a subtitle (deck) for the headliner — a single sentence expanding on the headline.
12. Include a pull_quote for the headliner if the article naturally contains a quotable sentiment. Otherwise set to null.
13. For "around_town": collect brief 1-sentence news items from smaller events that don't warrant full articles. If none, return empty array.

PREVIOUSLY REPORTED HEADLINES (for continuity reference):
${JSON.stringify(previousHeadlines.slice(0, 10), null, 2)}

QUALIFYING WORLD EVENTS FOR THIS EDITION:
${JSON.stringify(allMaterial, null, 2)}

Return JSON with this exact structure:
{
  "headliner": {
    "title": "ALL-CAPS HEADLINE",
    "subtitle": "Subtitle sentence",
    "body": "2-3 paragraphs of actual newspaper writing separated by \\n\\n",
    "byline": "Reporter Name",
    "role": "Staff Writer",
    "pull_quote": "A quotable line from the article or null",
    "image_prompt": "Scene/activity/environment description. Do NOT describe character physical appearance — identity comes from reference imagery.",
    "image_depicts_characters": true | false,
    "image_caption": "Caption for the image",
    "category": "community_spotlight|campaign_watch|neighborhood_news",
    "character_ids": ["..."],
    "character_names": ["..."],
    "story_event_ids": ["..."]
  } | null,
  "sections": [
    {
      "category": "community_spotlight|campaign_watch|neighborhood_news",
      "title": "Article headline",
      "body": "1-2 paragraphs of actual newspaper writing",
      "byline": "Reporter Name",
      "role": "Staff Writer",
      "image_prompt": "Scene/activity/environment description or null. Do NOT describe character physical appearance.",
      "image_depicts_characters": true | false,
      "image_caption": "Caption or null",
      "character_ids": ["..."],
      "character_names": ["..."],
      "story_event_ids": ["..."],
      "impact_tier": "feature|secondary|minor_mention"
    }
  ],
  "around_town": [
    { "text": "Brief 1-sentence news item" }
  ]
}

If no story is strong enough to be a headliner, set headliner to null.`;

    const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: llmPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          headliner: {
            type: "object",
            properties: {
              title: { type: "string" },
              subtitle: { type: "string" },
              body: { type: "string" },
              byline: { type: "string" },
              role: { type: "string" },
              pull_quote: { type: "string" },
              image_prompt: { type: "string" },
              image_depicts_characters: { type: "boolean" },
              image_caption: { type: "string" },
              category: { type: "string" },
              character_ids: { type: "array", items: { type: "string" } },
              character_names: { type: "array", items: { type: "string" } },
              story_event_ids: { type: "array", items: { type: "string" } },
            }
          },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string" },
                title: { type: "string" },
                body: { type: "string" },
                byline: { type: "string" },
                role: { type: "string" },
                image_prompt: { type: "string" },
                image_depicts_characters: { type: "boolean" },
                image_caption: { type: "string" },
                character_ids: { type: "array", items: { type: "string" } },
                character_names: { type: "array", items: { type: "string" } },
                story_event_ids: { type: "array", items: { type: "string" } },
                impact_tier: { type: "string" },
              }
            }
          },
          around_town: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" }
              }
            }
          }
        }
      }
    });

    const editionData = llmResult;

    // ── RESOLVE CHARACTER VISUAL IDENTITIES FOR IMAGE GENERATION ─────────
    // When an article image is intended to depict established characters,
    // resolve those characters' authoritative visual reference imagery and
    // supply it to GenerateImage as existing_image_urls. This preserves the
    // character's recognizable established identity. The image_prompt
    // supplies the scene/activity/context (WHAT); the reference images
    // supply the character identity (WHO).
    const charsNeedingRef = new Set();
    if (editionData.headliner?.image_prompt && editionData.headliner.image_depicts_characters) {
      for (const id of editionData.headliner.character_ids || []) charsNeedingRef.add(id);
    }
    for (const s of editionData.sections || []) {
      if (s.image_prompt && s.image_depicts_characters) {
        for (const id of s.character_ids || []) charsNeedingRef.add(id);
      }
    }

    // Build a name→id map from source material so we can resolve character
    // references even if the LLM returns a name instead of a database ID.
    const nameToIdMap = {};
    for (const m of allMaterial) {
      if (m.type === 'story_event') {
        for (const p of m.participants || []) { if (p.id && p.name) nameToIdMap[p.name] = p.id; }
        for (const f of m.focus_characters || []) { if (f.id && f.name) nameToIdMap[f.name] = f.id; }
      } else if (m.character_id && m.character_name) {
        nameToIdMap[m.character_name] = m.character_id;
      }
    }

    const charRefMap = {}; // charId -> [image URLs]
    for (const charRef of charsNeedingRef) {
      try {
        // Resolve to an actual character ID — try as-is first, then name lookup
        let resolvedId = charRef;
        if (!nameToIdMap[charRef] && nameToIdMap[charRef] !== undefined) {
          // charRef is a name that exists in the map — use the mapped ID
          resolvedId = nameToIdMap[charRef];
        } else {
          // Check if charRef is a name (not an ID) by looking it up in nameToIdMap values
          for (const [name, id] of Object.entries(nameToIdMap)) {
            if (name === charRef) { resolvedId = id; break; }
          }
        }

        let chars = await base44.asServiceRole.entities.Character.filter({ id: resolvedId }, null, 1);
        let char = chars?.[0];
        // Fallback: if ID lookup failed, try by name (LLM may have returned a name)
        if (!char) {
          chars = await base44.asServiceRole.entities.Character.filter({ name: resolvedId }, null, 1);
          char = chars?.[0];
        }
        if (char) {
          const refs = [
            char.image_avatar_url,
            char.avatar_url,
            ...(char.reference_image_urls || []),
          ].filter(Boolean);
          if (refs.length > 0) charRefMap[charRef] = refs;
        }
      } catch (_) { /* non-fatal — character may not be found */ }
    }

    // ── GENERATE ARTICLE IMAGES (IDENTITY-AWARE) ────────────────────────
    // For each article with an image_prompt:
    //   - If image_depicts_characters is true, supply the resolved character
    //     reference images as existing_image_urls so the generated person
    //     preserves the character's established visual identity.
    //   - If image_depicts_characters is false (general event photo), generate
    //     from the prompt alone without character references.
    async function generateArticleImage(article) {
      if (!article?.image_prompt) return;
      const refImages = [];
      if (article.image_depicts_characters) {
        for (const id of article.character_ids || []) {
          if (charRefMap[id]) refImages.push(...charRefMap[id]);
        }
      }
      try {
        const imgResult = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: `Realistic newspaper photograph, photojournalism style: ${article.image_prompt}. Natural lighting, candid moment, high quality documentary photography.`,
          ...(refImages.length > 0 ? { existing_image_urls: refImages.slice(0, 4) } : {}),
        });
        article.image_url = imgResult?.url || null;
      } catch (imgErr) {
        console.warn('[generateWeeklyPublication] Image generation failed:', imgErr.message);
        article.image_url = null;
      }
    }

    // Headline image (required for every genuine headline story)
    if (editionData.headliner) {
      await generateArticleImage(editionData.headliner);
    }

    // Section images (generated when the LLM provides an image_prompt)
    for (const section of editionData.sections || []) {
      if (section.image_prompt) {
        await generateArticleImage(section);
      }
    }

    // ── UPDATE PUBLIC PROFILE — last_publication_appearance_at ───────────
    const allCharIds = new Set([
      ...(editionData.headliner?.character_ids || []),
      ...editionData.sections.flatMap(s => s.character_ids || []),
    ]);
    for (const charId of allCharIds) {
      const profile = allProfiles.find(p => p.character_id === charId);
      if (profile) {
        await base44.asServiceRole.entities.PublicProfile.update(profile.id, {
          last_publication_appearance_at: nowIso,
        }).catch(() => {});
      }
    }

    // ── SAVE EDITION ──────────────────────────────────────────────────────
    const editionPayload = {
      edition_number: editionNumber,
      edition_date: editionDate,
      week_start: weekStartStr,
      week_end: weekEndStr,
      publication_type: mode,
      headliner: editionData.headliner || null,
      sections: editionData.sections || [],
      around_town: editionData.around_town || [],
      status: 'published',
      has_sufficient_material: true,
      created_at: nowIso,
      published_at: nowIso,
      ...(mode === 'manual_refresh' ? { refreshed_at: nowIso } : {}),
    };

    let edition;
    if (mode === 'manual_refresh') {
      // Update existing manual_refresh for this week, or create new
      const existingRefresh = await base44.asServiceRole.entities.WeeklyPublication.filter(
        { week_start: weekStartStr, publication_type: 'manual_refresh' }, null, 1
      );
      if (existingRefresh[0]) {
        await base44.asServiceRole.entities.WeeklyPublication.update(existingRefresh[0].id, {
          ...editionPayload,
          refreshed_at: nowIso,
          published_at: nowIso,
        });
        edition = { ...existingRefresh[0], ...editionPayload, id: existingRefresh[0].id };
      } else {
        edition = await base44.asServiceRole.entities.WeeklyPublication.create(editionPayload);
      }
    } else {
      edition = await base44.asServiceRole.entities.WeeklyPublication.create(editionPayload);
    }

    return Response.json({ success: true, edition, created: true, has_material: true });
  } catch (error) {
    console.error('generateWeeklyPublication error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});