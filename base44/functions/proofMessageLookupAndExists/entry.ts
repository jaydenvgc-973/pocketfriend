/**
 * proofMessageLookupAndExists
 *
 * Proof function for two open questions:
 * 1. Does Base44 support { archived_date: { $exists: false } } filter syntax?
 * 2. Does Message.get(id) return a record that filter({ id }) also returns?
 *
 * This function:
 *   - Takes a known conversation ID and fetches messages with $exists:false
 *   - Compares results vs filter without the $exists clause
 *   - Takes a known message ID and compares get() vs filter({ id }) results
 *   - Reports exact counts and any discrepancies
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { conversation_id, message_id } = body;

    const results = {};

    // ── PROOF 1: $exists: false filter syntax ─────────────────────────────────
    if (conversation_id) {
      // Fetch WITHOUT $exists filter
      const allMsgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id },
        '-created_date',
        50
      ).catch(e => ({ error: e.message }));

      // Fetch WITH $exists: false filter
      const nonArchivedMsgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id, archived_date: { $exists: false } },
        '-created_date',
        50
      ).catch(e => ({ error: e.message }));

      // Fetch WITH $exists: true filter (archived only)
      const archivedMsgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id, archived_date: { $exists: true } },
        '-created_date',
        50
      ).catch(e => ({ error: e.message }));

      const allCount = Array.isArray(allMsgs) ? allMsgs.length : 'ERROR';
      const nonArchivedCount = Array.isArray(nonArchivedMsgs) ? nonArchivedMsgs.length : 'ERROR';
      const archivedCount = Array.isArray(archivedMsgs) ? archivedMsgs.length : 'ERROR';

      // Check for archived messages that leaked into $exists:false result
      const leaked = Array.isArray(nonArchivedMsgs)
        ? nonArchivedMsgs.filter(m => m.archived_date != null)
        : [];

      // Check for non-archived messages in $exists:true result
      const misclassified = Array.isArray(archivedMsgs)
        ? archivedMsgs.filter(m => m.archived_date == null)
        : [];

      results.exists_filter_proof = {
        conversation_id,
        all_messages_count: allCount,
        non_archived_count: nonArchivedCount,
        archived_count: archivedCount,
        exists_false_filter_worked: !Array.isArray(nonArchivedMsgs) ? false : nonArchivedMsgs.length <= (Array.isArray(allMsgs) ? allMsgs.length : 0),
        exists_true_filter_worked: !Array.isArray(archivedMsgs) ? false : true,
        leaked_archived_in_non_archived_result: leaked.length,
        misclassified_non_archived_in_archived_result: misclassified.length,
        syntax_accepted: !nonArchivedMsgs?.error,
        error_if_any: nonArchivedMsgs?.error || null,
        // Sample: first 3 non-archived messages (check archived_date is null/undefined)
        sample_non_archived: Array.isArray(nonArchivedMsgs)
          ? nonArchivedMsgs.slice(0, 3).map(m => ({
              id: m.id,
              archived_date: m.archived_date ?? null,
              content_preview: (m.content || '').substring(0, 40),
            }))
          : [],
        // Sample: first 3 archived messages (check archived_date is set)
        sample_archived: Array.isArray(archivedMsgs)
          ? archivedMsgs.slice(0, 3).map(m => ({
              id: m.id,
              archived_date: m.archived_date ?? null,
              content_preview: (m.content || '').substring(0, 40),
            }))
          : [],
      };

      console.log(`[proofMessageLookupAndExists] $exists proof: all=${allCount} non_archived=${nonArchivedCount} archived=${archivedCount} leaked=${leaked.length}`);
    } else {
      results.exists_filter_proof = { skipped: 'no conversation_id provided' };
    }

    // ── PROOF 2: Message.get(id) vs filter({ id }) ────────────────────────────
    if (message_id) {
      // Method A: direct get()
      const getResult = await base44.asServiceRole.entities.Message.get(message_id).catch(e => ({ error: e.message }));

      // Method B: filter({ id })
      const filterResult = await base44.asServiceRole.entities.Message.filter(
        { id: message_id },
        null,
        1
      ).catch(e => ({ error: e.message }));

      const getFound = getResult && !getResult.error;
      const filterFound = Array.isArray(filterResult) && filterResult.length > 0;
      const filterMsg = filterFound ? filterResult[0] : null;

      results.message_lookup_proof = {
        message_id,
        get_found: getFound,
        filter_found: filterFound,
        get_error: getResult?.error || null,
        filter_error: filterResult?.error || null,
        id_match: getFound && filterFound
          ? getResult.id === filterMsg.id
          : null,
        get_has_image_url: getFound ? !!getResult.image_url : null,
        filter_has_image_url: filterFound ? !!filterMsg.image_url : null,
        get_has_generation_context: getFound ? !!getResult.generation_context : null,
        filter_has_generation_context: filterFound ? !!filterMsg.generation_context : null,
        // Critical: does get() work when filter() would also work?
        both_methods_consistent: getFound && filterFound
          ? getResult.id === filterMsg.id
          : null,
        recommendation: getFound
          ? 'get() works — use as primary with filter() fallback'
          : (filterFound ? 'get() failed but filter() succeeded — filter() is the safer path' : 'both failed — message does not exist'),
      };

      console.log(`[proofMessageLookupAndExists] Lookup proof: get_found=${getFound} filter_found=${filterFound} id=${message_id}`);
    } else {
      results.message_lookup_proof = { skipped: 'no message_id provided' };
    }

    // ── PROOF 3: Does filter({ id: nonexistent }) return 404 or empty array? ──
    const ghostId = 'NONEXISTENT_ID_TEST_12345_PROOF';
    const ghostFilter = await base44.asServiceRole.entities.Message.filter(
      { id: ghostId },
      null,
      1
    ).catch(e => ({ error: e.message }));
    const ghostGet = await base44.asServiceRole.entities.Message.get(ghostId).catch(e => ({ error: e.message }));

    results.nonexistent_id_behavior = {
      ghost_id: ghostId,
      filter_returns: Array.isArray(ghostFilter) ? `empty array (length ${ghostFilter.length})` : `error: ${ghostFilter?.error}`,
      get_returns: ghostGet?.error ? `error: ${ghostGet.error}` : (ghostGet ? 'object (unexpected)' : 'null/undefined'),
      filter_safe_for_nonexistent: Array.isArray(ghostFilter) && ghostFilter.length === 0,
      get_safe_for_nonexistent: !!ghostGet?.error,
    };

    console.log(`[proofMessageLookupAndExists] Ghost ID behavior: filter=${JSON.stringify(results.nonexistent_id_behavior.filter_returns)} get=${JSON.stringify(results.nonexistent_id_behavior.get_returns)}`);

    return Response.json({ success: true, proof: results });

  } catch (error) {
    console.error('[proofMessageLookupAndExists] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});