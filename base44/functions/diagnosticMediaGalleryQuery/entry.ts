/**
 * diagnosticMediaGalleryQuery
 *
 * Diagnose why fetchMediaGalleryPage returns images but auditMediaGalleryFullDataset sees 0.
 * 
 * Root cause investigation:
 * 1. What conversations exist for the user?
 * 2. What messages exist in those conversations?
 * 3. Do those messages have image_url set?
 * 4. What does the Message filter actually return?
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const ownerEmail = user.email;
    console.log(`[diagnosticMediaGalleryQuery] Starting diagnostic for ${ownerEmail}`);

    // Step 1: Get conversations
    const conversations = await base44.entities.Conversation.filter(
      { created_by: ownerEmail },
      '-created_date',
      500
    );
    console.log(`[diagnosticMediaGalleryQuery] Found ${conversations.length} conversations`);

    const conversationIds = (conversations || []).map(c => c.id).filter(Boolean);
    console.log(`[diagnosticMediaGalleryQuery] Conversation IDs:`, conversationIds.slice(0, 5));

    if (conversationIds.length === 0) {
      return Response.json({ error: 'No conversations found' }, { status: 400 });
    }

    // Step 2: Query messages directly
    const query = { conversation_id: { $in: conversationIds } };
    console.log(`[diagnosticMediaGalleryQuery] Querying messages with:`, JSON.stringify(query));

    const messages = await base44.entities.Message.filter(
      query,
      '-created_date',
      100
    );
    console.log(`[diagnosticMediaGalleryQuery] Raw message query returned ${messages.length} messages`);

    // Step 3: Check for images
    const messagesWithImages = messages.filter(m => m.image_url);
    console.log(`[diagnosticMediaGalleryQuery] Messages with image_url: ${messagesWithImages.length}`);

    if (messagesWithImages.length > 0) {
      const sample = messagesWithImages[0];
      console.log(`[diagnosticMediaGalleryQuery] Sample image message:`, {
        id: sample.id,
        conversation_id: sample.conversation_id,
        image_url: sample.image_url?.substring(0, 80),
        has_generation_context: !!sample.generation_context,
        image_description: sample.image_description?.substring(0, 80),
        sender_type: sample.sender_type,
        created_date: sample.created_date,
      });
    }

    // Step 4: Call fetchMediaGalleryPage and see what it returns
    console.log(`[diagnosticMediaGalleryQuery] Now calling fetchMediaGalleryPage with page=1`);
    const pageRes = await base44.functions.invoke('fetchMediaGalleryPage', {
      page: 1,
      pageSize: 5,
      searchTerm: '',
    });

    console.log(`[diagnosticMediaGalleryQuery] fetchMediaGalleryPage returned:`, {
      images_count: pageRes?.data?.images?.length || 0,
      has_more: pageRes?.data?.hasMore,
      total_images: pageRes?.data?.totalImages,
    });

    if (pageRes?.data?.images?.length > 0) {
      const img = pageRes.data.images[0];
      console.log(`[diagnosticMediaGalleryQuery] First image from page:`, {
        id: img.id,
        url: img.url?.substring(0, 80),
        conversation_id: img.conversationId,
        has_display_prompt: !!img.displayPrompt,
        category: img.imageCategory,
      });
    }

    return Response.json({
      user_email: ownerEmail,
      total_conversations: conversations.length,
      total_messages_in_conversations: messages.length,
      messages_with_images: messagesWithImages.length,
      fetchMediaGalleryPage_results: {
        images_returned: pageRes?.data?.images?.length || 0,
        has_more: pageRes?.data?.hasMore,
        total_images: pageRes?.data?.totalImages,
      },
      diagnostic_status: messagesWithImages.length > 0 && pageRes?.data?.images?.length === 0 ? 'MISMATCH_FOUND' : 'OK',
    });

  } catch (error) {
    console.error('[diagnosticMediaGalleryQuery] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});