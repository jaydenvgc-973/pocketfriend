import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * backfillConversationOwnerEmail
 * 
 * Stamps owner_email on all existing Conversation records that are missing it.
 * 
 * Strategy (batch, no per-record character fetches):
 * 1. Fetch all Characters (service role) → build id→owner_email map.
 * 2. Fetch all Conversations (service role) → filter to those missing owner_email.
 * 3. For each missing Conversation, resolve owner_email from the character map
 *    using character_ids[0].
 * 4. Batch-update in parallel (throttled to avoid rate limits).
 * 
 * Orphaned conversations (character deleted) are logged as failures but not deleted.
 * This is idempotent — already-stamped records are skipped.
 * Admin-only.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Step 1: Bulk-fetch ALL characters to build an in-memory id→owner_email map.
    // Use service role so we see all users' characters.
    console.log('[backfill] Fetching all characters...');
    const allCharacters = await base44.asServiceRole.entities.Character.list('-created_date', 2000);
    const charOwnerMap = {};
    for (const c of allCharacters) {
      if (c.id && c.owner_email) {
        charOwnerMap[c.id] = c.owner_email;
      }
    }
    console.log(`[backfill] Built owner map for ${Object.keys(charOwnerMap).length} characters (total fetched: ${allCharacters.length})`);

    // Step 2: Fetch all Conversations
    console.log('[backfill] Fetching all conversations...');
    const allConversations = await base44.asServiceRole.entities.Conversation.list('-created_date', 2000);
    const missing = allConversations.filter(c => !c.owner_email);
    console.log(`[backfill] ${missing.length} of ${allConversations.length} conversations missing owner_email`);

    if (missing.length === 0) {
      return Response.json({
        success: true,
        message: 'All Conversation records already have owner_email.',
        total: allConversations.length,
        backfilled: 0,
        failed: 0,
        failures: [],
      });
    }

    // Step 3: Resolve owner_email for each missing conversation from the map
    const toUpdate = [];
    const failures = [];

    for (const convo of missing) {
      const characterId = convo.character_ids?.[0];

      if (!characterId) {
        failures.push({ id: convo.id, reason: 'no_character_ids' });
        continue;
      }

      const ownerEmail = charOwnerMap[characterId];

      if (!ownerEmail) {
        // Character either deleted or missing owner_email itself
        failures.push({ id: convo.id, characterId, reason: 'character_not_found_or_missing_owner_email' });
        continue;
      }

      toUpdate.push({ id: convo.id, owner_email: ownerEmail });
    }

    console.log(`[backfill] ${toUpdate.length} conversations to update, ${failures.length} unresolvable`);

    // Step 4: Update in small parallel batches to avoid rate limits
    const BATCH_SIZE = 5;
    let backfilled = 0;
    let updateFailures = 0;

    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const batch = toUpdate.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(item =>
          base44.asServiceRole.entities.Conversation.update(item.id, { owner_email: item.owner_email })
        )
      );

      for (let j = 0; j < results.length; j++) {
        if (results[j].status === 'fulfilled') {
          backfilled++;
        } else {
          updateFailures++;
          failures.push({ id: batch[j].id, reason: `update_error: ${results[j].reason?.message || 'unknown'}` });
          console.error(`[backfill] Failed to update conversation id=${batch[j].id}: ${results[j].reason?.message}`);
        }
      }

      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < toUpdate.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    console.log(`[backfill] Complete. backfilled=${backfilled} unresolvable=${failures.length - updateFailures} update_failed=${updateFailures}`);

    return Response.json({
      success: true,
      total_conversations: allConversations.length,
      missing_before: missing.length,
      backfilled,
      unresolvable: failures.length - updateFailures,
      update_failed: updateFailures,
      failures: failures.slice(0, 100),
    });

  } catch (error) {
    console.error('[backfillConversationOwnerEmail] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});