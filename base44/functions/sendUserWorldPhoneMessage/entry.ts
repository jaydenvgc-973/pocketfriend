/**
 * sendUserWorldPhoneMessage
 *
 * The account user's own World Phone — communication under the user's World Name
 * (UserSettings.fictional_world_name), never as one of their characters.
 *
 * Used by:
 *   - Image sharing as "You" to an eligible character (same account or another account)
 *   - The World Phone section on the User Profile
 *
 * DELIVERY: the existing World Phone pathway. One conversation per user↔character
 * pair, keyed `world_phone::user_<userId>::<characterId>`, so it can never collide
 * with (or be adopted as) a character↔character thread. The character's reply is
 * written as that character's own message — the sender identity stays distinct.
 *
 * ELIGIBILITY: own characters, or characters on another account reachable through
 * the existing contact graph of the user's own characters (or a thread that already
 * exists). Nothing outside that graph is reachable.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user?.email) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const sr = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const {
      recipient_character_id,
      content,
      image_url,
      image_description,
      message_type,
      source,
      generate_reply = true,
    } = body;

    if (!recipient_character_id) {
      return Response.json({ success: false, error: 'recipient_character_id is required' }, { status: 400 });
    }

    const isImage = message_type === 'image';
    if (isImage && !image_url) {
      return Response.json({ success: false, error: 'Image send requires image_url' }, { status: 400 });
    }
    if (!isImage && !content?.trim()) {
      return Response.json({ success: false, error: 'Message content is required' }, { status: 400 });
    }

    // ── RECIPIENT ───────────────────────────────────────────────────────────
    const recipList = await sr.entities.Character.filter({ id: recipient_character_id }, null, 1).catch(() => []);
    const recipient = recipList?.[0];
    if (!recipient) {
      return Response.json({ success: false, error: 'Recipient character not found' });
    }
    if (['deleted', 'soft_deleted', 'merged'].includes(recipient.status)) {
      return Response.json({ success: false, error: 'Recipient is not an active character' });
    }
    if (recipient.life_status === 'deceased') {
      return Response.json({ success: false, error: `${recipient.name} is deceased.` });
    }

    // ── USER WORLD NAME (identity authority) ─────────────────────────────────
    const settingsList = await sr.entities.UserSettings.filter({ owner_email: user.email }, null, 1).catch(() => []);
    const settings = settingsList?.[0] || {};
    const worldName = settings.fictional_world_name || user.full_name || user.email.split('@')[0];

    const canonicalKey = `world_phone::user_${user.id}::${recipient.id}`;

    const existingThread = await sr.entities.Conversation.filter(
      { shared_conversation_key: canonicalKey },
      '-updated_date',
      5
    ).catch(() => []);

    // ── ELIGIBILITY ─────────────────────────────────────────────────────────
    if (!existingThread?.[0] && recipient.owner_email !== user.email) {
      const myChars = await sr.entities.Character.filter({ owner_email: user.email }, null, 200).catch(() => []);
      const known = (myChars || []).some((c) =>
        (c.fictional_relationships || []).some((r) => r?.related_character_id === recipient.id) ||
        (c.family_members || []).some((f) => f?.character_id === recipient.id)
      );
      if (!known) {
        return Response.json({
          success: false,
          reason: 'not_a_known_contact',
          error: 'This character is not a known contact of anyone on your account.',
        });
      }
    }

    // ── CONVERSATION ────────────────────────────────────────────────────────
    let conversationId = existingThread?.[0]?.id || null;
    if (!conversationId) {
      const created = await sr.entities.Conversation.create({
        title: `${worldName} & ${recipient.name}`,
        type: 'direct',
        character_ids: [recipient.id],
        participant_character_ids: [recipient.id],
        shared_conversation_key: canonicalKey,
        owner_email: user.email,
        channel: 'world_phone',
        world_contact_mode: 'user_to_character',
        sync_status: 'complete',
      });
      conversationId = created.id;
    }

    const now = new Date().toISOString();

    // ── OUTBOUND (the user speaks as themselves) ────────────────────────────
    // sender_type stays 'user' — never a character. character_name carries the
    // user's World Name so the recipient's World Phone identifies the sender
    // correctly (character_id stays null, so it is never treated as a character).
    const outbound = await sr.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'user',
      character_name: worldName,
      content: isImage ? '' : content.trim(),
      image_url: image_url || null,
      image_description: image_description || null,
      image_analysis_status: isImage ? (image_description ? 'complete' : 'pending') : null,
      image_analysis_is_transport_metadata: false,
      message_type: isImage ? 'image' : 'text',
      channel: 'world_phone',
      shared_conversation_key: canonicalKey,
      owner_email: user.email,
      user_operated: true,
      typed_by_user: true,
      is_read: true,
      memory_eligible: true,
      relationship_eligible: true,
      timestamp: now,
      generation_context: undefined,
    });

    if (!outbound?.id) {
      return Response.json({ success: false, error: 'Message write failed' });
    }

    await sr.entities.Conversation.update(conversationId, {
      last_message_preview: isImage ? '📷 Photo' : content.trim().substring(0, 100),
      last_message_date: now,
    }).catch(() => {});

    // ── RECIPIENT REPLY (in the character's own identity) ───────────────────
    const SLEEP_STATES = new Set(['sleeping', 'napping', 'passed_out']);
    let replyId = null;
    let replyText = null;
    let sleepNotice = null;

    if (SLEEP_STATES.has(recipient.resolved_presence_status)) {
      sleepNotice = recipient.pending_alarm_time || recipient.presence_stay_lock_expires_at
        ? `${recipient.name} is ${recipient.resolved_presence_status} and should wake around ${new Date(recipient.pending_alarm_time || recipient.presence_stay_lock_expires_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })} Eastern.`
        : `${recipient.name} is currently ${recipient.resolved_presence_status} and can't reply right now.`;
    } else if (generate_reply) {
      try {
        const relationshipNote = (recipient.fictional_relationships || [])
          .filter((r) => {
            const n = (r.person_name || '').toLowerCase();
            return n && worldName.toLowerCase().includes(n.split(' ')[0]);
          })
          .map((r) => r.relationship_type || r.label_from_source_perspective)
          .filter(Boolean)[0] || null;

        const identity = `${recipient.name}. ${recipient.personality_summary || ''} ${recipient.current_situation || ''}`.trim();
        const arrived = isImage
          ? `${worldName} just sent you a photo${image_description ? ` (${image_description})` : ''} on World Phone.`
          : `${worldName} just texted you on World Phone: "${content.trim()}"`;

        const raw = await sr.integrations.Core.InvokeLLM({
          prompt: `You are ${identity}
${relationshipNote ? `\n${worldName} is your ${relationshipNote}.` : ''}

${arrived}

Reply as ${recipient.name} in a real text message. 1–3 sentences. Natural, in your own voice, grounded in your life and your relationship with ${worldName}.
Do NOT start with your name. Do NOT say you are an AI. Return ONLY the message text.`,
        });
        const text = (typeof raw === 'string' ? raw : '').trim();
        if (text && text.length > 2) {
          replyText = text;
          const reply = await sr.entities.Message.create({
            conversation_id: conversationId,
            sender_type: 'character',
            character_id: recipient.id,
            character_name: recipient.name,
            sender_character_id: recipient.id,
            content: text,
            channel: 'world_phone',
            shared_conversation_key: canonicalKey,
            owner_email: user.email,
            is_read: false,
            reply_to_message_id: outbound.id,
            memory_eligible: true,
            relationship_eligible: true,
            timestamp: new Date(Date.now() + 2000).toISOString(),
          }).catch(() => null);
          replyId = reply?.id || null;
        }
      } catch (replyErr) {
        console.warn('[sendUserWorldPhoneMessage] reply generation failed:', replyErr.message);
      }
    }

    if (replyText) {
      await sr.entities.Conversation.update(conversationId, {
        last_message_preview: replyText.substring(0, 100),
        last_message_date: new Date().toISOString(),
      }).catch(() => {});
    }

    return Response.json({
      success: true,
      message_id: outbound.id,
      conversation_id: conversationId,
      shared_conversation_key: canonicalKey,
      sender_display_name: worldName,
      recipient_character_id: recipient.id,
      recipient_name: recipient.name,
      reply_message_id: replyId,
      reply_text: replyText,
      sleep_notice: sleepNotice,
      is_image: isImage,
    });
  } catch (error) {
    console.error('[sendUserWorldPhoneMessage]', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});