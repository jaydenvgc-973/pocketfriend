/**
 * diagnosticMediaGalleryConversationStability
 *
 * Tests whether the Conversation list is stable between calls.
 * If conversation order/count changes, the subsequent message scan will produce different results.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;
    const results = [];

    // Call 1: Get conversations
    const c1 = await base44.asServiceRole.entities.Conversation.filter(
      { created_by: ownerEmail },
      '-created_date',
      500
    );
    results.push({
      call: 1,
      count: c1.length,
      firstId: c1[0]?.id,
      lastId: c1[c1.length - 1]?.id,
      firstDate: c1[0]?.created_date,
      lastDate: c1[c1.length - 1]?.created_date,
    });

    // Small delay
    await new Promise(r => setTimeout(r, 100));

    // Call 2: Get conversations again
    const c2 = await base44.asServiceRole.entities.Conversation.filter(
      { created_by: ownerEmail },
      '-created_date',
      500
    );
    results.push({
      call: 2,
      count: c2.length,
      firstId: c2[0]?.id,
      lastId: c2[c2.length - 1]?.id,
      firstDate: c2[0]?.created_date,
      lastDate: c2[c2.length - 1]?.created_date,
    });

    // Compare
    const same = c1.length === c2.length && c1[0]?.id === c2[0]?.id && c1[c1.length - 1]?.id === c2[c2.length - 1]?.id;

    return Response.json({
      results,
      same,
      conclusion: same ? 'Conversations are stable' : 'UNSTABLE: Conversation list differs between calls!',
      firstCallIds: c1.map(c => c.id),
      secondCallIds: c2.map(c => c.id),
      differenceMissing: c1.filter(c => !c2.find(c2 => c2.id === c.id)).length,
      differenceNew: c2.filter(c => !c1.find(c1 => c1.id === c.id)).length,
    });

  } catch (error) {
    console.error('[diagnosticMediaGalleryConversationStability] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});