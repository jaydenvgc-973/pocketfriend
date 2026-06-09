/**
 * applyWorldPhoneManualReanchor
 *
 * Applies a user-confirmed re-anchor to a single World Phone conversation.
 * Takes the conversation_id and two live character IDs chosen by the user,
 * then:
 *   1. Validates both IDs are live characters belonging to this account.
 *   2. Updates the Conversation record:
 *      - participant_character_ids = [id1, id2] (sorted)
 *      - character_ids = [id1, id2] (sorted)
 *      - shared_conversation_key = world_phone::id1::id2
 *      - channel = world_phone
 *      - sync_status = complete
 *   3. Backfills ALL Message records in that thread:
 *      - participant_character_ids
 *      - shared_conversation_key
 *      - channel = world_phone
 *      - sender_character_id (preserved if already valid, else inferred)
 *      - receiver_character_id (inferred as the other participant)
 *
 * Payload:
 *   conversation_id: string   (required)
 *   character_id_1: string    (required — live character)
 *   character_id_2: string    (required — live character, different from id_1)
 *
 * Does NOT:
 *   - delete any Conversation or Message
 *   - create new conversations
 *   - change character records
 *   - silently guess replacements
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;
    const body = await req.json().catch(() => ({}));

    const { conversation_id, character_id_1, character_id_2 } = body;

    if (!conversation_id || !character_id_1 || !character_id_2) {
      return Response.json({ error: 'conversation_id, character_id_1, and character_id_2 are required' }, { status: 400 });
    }
    if (character_id_1 === character_id_2) {
      return Response.json({ error: 'character_id_1 and character_id_2 must be different' }, { status: 400 });
    }

    // ── Validate: conversation belongs to this account ────────────────────────
    const [convoArr] = await Promise.all([
      base44.asServiceRole.entities.Conversation.filter({ id: conversation_id }, null, 1).catch(() => []),
    ]);
    const convo = convoArr?.[0];
    if (!convo) {
      return Response.json({ error: 'Conversation not found' }, { status: 404 });
    }
    if (convo.owner_email !== ownerEmail) {
      return Response.json({ error: 'Conversation does not belong to this account' }, { status: 403 });
    }

    // ── Validate: both character IDs are live and owned by this account ───────
    const [char1Arr, char2Arr] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ id: character_id_1 }, null, 1).catch(() => []),
      base44.asServiceRole.entities.Character.filter({ id: character_id_2 }, null, 1).catch(() => []),
    ]);

    const char1 = char1Arr?.[0];
    const char2 = char2Arr?.[0];

    if (!char1) return Response.json({ error: `Character ${character_id_1} not found` }, { status: 404 });
    if (!char2) return Response.json({ error: `Character ${character_id_2} not found` }, { status: 404 });

    const invalidStatuses = ['deleted', 'soft_deleted', 'merged'];
    if (invalidStatuses.includes(char1.status)) {
      return Response.json({ error: `Character "${char1.name}" is ${char1.status} and cannot be used as an anchor` }, { status: 400 });
    }
    if (invalidStatuses.includes(char2.status)) {
      return Response.json({ error: `Character "${char2.name}" is ${char2.status} and cannot be used as an anchor` }, { status: 400 });
    }
    if (char1.owner_email !== ownerEmail) {
      return Response.json({ error: `Character "${char1.name}" does not belong to this account` }, { status: 403 });
    }
    if (char2.owner_email !== ownerEmail) {
      return Response.json({ error: `Character "${char2.name}" does not belong to this account` }, { status: 403 });
    }

    // ── Build the canonical anchor values ────────────────────────────────────
    const sortedIds = [character_id_1, character_id_2].sort();
    const newKey = `world_phone::${sortedIds[0]}::${sortedIds[1]}`;

    // ── Step 1: Update the Conversation record ────────────────────────────────
    const convoUpdatePayload = {
      participant_character_ids: sortedIds,
      character_ids: sortedIds,
      shared_conversation_key: newKey,
      channel: 'world_phone',
      sync_status: 'complete',
    };
    if (convo.title?.startsWith('world_phone::')) {
      convoUpdatePayload.title = newKey;
    }

    await base44.asServiceRole.entities.Conversation.update(conversation_id, convoUpdatePayload);

    // ── Step 2: Backfill all Message records in this thread ───────────────────
    const msgs = await base44.asServiceRole.entities.Message.filter(
      { conversation_id }, 'created_date', 2000
    ).catch(() => []);

    let backfilled = 0;
    let skipped = 0;
    let writeCount = 0;

    for (const msg of msgs) {
      const alreadyCorrect =
        msg.shared_conversation_key === newKey &&
        Array.isArray(msg.participant_character_ids) &&
        sortedIds.every(id => msg.participant_character_ids.includes(id));

      if (alreadyCorrect) { skipped++; continue; }

      // Infer sender: prefer existing sender_character_id if it matches one of our new anchors
      let inferredSender = null;
      if (msg.sender_character_id && sortedIds.includes(msg.sender_character_id)) {
        inferredSender = msg.sender_character_id;
      } else if (msg.character_id && sortedIds.includes(msg.character_id)) {
        inferredSender = msg.character_id;
      } else if (msg.sender_type === 'character') {
        // Default: first sorted ID is the sender for character messages
        inferredSender = sortedIds[0];
      } else {
        // User message — sender is the "user side"; receiver is the character
        inferredSender = sortedIds[0];
      }

      const inferredReceiver = inferredSender === sortedIds[0] ? sortedIds[1] : sortedIds[0];

      // Throttle: pause every 10 writes
      if (writeCount > 0 && writeCount % 10 === 0) {
        await new Promise(r => setTimeout(r, 500));
      }

      await base44.asServiceRole.entities.Message.update(msg.id, {
        shared_conversation_key: newKey,
        participant_character_ids: sortedIds,
        channel: 'world_phone',
        sender_character_id: inferredSender,
        receiver_character_id: inferredReceiver,
      }).catch(e => console.warn(`WARN backfill msg ${msg.id.substring(0,8)}: ${e.message}`));

      backfilled++;
      writeCount++;
    }

    console.log(
      `[applyWorldPhoneManualReanchor] convo=${conversation_id.substring(0,8)} | ` +
      `anchors=${char1.name} + ${char2.name} | msgs=${msgs.length} | backfilled=${backfilled} | skipped=${skipped}`
    );

    return Response.json({
      success: true,
      conversation_id,
      new_key: newKey,
      character_1: { id: char1.id, name: char1.name },
      character_2: { id: char2.id, name: char2.name },
      total_messages: msgs.length,
      messages_backfilled: backfilled,
      messages_already_correct: skipped,
    });

  } catch (error) {
    console.error('[applyWorldPhoneManualReanchor]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});