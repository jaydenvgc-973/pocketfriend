import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get all characters - use both service role and user endpoints to ensure we get data
    let allChars = [];
    try {
      // Try service role first
      let charsResult = await base44.asServiceRole.entities.Character.list();
      allChars = Array.isArray(charsResult) ? charsResult : (charsResult?.data || []);
      
      // If empty, try user endpoint
      if (allChars.length === 0) {
        charsResult = await base44.entities.Character.list();
        allChars = Array.isArray(charsResult) ? charsResult : (charsResult?.data || []);
      }
      
      console.log(`Found ${allChars.length} total characters`);
    } catch (e) {
      console.error('Error fetching characters:', e);
      return Response.json({ error: `Failed to fetch characters: ${e.message}` }, { status: 500 });
    }

    // Find all Nathan characters
    const allNathans = allChars.filter(c => c.name === 'Nathan Parker');
    const targetNathan = allNathans.find(c => c.created_by === 'murqart@gmail.com');

    if (!targetNathan) {
      return Response.json({ error: `Nathan not found. Found ${allNathans.length} Nathans total, ${allChars.length} chars total` }, { status: 404 });
    }

    const targetNathanId = targetNathan.id;

    // Collect all Nathan's photos from all accounts
    const allReferenceUrls = new Set();
    const allSceneImages = {};
    const allFictionalImages = {};

    for (const nathan of allNathans) {
      if (nathan.reference_image_urls?.length) {
        nathan.reference_image_urls.forEach(url => allReferenceUrls.add(url));
      }
      if (nathan.scene_images) {
        Object.assign(allSceneImages, nathan.scene_images);
      }
      if (nathan.fictional_entity_images) {
        Object.assign(allFictionalImages, nathan.fictional_entity_images);
      }
    }

    // Get all messages
    let allMessages = [];
    try {
      const messagesResult = await base44.asServiceRole.entities.Message.list();
      allMessages = Array.isArray(messagesResult) ? messagesResult : (messagesResult?.data || []);
    } catch (e) {
      console.error('Error fetching messages:', e);
    }
    
    const nathanMessages = allMessages.filter(m => m.character_name === 'Nathan Parker');
    const messagesToUpdate = nathanMessages.filter(m => m.character_id !== targetNathanId);
    const conversationIds = new Set(messagesToUpdate.map(m => m.conversation_id));

    // Update all Nathan's messages to point to the target character
    for (const message of messagesToUpdate) {
      await base44.asServiceRole.entities.Message.update(message.id, {
        character_id: targetNathanId
      });
    }

    // Get all conversations and update relevant ones
    let allConversations = [];
    try {
      const convsResult = await base44.asServiceRole.entities.Conversation.list();
      allConversations = Array.isArray(convsResult) ? convsResult : (convsResult?.data || []);
    } catch (e) {
      console.error('Error fetching conversations:', e);
    }

    const conversationsToUpdate = allConversations.filter(c => conversationIds.has(c.id));

    for (const conv of conversationsToUpdate) {
      const characterIds = new Set(conv.character_ids || []);
      characterIds.add(targetNathanId);
      
      await base44.asServiceRole.entities.Conversation.update(conv.id, {
        character_ids: Array.from(characterIds)
      });
    }

    // Update Nathan with all collected photos and clear avatar for regeneration
    await base44.asServiceRole.entities.Character.update(targetNathanId, {
      avatar_url: null,
      reference_image_urls: Array.from(allReferenceUrls),
      scene_images: Object.keys(allSceneImages).length > 0 ? allSceneImages : null,
      fictional_entity_images: Object.keys(allFictionalImages).length > 0 ? allFictionalImages : null
    });

    return Response.json({
      success: true,
      messagesUpdated: messagesToUpdate.length,
      conversationsUpdated: conversationsToUpdate.length,
      referencePhotosConsolidated: allReferenceUrls.size,
      targetNathanId
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});