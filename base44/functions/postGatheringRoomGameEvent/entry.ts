import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// ── postGatheringRoomGameEvent ───────────────────────────────────────────────
// Posts a game activity/result as a ROOM EVENT — not user-authored speech.
// The message is marked is_game_event=true with game_event_data so the frontend
// renders it as a game event card, not a chat bubble. Characters react to it as
// an event and form memories through the same canonical Memory pathway.
//
// This preserves sender/source semantics: the game initiator's participant ID
// is used for authorization (they must be in the room), but the message is
// visually and semantically a game event, not the initiator "saying" anything.
//
// Character reactions + memory extraction run non-blocking (same pattern as
// sendGatheringRoomMessage) so the HTTP response returns immediately.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const gatheringRoomId = body.gathering_room_id;
    const gameId = body.game_id;

    if (!gatheringRoomId || !gameId) {
      return Response.json({ error: 'Missing gathering_room_id or game_id' }, { status: 400 });
    }

    // ── 1. LOAD GAME ──
    const games = await base44.asServiceRole.entities.GatheringRoomGame.filter({ id: gameId }, null, 1);
    const game = games[0];
    if (!game) return Response.json({ error: 'Game not found' }, { status: 404 });
    if (game.gathering_room_id !== gatheringRoomId) {
      return Response.json({ error: 'Game does not belong to this room' }, { status: 400 });
    }
    if (game.status !== 'completed') {
      return Response.json({ error: 'Game is not completed' }, { status: 400 });
    }

    // ── 2. LOAD ROOM + ENSURE EPOCH ──
    const nowIso = new Date().toISOString();
    const roomResult = await base44.asServiceRole.entities.GatheringRoom.filter({ id: gatheringRoomId }, null, 1);
    let room = roomResult[0];
    if (room && !room.gathering_epoch) {
      await base44.asServiceRole.entities.GatheringRoom.update(gatheringRoomId, { gathering_epoch: nowIso });
      room = { ...room, gathering_epoch: nowIso };
    }

    // ── 3. RESOLVE INITIATOR PARTICIPANT (for authorization) ──
    // The initiator is participants[0] — the user who started the game.
    const initiator = game.participants?.[0];
    if (!initiator || initiator.owner_email !== user.email) {
      return Response.json({ error: 'Only the game initiator can post the result' }, { status: 403 });
    }

    // ── 4. CREATE GAME EVENT MESSAGE ──
    const resultSummary = game.result_summary || `${game.participants.map(p => p.participant_name).join(' vs ')} — game finished.`;
    const winnerName = game.winner_index === -1 ? 'Draw' : (game.participants?.[game.winner_index]?.participant_name || '');

    const message = await base44.asServiceRole.entities.GatheringRoomMessage.create({
      gathering_room_id: gatheringRoomId,
      session_id: null,
      owner_email: user.email,
      sender_participant_id: initiator.participant_id,
      sender_participant_name: 'Game Activity',
      sender_avatar_url: null,
      sender_participant_type: 'user',
      content: resultSummary,
      is_game_event: true,
      game_event_data: {
        game_type: game.game_type,
        result_summary: resultSummary,
        winner_name: winnerName,
        participant_names: game.participants.map(p => p.participant_name),
      },
      is_directed: false,
      directed_to_participant_ids: [],
      directed_to_participant_names: [],
      timestamp: nowIso,
    });

    const __response = Response.json({ success: true, message });

    // ── 5. CHARACTER REACTIONS + MEMORY EXTRACTION (NON-BLOCKING) ──────────────
    (async () => {
      try {
        const allRoomSessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
          { gathering_room_id: gatheringRoomId, status: 'active' },
          'started_at', 50
        );
        const validSessionIds = new Set(
          allRoomSessions
            .filter(s => new Date(s.expires_at).getTime() > Date.now())
            .map(s => s.id)
        );

        const allRoomParticipants = await base44.asServiceRole.entities.GatheringRoomParticipant.filter(
          { gathering_room_id: gatheringRoomId },
          'joined_at', 50
        );
        const validParticipants = allRoomParticipants.filter(p => validSessionIds.has(p.session_id));
        const characterParticipants = validParticipants.filter(p => p.participant_type === 'character');

        if (characterParticipants.length === 0) return;

        // Load character records
        const charRecords = [];
        for (const cp of characterParticipants) {
          try {
            const chars = await base44.asServiceRole.entities.Character.filter({ id: cp.participant_id }, null, 1);
            if (chars[0]) charRecords.push({ participant: cp, record: chars[0] });
          } catch (_) {}
        }
        if (charRecords.length === 0) return;

        // Recent conversation context (last 12 messages from current gathering)
        const epochFilter = room?.gathering_epoch
          ? { gathering_room_id: gatheringRoomId, timestamp: { $gte: room.gathering_epoch } }
          : { gathering_room_id: gatheringRoomId };
        const recentMessages = await base44.asServiceRole.entities.GatheringRoomMessage.filter(
          epochFilter, '-timestamp', 12
        );
        const conversationHistory = recentMessages.reverse().map(m => {
          if (m.is_game_event) return `[Game Event]: ${m.content}`;
          let line = `${m.sender_participant_name}`;
          if (m.is_directed && m.directed_to_participant_names?.length > 0) {
            line += ` (to ${m.directed_to_participant_names.join(', ')})`;
          }
          line += `: ${m.content}`;
          return line;
        }).join('\n');

        const participantNames = validParticipants.map(p => p.participant_name);
        const gameLabel = game.game_type === 'bowling' ? 'Bowling'
          : game.game_type === 'tictactoe' ? 'Tic-Tac-Toe'
          : game.game_type === 'dotsandboxes' ? 'Dots & Boxes'
          : game.game_type === 'pool' ? 'Pool'
          : game.game_type === 'gemduel' ? 'Gem Duel'
          : game.game_type === 'chemistry' ? 'Chemistry'
          : 'a game';

        // ── 5a. CHARACTER REACTIONS ──
        const charDescriptions = charRecords.map(c =>
          `${c.record.name}: ${c.record.personality_summary || 'Not specified'}. Communication style: ${c.record.communication_style || 'Natural and conversational'}. Emotional state: ${c.record.emotional_state || 'calm'}`
        ).join('\n');

        const reactionPrompt = [
          `You are moderating reactions in a shared social space called "${room?.name || 'a Gathering Room'}".`,
          room?.description ? `The space: ${room.description}` : '',
          '',
          `The people currently present are: ${participantNames.join(', ')}.`,
          `Everyone here is simply a person. Do not speculate about or reveal whether anyone is a user, character, AI, human, NPC, or bot.`,
          '',
          `A game activity just occurred:`,
          `Game: ${gameLabel}`,
          `Result: ${resultSummary}`,
          '',
          `Recent conversation context:`,
          conversationHistory || '(no conversation yet)',
          '',
          `The characters present are:`,
          charDescriptions,
          '',
          `Based on the game result and each character's personality, determine which character(s) naturally have a reason to react.`,
          `Not everyone needs to react. Some might stay silent.`,
          `For each character who should react, generate their reaction in character.`,
          `Rules:`,
          `- Stay in character.`,
          `- Keep reactions brief and natural (1-2 sentences).`,
          `- React to the game result as an event that happened — do NOT claim you were playing unless you were a participant.`,
          `- If you were a participant, you may comment on your own performance or the outcome.`,
          `- If you were not a participant, you may comment on what you observed.`,
          `- Never reveal or speculate about whether participants are users, characters, AI, or any other entity type.`,
          `- Refer to everyone by name only.`,
        ].filter(Boolean).join('\n');

        try {
          const llmRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: reactionPrompt,
            model: 'gemini_3_flash',
            response_json_schema: {
              type: 'object',
              properties: {
                responses: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      character_name: { type: 'string' },
                      response: { type: 'string' }
                    },
                    required: ['character_name', 'response']
                  }
                }
              },
              required: ['responses']
            }
          });

          for (const resp of (llmRes?.responses || [])) {
            if (!resp.response?.trim()) continue;
            const matched = charRecords.find(c =>
              c.record.name.toLowerCase() === resp.character_name?.toLowerCase() ||
              c.participant.participant_name.toLowerCase() === resp.character_name?.toLowerCase()
            );
            if (!matched) continue;

            let charAvatarUrl = matched.participant.avatar_url || matched.record.avatar_url || matched.record.image_avatar_url || null;

            await base44.asServiceRole.entities.GatheringRoomMessage.create({
              gathering_room_id: gatheringRoomId,
              session_id: matched.participant.session_id,
              owner_email: matched.participant.owner_email,
              sender_participant_id: matched.participant.id,
              sender_participant_name: matched.participant.participant_name,
              sender_avatar_url: charAvatarUrl,
              sender_participant_type: 'character',
              content: resp.response.trim(),
              is_game_event: false,
              is_directed: false,
              directed_to_participant_ids: [],
              directed_to_participant_names: [],
              timestamp: new Date().toISOString(),
            });
          }
        } catch (err) {
          console.warn(`[gameEvent] Character reactions failed: ${err?.message}`);
        }

        // ── 5b. MEMORY EXTRACTION ──
        // Only the game RESULT is salient — not every individual move. The game
        // event message carries the result summary. Characters who were present
        // may form a memory of the game outcome if it was meaningful to them.
        try {
          const memCharDescriptions = charRecords.map(c =>
            `${c.record.name}: ${c.record.personality_summary || 'Not specified'}`
          ).join('\n');

          const memoryPrompt = [
            `You are analyzing a game activity that just occurred in a shared social space called "${room?.name || 'a Gathering Room'}".`,
            '',
            `Game: ${gameLabel}`,
            `Result: ${resultSummary}`,
            `Participants: ${game.participants.map(p => p.participant_name).join(', ')}`,
            '',
            `The characters present were:`,
            memCharDescriptions,
            '',
            `Determine which characters would form a lasting memory from this game.`,
            `Only form memories for meaningful game outcomes — a close win, a surprising result, a first time playing together, etc.`,
            `Do NOT form a memory for every casual game.`,
            `Include the location ("${room?.name || 'a Gathering Room'}") and the game type in the description.`,
            `Memory should be from the character's perspective — what they witnessed or experienced.`,
            `If the character was a participant, they remember playing and the outcome.`,
            `If the character was not a participant, they remember watching the game.`,
            `Do NOT reveal or speculate about whether any participant is a user, character, AI, or any entity type.`,
            '',
            `Return a JSON object with "memories" array. Each item has:`,
            `- character_name: exact character name`,
            `- title: brief summary (5-10 words)`,
            `- description: what happened, including the location, game, and who was involved`,
            `- emotional_impact: how it emotionally affected the character`,
            `Empty array if nothing salient enough to remember.`,
          ].filter(Boolean).join('\n');

          const memoryRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: memoryPrompt,
            model: 'gemini_3_flash',
            response_json_schema: {
              type: 'object',
              properties: {
                memories: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      character_name: { type: 'string' },
                      title: { type: 'string' },
                      description: { type: 'string' },
                      emotional_impact: { type: 'string' }
                    },
                    required: ['character_name', 'title', 'description']
                  }
                }
              },
              required: ['memories']
            }
          });

          for (const mem of (memoryRes?.memories || [])) {
            if (!mem.title?.trim() || !mem.description?.trim()) continue;
            const matched = charRecords.find(c =>
              c.record.name.toLowerCase() === mem.character_name?.toLowerCase() ||
              c.participant.participant_name.toLowerCase() === mem.character_name?.toLowerCase()
            );
            if (!matched) continue;

            await base44.asServiceRole.entities.Memory.create({
              character_id: matched.record.id,
              title: mem.title.trim(),
              description: mem.description.trim(),
              emotional_impact: mem.emotional_impact?.trim() || 'neutral',
              timestamp: nowIso,
              source_context: `gathering_room_game:${gatheringRoomId}:${room?.name || ''}:${game.game_type}`,
            });
          }
        } catch (memErr) {
          console.warn(`[gameEvent] Memory extraction failed: ${memErr?.message}`);
        }
      } catch (err) {
        console.warn(`[gameEvent] Background work failed: ${err?.message}`);
      }
    })();

    return __response;
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});