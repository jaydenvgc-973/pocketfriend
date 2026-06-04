/**
 * proofRegenMessageLookup
 *
 * Targeted proof: find a real image message for this user and test
 * whether get() and filter() can both retrieve it, mimicking what
 * regenerateImageWithReason does at line 814.
 *
 * Also tests the $exists:false filter on a real conversation with messages.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));

    // ── Step 1: Find a real image message for this user ───────────────────────
    // Scan recent conversations to find one with an image message
    const convos = await base44.entities.Conversation.filter(
      { owner_email: user.email },
      '-last_message_date',
      10
    ).catch(() => []);

    let imageMsgId = null;
    let imageMsgConvoId = null;
    let imageMsg = null;

    for (const c of convos) {
      if (!c.id) continue;
      const msgs = await base44.entities.Message.filter(
        { conversation_id: c.id },
        '-created_date',
        20
      ).catch(() => []);
      const imgMsg = msgs.find(m => m.image_url && m.generation_context);
      if (imgMsg) {
        imageMsgId = imgMsg.id;
        imageMsgConvoId = c.id;
        imageMsg = imgMsg;
        break;
      }
    }

    if (!imageMsgId) {
      return Response.json({
        success: false,
        message: 'No image message with generation_context found in recent conversations',
        convos_scanned: convos.length,
      });
    }

    console.log(`[proofRegenMessageLookup] Found image message: id=${imageMsgId} convo=${imageMsgConvoId}`);

    // ── Step 2: Test get() — what regenerateImageWithReason line 1902 uses ────
    const getResult = await base44.asServiceRole.entities.Message.get(imageMsgId).catch(e => ({ _error: e.message }));

    // ── Step 3: Test filter({ id }) — what line 814 uses (the broken path) ────
    const filterResult = await base44.asServiceRole.entities.Message.filter(
      { id: imageMsgId },
      null,
      1
    ).catch(e => ({ _error: e.message }));

    // ── Step 4: Test $exists:false on this real conversation ──────────────────
    // First get count without filter
    const allInConvo = await base44.entities.Message.filter(
      { conversation_id: imageMsgConvoId },
      '-created_date',
      50
    ).catch(e => ({ _error: e.message }));

    // Then with $exists:false
    const nonArchivedInConvo = await base44.entities.Message.filter(
      { conversation_id: imageMsgConvoId, archived_date: { $exists: false } },
      '-created_date',
      50
    ).catch(e => ({ _error: e.message }));

    // ── Step 5: Check if filter({ id }) at line 814 would actually work ───────
    // The current code: filter({ id: messageId }, null, 1).catch(() => [])
    // If filter throws on a valid ID (non-array response), catch returns []
    // meaning message = undefined → 404
    const filterRawError = filterResult?._error || null;
    const filterWorked = Array.isArray(filterResult) && filterResult.length > 0;
    const getWorked = getResult && !getResult._error && getResult.id === imageMsgId;

    return Response.json({
      success: true,
      found_image_message: {
        id: imageMsgId,
        conversation_id: imageMsgConvoId,
        has_image_url: !!imageMsg.image_url,
        has_generation_context: !!imageMsg.generation_context,
        image_url_preview: imageMsg.image_url?.substring(0, 80),
        char_id_in_context: imageMsg.generation_context?.character_id || null,
        location_name_in_context: imageMsg.generation_context?.location_name || null,
      },
      lookup_comparison: {
        // get() result — used by line 1902 (post-generation verify, works)
        get_worked: getWorked,
        get_error: getResult?._error || null,
        // filter() result — used by line 814 (initial lookup, potentially broken)
        filter_worked: filterWorked,
        filter_error: filterRawError,
        filter_returned_array: Array.isArray(filterResult),
        filter_array_length: Array.isArray(filterResult) ? filterResult.length : null,
        // Does line 814's pattern work?
        line_814_pattern_would_find_message: filterWorked,
        line_814_pattern_would_404: !filterWorked,
        // Recommendation
        safe_lookup_pattern: getWorked
          ? 'Use get() as primary — already works at line 1902. Line 814 should mirror it.'
          : 'Neither method reliable — investigate RLS scope',
      },
      exists_filter_proof: {
        conversation_id: imageMsgConvoId,
        all_messages_count: Array.isArray(allInConvo) ? allInConvo.length : `error: ${allInConvo?._error}`,
        non_archived_count: Array.isArray(nonArchivedInConvo) ? nonArchivedInConvo.length : `error: ${nonArchivedInConvo?._error}`,
        exists_false_syntax_accepted: !nonArchivedInConvo?._error,
        exists_false_error: nonArchivedInConvo?._error || null,
        archived_in_non_archived_result: Array.isArray(nonArchivedInConvo)
          ? nonArchivedInConvo.filter(m => m.archived_date != null).length
          : null,
      },
    });

  } catch (error) {
    console.error('[proofRegenMessageLookup] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});