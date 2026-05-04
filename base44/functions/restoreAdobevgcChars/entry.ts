/**
 * restoreAdobevgcChars
 * Restores Alden Spencer and Jesse Arden character records.
 * Chris Brown was already restored in the previous run.
 * Relinks all conversations and messages to new IDs.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const TARGET_EMAIL = 'adobevgc@gmail.com';
const TARGET_USER_ID = '69dc11160b6a8c4e19937fac';

const MISSING_CHARS = [
  { name: 'Alden Spencer', old_id: '69e1cbaf2dae540ad7f9042a' },
  { name: 'Jesse Arden', old_id: '69f4a5447df393b107a193dc' },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const results = [];

    for (const charDef of MISSING_CHARS) {
      // Verify it doesn't already exist
      const existing = await base44.asServiceRole.entities.Character.filter(
        { id: charDef.old_id }, '-created_date', 1
      );
      if (existing.length > 0) {
        results.push({
          character: charDef.name,
          status: 'already_exists',
          id: charDef.old_id,
          owner_email: existing[0].owner_email,
        });
        continue;
      }

      // Create new character record
      const newChar = await base44.asServiceRole.entities.Character.create({
        name: charDef.name,
        status: 'active',
        character_type: 'active_created_character',
        owner_email: TARGET_EMAIL,
        owner_user_id: TARGET_USER_ID,
        data_scope: 'private_user',
        visibility_scope: 'account_private',
        emotional_state: 'calm',
        friendship_level: 75,
        romantic_level: 0,
        trust_level: 50,
        user_respect_level: 50,
        is_active_character: true,
        is_finalized: true,
      });

      const newId = newChar.id;

      // Relink conversations
      const allConvos = await base44.asServiceRole.entities.Conversation.list('-created_date', 500);
      const relevantConvos = allConvos.filter(c =>
        (c.character_ids || []).includes(charDef.old_id)
      );
      for (const c of relevantConvos) {
        const updatedIds = c.character_ids.map(id => id === charDef.old_id ? newId : id);
        await base44.asServiceRole.entities.Conversation.update(c.id, {
          character_ids: updatedIds,
        });
      }

      // Relink messages (in batches — filter doesn't support array contains directly)
      const allMsgs = await base44.asServiceRole.entities.Message.filter(
        { character_id: charDef.old_id }, '-created_date', 500
      );
      for (const m of allMsgs) {
        await base44.asServiceRole.entities.Message.update(m.id, {
          character_id: newId,
        });
      }

      results.push({
        character: charDef.name,
        old_id: charDef.old_id,
        new_id: newId,
        status: 'restored_with_new_id',
        convos_relinked: relevantConvos.length,
        messages_relinked: allMsgs.length,
      });
    }

    // Verify final state
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 100
    );
    const allConvos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: TARGET_EMAIL }, '-created_date', 100
    );

    return Response.json({
      success: true,
      results,
      verification: {
        chars_now_owned_by_adobevgc: allChars.length,
        chars: allChars.map(c => ({ id: c.id, name: c.name, status: c.status })),
        convos_now_owned_by_adobevgc: allConvos.length,
        convos: allConvos.map(c => ({
          id: c.id,
          title: c.title,
          type: c.type,
          character_ids: c.character_ids,
          last_message_date: c.last_message_date,
        })),
      },
    });

  } catch (error) {
    console.error('[restoreAdobevgcChars] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});