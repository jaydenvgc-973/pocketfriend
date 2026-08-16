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

// Resolve character reference images using the SAME authority as generateImageAsync:
//   1. reference_image_urls (user-uploaded photos) — filtered, no generated_image
//   2. avatar_url fallback — CDN-hosted generated avatars allowed
function resolveCharRefUrls(charRecord) {
  const allRefs = cdnFilter(charRecord.reference_image_urls || []);
  const refUrls = allRefs.filter(url => !url.includes('generated_image'));
  if (refUrls.length > 0) return refUrls.slice(0, 4);
  // Avatar fallback — allow CDN-hosted avatars even if generated_image in URL
  if (charRecord.avatar_url) {
    const avatarPublic = toPublicCDN(charRecord.avatar_url);
    const isCDN = avatarPublic.startsWith('https://media.base44.com/');
    if (isAccessible(avatarPublic) && (isCDN || !avatarPublic.includes('generated_image'))) {
      return [avatarPublic];
    }
  }
  if (charRecord.image_avatar_url) {
    const imgAvatarPublic = toPublicCDN(charRecord.image_avatar_url);
    const isCDN = imgAvatarPublic.startsWith('https://media.base44.com/');
    if (isAccessible(imgAvatarPublic) && (isCDN || !imgAvatarPublic.includes('generated_image'))) {
      return [imgAvatarPublic];
    }
  }
  return [];
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
7. IMAGE GENERATION — TWO SEPARATE DECISIONS:
   DECISION 1 — Should this article have an image?
     - The headliner MUST have an image_prompt (required).
     - Sections: ONLY include an image_prompt when the article is a feature-tier story that naturally warrants a photograph. Most sections should have image_prompt set to null. Do NOT give every section an image.
   DECISION 2 — If an image is present, does it depict an established character?
     - Set "image_depicts_characters" to true if the photograph is intended to visibly depict one or more established characters named in the article (e.g. a portrait, a photo of the character at an event, a character on a campaign shoot).
     - Set it to false if the image is a general environmental/crowd photograph where no particular established character is intended to be identifiable (e.g. a wide shot of a festival, a building exterior, a crowd scene).
   When image_depicts_characters is true:
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

    // ── RESOLVE CHARACTER VISUAL IDENTITIES FOR IMAGE GENERATION ─────────
    // Uses the SAME proven pathway as generateImageAsync: CDN-filtered
    // reference_image_urls first, avatar_url fallback. Raw URLs that are
    // private/signed/internal are rejected — the image generator cannot
    // fetch them, so they silently fail to influence identity.
    const charsNeedingRef = new Set();
    if (editionData.headliner?.image_prompt && editionData.headliner.image_depicts_characters) {
      for (const id of editionData.headliner.character_ids || []) charsNeedingRef.add(id);
    }
    for (const s of editionData.sections || []) {
      if (s.image_prompt && s.image_depicts_characters) {
        for (const id of s.character_ids || []) charsNeedingRef.add(id);
      }
    }

    // Build a name→id map from source material (deterministic source relationships)
    const nameToIdMap = {};
    for (const m of allMaterial) {
      if (m.type === 'story_event') {
        for (const p of m.participants || []) { if (p.id && p.name) nameToIdMap[p.name] = p.id; }
        for (const f of m.focus_characters || []) { if (f.id && f.name) nameToIdMap[f.name] = f.id; }
      } else if (m.character_id && m.character_name) {
        nameToIdMap[m.character_name] = m.character_id;
      }
    }

    // charKey -> { record, refUrls, appearanceLockText }
    const charRefMap = {};
    for (const charKey of charsNeedingRef) {
      try {
        let resolvedId = charKey;
        // If charKey is a name in the map, use the mapped ID
        if (nameToIdMap[charKey]) resolvedId = nameToIdMap[charKey];

        let chars = await base44.asServiceRole.entities.Character.filter({ id: resolvedId }, null, 1);
        let char = chars?.[0];
        // Fallback: try by name if ID lookup failed
        if (!char) {
          chars = await base44.asServiceRole.entities.Character.filter({ name: resolvedId }, null, 1);
          char = chars?.[0];
        }
        if (char) {
          const refUrls = resolveCharRefUrls(char);
          const appearanceLockText = buildAppearanceLockText(char);
          if (refUrls.length > 0 || appearanceLockText) {
            charRefMap[charKey] = { record: char, refUrls, appearanceLockText };
          }
        }
      } catch (_) { /* non-fatal */ }
    }

    // ── GENERATE ARTICLE IMAGES ────────────────────────────────────────
    // Image generation decision and identity-reference decision are SEPARATE:
    //   - Should this article have an image? → only when image_prompt is non-null
    //   - If image_depicts_characters, supply character refs + identity-lock prompt
    // The headliner always has an image. Sections only when image_prompt is non-null.
    async function generateArticleImage(article) {
      if (!article?.image_prompt) return;

      const sceneDesc = article.image_prompt;
      const depictsChars = article.image_depicts_characters === true;
      const charEntries = [];
      if (depictsChars) {
        for (const id of article.character_ids || []) {
          if (charRefMap[id]) charEntries.push(charRefMap[id]);
        }
      }
      const hasCharRefs = charEntries.length > 0 && charEntries.some(e => e.refUrls.length > 0);

      console.log(`[WeeklyImageGen] article="${article.title?.substring(0, 50)}" depicts_chars=${depictsChars} char_entries=${charEntries.length} has_char_refs=${hasCharRefs}`);
      if (depictsChars && charEntries.length > 0) {
        for (const e of charEntries) {
          console.log(`[WeeklyImageGen]   char="${e.record.name}" ref_urls=${e.refUrls.length} has_lock=${!!e.appearanceLockText}`);
          e.refUrls.forEach((u, i) => console.log(`[WeeklyImageGen]     ref[${i}]: ${u}`));
        }
      }

      let prompt;
      let existingImageUrls;

      if (depictsChars && hasCharRefs) {
        // ── IDENTITY-AWARE PATH: build a prompt that instructs the model ──
        // to use the reference images as face identity photos, exactly like
        // generateImageAsync does. The model must know WHICH images are WHO.
        const allRefUrls = [];
        const subjectBlocks = [];
        let imgIdx = 1;
        for (const entry of charEntries) {
          const charName = entry.record.name || entry.record.display_name || 'the character';
          const refs = entry.refUrls.slice(0, 3);
          if (refs.length === 0) continue;
          const start = imgIdx;
          const end = imgIdx + refs.length - 1;
          const refRange = refs.length === 1 ? `Image ${start}` : `Images ${start}–${end}`;
          allRefUrls.push(...refs);
          const lines = [];
          lines.push(`SUBJECT: "${charName}"`);
          lines.push(`${refRange} are FACE/IDENTITY reference photographs for "${charName}".`);
          lines.push('Extract ONLY: face bone structure, skin tone, eye shape, nose, mouth, hair color/length/style, facial hair, body type.');
          lines.push('⛔ DISCARD: pose, background, clothing, lighting from these photos — face and body identity ONLY.');
          lines.push('⛔ FACE RESEMBLANCE IS MANDATORY: the person in this image MUST be recognizably the same person as shown in the reference photos.');
          lines.push('⛔ DO NOT generate a "similar" person, lookalike, or generic substitute.');
          if (entry.appearanceLockText) {
            lines.push(`APPEARANCE LOCK (ABSOLUTE): ${entry.appearanceLockText}`);
            lines.push('⛔ DO NOT default to Caucasian/white/European. Render EXACTLY the ethnicity and features specified.');
          }
          subjectBlocks.push(lines.join('\n'));
          imgIdx = end + 1;
        }

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
${sceneDesc}

Photorealistic newspaper photograph, photojournalism style. Natural lighting, candid moment, high quality documentary photography. Ultra-detailed. Real human proportions. Not an illustration.

⛔ The visible person(s) MUST match the reference photo identity. GENERATION INVALID if the face could be mistaken for a different person.`;
        existingImageUrls = allRefUrls.slice(0, 6);
      } else {
        // ── GENERAL EVENT IMAGE: no character identity references ──
        prompt = `Realistic newspaper photograph, photojournalism style: ${sceneDesc}. Natural lighting, candid moment, high quality documentary photography. Ultra-detailed. Real human proportions. Not an illustration.`;
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