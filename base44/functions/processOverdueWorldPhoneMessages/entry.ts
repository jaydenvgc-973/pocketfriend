import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * processOverdueWorldPhoneMessages
 *
 * WORLD PHONE / WORLD CONTACTS RESPONSE ENFORCEMENT
 *
 * Finds bilateral World Phone messages that have been unanswered for more than
 * the configured threshold (default: 48 hours) and generates a response from
 * the receiving character using the canonical sendWorldPhoneMessage path.
 *
 * RULES:
 * - Only processes bilateral World Phone conversations (channel='world_phone' with
 *   both sender_character_id and receiver_character_id populated)
 * - Receiver must be awake, not jailed, not house_arrested
 * - Only generates one catch-up response per unanswered message
 * - If no valid non-World Phone direct conversation exists for the response,
 *   it is generated into the canonical WP thread (NOT into a user's direct chat)
 * - Unanswered is defined as: last message was FROM Character A to Character B,
 *   and Character B has NOT replied since
 * - Valid blocking conditions (no response required):
 *     - receiver is jailed
 *     - receiver has house_arrest_active
 *     - relationship tension_level > 85 (effectively blocked sender)
 *     - receiver is sleeping (response deferred until awake)
 *
 * Called by a scheduled automation every 6 hours.
 */

const OVERDUE_HOURS = 48;
const MAX_RESPONSES_PER_RUN = 5; // cap to avoid rate limit

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Auth — works in scheduled context (no user token) and direct calls
    let callerEmail = null;
    try {
      const me = await base44.auth.me();
      callerEmail = me?.email || null;
    } catch { /* scheduled — no session */ }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun === true;
    const overdueHours = body.overdueHours || OVERDUE_HOURS;

    const cutoff = new Date(Date.now() - overdueHours * 3600 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    const log = [];
    const processed = [];
    const skipped = [];

    log.push(`[processOverdueWorldPhoneMessages] START | dryRun=${dryRun} | overdueHours=${overdueHours} | cutoff=${cutoff}`);

    // ── STEP 1: FETCH ALL WORLD PHONE CONVERSATIONS ─────────────────────────
    const convos = await base44.asServiceRole.entities.Conversation.filter(
      { channel: 'world_phone' },
      '-last_message_date',
      200
    ).catch(() => []);

    log.push(`[processOverdueWorldPhoneMessages] WP convos found: ${convos.length}`);

    let responsesGenerated = 0;

    for (const convo of convos) {
      if (responsesGenerated >= MAX_RESPONSES_PER_RUN) break;

      // Must have bilateral participants
      const participants = convo.participant_character_ids || convo.character_ids || [];
      if (participants.length !== 2) continue;

      // Fetch last few messages
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id },
        '-timestamp',
        10
      ).catch(() => []);

      // Filter to real bilateral messages (not narrative, not excluded)
      const realMsgs = msgs.filter(m =>
        !m.is_narrative &&
        !m.canon_excluded &&
        m.content?.trim() &&
        m.sender_character_id &&
        m.receiver_character_id
      );

      if (realMsgs.length === 0) continue;

      const lastMsg = realMsgs[0]; // most recent
      const lastMsgTime = lastMsg.timestamp || lastMsg.created_date;
      if (!lastMsgTime) continue;

      const ageHours = (Date.now() - new Date(lastMsgTime).getTime()) / 3600000;
      if (ageHours < overdueHours) continue; // not yet overdue

      const senderId = lastMsg.sender_character_id;
      const receiverId = lastMsg.receiver_character_id;

      // Check if receiver already replied since this message
      const receiverReplied = realMsgs.some(m =>
        m.sender_character_id === receiverId &&
        new Date(m.timestamp || m.created_date) > new Date(lastMsgTime)
      );
      if (receiverReplied) continue;

      // ── FETCH RECEIVER CHARACTER ────────────────────────────────────────────
      const receiverArr = await base44.asServiceRole.entities.Character.filter(
        { id: receiverId }, null, 1
      ).catch(() => []);
      const receiver = receiverArr[0];
      if (!receiver) {
        skipped.push({ convo_id: convo.id, reason: 'receiver_not_found', receiver_id: receiverId });
        continue;
      }

      // ── BLOCKING CONDITIONS ─────────────────────────────────────────────────
      if (receiver.is_jailed) {
        skipped.push({ convo_id: convo.id, reason: 'receiver_jailed', receiver: receiver.name });
        continue;
      }
      if (receiver.house_arrest_active) {
        skipped.push({ convo_id: convo.id, reason: 'receiver_house_arrest', receiver: receiver.name });
        continue;
      }
      // Receiver sleeping — defer, don't skip permanently
      const isSleeping = receiver.resolved_presence_status === 'sleeping' ||
        receiver.resolved_presence_status === 'napping';
      if (isSleeping) {
        skipped.push({ convo_id: convo.id, reason: 'receiver_sleeping', receiver: receiver.name });
        continue;
      }

      // Check relationship tension in receiver's fictional_relationships
      const rel = (receiver.fictional_relationships || []).find(
        r => r.related_character_id === senderId
      );
      if (rel && (rel.tension_level ?? 0) > 85) {
        skipped.push({ convo_id: convo.id, reason: 'relationship_blocked_by_tension', receiver: receiver.name, tension: rel.tension_level });
        continue;
      }

      // ── FETCH SENDER ───────────────────────────────────────────────────────
      const senderArr = await base44.asServiceRole.entities.Character.filter(
        { id: senderId }, null, 1
      ).catch(() => []);
      const sender = senderArr[0];
      if (!sender) {
        skipped.push({ convo_id: convo.id, reason: 'sender_not_found', sender_id: senderId });
        continue;
      }

      log.push(`[processOverdueWorldPhoneMessages] Overdue: ${receiver.name} owes reply to ${sender.name} | age=${Math.round(ageHours)}h | msg="${lastMsg.content?.substring(0, 60)}"`);

      if (dryRun) {
        processed.push({
          dry_run: true,
          receiver: receiver.name,
          sender: sender.name,
          convo_id: convo.id,
          age_hours: Math.round(ageHours),
          original_msg: lastMsg.content?.substring(0, 80),
        });
        continue;
      }

      // ── GENERATE CATCH-UP RESPONSE ──────────────────────────────────────────
      // Build a contextual reply from receiver to sender's message
      const ownerEmail = receiver.owner_email || sender.owner_email || convo.owner_email;

      // Build minimal personality context for the receiver
      const receiverPersonality = [
        receiver.personality_summary,
        receiver.communication_style,
        receiver.emotional_state ? `Current emotional state: ${receiver.emotional_state}` : null,
        receiver.occupation ? `Occupation: ${receiver.occupation}` : null,
      ].filter(Boolean).join('. ');

      const relContext = rel
        ? `Your relationship with ${sender.name}: ${rel.relationship_type || 'contact'}, friendship ${rel.friendship_level ?? 50}/100, trust ${rel.trust_level ?? 50}/100.`
        : `${sender.name} is someone you know.`;

      const timeNote = ageHours > 72
        ? `It has been ${Math.round(ageHours / 24)} days since they sent this.`
        : `It has been about ${Math.round(ageHours)} hours since they sent this.`;

      const catchUpPrompt = `You are ${receiver.name}. ${receiverPersonality}

${relContext}

${sender.name} sent you this message ${timeNote}:
"${lastMsg.content}"

You're just now getting around to responding. Write a short, natural catch-up reply in your own voice.
- Acknowledge the delay naturally if it was long (2+ days): "Sorry, been busy" / "Just seeing this" / "Heads up been slammed"
- If it was shorter (under 2 days), just reply normally without belaboring the delay
- 1-3 sentences max. Sound real. Sound like you.
- Return ONLY the message text.`;

      let replyText = null;
      try {
        const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: catchUpPrompt,
        });
        replyText = (typeof llmResult === 'string' ? llmResult : '').trim();
      } catch (llmErr) {
        log.push(`[processOverdueWorldPhoneMessages] LLM failed for ${receiver.name}: ${llmErr.message}`);
      }

      if (!replyText) {
        // Safe fallback
        replyText = ageHours > 72
          ? `Hey, sorry I'm just seeing this. Been a lot going on.`
          : `Hey, sorry for the late reply.`;
      }

      // ── WRITE THE REPLY MESSAGE ─────────────────────────────────────────────
      const participantIds = [senderId, receiverId].sort();
      const sharedKey = convo.shared_conversation_key ||
        `world_phone::${participantIds[0]}::${participantIds[1]}`;

      const savedMsg = await base44.asServiceRole.entities.Message.create({
        conversation_id: convo.id,
        sender_type: 'character',
        character_id: receiverId,
        character_name: receiver.name,
        sender_character_id: receiverId,
        receiver_character_id: senderId,
        participant_character_ids: participantIds,
        shared_conversation_key: sharedKey,
        content: replyText,
        timestamp: nowIso,
        channel: 'world_phone',
        is_read: false,
        sync_status: 'complete',
        recovery_signal: false,
        memory_eligible: true,
        relationship_eligible: true,
        autonomy_marker: 'overdue_catch_up',
      }).catch(err => {
        log.push(`[processOverdueWorldPhoneMessages] Message.create failed: ${err.message}`);
        return null;
      });

      if (!savedMsg) continue;

      // Update conversation preview
      await base44.asServiceRole.entities.Conversation.update(convo.id, {
        last_message_preview: replyText.substring(0, 100),
        last_message_date: nowIso,
      }).catch(() => {});

      // Write bilateral memories
      await Promise.all([
        base44.asServiceRole.entities.CharacterMemory.create({
          character_id: receiverId,
          memory_type: 'relationship',
          memory_text: `Replied to ${sender.name} after a ${Math.round(ageHours)}-hour delay: "${replyText.substring(0, 150)}"`,
          memory_summary: `[overdue_reply] Caught up with ${sender.name}`,
          related_character_id: senderId,
          importance_score: 3,
          confidence_score: 0.9,
          permanence: 'long_term',
        }).catch(() => null),
        base44.asServiceRole.entities.CharacterMemory.create({
          character_id: senderId,
          memory_type: 'relationship',
          memory_text: `${receiver.name} finally replied after ${Math.round(ageHours)} hours: "${replyText.substring(0, 150)}"`,
          memory_summary: `[overdue_reply] Heard back from ${receiver.name}`,
          related_character_id: receiverId,
          importance_score: 3,
          confidence_score: 0.9,
          permanence: 'long_term',
        }).catch(() => null),
      ]);

      responsesGenerated++;
      processed.push({
        receiver: receiver.name,
        sender: sender.name,
        convo_id: convo.id,
        message_id: savedMsg.id,
        age_hours: Math.round(ageHours),
        reply_preview: replyText.substring(0, 80),
        original_msg: lastMsg.content?.substring(0, 80),
      });

      console.log(`[processOverdueWorldPhoneMessages] ✓ ${receiver.name} replied to ${sender.name} | age=${Math.round(ageHours)}h | msg=${savedMsg.id}`);

      // Throttle
      await new Promise(r => setTimeout(r, 500));
    }

    log.push(`[processOverdueWorldPhoneMessages] DONE | responses_generated=${responsesGenerated} | skipped=${skipped.length}`);

    return Response.json({
      success: true,
      dry_run: dryRun,
      responses_generated: responsesGenerated,
      skipped_count: skipped.length,
      processed,
      skipped,
      log,
      timestamp: nowIso,
    });

  } catch (error) {
    console.error('[processOverdueWorldPhoneMessages] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});