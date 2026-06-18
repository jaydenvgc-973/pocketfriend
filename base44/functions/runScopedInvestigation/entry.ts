import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════════════════════
// runScopedInvestigation
//
// SCOPED ACCESS RULE:
//   This function accesses sensitive entity records (Conversation, Message,
//   CharacterRelationship, CharacterMemory, StoryEvent) ONLY within the scope
//   of a specific investigation. It does NOT grant permanent unrestricted
//   access. It returns evidence-labeled findings — not raw data dumps.
//
// SEPARATION RULE:
//   Vick Servicio is the investigating authority. The function performs the
//   sensitive-record inspection. Findings are returned in summary form with
//   labeled evidence sources. Unrelated private content is not exposed.
//
// SCOPE PARAMETERS:
//   characterId (required) — which character is being investigated
//   scope (required) — what to investigate:
//     "conversations"     — conversation records for this character
//     "messages"          — recent messages involving this character
//     "relationships"     — relationship records for this character
//     "memories"          — character memory records
//     "story_events"      — story events involving this character
//     "full"              — all of the above
//   limit (optional)      — max records per scope (default: 20)
//   ownerEmail (optional) — filter to specific account
//
// RETURN FORMAT:
//   Each scope returns:
//   {
//     scope: "conversations" | "messages" | etc.,
//     status: "found" | "empty" | "access_denied" | "error",
//     count: number,
//     finding: string,         // evidence-labeled summary
//     evidence_source: string, // exact entity + field path
//     evidence_type: "observed" | "inferred" | "unknown",
//     detail: [] | null,       // trimmed findings, never raw dumps
//   }
// ═══════════════════════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json().catch(() => ({}));

    const characterId = payload.characterId || payload.character_id;
    const scope = payload.scope || 'full';
    const limit = payload.limit || 20;
    const ownerEmail = payload.ownerEmail || payload.owner_email || null;

    if (!characterId) {
      return new Response(JSON.stringify({ error: 'characterId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verify the target character exists
    const charQuery = ownerEmail
      ? { id: characterId, owner_email: ownerEmail }
      : { id: characterId };
    const chars = await base44.entities.Character.filter(charQuery);
    const character = chars[0] || null;

    if (!character) {
      return new Response(JSON.stringify({
        error: 'Character not found',
        character_id: characterId,
        investigation_status: 'blocked_missing_character',
      }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const results = {};

    // ── CONVERSATIONS ──────────────────────────────────────────────────────
    if (scope === 'conversations' || scope === 'full') {
      try {
        const convos = await base44.asServiceRole.entities.Conversation.filter(
          { character_ids: { $contains: characterId } },
          null,
          limit
        );
        if (convos.length > 0) {
          const convLabels = convos.map(c => ({
            id: c.id,
            title: c.title,
            type: c.type,
            channel: c.channel || null,
            last_message_date: c.last_message_date || null,
            last_preview: c.last_message_preview
              ? c.last_message_preview.slice(0, 80)
              : null,
          }));
          results.conversations = {
            status: 'found',
            count: convos.length,
            finding: `${convos.length} conversation${convos.length > 1 ? 's' : ''} found for ${character.name || characterId}.`,
            evidence_source: 'Conversation entity via asServiceRole',
            evidence_type: 'observed',
            detail: convLabels,
          };
        } else {
          results.conversations = {
            status: 'empty',
            count: 0,
            finding: `No conversations found for ${character.name || characterId}.`,
            evidence_source: 'Conversation entity via asServiceRole',
            evidence_type: 'observed',
            detail: [],
          };
        }
      } catch (e) {
        results.conversations = {
          status: 'access_denied',
          count: 0,
          finding: `Could not access conversation records: ${e.message}`,
          evidence_source: 'Conversation entity',
          evidence_type: 'unknown',
          detail: null,
        };
      }
    }

    // ── RECENT MESSAGES ────────────────────────────────────────────────────
    if (scope === 'messages' || scope === 'full') {
      try {
        // Find conversations first to get their IDs
        const convos = await base44.asServiceRole.entities.Conversation.filter(
          { character_ids: { $contains: characterId } },
          null,
          limit
        );
        const convoIds = convos.map(c => c.id);

        let allMsgs = [];
        if (convoIds.length > 0) {
          // Query messages for each conversation (limited)
          for (const cid of convoIds.slice(0, 3)) {
            const msgs = await base44.asServiceRole.entities.Message.filter(
              { conversation_id: cid },
              '-timestamp',
              10
            );
            allMsgs = allMsgs.concat(msgs);
          }
        }

        if (allMsgs.length > 0) {
          const msgLabels = allMsgs.slice(0, limit).map(m => ({
            id: m.id,
            sender_type: m.sender_type,
            character_name: m.character_name || null,
            content: (m.content || '').slice(0, 100),
            timestamp: m.timestamp || null,
            convo_id: m.conversation_id,
          }));
          results.messages = {
            status: 'found',
            count: allMsgs.length,
            finding: `${allMsgs.length} recent messages found across ${convoIds.length} conversations. Content truncated to 100 chars.`,
            evidence_source: 'Message entity via asServiceRole',
            evidence_type: 'observed',
            detail: msgLabels,
          };
        } else {
          results.messages = {
            status: 'empty',
            count: 0,
            finding: `No recent messages found for ${character.name || characterId}.`,
            evidence_source: 'Message entity via asServiceRole',
            evidence_type: 'observed',
            detail: [],
          };
        }
      } catch (e) {
        results.messages = {
          status: 'access_denied',
          count: 0,
          finding: `Could not access message records: ${e.message}`,
          evidence_source: 'Message entity',
          evidence_type: 'unknown',
          detail: null,
        };
      }
    }

    // ── RELATIONSHIPS ──────────────────────────────────────────────────────
    if (scope === 'relationships' || scope === 'full') {
      try {
        const rels = await base44.asServiceRole.entities.CharacterRelationship.filter(
          { source_character_id: characterId },
          null,
          limit
        );
        if (rels.length > 0) {
          const relLabels = rels.map(r => ({
            id: r.id,
            target_id: r.target_character_id,
            type: r.relationship_type,
            label: r.label_from_source_perspective || null,
            friendship: r.friendship_level,
            trust: r.trust_level,
            tension: r.tension_level,
          }));
          results.relationships = {
            status: 'found',
            count: rels.length,
            finding: `${rels.length} relationship${rels.length > 1 ? 's' : ''} found for ${character.name || characterId}.`,
            evidence_source: 'CharacterRelationship entity via asServiceRole',
            evidence_type: 'observed',
            detail: relLabels,
          };
        } else {
          results.relationships = {
            status: 'empty',
            count: 0,
            finding: `No relationships found for ${character.name || characterId}.`,
            evidence_source: 'CharacterRelationship entity via asServiceRole',
            evidence_type: 'observed',
            detail: [],
          };
        }
      } catch (e) {
        results.relationships = {
          status: 'access_denied',
          count: 0,
          finding: `Could not access relationship records: ${e.message}`,
          evidence_source: 'CharacterRelationship entity',
          evidence_type: 'unknown',
          detail: null,
        };
      }
    }

    // ── CHARACTER MEMORIES ─────────────────────────────────────────────────
    if (scope === 'memories' || scope === 'full') {
      try {
        const mems = await base44.asServiceRole.entities.CharacterMemory.filter(
          { character_id: characterId },
          null,
          limit
        );
        if (mems.length > 0) {
          const memLabels = mems.map(m => ({
            id: m.id,
            type: m.memory_type,
            summary: (m.memory_summary || m.memory_text || '').slice(0, 100),
            importance: m.importance_score,
            permanence: m.permanence,
            validation: m.validation_status,
          }));
          results.memories = {
            status: 'found',
            count: mems.length,
            finding: `${mems.length} memor${mems.length > 1 ? 'ies' : 'y'} found for ${character.name || characterId}. Summaries only — full memory text not returned.`,
            evidence_source: 'CharacterMemory entity via asServiceRole',
            evidence_type: 'observed',
            detail: memLabels,
          };
        } else {
          results.memories = {
            status: 'empty',
            count: 0,
            finding: `No memories found for ${character.name || characterId}.`,
            evidence_source: 'CharacterMemory entity via asServiceRole',
            evidence_type: 'observed',
            detail: [],
          };
        }
      } catch (e) {
        results.memories = {
          status: 'access_denied',
          count: 0,
          finding: `Could not access memory records: ${e.message}`,
          evidence_source: 'CharacterMemory entity',
          evidence_type: 'unknown',
          detail: null,
        };
      }
    }

    // ── STORY EVENTS ───────────────────────────────────────────────────────
    if (scope === 'story_events' || scope === 'full') {
      try {
        const events = await base44.asServiceRole.entities.StoryEvent.filter(
          { participant_character_ids: { $contains: characterId } },
          null,
          limit
        );
        if (events.length > 0) {
          const evLabels = events.map(e => ({
            id: e.id,
            title: e.title,
            date: e.event_date,
            status: e.status,
            preview: (e.narrative_preview || e.generated_narrative || '').slice(0, 100),
            venue: e.venue_name || null,
          }));
          results.story_events = {
            status: 'found',
            count: events.length,
            finding: `${events.length} story event${events.length > 1 ? 's' : ''} found for ${character.name || characterId}.`,
            evidence_source: 'StoryEvent entity via asServiceRole',
            evidence_type: 'observed',
            detail: evLabels,
          };
        } else {
          results.story_events = {
            status: 'empty',
            count: 0,
            finding: `No story events found for ${character.name || characterId}.`,
            evidence_source: 'StoryEvent entity via asServiceRole',
            evidence_type: 'observed',
            detail: [],
          };
        }
      } catch (e) {
        results.story_events = {
          status: 'access_denied',
          count: 0,
          finding: `Could not access story event records: ${e.message}`,
          evidence_source: 'StoryEvent entity',
          evidence_type: 'unknown',
          detail: null,
        };
      }
    }

    return new Response(JSON.stringify({
      investigation_scope: scope,
      character_id: characterId,
      character_name: character.name,
      results,
      separation_notice: 'This function accessed sensitive records via service role. Findings are evidence-labeled and summarized. Raw private content is not included in this response. Full message bodies, complete memory text, and narrative content are not returned.',
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message,
      investigation_status: 'failed',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});