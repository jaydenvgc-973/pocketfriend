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

// ── CDN URL UTILITIES (aligned with generateImageAsync proven pathway) ───────
function toPublicCDN(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('https://media.base44.com/')) return url;
  const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
  if (match) return `https://media.base44.com/images/public/${match[1]}`;
  return url;
}

function isAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('/files/mp/private/') || url.includes('/files/private/')) return false;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  if (url.includes('base44.app/api/apps/')) return false;
  return true;
}

function cdnFilter(urls) {
  return (urls || []).map(toPublicCDN).filter(isAccessible);
}

// Resolve a character's authoritative reference images with the SAME pathway the
// app's Story Event images already use: the AVATAR is the character's canonical
// face and is always included first, reference photographs follow. Previously the
// avatar was dropped as soon as any loose reference photo existed, and a character
// whose only imagery lived behind a private URL resolved to nothing at all — the
// article photograph then fell back to a generic person.
function resolveCharacterRefImages(charRecord) {
  if (!charRecord) return [];
  const out = [];
  const pushUrl = (url) => {
    const pub = toPublicCDN(url);
    if (!pub || !isAccessible(pub) || out.includes(pub)) return;
    out.push(pub);
  };
  pushUrl(charRecord.avatar_url);
  pushUrl(charRecord.image_avatar_url);
  // Original avatar reference photos are never supplied here. They exist to create the
  // avatar, and the clothing they depict is not this character's established clothing.
  return out.slice(0, 2);
}

