/**
 * manualReanchorWorldPhoneConversation
 *
 * Applies a user-confirmed manual re-anchor to a single World Phone conversation
 * that could not be auto-resolved by auditAndRepairWorldPhoneAnchors.
 *
 * Payload:
 *   conversation_id: string   — the Conversation record to repair
 *   participant_a_id: string  — live Character ID for first participant
 *   participant_b_id: string  — live Character ID for second participant
 *   dryRun: boolean           — default false (this function is intentionally live by default)
 *
 * Writes:
 *   Conversation.participant_character_ids = [sortedA, sortedB]
 *   Conversation.character_ids = [sortedA, sortedB]
 *   Conversation.shared_conversation_key = world_phone::${a}::${b}
 *   Conversation.channel = world_phone
 *   Conversation.sync_status = complete
 *   Conversation.title = world_phone::${a}::${b} (if title was raw key format)
 *
 *   All Messages in the thread:
 *     participant_character_ids
 *     shared_conversation_key
 *     channel = world_phone
 *     sender_character_id (inferred from character_name match, or existing field)
 *     receiver_character_id (the other participant)
 *
 * Safety guards:
 *   - Both character IDs must resolve to live, non-deleted characters
 *   - Both characters must belong to this account (owner_email match) OR be npc_world_service
 *   - Conversation must belong to this account
 *   - Never deletes any Conversation or Message
 *   - If shared_conversation_key already matches a DIFFERENT existing conversation,
 *     marks that as a merge candidate and returns a warning (does not auto-merge)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { conversation_id, participant_a_id, participant_b_id } = body;
    const dryRun = body.dryRun === true;
    const ownerEmail = user.email;

    // ── Input validation ─────────────────────────────────────────────────────
    if (!conversation_id || !participant_a_id || !participant_b_id) {
      return Response.json({
        error: 'conversation_id, participant_a_id, and participant_b_id are all required'
      }, { status: 400 });
    }
    if (participant_a_id === participant_b_id) {
      return Response.json({ error: 'participant_a_id and participant_b_id must be different characters' }, { status: 400 });
    }

    // ── Load and verify the conversation ─────────────────────────────────────
    const convos = await base44.asServiceRole.entities.Conversation.filter(
      { id: conversation_id, owner_email: ownerEmail }, null, 1
    ).catch(() => []);
    const convo = convos?.[0];
    if (!convo) {
      return Response.json({ error: `Conversation ${conversation_id} not found for this account` }, { status: 404 });
    }

    // ── Load and verify both characters ──────────────────────────────────────
    const [charAArr, charBArr] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ id: participant_a_id }, null, 1).catch(() => []),
      base44.asServiceRole.entities.Character.filter({ id: participant_b_id }, null, 1).catch(() => []),
    ]);

    const charA = charAArr?.[0];
    const charB = charBArr?.[0];

    if (!charA) return Response.json({ error: `Character ${participant_a_id} not found` }, { status: 404 });
    if (!charB) return Response.json({ error: `Character ${participant_b_id} not found` }, { status: 404 });

    // Verify both are live
    const deadStatuses = ['deleted', 'soft_deleted', 'merged'];
    if (deadStatuses.includes(charA.status)) {
      return Response.json({ error: `Character "${charA.name}" (${participant_a_id}) is ${charA.status} — cannot use as anchor` }, { status: 400 });
    }
    if (deadStatuses.includes(charB.status)) {
      return Response.json({ error: `Character "${charB.name}" (${participant_b_id}) is ${charB.status} — cannot use as anchor` }, { status: 400 });
    }

    // Verify ownership — both must belong to this account OR be npc_world_service
    const isWorldService = (c) => c.character_type === 'npc_world_service';
    if (!isWorldService(charA) && charA.owner_email !== ownerEmail) {
      return Response.json({ error: `Character "${charA.name}" does not belong to this account` }, { status: 403 });
    }
    if (!isWorldService(charB) && charB.owner_email !== ownerEmail) {
      return Response.json({ error: `Character "${charB.name}" does not belong to this account` }, { status: 403 });
    }

    // ── Build corrected canonical values ──────────────────────────────────────
    const sortedIds = [participant_a_id, participant_b_id].sort();
    const newCanonicalKey = `world_phone::${sortedIds[0]}::${sortedIds[1]}`;

    // ── Check for key collision — another conversation already uses this key ──
    const existingWithKey = await base44.asServiceRole.entities.Conversation.filter(
      { shared_conversation_key: newCanonicalKey, owner_email: ownerEmail }, null, 5
    ).catch(() => []);
    const collision = existingWithKey.filter(c => c.id !== conversation_id);

    // ── Load all messages in this thread ─────────────────────────────────────
    const msgs = await base44.asServiceRole.entities.Message.filter(
      { conversation_id }, 'created_date', 2000
    ).catch(() => []);

    // ── Build the update payload for the conversation ─────────────────────────
    const convoUpdatePayload = {
      participant_character_ids: sortedIds,
      character_ids: sortedIds,
      shared_conversation_key: newCanonicalKey,
      channel: 'world_phone',
      sync_status: 'complete',
    };
    if (convo.title?.startsWith('world_phone::')) {
      convoUpdatePayload.title = newCanonicalKey;
    }

    const summary = {
      conversation_id,
      conversation_title: convo.title,
      participant_a: { id: charA.id, name: charA.name },
      participant_b: { id: charB.id, name: charB.name },
      new_canonical_key: newCanonicalKey,
      original_dead_ids: [
        ...(convo.participant_character_ids || []),
        ...(convo.character_ids || []),
      ].filter((v, i, a) => a.indexOf(v) === i),
      message_count: msgs.length,
      messages_to_backfill: 0,
      key_collision: collision.length > 0 ? collision.map(c => ({ id: c.id, title: c.title })) : null,
      dry_run: dryRun,
      status: 'pending',
    };

    if (dryRun) {
      summary.status = 'dry_run_ok';
      summary.messages_to_backfill = msgs.length;
      return Response.json(summary);
    }

    // ── WRITE: update the conversation ────────────────────────────────────────
    const convoErr = await base44.asServiceRole.entities.Conversation.update(conversation_id, convoUpdatePayload)
      .then(() => null)
      .catch(e => e.message);

    if (convoErr) {
      summary.status = 'failed';
      summary.error = convoErr;
      return Response.json(summary, { status: 500 });
    }

    // ── WRITE: backfill all messages ──────────────────────────────────────────
    let backfilled = 0;
    let skipped = 0;
    let writeCount = 0;

    // Build a name→id map for inferring sender/receiver from character_name on messages
    const nameToId = new Map([
      [charA.name?.toLowerCase()?.trim(), charA.id],
      [charB.name?.toLowerCase()?.trim(), charB.id],
    ]);

    for (const msg of msgs) {
      const needsBackfill =
        msg.shared_conversation_key !== newCanonicalKey ||
        !Array.isArray(msg.participant_character_ids) ||
        !sortedIds.every(id => (msg.participant_character_ids || []).includes(id));

      if (!needsBackfill) { skipped++; continue; }

      // Infer sender: check character_name → nameToId, then existing sender_character_id if it matches
      let inferredSender = null;
      const msgNameLower = msg.character_name?.toLowerCase()?.trim();
      if (msgNameLower && nameToId.has(msgNameLower)) {
        inferredSender = nameToId.get(msgNameLower);
      } else if (msg.sender_character_id && sortedIds.includes(msg.sender_character_id)) {
        inferredSender = msg.sender_character_id;
      } else if (msg.character_id && sortedIds.includes(msg.character_id)) {
        inferredSender = msg.character_id;
      } else {
        // Fallback: user messages have sender_type='user', assign sender as participant A
        inferredSender = msg.sender_type === 'user' ? sortedIds[0] : sortedIds[0];
      }
      const inferredReceiver = inferredSender === sortedIds[0] ? sortedIds[1] : sortedIds[0];

      if (writeCount > 0 && writeCount % 5 === 0) {
        await new Promise(r => setTimeout(r, 600));
      }

      await base44.asServiceRole.entities.Message.update(msg.id, {
        shared_conversation_key: newCanonicalKey,
        participant_character_ids: sortedIds,
        channel: 'world_phone',
        sender_character_id: inferredSender,
        receiver_character_id: inferredReceiver,
      }).catch(e => console.warn(`[manualReanchor] msg backfill warn ${msg.id.substring(0,8)}: ${e.message}`));

      backfilled++;
      writeCount++;
    }

    summary.status = 'repaired';
    summary.messages_to_backfill = msgs.length;
    summary.messages_backfilled = backfilled;
    summary.messages_skipped = skipped;

    console.log(
      `[manualReanchorWorldPhoneConversation] repaired convo=${conversation_id.substring(0,8)}` +
      ` | a=${charA.name} b=${charB.name} | msgs=${msgs.length} backfilled=${backfilled}`
    );

    return Response.json(summary);

  } catch (error) {
    console.error('[manualReanchorWorldPhoneConversation]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});