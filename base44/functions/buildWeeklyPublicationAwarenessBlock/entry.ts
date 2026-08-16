/**
 * buildWeeklyPublicationAwarenessBlock
 *
 * Extracted helper for buildCanonicalCharacterContext.
 *
 * Reads published WeeklyPublication editions and returns a formatted awareness
 * block containing ONLY the published newspaper content — headlines, article
 * bodies, and Around Town briefs.
 *
 * This is the PUBLIC-WORLD KNOWLEDGE boundary:
 *   Published Weekly content → public world knowledge → characters can know it.
 *   Underlying source records (StoryEvents, CommunityEvents, etc.) → private → NOT included.
 *
 * The block contains only what a person living in the world could know from
 * reading the local newspaper. No source record IDs, no private character data,
 * no unpublished details.
 *
 * READ-ONLY. No records are created, updated, or deleted.
 * Works without a user session (automation callers) — WeeklyPublication has read: true RLS.
 *
 * Returns:
 *   awarenessBlock   — string to inject into the canonical prompt
 *   editionCount     — number of editions included
 *   latestEditionDate — ISO date of the most recent edition
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Soft auth — automation callers may not have a user session.
    await base44.auth.me().catch(() => null);

    let body = {};
    try { body = await req.json(); } catch (_) { /* no body */ }
    const { characterName = '' } = body;

    // ── LOAD PUBLISHED EDITIONS ──────────────────────────────────────────
    // Load recent published editions. WeeklyPublication has read: true RLS,
    // so all accounts can read all published editions — this is correct for
    // a world-level public newspaper.
    const allEditions = await base44.asServiceRole.entities.WeeklyPublication
      .filter({ status: 'published' }, '-edition_date', 20)
      .catch(() => []);

    if (!allEditions || allEditions.length === 0) {
      return Response.json({
        awarenessBlock: '',
        editionCount: 0,
        latestEditionDate: null,
      });
    }

    // Deduplicate by edition_date — if both official and manual_refresh exist
    // for the same week, keep the one with the most recent published_at/refreshed_at.
    const byDate = new Map();
    for (const ed of allEditions) {
      if (!ed.edition_date) continue;
      const existing = byDate.get(ed.edition_date);
      if (!existing) {
        byDate.set(ed.edition_date, ed);
      } else {
        const existingTs = new Date(existing.refreshed_at || existing.published_at || existing.created_at || 0).getTime();
        const newTs = new Date(ed.refreshed_at || ed.published_at || ed.created_at || 0).getTime();
        if (newTs > existingTs) byDate.set(ed.edition_date, ed);
      }
    }

    // Sort by edition_date descending, take the last 3
    const recentEditions = [...byDate.values()]
      .sort((a, b) => new Date(b.edition_date) - new Date(a.edition_date))
      .slice(0, 3);

    if (recentEditions.length === 0) {
      return Response.json({
        awarenessBlock: '',
        editionCount: 0,
        latestEditionDate: null,
      });
    }

    // ── FORMAT AWARENESS BLOCK ───────────────────────────────────────────
    // Include ONLY published content: headlines, article bodies, Around Town.
    // Do NOT include: story_event_ids, character_ids, image_urls, image_prompts,
    // publication_type, or any internal metadata.
    const editionBlocks = [];

    for (const ed of recentEditions) {
      const lines = [];
      const edDate = new Date(ed.edition_date).toLocaleDateString('en-US', {
        timeZone: 'America/New_York',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      const edNum = ed.edition_number ? ` (Edition #${ed.edition_number})` : '';
      lines.push(`━━━ THE WEEKLY — ${edDate}${edNum} ━━━`);

      // Headliner
      if (ed.headliner && ed.headliner.title) {
        lines.push(`LEAD STORY: ${ed.headliner.title}`);
        if (ed.headliner.subtitle) lines.push(`  ${ed.headliner.subtitle}`);
        if (ed.headliner.body) {
          lines.push(`  ${ed.headliner.body.substring(0, 600)}`);
        }
        if (ed.headliner.pull_quote) {
          lines.push(`  Pull quote: "${ed.headliner.pull_quote}"`);
        }
        // Character names are publicly published in the newspaper — anyone reading
        // the paper sees these names. Include them as public knowledge.
        if (ed.headliner.character_names && ed.headliner.character_names.length > 0) {
          lines.push(`  People mentioned: ${ed.headliner.character_names.join(', ')}`);
        }
      }

      // Sections
      const sections = ed.sections || [];
      for (const s of sections) {
        if (!s.title) continue;
        lines.push(`  • ${s.title}`);
        if (s.body) {
          lines.push(`    ${s.body.substring(0, 400)}`);
        }
        if (s.character_names && s.character_names.length > 0) {
          lines.push(`    People mentioned: ${s.character_names.join(', ')}`);
        }
      }

      // Around Town
      const aroundTown = ed.around_town || [];
      if (aroundTown.length > 0) {
        lines.push(`  AROUND TOWN:`);
        for (const item of aroundTown) {
          if (item.text) lines.push(`    - ${item.text}`);
        }
      }

      editionBlocks.push(lines.join('\n'));
    }

    const awarenessBlock = `
════════════════════════════════════
THE WEEKLY — YOUR LOCAL NEWSPAPER (PUBLIC WORLD KNOWLEDGE)
Source: Published editions of "The Weekly." This is your local community newspaper. The information below is PUBLIC — anyone living in this world who reads the paper or hears about it can know these things.
════════════════════════════════════
${editionBlocks.join('\n\n')}

RULES — HOW TO USE THIS KNOWLEDGE:
• You KNOW these things because they were published in the local newspaper. You may have read the paper, heard about it from someone, or seen it discussed. This is normal public awareness.
• You CAN reference this information when it is naturally relevant — congratulating someone for a reported accomplishment, discussing a community event, mentioning a story you read, reacting to public news.
• Do NOT force newspaper content into every conversation. Do NOT randomly announce headlines. Do NOT prepend newspaper summaries. Only reference this knowledge when it fits what you are actually discussing.
• If a later edition corrects or updates an earlier report, the newer publication is the current truth. You understand corrections as corrections — not as contradictions.
• You know what the NEWSPAPER reported — not everything that happened behind the scenes. Do NOT claim knowledge of unpublished details, private conversations, or internal records merely because the newspaper exists.
• Character names listed above are publicly known from the newspaper. You may recognize them as "the person from that article" when relevant. This does NOT give you private knowledge of their personal life beyond what was published.
════════════════════════════════════`;

    console.log(
      `[buildWeeklyPublicationAwarenessBlock] char=${characterName}` +
      ` | editions=${recentEditions.length}` +
      ` | latest=${recentEditions[0]?.edition_date || 'none'}`
    );

    return Response.json({
      awarenessBlock,
      editionCount: recentEditions.length,
      latestEditionDate: recentEditions[0]?.edition_date || null,
    });

  } catch (error) {
    console.error(`[buildWeeklyPublicationAwarenessBlock] error: ${error.message}`);
    return Response.json({
      awarenessBlock: '',
      editionCount: 0,
      latestEditionDate: null,
      error: error.message,
    }, { status: 500 });
  }
});