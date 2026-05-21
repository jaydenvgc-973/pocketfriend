/**
 * deleteMediaGalleryImage
 *
 * Delete an image from Media Gallery.
 * Ownership is resolved from the parent source (Message/Conversation/Character),
 * not the image URL alone.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      messageId,
      parentEntity,
      parentOwnerId,
    } = await req.json();

    if (!messageId) {
      return Response.json({ error: 'Missing messageId' }, { status: 400 });
    }

    // Load the message
    const msgArray = await base44.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
    const msg = msgArray?.[0];

    if (!msg) {
      return Response.json({ error: `Message not found: ${messageId}` }, { status: 404 });
    }

    // Resolve ownership from parent source
    let ownerEmail = null;

    // 1. Try conversation ownership
    if (msg.conversation_id) {
      const convArray = await base44.entities.Conversation.filter(
        { id: msg.conversation_id },
        null,
        1
      ).catch(() => []);
      const conv = convArray?.[0];
      if (conv?.owner_email) {
        ownerEmail = conv.owner_email;
      }
    }

    // 2. Fallback to message owner
    if (!ownerEmail && msg.owner_email) {
      ownerEmail = msg.owner_email;
    }

    // 3. Fallback to creator
    if (!ownerEmail && msg.created_by) {
      ownerEmail = msg.created_by;
    }

    if (!ownerEmail) {
      return Response.json({
        error: 'Could not resolve ownership for this image. Parent source has no owner.',
        messageId,
        conversationId: msg.conversation_id
      }, { status: 403 });
    }

    // Verify current user owns this image
    if (ownerEmail !== user.email) {
      console.warn(`[deleteMediaGalleryImage] DENIED: owner=${ownerEmail}, current=${user.email}`);
      return Response.json({
        error: 'You do not own this image.',
        ownership: { owner: ownerEmail, current: user.email }
      }, { status: 403 });
    }

    // Delete the message (which removes the image from the conversation)
    await base44.entities.Message.delete(messageId);

    console.log(`[deleteMediaGalleryImage] ✓ Deleted message ${messageId} | owner=${ownerEmail}`);

    return Response.json({
      success: true,
      deleted_message_id: messageId,
      owner_email: ownerEmail
    });

  } catch (error) {
    console.error('[deleteMediaGalleryImage]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});