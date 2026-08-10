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

    // Recalculate room occupancy after lazy expiration so the sanitized
    // current_occupancy on the GatheringRoom entity stays authoritative.
    if (stale.length > 0) {
      try {
        await base44.asServiceRole.functions.invoke('recalculateGatheringRoomOccupancy', {
          gathering_room_id: gatheringRoomId,
        });
      } catch (_) {}
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

    // ── 3.5. RE-RESOLVE SENDER AVATAR ──
    // User-type participants may have null avatar_url if created before the avatar
    // fix. Re-resolve from the User entity (same source as getGatheringRoomParticipants
    // and UserCard on Home) so the message always carries the correct room-facing avatar.
    let resolvedSenderAvatarUrl = sender.avatar_url;
    if (!resolvedSenderAvatarUrl && sender.participant_type === 'user') {
      try {
        const senderUsers = await base44.asServiceRole.entities.User.filter({ id: sender.participant_id }, null, 1);
        const senderUser = senderUsers[0];
        if (senderUser) {
          resolvedSenderAvatarUrl = senderUser.generated_avatar_urls?.[0] || senderUser.reference_image_urls?.[0] || null;
        }
      } catch (_) {}
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
      sender_avatar_url: resolvedSenderAvatarUrl,
      content,
      is_directed: isDirected,
      directed_to_participant_ids: directedToParticipantIds,
      directed_to_participant_names: directedToNames,
      timestamp: nowIso,
      image_url: imageUrl,
      media_share: mediaShare,
    });

    // ── 6. GENERATE CHARACTER RESPONSES from the ROOM-WIDE participant pool ─────
    // The response candidate pool is ALL valid active characters currently present
    // in this Gathering Room — NOT just the sender's own characters. This prevents
    // account-structure leakage through response timing and grouping.
    //
    // Each character independently evaluates whether they have a natural reason to
    // respond. Ownership is used ONLY to load the character record (authorization)
    // and to attribute the response message — NOT to determine response eligibility.
    // Room presence is the participation authority.
    //
    // Cross-account character responses are committed with the character's own
    // owner_email and session_id, so the message is correctly attributed to the
    // character's owning account.
    //
    // Responses are generated in parallel and committed individually as they
    // complete, producing natural sequencing — not an account-grouped block.

    // 6a. Get all valid active sessions in the room (cross-account)
    const allRoomSessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { gathering_room_id: gatheringRoomId, status: 'active' },
      'started_at', 50
    );
    const validRoomSessionIds = new Set(
      allRoomSessions
        .filter(s => new Date(s.expires_at).getTime() > now.getTime())
        .map(s => s.id)
    );

    // 6b. Re-fetch all participants (the earlier fetch was capped at 20; rooms can hold up to 8)
    const allRoomParticipants = await base44.asServiceRole.entities.GatheringRoomParticipant.filter(
      { gathering_room_id: gatheringRoomId },
      'joined_at', 50
    );
    const validRoomParticipants = allRoomParticipants.filter(p => validRoomSessionIds.has(p.session_id));

    // 6c. Build the room-wide character candidate pool
    // All character-type participants in valid active sessions, excluding the sender
    // (a character must not respond to its own message).
    const roomCharacterPool = validRoomParticipants.filter(
      p => p.participant_type === 'character' && p.id !== sender.id
    );

    const characterResponses = [];

    if (roomCharacterPool.length > 0) {
      // Build shared room context for all candidates
      const roomResult = await base44.asServiceRole.entities.GatheringRoom.filter({ id: gatheringRoomId }, null, 1);
      const room = roomResult[0];

      const activeMedia = room?.active_media;
      const mediaContext = activeMedia && activeMedia.media_type && activeMedia.media_type !== 'none'
        ? `\nThere is currently ${activeMedia.media_type === 'video' ? 'a video' : activeMedia.media_type === 'music' ? 'music' : 'an image'} playing in the room${activeMedia.title ? ` ("${activeMedia.title}")` : ''}. You can naturally react to it if appropriate.`
        : '';

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

      // Participant names only — NO type disclosure
      const participantNames = validRoomParticipants.map(p => p.participant_name);

      // 6d. Generate responses in parallel — each character independently decides
      // whether to respond. Responses commit as each LLM call completes, producing
      // natural sequencing rather than an account-grouped block.
      const responsePromises = roomCharacterPool.map(async (charPart) => {
        try {
          // Load full character record by ID — NO owner_email filter.
          // The character may belong to any account present in the room.
          // owner_email is used only for message attribution, not eligibility.
          const charRecords = await base44.asServiceRole.entities.Character.filter(
            { id: charPart.participant_id },
            null, 1
          );
          const charRecord = charRecords[0];
          if (!charRecord) return null;

          const prompt = [
            `You are ${charRecord.name}, currently in a shared social space called "${room?.name || 'a Gathering Room'}".`,
            room?.description ? `The space: ${room.description}` : '',
            '',
            `You are one of several people currently present in this shared space.`,
            `The people currently present are: ${participantNames.join(', ')}.`,
            `Everyone here is simply a person. Do not speculate about or reveal whether anyone is a user, character, AI, human, NPC, or bot.`,
            `Do not refer to anyone as "the user," "a character," "an AI," or similar labels.`,
            mediaContext,
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

          const llmRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt,
            model: 'gemini_3_flash',
          });

          const responseText = typeof llmRes === 'string' ? llmRes : (llmRes?.response || llmRes?.text || JSON.stringify(llmRes));
          const trimmed = responseText.trim();

          // Skip if character chooses to stay silent
          if (!trimmed || trimmed.includes('[SILENCE]')) return null;

          // Resolve character avatar (participant record, then Character entity fallback)
          let charAvatarUrl = charPart.avatar_url;
          if (!charAvatarUrl) {
            charAvatarUrl = charRecord.avatar_url || charRecord.image_avatar_url || null;
          }

          // Commit the response with the CHARACTER's owner_email and session_id,
          // not the sender's. This correctly attributes the message to the
          // character's owning account — the character speaks for itself, not
          // as part of the sender's account batch.
          const charMsg = await base44.asServiceRole.entities.GatheringRoomMessage.create({
            gathering_room_id: gatheringRoomId,
            session_id: charPart.session_id,
            owner_email: charPart.owner_email,
            sender_participant_id: charPart.id,
            sender_participant_name: charPart.participant_name,
            sender_avatar_url: charAvatarUrl,
            content: trimmed,
            is_directed: false,
            directed_to_participant_ids: [],
            directed_to_participant_names: [],
            timestamp: new Date().toISOString(),
          });
          return charMsg;
        } catch (err) {
          console.warn(`[gatheringRoom] Character response failed for ${charPart.participant_name}: ${err?.message}`);
          return null;
        }
      });

      const results = await Promise.allSettled(responsePromises);
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          characterResponses.push(r.value);
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