// Build appearance lock text from character record — aligned with the proven
// generateImageAsync buildAppearanceLockText: ethnicity-first, anti-whitewashing
// guards, hair-type-specific rejection rules, canonical-hierarchy declaration.
function buildAppearanceLockText(rec) {
  if (!rec) return null;
  const lock = rec.appearance_lock || {};
  const ethnicities = (rec.ethnicities || []).filter(Boolean);
  const skinTone = lock.skin_tone || null;
  const hairstyle = lock.hairstyle || lock.hair_type || null;
  const facialHair = lock.facial_hair || null;
  const bodyType = lock.body_type || lock.overall_aesthetic || null;
  const hasAny = ethnicities.length > 0 || skinTone || hairstyle || facialHair || bodyType;
  if (!hasAny) return null;
  const r = [];
  if (ethnicities.length > 0) {
    r.push(`ETHNICITY / RACE: ${ethnicities.join(', ')} — render EXACTLY this ethnicity. ⛔ DO NOT default to Caucasian/white/European. ⛔ DO NOT soften, lighten, or alter ethnic features toward any other baseline.`);
  }
  if (skinTone) {
    const skinLower = skinTone.toLowerCase();
    const hasAmbiguousLight = /\b(light|caramel|honey|tan|medium)\b/.test(skinLower);
    const hasBlackOrAA = ethnicities.some(e => /\b(black|african american|afro)\b/i.test(e));
    if (hasAmbiguousLight && hasBlackOrAA) {
      r.push(`SKIN TONE: ${skinTone} — warm brown melanated skin tone. ⛔ DO NOT render as pale, fair, or Caucasian-light. ⛔ DO NOT interpret "light" as white or European.`);
    } else {
      r.push(`SKIN TONE: ${skinTone} — do not lighten, soften, or alter in any direction.`);
    }
  }
  if (hairstyle) {
    r.push(`HAIR: ${hairstyle}`);
    if (/dreadlocks?|locs?/i.test(hairstyle)) r.push('⛔ REJECT: fade, short, bald, generic curls — DREADLOCKS ONLY');
    else if (/long hair/i.test(hairstyle)) r.push('⛔ REJECT: short, buzz, fade, cropped — LONG HAIR ONLY');
    else if (/afro/i.test(hairstyle)) r.push('⛔ REJECT: straight, slicked, fade — AFRO ONLY');
    else if (/braids?|cornrows/i.test(hairstyle)) r.push('⛔ REJECT: loose/straight/fade — BRAIDS ONLY');
  }
  if (facialHair) {
    r.push(`FACIAL HAIR: ${facialHair}`);
    if (/clean-?shaven|no facial hair/i.test(facialHair)) r.push('⛔ REJECT beard/stubble — CLEAN-SHAVEN ONLY');
    else r.push(`⛔ REJECT clean-shaven — ${facialHair} MUST EXIST`);
  }
  if (bodyType) r.push(`BODY TYPE: ${bodyType} — do not slim, bulk, age-down, or beautify beyond what is described.`);
  r.push('CANONICAL > REFS > PROMPT. Prompt controls pose/scene ONLY — NOT ethnicity/hair/face/skin/body.');
  return r.join('\n');
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
      // Private Story Events are never reported in the newsletter.
      if (e.is_public === false) return false;
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
        // A refresh that finds nothing must never publish an empty edition: an empty
        // record carries a newer published_at than the real edition and would replace
        // it on screen with nothing. It also must not hand back an empty record that
        // already exists for this week. The reader keeps the newest edition that
        // actually has stories, and no record is written.
        const hasContent = (edition) => !!edition
          && (!!edition.headliner || (edition.sections || []).length > 0 || (edition.around_town || []).length > 0);
        const existing = await base44.asServiceRole.entities.WeeklyPublication.filter(
          { week_start: weekStartStr }, null, 1
        );
        const current = (hasContent(existing[0]) ? existing[0] : null)
          || allEditions.find(hasContent)
          || null;
        if (current) {
          return Response.json({ success: true, message: 'No new material — existing edition remains current', edition: current, created: false, up_to_date: true });
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
7. IMAGE GENERATION — TWO SEPARATE DECISIONS:
   DECISION 1 — Should this article have an image?
     - The headliner MUST have an image_prompt (required).
     - Sections: ONLY include an image_prompt when the article is a feature-tier story that naturally warrants a photograph. Most sections should have image_prompt set to null. Do NOT give every section an image.
   DECISION 2 — If an image is present, does it depict an established character?
     - Set "image_depicts_characters" to true if the photograph is intended to visibly depict one or more established characters named in the article (e.g. a portrait, a photo of the character at an event, a character on a campaign shoot).
     - Set it to false if the image is a general environmental/crowd photograph where no particular established character is intended to be identifiable (e.g. a wide shot of a festival, a building exterior, a crowd scene).
     - An article about one or more specific established characters depicts them: set it to true. It is false only for a genuinely general environmental or crowd photograph of no particular person.
   When image_depicts_characters is true:
   - The image_prompt MUST name each established character who appears in the photograph, using the exact name used in the article (one to three people). The name identifies WHO is in the frame; their face, hair, skin tone and build still come only from their attached reference imagery.
   - The image_prompt MUST describe the event or moment the article reports, so the photograph and the article show the same thing.
   - The image_prompt MUST describe the scene, activity, environment, location, pose, and editorial composition — WHAT is happening and WHERE.
   - The image_prompt MUST NOT describe the character's physical appearance (face, hair, build, race, age, etc.). Character visual identity is supplied separately from authoritative reference imagery. Describing physical appearance causes the image generator to invent a generic person.
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
      "image_prompt": "Scene/activity/environment description. ONLY for feature-tier stories that warrant a photo — null for most sections. Do NOT describe character physical appearance." | null,
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
                image_prompt: { type: ["string", "null"] },
                image_depicts_characters: { type: "boolean" },
                image_caption: { type: ["string", "null"] },
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

    // ── AUTHORITATIVE PARTICIPANTS, FROM THE SOURCE RECORDS ──────────────
    // The Weekly already knows which established characters each story involved:
    // the StoryEvent's participant/focus character IDs, and the character ID carried
    // by a participation or public-record entry. That association — not a name in the
    // finished prose, and not a flag the editor model happened to set — decides who
    // appears in an article's photograph. The IDs are preserved from the source; the
    // editor's own character_ids are accepted only when they validate against a real
    // record (a bare name is never treated as an identity).
    const participantsBySourceId = new Map(); // source record id → [{ id, name }]
    const knownPeople = new Map();            // character id → name from the source
    const rememberPerson = (id, name) => {
      if (!id || typeof id !== 'string') return;
      if (!knownPeople.has(id) || (!knownPeople.get(id) && name)) knownPeople.set(id, name || '');
    };
    for (const m of allMaterial) {
      if (m.type === 'story_event') {
        const people = [...(m.participants || []), ...(m.focus_characters || [])].filter((p) => p && p.id);
        participantsBySourceId.set(m.id, people);
        people.forEach((p) => rememberPerson(p.id, p.name));
      } else if (m.character_id) {
        participantsBySourceId.set(m.id, [{ id: m.character_id, name: m.character_name || '' }]);
        rememberPerson(m.character_id, m.character_name);
      }
    }

    // Deterministic name→id map built from those source associations.
    const nameToIdMap = {};
    for (const [id, name] of knownPeople) { if (name) nameToIdMap[name] = id; }

    const LOOKS_LIKE_ID = /^[0-9a-f]{20,}$/i;
    const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const nameMentioned = (text, name) => {
      const body = normalize(text);
      const wanted = normalize(name);
      if (!body || !wanted) return false;
      if (body.includes(wanted)) return true;
      const words = wanted.split(' ').filter((w) => w.length > 2);
      const last = words[words.length - 1];
      return !!last && new RegExp(`(^| )${last}( |$)`).test(body);
    };

    // Every established character an article is about, by authoritative ID.
    const articleParticipantIds = (article) => {
      const ids = new Set();
      const linkedSources = (article?.story_event_ids || []).filter((sid) => participantsBySourceId.has(sid));
      for (const sourceId of linkedSources) {
        for (const person of participantsBySourceId.get(sourceId) || []) ids.add(person.id);
      }
      for (const token of article?.character_ids || []) {
        const value = typeof token === 'string' ? token.trim() : '';
        if (!value) continue;
        if (nameToIdMap[value]) { ids.add(nameToIdMap[value]); continue; }
        if (knownPeople.has(value)) { ids.add(value); continue; }
        if (LOOKS_LIKE_ID.test(value)) ids.add(value);
      }
      // No authoritative story link survived onto the article: identify its people by
      // the exact names the source records already carry. Still resolved to real
      // records — never to a name the image generator has to guess at.
      if (linkedSources.length === 0 && ids.size === 0) {
        const prose = normalize([article?.title, article?.subtitle, article?.body].filter(Boolean).join(' '));
        if (prose) {
          for (const [id, name] of knownPeople) {
            const wanted = normalize(name);
            if (wanted && prose.includes(wanted)) ids.add(id);
          }
        }
      }
      return [...ids];
    };

    // Who is in this photograph. A participant the scene description actually names
    // is depicted, whatever the editorial flag says — the scene prompt is the closest
    // statement of what the image shows. Otherwise the flag decides, and an article
    // with no identified person stays a general event photograph. Everyone mentioned
    // in the prose is not dragged into the frame.
    const articleDepictedIds = (article) => {
      if (!article?.image_prompt) return [];
      const ids = articleParticipantIds(article);
      const named = ids.filter((id) => nameMentioned(article.image_prompt, knownPeople.get(id) || ''));
      if (named.length) return named.slice(0, 4);
      if (article.image_depicts_characters === false) return [];
      return ids.slice(0, 4);
    };

    // characterId → { id, record, name, refUrls, appearanceLockText }
    // Resolved with the service role — the existing authorized cross-account pathway
    // this newsletter already uses for its source records. A character belonging to
    // another Pocketfriend account resolves and supplies references exactly like one
    // of the reader's own, and is never swapped for a generic person.
    const charRefMap = new Map();
    const resolveCharacterEntry = async (characterId) => {
      if (charRefMap.has(characterId)) return charRefMap.get(characterId);
      let entry = null;
      try {
        let char = null;
        try { char = await base44.asServiceRole.entities.Character.get(characterId); } catch (_) { /* not found */ }
        if (!char) {
          const byName = knownPeople.get(characterId);
          if (byName) {
            const found = await base44.asServiceRole.entities.Character.filter({ name: byName }, null, 1);
            char = found?.[0] || null;
          }
        }
        if (char) {
          entry = {
            id: char.id,
            record: char,
            name: char.name || char.display_name || '',
            refUrls: resolveCharacterRefImages(char),
            appearanceLockText: buildAppearanceLockText(char),
          };
        }
      } catch (_) { /* non-fatal */ }
      charRefMap.set(characterId, entry);
      return entry;
    };

    // ── CULTURAL SCENE ACCURACY ────────────────────────────────────────
    // A keyword is not a scene. In this world "ballroom" almost always means LGBTQ
    // ballroom culture — houses, categories walked on a runway, vogue performance,
    // judges and the community around the floor — while a photograph of couples in
    // closed partner-dance posture is a different event entirely. The article's own
    // words decide which one this is, and the answer is added to the image request
    // itself, so the scene is read as the culture being reported whether or not the
    // article names anyone.
    const BALLROOM_CULTURE = /\b(vogue|voguing|vogue femme|realness|kiki ball|house ball|femme queen|butch queen|tens across the board|007s?|ballroom (?:&|and) vogue)\b/i;
    const BALLROOM_HOUSES = /\b(?:the |local |competing )houses\b/i;

    const articleSceneText = (article) => {
      const parts = [article?.title, article?.subtitle, article?.body, article?.image_prompt, article?.pull_quote];
      (article?.story_event_ids || []).forEach((sid) => {
        const material = allMaterial.find((m) => m.id === sid);
        if (material) parts.push(material.title, material.plot, material.venue_name);
      });
      return parts.filter(Boolean).join(' ');
    };

    // The categories the article actually names, so the styling follows the category
    // being presented instead of one generic "ballroom" look.
    const ballroomCategoryLines = (text) => {
      const lines = [];
      if (/schoolboy|school boy|school girl|schoolgirl/i.test(text)) lines.push('Schoolboy / School Girl Realness — student styling (caps, backpacks, oversized hoodies, sneakers, school uniforms where allowed); never businesswear.');
      if (/executive realness/i.test(text)) lines.push('Executive Realness — professional tailoring and corporate bearing.');
      if (/femme queen/i.test(text)) lines.push('Femme Queen Realness — its own established presentation.');
      if (/runway/i.test(text)) lines.push('Runway — the walk: strut, posture, carriage, the turn, the garment moving with the body. Walked, never danced.');
      if (/vogue femme|cunty|dramatics|vogu(?:e|ing)/i.test(text)) lines.push('Vogue performance — hand performance, catwalk, duckwalk, floor work, spins and dips.');
      return lines;
    };

    const cultureSceneGuide = (article) => {
      const text = articleSceneText(article);
      // A culture signal outranks the phrase "ballroom dance" in the same article: the
      // article about a Vogue Social is exactly the one that calls it a ballroom dance
      // competition. Only an article with no culture signal at all is left alone.
      const ballroomCulture = BALLROOM_CULTURE.test(text)
        || (/ballroom/i.test(text) && BALLROOM_HOUSES.test(text));
      if (!ballroomCulture) return '';
      const categoryLines = ballroomCategoryLines(text);
      return [
        '',
        '═══════════════════════════════════════════════════════════',
        'SCENE CULTURE — LGBTQ BALLROOM CULTURE, NOT A FORMAL DANCE',
        '═══════════════════════════════════════════════════════════',
        'This is a community ball in LGBTQ ballroom culture: a runway or floor where categories are presented, vogue performance, judges scoring, houses and the community crowded around the floor. Styling, posture and activity follow the category being presented.',
        categoryLines.length ? `Categories this article names:\n- ${categoryLines.join('\n- ')}` : '',
        '⛔ NOT a traditional partner ballroom dance. No waltz, foxtrot, quickstep, tango, ballgowns, tuxedoed couples, chandeliered dance hall, and no couple in closed partner-dance posture. A photograph showing that is a different event and is invalid for this article.',
        '⛔ A venue named "ballroom" is not a formal dance hall. Read the event from the article, never from the word alone.',
      ].filter(Boolean).join('\n');
    };

    // ── GENERATE ARTICLE IMAGES ────────────────────────────────────────
    // Image generation decision and identity-reference decision are SEPARATE:
    //   - Should this article have an image? → only when image_prompt is non-null
    //   - Who is in it? → the article's authoritative participants (articleDepictedIds),
    //     resolved to live character records with their avatars and reference photos
    // The headliner always has an image. Sections only when image_prompt is non-null.
    // Each character record is fetched once per edition and reused across articles.
    async function generateArticleImage(article) {
      if (!article?.image_prompt) return;

      const sceneDesc = article.image_prompt;
      // How this event is read — added to the image request whether or not the article
      // names anyone, so a generic crowd is still the right kind of crowd.
      const cultureGuide = cultureSceneGuide(article);
      // The depicted people are the article's authoritative participants — resolved
      // by ID from the source records, including characters owned by other accounts.
      const depictedIds = articleDepictedIds(article);
      const charEntries = [];
      for (const id of depictedIds) {
        const entry = await resolveCharacterEntry(id);
        if (entry) charEntries.push(entry);
      }

      console.log(`[WeeklyImageGen] article="${article.title?.substring(0, 50)}" depicted_ids=${depictedIds.length} resolved=${charEntries.length} culture=${cultureGuide ? 'ballroom' : 'none'}`);
      for (const e of charEntries) {
        console.log(`[WeeklyImageGen]   char="${e.name}" id=${e.id} ref_urls=${e.refUrls.length} has_lock=${!!e.appearanceLockText}`);
        e.refUrls.forEach((u, i) => console.log(`[WeeklyImageGen]     ref[${i}]: ${u}`));
      }
      if (depictedIds.length > 0 && charEntries.length === 0) {
        console.warn(`[WeeklyImageGen]   ${depictedIds.length} identified participant(s) could not be resolved to character records: ${depictedIds.join(', ')}`);
      }

      let prompt;
      let existingImageUrls;

      if (charEntries.length > 0) {
        // ── IDENTITY-AWARE PATH: build a prompt that instructs the model ──
        // to use the reference images as face identity photos, exactly like
        // generateImageAsync does. The model must know WHICH images are WHO.
        const allRefUrls = [];
        const subjectBlocks = [];
        // Reference images are budgeted so their numbering stays true: every
        // subject's images are attached, and the indexes in the prompt match them.
        const perSubjectRefAllowance = Math.min(3, Math.max(1, Math.floor(6 / charEntries.length)));
        let imgIdx = 1;
        for (const entry of charEntries) {
          const charName = entry.name || 'the character';
          const refs = entry.refUrls.slice(0, perSubjectRefAllowance);
          const start = imgIdx;
          const end = imgIdx + refs.length - 1;
          const refRange = refs.length === 0 ? null : (refs.length === 1 ? `Image ${start}` : `Images ${start}–${end}`);
          if (refs.length > 0) {
            allRefUrls.push(...refs);
            imgIdx = end + 1;
          }
          const lines = [];
          lines.push(`SUBJECT: "${charName}"`);
          if (refRange) {
            lines.push(`${refRange} are FACE/IDENTITY reference photographs for "${charName}".`);
            lines.push('Extract ONLY: face bone structure, skin tone, eye shape, nose, mouth, hair color/length/style, facial hair, body type.');
            lines.push('⛔ DISCARD: pose, background, clothing, lighting from these photos — face and body identity ONLY.');
            lines.push('⛔ FACE RESEMBLANCE IS MANDATORY: the person in this image MUST be recognizably the same person as shown in the reference photos.');
            lines.push('⛔ DO NOT generate a "similar" person, lookalike, or generic substitute.');
          } else {
            lines.push('No reference photograph could be attached for this subject. Render them from the appearance record below and nothing else — ⛔ never a generic, default-looking, or stand-in person.');
          }
          if (entry.appearanceLockText) {
            lines.push(`APPEARANCE LOCK (ABSOLUTE): ${entry.appearanceLockText}`);
            lines.push('⛔ DO NOT default to Caucasian/white/European. Render EXACTLY the ethnicity and features specified.');
          }
          subjectBlocks.push(lines.join('\n'));
        }

        const depictedNames = charEntries.map((e) => e.name).filter(Boolean);
        const depictedLine = depictedNames.length
          ? `\nThe people in this photograph are ${depictedNames.join(' and ')} — the attached reference subjects, and they are the people taking part in the event itself: the family, guests or performers at the centre of the action. ⛔ Every figure at the centre of the action must be one of them, rendered as the same recognisable person as their reference photograph; do not put an unnamed participant in their place, do not add another performer alongside them, and do not replace, blend or average any of them. Any crowd, audience or spectators are background only and must stay clearly distinct from them.`
          : '';

        const subjectBlockText = subjectBlocks.length === 1
          ? subjectBlocks[0]
          : subjectBlocks.map((b, i) => `─── SUBJECT ${i + 1} ───\n${b}`).join('\n\n');

        const multiRule = subjectBlocks.length > 1
          ? `\n\nThis image contains ${subjectBlocks.length} distinct established characters. Each subject retains their own distinct face, hair, skin tone, and body type. ⛔ NEVER swap, blend, or cross-assign appearance between subjects.`
          : '';

        prompt = `═══════════════════════════════════════════════════════════
⚠️ FICTIONAL CHARACTER NOTICE
═══════════════════════════════════════════════════════════
ALL subjects are 100% FICTIONAL CHARACTERS for a storytelling app. Not real people.
✅ Treat as characters in a novel. Render from reference photos and appearance descriptions only.

═══════════════════════════════════════════════════════════
⛔ IDENTITY DEFAULT PROHIBITION — NON-NEGOTIABLE
═══════════════════════════════════════════════════════════
⛔ DO NOT default to Caucasian, white, fair-skinned, or any assumed ethnicity.
✅ Use ONLY: reference images, appearance lock, ethnicities field.
✅ If ethnicities are specified, render EXACTLY those. No whitewashing.

═══════════════════════════════════════════════════════════
REFERENCE IMAGE INSTRUCTIONS — FACE IDENTITY
═══════════════════════════════════════════════════════════
${subjectBlockText}${multiRule}

═══════════════════════════════════════════════════════════
SCENE — NEWSPAPER PHOTOGRAPH
═══════════════════════════════════════════════════════════
${sceneDesc}${depictedLine}${cultureGuide}

Photorealistic newspaper photograph, photojournalism style. Natural lighting, candid moment, high quality documentary photography. Ultra-detailed. Real human proportions. Not an illustration.

⛔ The visible person(s) MUST match the reference photo identity. GENERATION INVALID if the face could be mistaken for a different person.`;
        existingImageUrls = allRefUrls.slice(0, 6);
      } else {
        // ── GENERAL EVENT IMAGE: no character identity references ──
        prompt = `Realistic newspaper photograph, photojournalism style: ${sceneDesc}. Natural lighting, candid moment, high quality documentary photography. Ultra-detailed. Real human proportions. Not an illustration.${cultureGuide}`;
        existingImageUrls = undefined;
      }

      try {
        const imgResult = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt,
          ...(existingImageUrls && existingImageUrls.length > 0 ? { existing_image_urls: existingImageUrls } : {}),
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

    // Section images — ONLY when the LLM provided a non-null image_prompt
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