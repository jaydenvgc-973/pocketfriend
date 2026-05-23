/**
 * diagnoseCursorBehavior
 *
 * Tests the compound cursor behavior in fetchMediaGalleryPage:
 * 1. Fetch first batch of 200 messages (no cursor)
 * 2. Get the oldest message's date and id
 * 3. Fetch next batch using compound cursor
 * 4. Verify the next batch returns messages older than the cursor
 * 5. Count images per batch
 *
 * Identifies if the $or compound cursor is the cause of the collapse.
 * DIAGNOSTIC ONLY — no writes.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;

    const conversations = await base44.entities.Conversation.filter(
      { created_by: ownerEmail },
      '-created_date', 500
    );
    const conversationIds = (conversations || []).map(c => c.id).filter(Boolean);
    console.log(`[diagnoseCursorBehavior] ${conversationIds.length} conversations`);

    const batches = [];

    // Batch 1: no cursor
    const b1 = await base44.asServiceRole.entities.Message.filter(
      { conversation_id: { $in: conversationIds } },
      '-created_date',
      200
    );
    const b1_images = (b1 || []).filter(m => m.image_url && !m.recovery_signal).length;
    const b1_oldest = b1?.[b1.length - 1];
    batches.push({
      batch: 1,
      msg_count: b1?.length || 0,
      image_count: b1_images,
      oldest_date: b1_oldest?.created_date,
      oldest_id: b1_oldest?.id,
      newest_date: b1?.[0]?.created_date,
    });

    console.log(`[diagnoseCursorBehavior] B1: ${b1?.length} msgs, ${b1_images} images, oldest=${b1_oldest?.created_date}`);

    if (!b1_oldest?.created_date) {
      return Response.json({ error: 'No messages in batch 1', batches }, { status: 400 });
    }

    // Batch 2: compound cursor using $or
    const cursorDate = b1_oldest.created_date;
    const cursorId = b1_oldest.id;

    const b2_query_compound = {
      conversation_id: { $in: conversationIds },
      $or: [
        { created_date: { $lt: cursorDate } },
        { created_date: cursorDate, id: { $lt: cursorId || '' } },
      ],
    };

    let b2_compound;
    try {
      b2_compound = await base44.asServiceRole.entities.Message.filter(
        b2_query_compound,
        '-created_date',
        200
      );
    } catch (e) {
      b2_compound = null;
      batches.push({ batch: '2_compound', error: e.message });
    }

    if (b2_compound !== null) {
      const b2_images = (b2_compound || []).filter(m => m.image_url && !m.recovery_signal).length;
      const b2_oldest = b2_compound?.[b2_compound.length - 1];
      batches.push({
        batch: '2_compound_cursor',
        msg_count: b2_compound?.length || 0,
        image_count: b2_images,
        oldest_date: b2_oldest?.created_date,
        oldest_id: b2_oldest?.id,
        newest_date: b2_compound?.[0]?.created_date,
        cursor_used: { date: cursorDate, id: cursorId },
        notes: b2_compound?.length === 0 ? 'EMPTY — compound cursor returned nothing' : 'OK',
      });
      console.log(`[diagnoseCursorBehavior] B2 compound: ${b2_compound?.length} msgs, ${b2_images} images`);
    }

    // Batch 2 alt: simple $lt cursor (no compound $or)
    const b2_simple = await base44.asServiceRole.entities.Message.filter(
      {
        conversation_id: { $in: conversationIds },
        created_date: { $lt: cursorDate },
      },
      '-created_date',
      200
    );
    const b2_simple_images = (b2_simple || []).filter(m => m.image_url && !m.recovery_signal).length;
    batches.push({
      batch: '2_simple_lt_cursor',
      msg_count: b2_simple?.length || 0,
      image_count: b2_simple_images,
      newest_date: b2_simple?.[0]?.created_date,
      notes: b2_simple?.length === 0 ? 'EMPTY — simple $lt also returned nothing' : 'OK — simple cursor works',
    });
    console.log(`[diagnoseCursorBehavior] B2 simple: ${b2_simple?.length} msgs, ${b2_simple_images} images`);

    // Batch 2 alt: offset pagination
    const b2_offset = await base44.asServiceRole.entities.Message.filter(
      { conversation_id: { $in: conversationIds } },
      '-created_date',
      200,
      200
    );
    const b2_offset_images = (b2_offset || []).filter(m => m.image_url && !m.recovery_signal).length;
    batches.push({
      batch: '2_offset_200',
      msg_count: b2_offset?.length || 0,
      image_count: b2_offset_images,
      newest_date: b2_offset?.[0]?.created_date,
      notes: b2_offset?.length === 0 ? 'EMPTY — offset also returned nothing' : 'OK — offset pagination works',
    });
    console.log(`[diagnoseCursorBehavior] B2 offset: ${b2_offset?.length} msgs, ${b2_offset_images} images`);

    const compoundWorks = b2_compound && b2_compound.length > 0;
    const simpleWorks = b2_simple && b2_simple.length > 0;
    const offsetWorks = b2_offset && b2_offset.length > 0;

    return Response.json({
      diagnostic_date: new Date().toISOString(),
      cursor_test_results: batches,
      conclusion: {
        compound_cursor_works: compoundWorks,
        simple_lt_cursor_works: simpleWorks,
        offset_pagination_works: offsetWorks,
        root_cause: !compoundWorks && simpleWorks
          ? 'COMPOUND_CURSOR_BROKEN: The $or query combining $lt on date + id is not supported or returns empty. Simple $lt cursor works. Switch to simple cursor.'
          : !compoundWorks && !simpleWorks && offsetWorks
          ? 'CURSOR_PAGINATION_BROKEN: Neither compound nor simple cursor works. Only offset works. Investigate DB cursor support.'
          : !compoundWorks && !simpleWorks && !offsetWorks
          ? 'TOTAL_SCAN_FAILURE: All pagination methods return empty after batch 1'
          : compoundWorks
          ? 'COMPOUND_CURSOR_WORKS: cursor pagination is functional'
          : 'UNKNOWN',
      },
    });

  } catch (error) {
    console.error('[diagnoseCursorBehavior] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});