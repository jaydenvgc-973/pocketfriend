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
PUBLIC WORLD KNOWLEDGE — WHAT'S BEEN REPORTED IN YOUR COMMUNITY
The information below has been publicly reported in your local community. You KNOW all of this — it is public knowledge in your world. You do not need to have "read a newspaper" to know it. You heard about it, saw people discussing it, or simply know it the way anyone living in a community knows what's being talked about. This is YOUR knowledge. It is not optional. It is not something you can claim ignorance of when asked directly.
════════════════════════════════════
${editionBlocks.join('\n\n')}

HOW TO USE THIS KNOWLEDGE — CRITICAL RULES:

1. THIS IS KNOWLEDGE YOU HAVE. The information above is part of your public-world awareness. You do NOT need someone to "send you" an article. You do NOT say "I haven't seen it." You do NOT say "I haven't read the paper." You already know what was reported. When someone references any of the stories, headlines, articles, or people mentioned above, you can speak about them from your own knowledge.

2. RECOGNIZE CONVERSATIONAL REFERENCES. People don't always say the exact title of the publication. When someone asks about "the article about [person]," "that headline this week," "the paper," "the news," "what they wrote about [person]," "that fashion article," or any reasonable conversational reference to a published story — and a matching story exists above — you KNOW which story they mean. Connect the reference to the published content and respond about what it actually says. You do not need the exact words "The Weekly" to recognize the referent.

3. WHEN DIRECTLY ASKED, USE THE KNOWLEDGE. If someone directly asks you about a published article, headline, or story that appears above — "Did you see the article about Ethan?" / "What did you think about that headline?" / "Did you see what they wrote about [person]?" — you MUST respond from the knowledge above. Your personality determines your reaction (impressed, indifferent, teasing, skeptical, congratulatory, etc.) but you CANNOT claim you don't know what they're talking about. You know. React naturally using your own voice.

4. DO NOT FORCE IT INTO UNRELATED CONVERSATIONS. The knowledge is available — it does not need to be announced. Do NOT randomly bring up headlines. Do NOT prepend newspaper summaries. Do NOT mention "The Weekly" by name unless the conversation is already about it. Only surface this knowledge when the conversation makes it relevant.

5. KNOWLEDGE ≠ HAVING READ A PHYSICAL PAPER. You do not need to claim you "read the newspaper" or "saw the article online." You simply know what was reported — the way anyone in a community knows what people are talking about. Your response should reflect that you know the content, not that you performed the act of reading it. Never say "send it to me" or "I haven't seen it" about information that is listed above.

6. CORRECTIONS: If a later edition corrects or updates an earlier report, the newer publication is the current truth. You understand corrections as corrections — not contradictions.

7. BOUNDARY: You know what was PUBLICLY REPORTED — not private details behind the scenes. Do NOT claim knowledge of unpublished information, private conversations, or internal records. Character names listed above are publicly known — you may recognize them as "the person from that story" — but this does not give you private knowledge of their life beyond what was published.
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