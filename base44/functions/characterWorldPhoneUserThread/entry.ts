/**
 * characterWorldPhoneUserThread
 *
 * The receiving character's World Phone: recognizes account USERS who have actually
 * sent that character a World Phone message.
 *
 * A user→character thread lives on the sending user's account, keyed
 * `world_phone::user_<userId>::<characterId>` (written by sendUserWorldPhoneMessage).
 * The receiving character's owner cannot read it through RLS, so this function is the
 * verified read/write gateway:
 *
 *   action: 'contacts' — the users who have messaged this character (world name, avatar,
 *                        existing conversation id). A user appears ONLY when a real
 *                        user-sent message exists in the thread.
 *   action: 'thread'   — the messages of that existing conversation (no new thread).
 *   action: 'send'     — appends the character's own message to that SAME conversation.
 *
 * AUTHORIZATION: the caller must own the character (character.owner_email === caller.email).
 * The user identity is resolved from the conversation key + owner, never by name matching,
 * so a user is never confused with a similarly named character.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

const INACTIVE = new Set(['deleted', 'soft_deleted', 'merged']);

function userIdFromKey(key, characterId) {
  if (typeof key !== 'string') return null;
  const suffix = `::${characterId}`;
  if (!key.startsWith('world_phone::user_') || !key.endsWith(suffix)) return null;
  const id = key.slice('world_phone::user_'.length, key.length - suffix.length);
  return id && !id.includes('::') ? id : null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!me?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { character_id, action = 'contacts', user_id, content } = body || {};
    if (!character_id) return Response.json({ error: 'character_id is required' }, { status: 400 });

    const sr = base44.asServiceRole;

    // ── AUTHORIZATION: this must be the caller's own character ──────────────
    const charList = await sr.entities.Character.filter({ id: character_id }, null, 1).catch(() => []);
    const character = charList?.[0];
    if (!character || INACTIVE.has(character.status)) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }
    if (character.owner_email !== me.email) {
      return Response.json({ error: 'Not this character\'s World Phone' }, { status: 403 });
    }

    // ── THREADS ADDRESSED TO THIS CHARACTER ─────────────────────────────────
    // Same two participant fields the rest of World Phone uses; the key filter below
    // is what keeps this strictly to user→character threads.
    const [byParticipant, byCharacterId] = await Promise.all([
      sr.entities.Conversation.filter({ participant_character_ids: [character_id] }, '-updated_date', 200).catch(() => []),
      sr.entities.Conversation.filter({ character_ids: [character_id] }, '-updated_date', 200).catch(() => []),
    ]);

    const seenConvos = new Set();
    const userThreads = [...(byParticipant || []), ...(byCharacterId || [])].filter((c) => {
      if (!c?.id || seenConvos.has(c.id)) return false;
      if (INACTIVE.has(c.status)) return false;
      seenConvos.add(c.id);
      return !!userIdFromKey(c.shared_conversation_key, character_id);
    });

    // Latest thread per user
    const byUser = new Map();
    for (const convo of userThreads) {
      const uid = userIdFromKey(convo.shared_conversation_key, character_id);
      if (!uid) continue;
      const prev = byUser.get(uid);
      const stamp = (c) => new Date(c.last_message_date || c.updated_date || c.created_date || 0).getTime();
      if (!prev || stamp(convo) > stamp(prev)) byUser.set(uid, convo);
    }

    // ── PROOF OF ACTUAL COMMUNICATION ───────────────────────────────────────
    // A user appears as a contact only because they really sent this character a
    // message — never merely because a relationship exists between the accounts.
    const proofs = await Promise.all(
      [...byUser.values()].map((convo) =>
        sr.entities.Message.filter(
          { conversation_id: convo.id, sender_type: 'user' },
          'created_date',
          1
        ).catch(() => [])
      )
    );

    const established = [...byUser.entries()].filter((_, i) => (proofs[i] || []).length > 0);

    // ── USER IDENTITY: World Name + real profile avatar ──────────────────────
    const contacts = await Promise.all(
      established.map(async ([uid, convo]) => {
        const senderEmail = convo.owner_email || null;
        const [settingsList, usersList] = await Promise.all([
          senderEmail
            ? sr.entities.UserSettings.filter({ owner_email: senderEmail }, null, 1).catch(() => [])
            : Promise.resolve([]),
          senderEmail
            ? sr.entities.User.filter({ email: senderEmail }, null, 1).catch(() => [])
            : Promise.resolve([]),
        ]);
        const settings = settingsList?.[0] || null;
        const senderUser = usersList?.[0] || null;
        const worldName =
          settings?.fictional_world_name ||
          senderUser?.full_name ||
          (senderEmail ? senderEmail.split('@')[0] : 'World Phone');
        const avatarUrl =
          senderUser?.generated_avatar_urls?.[0] ||
          senderUser?.reference_image_urls?.[0] ||
          senderUser?.avatar_url ||
          null;

        return {
          user_id: uid,
          world_name: worldName,
          avatar_url: avatarUrl,
          conversation_id: convo.id,
          shared_conversation_key: convo.shared_conversation_key,
          last_message_preview: convo.last_message_preview || null,
          last_message_date: convo.last_message_date || null,
        };
      })
    );

    contacts.sort((a, b) => (a.world_name || '').localeCompare(b.world_name || ''));

    if (action === 'contacts') {
      return Response.json({ success: true, contacts });
    }

    // Everything below needs an explicit, already-established contact
    const target = contacts.find((c) => c.user_id === user_id);
    if (!target) {
      return Response.json({ success: false, error: 'No established World Phone conversation with this user' }, { status: 404 });
    }

    if (action === 'thread') {
      const rows = await sr.entities.Message.filter(
        { conversation_id: target.conversation_id },
        'created_date',
        500
      ).catch(() => []);
      const messages = (rows || [])
        .slice()
        .sort((a, b) => new Date(a.timestamp || a.created_date || 0) - new Date(b.timestamp || b.created_date || 0))
        .map((m) => ({
          id: m.id,
          sender_type: m.sender_type,
          sender_character_id: m.sender_character_id || m.character_id || null,
          character_name: m.character_name || null,
          content: m.content || '',
          image_url: m.image_url || null,
          message_type: m.message_type || null,
          timestamp: m.timestamp || m.created_date || null,
        }));
      return Response.json({ success: true, contact: target, messages });
    }

    if (action === 'send') {
      const text = typeof content === 'string' ? content.trim() : '';
      if (!text) return Response.json({ success: false, error: 'Message content is required' }, { status: 400 });

      const now = new Date().toISOString();
      const created = await sr.entities.Message.create({
        conversation_id: target.conversation_id,
        sender_type: 'character',
        character_id: character.id,
        character_name: character.name,
        sender_character_id: character.id,
        content: text,
        channel: 'world_phone',
        shared_conversation_key: target.shared_conversation_key,
        owner_email: byUser.get(target.user_id)?.owner_email || null,
        user_operated: true,
        typed_by_user: true,
        is_read: false,
        memory_eligible: true,
        relationship_eligible: true,
        timestamp: now,
      });

      await sr.entities.Conversation.update(target.conversation_id, {
        last_message_preview: text.substring(0, 100),
        last_message_date: now,
      }).catch(() => {});

      return Response.json({ success: true, message_id: created?.id || null, conversation_id: target.conversation_id });
    }

    return Response.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[characterWorldPhoneUserThread]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});