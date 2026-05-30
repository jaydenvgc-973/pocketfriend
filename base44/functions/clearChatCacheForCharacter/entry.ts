import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // This function will be called from Settings to manually clear stale chat cache
    const payload = await req.json().catch(() => ({}));
    const characterId = payload.characterId;

    if (!characterId) {
      return Response.json({ 
        success: false,
        message: 'characterId required in payload'
      });
    }

    // Note: This is a backend diagnostic only.
    // The actual cache clearing happens on the frontend in useChatLoadConvo
    // by calling lfcDelete during hook initialization.
    // This function documents what needs to be cleared.

    const namespaces = [
      `chat_msgs:${characterId}`, // old format (pre-chatType-key)
      `chat_msgs:direct:${characterId}`, // current stale cache
      `chat_msgs:phone:${characterId}`, // text channel cache
      `world_contacts_unread:${characterId}`, // world phone unread badge
    ];

    return Response.json({
      success: true,
      message: 'Cache namespaces that should be cleared',
      character_id: characterId,
      namespaces_to_clear: namespaces,
      instructions: 'Call lfcDelete(ownerEmail, namespace) for each namespace on page load'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});