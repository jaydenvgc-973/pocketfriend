/**
 * diagnoseGalleryOwnershipGap
 *
 * Diagnoses the gap between:
 *   - fetchMediaGalleryPage (uses created_by on Conversation = 169)
 *   - testPaginationUniqueness (uses owner_email on Conversation = 179)
 *
 * Finds the 10 missing conversations and checks if they contain images.
 * DIAGNOSTIC ONLY — no writes.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;

    // Get both sets
    const [byOwnerEmail, byCreatedBy] = await Promise.all([
      base44.entities.Conversation.filter({ owner_email: ownerEmail }, '-created_date', 500),
      base44.entities.Conversation.filter({ created_by: ownerEmail }, '-created_date', 500),
    ]);

    const ownerEmailIds = new Set((byOwnerEmail || []).map(c => c.id));
    const createdByIds = new Set((byCreatedBy || []).map(c => c.id));

    // Conversations in owner_email but NOT in created_by (the gap)
    const inOwnerEmailOnly = [...ownerEmailIds].filter(id => !createdByIds.has(id));
    // Conversations in created_by but NOT in owner_email
    const inCreatedByOnly = [...createdByIds].filter(id => !ownerEmailIds.has(id));

    console.log(`[diagnoseGalleryOwnershipGap] owner_email: ${ownerEmailIds.size} | created_by: ${createdByIds.size}`);
    console.log(`[diagnoseGalleryOwnershipGap] in owner_email only: ${inOwnerEmailOnly.length}`);
    console.log(`[diagnoseGalleryOwnershipGap] in created_by only: ${inCreatedByOnly.length}`);

    // For each gap conversation, check if it has image messages
    const gapConvosWithImages = [];
    for (const convoId of inOwnerEmailOnly.slice(0, 20)) {
      const msgs = await base44.entities.Message.filter(
        { conversation_id: convoId },
        '-created_date',
        50
      );
      const imgMsgs = (msgs || []).filter(m => m.image_url);
      if (imgMsgs.length > 0) {
        const c = (byOwnerEmail || []).find(c => c.id === convoId);
        gapConvosWithImages.push({
          convo_id: convoId,
          convo_type: c?.type,
          image_count: imgMsgs.length,
          sample_image_url: imgMsgs[0]?.image_url?.substring(0, 60),
        });
      }
    }

    // Total image count from owner_email path
    const allOwnerEmailConvoIds = [...ownerEmailIds];
    let ownerEmailImageCount = 0;
    const batchSize = 200;
    for (let offset = 0; offset < 10000; offset += batchSize) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: { $in: allOwnerEmailConvoIds } },
        '-created_date',
        batchSize,
        offset
      );
      if (!msgs || msgs.length === 0) break;
      ownerEmailImageCount += msgs.filter(m => m.image_url && !m.recovery_signal).length;
      if (msgs.length < batchSize) break;
    }

    // Total image count from created_by path
    const allCreatedByConvoIds = [...createdByIds];
    let createdByImageCount = 0;
    for (let offset = 0; offset < 10000; offset += batchSize) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: { $in: allCreatedByConvoIds } },
        '-created_date',
        batchSize,
        offset
      );
      if (!msgs || msgs.length === 0) break;
      createdByImageCount += msgs.filter(m => m.image_url && !m.recovery_signal).length;
      if (msgs.length < batchSize) break;
    }

    return Response.json({
      diagnostic_date: new Date().toISOString(),
      conversation_counts: {
        via_owner_email: ownerEmailIds.size,
        via_created_by: createdByIds.size,
        gap_in_owner_email_only: inOwnerEmailOnly.length,
        gap_in_created_by_only: inCreatedByOnly.length,
      },
      image_counts: {
        via_owner_email_path: ownerEmailImageCount,
        via_created_by_path: createdByImageCount,
        images_missed_by_created_by: ownerEmailImageCount - createdByImageCount,
      },
      gap_conversations_with_images: gapConvosWithImages,
      verdict: inOwnerEmailOnly.length > 0 && gapConvosWithImages.length > 0
        ? 'GAP_CAUSES_MISSING_IMAGES: fetchMediaGalleryPage must switch to owner_email to find all images'
        : inOwnerEmailOnly.length > 0 && gapConvosWithImages.length === 0
        ? 'GAP_EXISTS_BUT_NO_IMAGES_AFFECTED: The missing conversations have no images'
        : 'NO_GAP: Both paths find the same conversations',
      recommendation: ownerEmailImageCount !== createdByImageCount
        ? 'SWITCH fetchMediaGalleryPage to use owner_email on Conversation — images are being missed'
        : 'Both paths find same image count — gap exists but does not affect gallery',
    });

  } catch (error) {
    console.error('[diagnoseGalleryOwnershipGap] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});