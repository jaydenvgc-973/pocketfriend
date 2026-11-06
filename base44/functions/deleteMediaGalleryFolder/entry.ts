/**
 * deleteMediaGalleryFolder
 *
 * Deletes ONE character folder from the Media Gallery. Only two things are removed:
 *   1. the image records that belong to that folder (messages carrying an image in
 *      that character's chat/text conversations), and
 *   2. the folder record itself.
 *
 * Never touches: the character record, conversation text, Story Events, or any
 * other application data. Image removal uses the same semantics as the existing
 * per-image delete (deleteMediaGalleryImage). The Story Events and Miscellaneous
 * categories are never deletable.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { folderKey } = await req.json();
    if (!folderKey || typeof folderKey !== 'string' || !folderKey.startsWith('character:')) {
      return Response.json({ error: 'Only character folders can be deleted.' }, { status: 400 });
    }
    const characterId = folderKey.slice('character:'.length);
    if (!characterId) return Response.json({ error: 'Invalid folder key.' }, { status: 400 });

    // Conversations that belong to this folder: the character's own chat/text
    // conversations (exactly one character), excluding Story Event conversations
    // because those images live in the Story Events folder.
    const convos = await base44.entities.Conversation.filter(
      { $or: [{ created_by: user.email }, { owner_email: user.email }] },
      '-created_date',
      500
    ).catch(() => []);

    const targetConversationIds = (convos || []).filter((c) => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids.filter(Boolean) : [];
      if (ids.length !== 1 || ids[0] !== characterId) return false;
      if ((c.title || '').startsWith('story_event::')) return false;
      return true;
    }).map((c) => c.id);

    let deletedImages = 0;
    const CHUNK = 20;

    for (let i = 0; i < targetConversationIds.length; i += CHUNK) {
      const chunk = targetConversationIds.slice(i, i + CHUNK);
      let offset = 0;

      while (true) {
        const batch = await base44.entities.Message.filter(
          { conversation_id: { $in: chunk } },
          '-created_date',
          500,
          offset
        ).catch(() => []);

        if (!batch || batch.length === 0) break;

        const ids = batch
          .filter((m) => m.image_url && m.recovery_signal !== true)
          // Story Event images belong to the Story Events folder — never removed here.
          .filter((m) => !String((m.generation_context || {}).context_origin || '').startsWith('story_event'))
          .map((m) => m.id);

        if (ids.length > 0) {
          try {
            await base44.entities.Message.deleteMany({ id: { $in: ids } });
          } catch {
            for (const id of ids) {
              await base44.entities.Message.delete(id).catch(() => {});
            }
          }
          deletedImages += ids.length;
        }

        if (batch.length < 500) break;
        offset += 500;
        if (offset > 20000) break;
      }
    }

    await base44.entities.MediaGalleryFolder
      .deleteMany({ owner_email: user.email, folder_key: folderKey })
      .catch(() => {});

    console.log(`[deleteMediaGalleryFolder] folder=${folderKey} conversations=${targetConversationIds.length} imagesDeleted=${deletedImages}`);

    return Response.json({
      success: true,
      folder_key: folderKey,
      deleted_images: deletedImages,
      conversations_scanned: targetConversationIds.length,
    });
  } catch (error) {
    console.error('[deleteMediaGalleryFolder]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});