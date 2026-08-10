import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const gatheringRoomId = body.gathering_room_id;
    const content = body.content || '';
    const senderParticipantId = body.sender_participant_id || null;
    const isDirected = !!body.is_directed;
    const directedToParticipantIds = Array.isArray(body.directed_to_participant_ids) ? body.directed_to_participant_ids : [];
    const imageUrl = body.image_url || null;
    const mediaShare = body.media_share || null;

    if (!gatheringRoomId || !content) {
      return Response.json({ error: 'Missing gathering_room_id or content' }, { status: 400 });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // ── 1. LAZY EXPIRATION: expire stale sessions before processing ──
    const allSessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { gathering_room_id: gatheringRoomId, status: 'active' },
      null, 50
    );
    const stale = allSessions.filter(s => new Date(s.expires_at).getTime() < now.getTime());
    for (const sess of stale) {
      await base44.asServiceRole.entities.GatheringRoomSession.update(sess.id, {
        status: 'expired', ended_at: nowIso,
      });
      await base44.asServiceRole.entities.GatheringRoomParticipant.deleteMany({ session_id: sess.id });
      await base44.asServiceRole.entities.GatheringRoomCooldown.create({
        gathering_room_id: gatheringRoomId,
        gathering_room_name: sess.gathering_room_name,
        owner_email: sess.owner_email,
        owner_user_id: sess.owner_user_id,
        cooldown_until: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
        reason: 'expired',
        character_ids: sess.character_ids || [],
        created_at: nowIso,
      });
    }

    // ── 2. VERIFY SENDER HAS ACTIVE SESSION ──
    const userSessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { gathering_room_id: gatheringRoomId, owner_email: user.email, status: 'active' },
      null, 1
    );
    const session = userSessions[0];
    if (!session) {
      return Response.json({ error: 'You do not have an active session in this Gathering Room.' }, { status: 403 });
    }

    // ── 3. RESOLVE SENDER PARTICIPANT ──
    // If sender_participant_id is provided, verify it belongs to this user's session.
    // Otherwise default to the user's own participant record.
    const allParticipants = await base44.asServiceRole.entities.GatheringRoomParticipant.filter(
      { gathering_room_id: gatheringRoomId },
      null, 20
    );

    const userParticipants = allParticipants.filter(p => p.session_id === session.id);
    let sender = userParticipants.find(p => p.id === senderParticipantId);
    if (!sender) {
      // Default to the user participant (not a character)
      sender = userParticipants.find(p => p.participant_type === 'user');
    }
    if (!sender) {
      return Response.json({ error: 'Sender participant not found in your session.' }, { status: 403 });
    }

    // ── 4. RESOLVE DIRECTED-TO PARTICIPANT NAMES ──
    let directedToNames = [];
    if (isDirected && directedToParticipantIds.length > 0) {
      directedToNames = allParticipants
        .filter(p => directedToParticipantIds.includes(p.id))
        .map(p => p.participant_name);
    }

    // ── 5. CREATE MESSAGE ──
    const message = await base44.asServiceRole.entities.GatheringRoomMessage.create({
      gathering_room_id: gatheringRoomId,
      session_id: session.id,
      owner_email: user.email,
      sender_participant_id: sender.id,
      sender_participant_name: sender.participant_name,
      sender_avatar_url: sender.avatar_url,
      sender_participant_type: sender.participant_type,
      content,
      is_directed: isDirected,
      directed_to_participant_ids: directedToParticipantIds,
      directed_to_participant_names: directedToNames,
      timestamp: nowIso,
      image_url: imageUrl,
      media_share: mediaShare,
    });

    // ── 6. GENERATE CHARACTER RESPONSES for user's own characters in the room ──
    // Only the user's own characters respond to their messages. Other accounts'
    // characters respond when their owners interact. This keeps simulation authority
    // with each character's owning account.
    const characterParticipants = userParticipants.filter(p => p.participant_type === 'character');

    const characterResponses = [];

    if (characterParticipants.length > 0) {
      // Build room context for character LLM
      const room = await base44.asServiceRole.entities.GatheringRoom.filter({ id: gatheringRoomId }, null, 1);

      // Recent messages for context (last 12)
      const recentMessages = await base44.asServiceRole.entities.GatheringRoomMessage.filter(
        { gathering_room_id: gatheringRoomId },
        '-timestamp', 12
      );
      const conversationHistory = recentMessages.reverse().map(m => {
        let line = `${m.sender_participant_name}`;
        if (m.is_directed && m.directed_to_participant_names?.length > 0) {
          line += ` (to ${m.directed_to_participant_names.join(', ')})`;
        }
        line += `: ${m.content}`;
        return line;
      }).join('\n');

      // Participant names only — NO type disclosure (rule 8)
      const participantNames = allParticipants.map(p => p.participant_name);

      for (const charPart of characterParticipants) {
        // Don't have a character respond to its own message
        if (charPart.id === sender.id) continue;

        // Load full character record for personality/context
        const charRecords = await base44.asServiceRole.entities.Character.filter(
          { id: charPart.participant_id, owner_email: user.email },
          null, 1
        );
        const charRecord = charRecords[0];
        if (!charRecord) continue;

        const prompt = [
          `You are ${charRecord.name}, currently in a shared social space called "${room[0]?.name || 'a Gathering Room'}".`,
          room[0]?.description ? `The space: ${room[0].description}` : '',
          '',
          `You are one of several people currently present in this shared space.`,
          `The people currently present are: ${participantNames.join(', ')}.`,
          `Everyone here is simply a person. Do not speculate about or reveal whether anyone is a user, character, AI, human, NPC, or bot.`,
          `Do not refer to anyone as "the user," "a character," "an AI," or similar labels.`,
          '',
          `Recent conversation:`,
          conversationHistory || '(no conversation yet)',
          '',
          `Your personality: ${charRecord.personality_summary || 'Not specified'}`,
          `Your communication style: ${charRecord.communication_style || 'Natural and conversational'}`,
          charRecord.emotional_state ? `Your current emotional state: ${charRecord.emotional_state}` : '',
          '',
          isDirected && directedToNames.includes(charRecord.name)
            ? `Someone just directed a message at you. Respond naturally.`
            : `Someone just said something in the shared space. Respond naturally if you have something to add — or stay silent if you wouldn't naturally speak up right now.`,
          '',
          `Rules:`,
          `- Stay in character as ${charRecord.name}.`,
          `- Keep your response brief and natural (1-3 sentences).`,
          `- Never reveal or speculate about whether other participants are users, characters, AI, or any other entity type.`,
          `- Refer to everyone by name only.`,
          `- If you have nothing natural to say, respond with exactly: [SILENCE]`,
        ].filter(Boolean).join('\n');

        try {
          const llmRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt,
            model: 'gemini_3_flash',
          });

          const responseText = typeof llmRes === 'string' ? llmRes : (llmRes?.response || llmRes?.text || JSON.stringify(llmRes));
          const trimmed = responseText.trim();

          // Skip if character chooses to stay silent
          if (trimmed && !trimmed.includes('[SILENCE]')) {
            const charMsg = await base44.asServiceRole.entities.GatheringRoomMessage.create({
              gathering_room_id: gatheringRoomId,
              session_id: session.id,
              owner_email: user.email,
              sender_participant_id: charPart.id,
              sender_participant_name: charPart.participant_name,
              sender_avatar_url: charPart.avatar_url,
              sender_participant_type: 'character',
              content: trimmed,
              is_directed: false,
              directed_to_participant_ids: [],
              directed_to_participant_names: [],
              timestamp: new Date(now.getTime() + 1000).toISOString(),
            });
            characterResponses.push(charMsg);
          }
        } catch (llmErr) {
          console.warn(`[gatheringRoom] Character response failed for ${charPart.participant_name}: ${llmErr?.message}`);
        }
      }
    }

    return Response.json({
      success: true,
      message,
      character_responses: characterResponses,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});