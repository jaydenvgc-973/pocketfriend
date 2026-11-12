/**
 * shareNarrativeToCharacter
 *
 * Delivers a shared narrative into a RECEIVING character's own direct thread on
 * the receiving character's account, so it appears on that character's Chat page
 * (channel "direct") or Text page (channel "phone").
 *
 * Used only when the receiving character belongs to a DIFFERENT account — a
 * same-account share stays on the existing client path. World Phone conversations
 * are deliberately never used: narrative records are forbidden there.
 *
 * Trust rules:
 *  - caller must be signed in
 *  - caller must own the character whose narrative is being shared
 *  - the receiving character must already be known to that character, using the
 *    same contact graph the UI resolves (family_members, fictional_relationships,
 *    people_in_world/known_people, or an existing shared conversation)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

function contactIds(character) {
  const ids = new Set();
  const push = (v) => { if (v) ids.add(v); };
  for (const fm of character.family_members || []) {
    push(fm.character_id);
    push(fm.related_character_id);
  }
  for (const rel of character.fictional_relationships || []) {
    push(rel.related_character_id);
    push(rel.character_id);
  }
  for (const p of (character.people_in_world || character.known_people || [])) {
    push(p.related_character_id);
    push(p.character_id);
  }
  return ids;
}

function recency(a, b) {
  const aTime = new Date(a.last_message_date || a.created_date).getTime();
  const bTime = new Date(b.last_message_date || b.created_date).getTime();
  return bTime - aTime;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const sourceMessageId = body.source_message_id;
    const recipientId = body.recipient_character_id;
    const channel = body.channel === 'phone' ? 'phone' : 'direct';

    if (!sourceMessageId || !recipientId) {
      return Response.json({ error: 'source_message_id and recipient_character_id are required' }, { status: 400 });
    }

    const source = await base44.asServiceRole.entities.Message
      .get(sourceMessageId)
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!source || !source.is_narrative || !source.content) {
      return Response.json({ error: 'Narrative message not found' }, { status: 404 });
    }

    const originArr = await base44.asServiceRole.entities.Character.filter({ id: source.character_id }, null, 1);
    const origin = originArr?.[0];
    if (!origin) return Response.json({ error: 'Origin character not found' }, { status: 404 });

    if ((origin.owner_email || '').toLowerCase() !== user.email.toLowerCase()) {
      return Response.json({ error: 'You can only share narratives from your own characters' }, { status: 403 });
    }

    const recipientArr = await base44.asServiceRole.entities.Character.filter({ id: recipientId }, null, 1);
    const recipient = recipientArr?.[0];
    if (!recipient || ['deleted', 'soft_deleted', 'merged', 'deceased'].includes(recipient.status)) {
      return Response.json({ error: 'Receiving character not found' }, { status: 404 });
    }
    if (!recipient.owner_email) {
      return Response.json({ error: 'Receiving character has no account' }, { status: 400 });
    }
    if (recipient.life_status === 'deceased') {
      return Response.json({ error: 'Receiving character is deceased' }, { status: 400 });
    }

    // Known-contact verification
    let known = contactIds(origin).has(recipientId);
    if (!known) {
      const shared = await base44.asServiceRole.entities.Conversation
        .filter({ character_ids: { $in: [origin.id] } }, null, 100)
        .catch(() => []);
      known = (shared || []).some(c => (c.character_ids || []).includes(recipientId));
    }
    if (!known) {
      return Response.json({ error: 'Receiving character is not known to this character' }, { status: 403 });
    }

    // Resolve the receiving character's own thread for this channel
    const existing = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: recipient.owner_email, character_ids: recipientId, type: channel },
      '-last_message_date',
      100
    );

    const valid = (existing || []).filter(c => {
      const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
      return ids.length === 1
        && ids[0] === recipientId
        && !c.shared_conversation_key
        && c.channel !== 'world_phone'
        && c.channel !== 'story_event';
    });
    const ranked = [
      ...valid.filter(c => c.last_message_date).sort(recency),
      ...valid.filter(c => !c.last_message_date).sort(recency),
    ];

    let conversationId = ranked[0]?.id || null;
    if (!conversationId) {
      const created = await base44.asServiceRole.entities.Conversation.create({
        title: `${channel} with ${recipient.name}`,
        type: channel,
        character_ids: [recipientId],
        owner_email: recipient.owner_email,
      });
      conversationId = created.id;
    }

    const sharedMessage = await base44.asServiceRole.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: origin.id,
      character_name: origin.name,
      content: source.content,
      image_url: source.image_url || undefined,
      image_description: source.image_description || source.inferred_image_description || undefined,
      is_narrative: true,
      // Narratives are never marked as forwarded and carry no forwarding
      // attribution — a shared narrative reads exactly like any other narrative.
      is_read: false,
      timestamp: new Date().toISOString(),
    });

    await base44.asServiceRole.entities.Conversation.update(conversationId, {
      last_message_preview: source.content.substring(0, 100),
      last_message_date: new Date().toISOString(),
    }).catch(() => {});

    return Response.json({
      success: true,
      conversation_id: conversationId,
      message_id: sharedMessage.id,
      channel,
      recipient_owner: recipient.owner_email,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});