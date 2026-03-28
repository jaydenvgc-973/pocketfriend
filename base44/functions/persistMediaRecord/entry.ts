import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const {
      conversationId,
      messageId,
      characterId,
      senderType,
      imageUrl,
      filename,
      messageContentPreview
    } = body;

    if (!conversationId || !imageUrl || !senderType) {
      return Response.json({ 
        error: 'conversationId, imageUrl, and senderType required' 
      }, { status: 400 });
    }

    // Check if this image is already recorded (prevent duplicates)
    const existing = await base44.entities.Media.filter({
      conversation_id: conversationId,
      image_url: imageUrl,
      is_deleted: false
    });

    if (existing && existing.length > 0) {
      return Response.json({
        success: true,
        mediaId: existing[0].id,
        message: 'Media already recorded'
      });
    }

    // Create a new media record
    const mediaRecord = await base44.entities.Media.create({
      conversation_id: conversationId,
      message_id: messageId || null,
      character_id: characterId || null,
      sender_type: senderType,
      image_url: imageUrl,
      filename: filename || 'image',
      sent_at: new Date().toISOString(),
      message_content_preview: messageContentPreview || null
    });

    return Response.json({
      success: true,
      mediaId: mediaRecord.id,
      message: 'Media record created'
    });

  } catch (error) {
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});