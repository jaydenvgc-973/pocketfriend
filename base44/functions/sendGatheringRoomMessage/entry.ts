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

    // ── 4.5. LOAD ROOM + ENSURE GATHERING EPOCH (synchronous) ──────────────────
    // The gathering_epoch scopes the live transcript. Set it before the message
    // commit so the message timestamp is always >= epoch. This runs synchronously
    // so the epoch is authoritative before any message is visible.
    const roomResult = await base44.asServiceRole.entities.GatheringRoom.filter({ id: gatheringRoomId }, null, 1);
    let room = roomResult[0];
    if (room && !room.gathering_epoch) {
      await base44.asServiceRole.entities.GatheringRoom.update(gatheringRoomId, {
        gathering_epoch: nowIso,
      });
      room = { ...room, gathering_epoch: nowIso };
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

    // Return immediately — the message is committed. Character responses and
    // memory extraction run without blocking the HTTP response. The sender sees
    // their message instantly; character responses arrive via realtime when ready.
    // This prevents "Network Error" when LLM calls take longer than the HTTP timeout.
    const __grResponse = Response.json({ success: true, message });

    // ── 6. GENERATE CHARACTER RESPONSES + MEMORY EXTRACTION (NON-BLOCKING) ─────
    // Fire LLM work without blocking — do not await. The HTTP response is already
    // prepared above; these operations commit their results via realtime.
    (async () => {
      try {
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
    // ── MEMORY EXTRACTION — SCENES PARITY ──────────────────────────────────────
    // Memory extraction writes to the SAME Memory entity used by normal Chat/Text/Scene
    // continuity. retrieveActiveMemory reads via Memory.filter({ character_id }) and
    // buildCanonicalCharacterContext injects the results into the Chat/Text prompt.
    //
    // CRITICAL: Memory extraction runs on EVERY message — regardless of whether any
    // character responded. A character who was present but silent still experienced
    // the conversation. If Mark says something about legacy and Ethan is present but
    // does not respond, Ethan must STILL form a memory of what he witnessed.
    //
    // The memory character pool includes ALL characters with valid active sessions
    // at the time of this message — INCLUDING the sender (a character who spoke must
    // remember what they said). This respects the participation window: only
    // characters with active, non-expired sessions are eligible. Messages before
    // entry or after exit are excluded because those sessions are not active.

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

    // 6c. Response candidate pool — all character-type participants EXCLUDING the sender
    // (a character must not respond to its own message).
    const roomCharacterPool = validRoomParticipants.filter(
      p => p.participant_type === 'character' && p.id !== sender.id
    );

    // 6d. Memory character pool — ALL character-type participants INCLUDING the sender
    // (a character who spoke must remember what they said). This is the participation
    // window: only characters with valid active sessions at this moment are eligible.
    const allRoomCharacterParticipants = validRoomParticipants.filter(
      p => p.participant_type === 'character'
    );

    const characterResponses = [];

    // 6e. Load ALL character records present in the room (for both response generation and memory)
    const allRoomCharacterRecords = [];
    for (const charPart of allRoomCharacterParticipants) {
      try {
        const charRecords = await base44.asServiceRole.entities.Character.filter(
          { id: charPart.participant_id }, null, 1
        );
        const charRecord = charRecords[0];
        if (charRecord) allRoomCharacterRecords.push({ participant: charPart, record: charRecord });
      } catch (_) {}
    }

    // 6f. Build shared room context (used by both response generation and memory extraction)
    // Room was already loaded and epoch ensured in step 4.5 (before message commit).
    let mediaContext = '';
    let conversationHistory = '';
    let participantNames = validRoomParticipants.map(p => p.participant_name);
    let relationshipContextBlock = '';
    let livedMemoryContextBlock = '';

    if (allRoomCharacterRecords.length > 0 || roomCharacterPool.length > 0) {
      const activeMedia = room?.active_media;
      mediaContext = activeMedia && activeMedia.media_type && activeMedia.media_type !== 'none'
        ? `\nThere is currently ${activeMedia.media_type === 'video' ? 'a video' : activeMedia.media_type === 'music' ? 'music' : 'an image'} playing in the room${activeMedia.title ? ` ("${activeMedia.title}")` : ''}. Characters can naturally react to it if appropriate.`
        : '';

      // Recent messages for context (last 12) — includes the message just committed
      // ── LIVE 20-MESSAGE WINDOW — scoped to current gathering ──────────────
      // Only messages from the current gathering (timestamp >= gathering_epoch)
      // are included in the LLM context, limited to the 20 newest. This is the
      // same bounded live transcript the frontend renders. Past gatherings do
      // not bloat the active interaction context. Character memory is written
      // separately by the memory extraction block below and is NOT truncated.
      const epochFilter = room?.gathering_epoch
        ? { gathering_room_id: gatheringRoomId, timestamp: { $gte: room.gathering_epoch } }
        : { gathering_room_id: gatheringRoomId };
      const recentMessages = await base44.asServiceRole.entities.GatheringRoomMessage.filter(
        epochFilter, '-timestamp', 20
      );
      conversationHistory = recentMessages.reverse().map(m => {
        let line = `${m.sender_participant_name}`;
        if (m.is_directed && m.directed_to_participant_names?.length > 0) {
          line += ` (to ${m.directed_to_participant_names.join(', ')})`;
        }
        line += `: ${m.content}`;
        return line;
      }).join('\n');

      // ── 6f.1. RELATIONSHIP CONTEXT — ASSEMBLED FROM MULTIPLE SOURCES ────────
      // The Gathering Room must carry each character's established relationships
      // into the generation context. Without this, the LLM infers relationships
      // from surnames or proximity, causing role drift.
      //
      // IMPORTANT: These sources are NOT a linear precedence chain. They represent
      // different kinds of information and are ASSEMBLED TOGETHER when
      // non-contradictory, each attributed to its source:
      //   - family_members: account-scoped profile Family list (stable character_id)
      //   - backstory / family_history: written family/back history (cross-account)
      //   - fictional_relationships: established relationship records (stable ID)
      //
      // A cross-account cousin pair may legitimately have BOTH:
      //   family_history → they are cousins
      //   Memory → they previously met in a Gathering Room
      // The memory does not establish the cousin relationship and the cousin
      // history does not substitute for their lived interaction. Both are present.
      //
      // Stable IDs (character_id, related_character_id) are preferred over name
      // matching wherever available. Name matching is used only where the source
      // has no structured ID (backstory prose).
      //
      // CRITICAL: Each fact is bound to the character whose record it comes from.
      // "Ethan's father is Vick" must never become "Eddie's father is Vick."
      // If no relationship is listed for a pair from any source, they may be
      // strangers — do NOT invent one from surnames, ages, or proximity.
      const otherCharacterParticipants = validRoomParticipants.filter(
        p => p.participant_type === 'character'
      );
      const relLines = [];
      for (const charRec of allRoomCharacterRecords) {
        const charName = charRec.record.name;
        const charId = charRec.record.id;
        const charRelationships = [];

        for (const otherPart of otherCharacterParticipants) {
          if (otherPart.participant_id === charId) continue; // skip self

          const otherName = otherPart.participant_name;
          const otherId = otherPart.participant_id;

          // 1. Profile Family list (account-scoped) — stable character_id preferred
          const familyMembers = charRec.record.family_members || [];
          const familyMatch = familyMembers.find(m =>
            m.character_id === otherId ||
            (m.name && m.name.toLowerCase() === otherName.toLowerCase())
          );
          if (familyMatch) {
            charRelationships.push({
              name: otherName,
              relationship: familyMatch.relationship_type || 'family member',
              source: 'profile Family list',
              detail: familyMatch.description || null,
            });
          }

          // 2. Written family/back history (cross-account family source)
          // No structured ID available — name match in prose is the only mechanism.
          const backstory = charRec.record.backstory || '';
          const familyHistory = charRec.record.family_history || '';
          const combinedHistory = `${backstory} ${familyHistory}`;
          const lowerHistory = combinedHistory.toLowerCase();
          const otherLower = otherName.toLowerCase();

          if (otherLower.length > 1 && lowerHistory.includes(otherLower)) {
            const idx = lowerHistory.indexOf(otherLower);
            const start = Math.max(0, idx - 120);
            const end = Math.min(combinedHistory.length, idx + otherName.length + 120);
            const context = combinedHistory.substring(start, end).trim();
            charRelationships.push({
              name: otherName,
              relationship: 'established in family/back history',
              source: 'written family history',
              detail: context,
            });
          }

          // 3. Fictional relationships (established character relationships)
          // Stable related_character_id preferred over name match.
          const ficRels = charRec.record.fictional_relationships || [];
          const ficMatch = ficRels.find(r =>
            r.related_character_id === otherId ||
            (r.person_name && r.person_name.toLowerCase() === otherName.toLowerCase())
          );
          if (ficMatch) {
            charRelationships.push({
              name: otherName,
              relationship: ficMatch.relationship_type || 'acquaintance',
              source: 'established relationship record',
              detail: ficMatch.description || ficMatch.history_summary || null,
            });
          }
          // All non-contradictory facts from all sources are assembled together.
          // If no source produced a fact for this pair, nothing is added — the
          // relationship remains unknown and must NOT be invented.
        }

        if (charRelationships.length > 0) {
          const lines = charRelationships.map(r => {
            let line = `  - ${r.name}: ${r.relationship} (source: ${r.source})`;
            if (r.detail) line += ` — ${r.detail.substring(0, 150)}`;
            return line;
          });
          relLines.push(`${charName} knows:\n${lines.join('\n')}`);
        }
      }

      if (relLines.length > 0) {
        relationshipContextBlock = [
          `════════════════════════════════════`,
          `ESTABLISHED RELATIONSHIPS — AUTHORITATIVE`,
          `Each fact below is bound to the character whose record it comes from.`,
          `Sources are assembled together — they are not a precedence chain.`,
          `Profile Family list absence does NOT mean two characters are unrelated —`,
          `cross-account family lives in written family/back history.`,
          `These facts take precedence over any inference from surnames, ages, or dialogue.`,
          `Never transfer one character's relationship role to another character.`,
          `If no relationship is listed for a pair, they may be strangers — do NOT invent one.`,
          `════════════════════════════════════`,
          relLines.join('\n\n'),
          `════════════════════════════════════`,
        ].join('\n');
      }

      // ── 6f.2. LIVED MEMORY — RECOGNITION AND CONTINUITY ─────────────────────
      // Lived memories persist independently of the 20-message transcript and
      // 30-minute room expiration. They add recognition continuity: "I remember
      // meeting this person before." They do NOT replace or compete with
      // established family/back history — they are a separate kind of information.
      //
      // MEMORY ENTITY IDENTITY NOTE:
      // The canonical Memory entity stores character_id (the owning character)
      // and prose title/description. It does NOT have structured participant IDs,
      // subject/object IDs, or other stable character references. Name matching in
      // prose is therefore the only available mechanism for finding memories
      // relevant to other participants. This is NOT equivalent to stable character
      // binding — it can miss nicknames, renamed characters, duplicate names, or
      // memories that refer to a person without repeating their full display name.
      // This limitation is inherited from the canonical Memory schema, not
      // introduced here. If the Memory entity gains structured participant IDs in
      // the future, this filter should prefer those IDs over name matching.
      //
      // RETRIEVAL: Uses retrieveActiveMemory (the canonical memory pathway with
      // semantic scoring) where available, falling back to asServiceRole direct
      // query for cross-account characters — same pattern as buildCanonicalCharacterContext.
      const memoryLines = [];
      for (const charRec of allRoomCharacterRecords) {
        const charName = charRec.record.name;
        const charId = charRec.record.id;
        const otherNames = otherCharacterParticipants
          .filter(p => p.participant_id !== charId)
          .map(p => p.participant_name)
          .filter(Boolean);

        if (otherNames.length === 0) continue;

        try {
          // Try canonical retrieveActiveMemory first (semantic scoring).
          // Pass other participants' names as context to boost relevant memories.
          // This works for same-account characters (user-scoped query).
          let memories = [];
          try {
            const memRes = await base44.functions.invoke('retrieveActiveMemory', {
              characterId: charId,
              currentMessage: otherNames.join(' '),
              recentMessages: [],
              topK: 20,
            }).catch(() => null);

            if (memRes?.data?.memories?.length > 0) {
              memories = memRes.data.memories;
            } else {
              // Fallback: asServiceRole direct query (cross-account characters where
              // retrieveActiveMemory's user-scoped query returns empty)
              memories = await base44.asServiceRole.entities.Memory.filter(
                { character_id: charId },
                '-timestamp',
                20
              ).catch(() => []);
            }
          } catch (_) {
            memories = await base44.asServiceRole.entities.Memory.filter(
              { character_id: charId },
              '-timestamp',
              20
            ).catch(() => []);
          }

          // Filter for memories mentioning other participants by name.
          // NOTE: This is prose-based name matching — the only mechanism available
          // given the Memory entity has no structured participant IDs. It is a
          // fallback, not a stable character binding.
          const relevant = memories.filter(m => {
            const memText = `${m.title || ''} ${m.description || ''}`.toLowerCase();
            return otherNames.some(name => {
              const lower = name.toLowerCase();
              return lower.length > 1 && memText.includes(lower);
            });
          });

          if (relevant.length > 0) {
            const memLines = relevant.slice(0, 4).map(m => {
              const title = m.title || 'Memory';
              const desc = (m.description || '').substring(0, 150);
              return `  - ${title}: ${desc}`;
            });
            memoryLines.push(`${charName} remembers:\n${memLines.join('\n')}`);
          }
        } catch (_) {}
      }

      if (memoryLines.length > 0) {
        livedMemoryContextBlock = [
          `LIVED MEMORY — RECOGNITION AND CONTINUITY (canonical memory, not transcript):`,
          `These are lived experiences from the canonical Memory entity.`,
          `They add recognition of previous encounters — they do NOT establish or`,
          `override family/back history. A memory of meeting someone does not make`,
          `them family; a family history does not substitute for a lived interaction.`,
          `They persist independently of the 20-message transcript and 30-minute room expiration.`,
          memoryLines.join('\n\n'),
        ].join('\n');
      }
    }

    // ── 6g. CHARACTER RESPONSE GENERATION (response candidates exclude sender) ──
    if (roomCharacterPool.length > 0 && room) {
      const characterRecords = allRoomCharacterRecords.filter(c =>
        roomCharacterPool.some(p => p.id === c.participant.id)
      );

      if (characterRecords.length > 0) {
        // ── CANONICAL CHARACTER CONTEXT ──────────────────────────────────────
        // Each character enters the Gathering Room as their FULL CANONICAL SELF.
        // buildCanonicalCharacterContext is the single source of truth for character
        // identity — personality, background, family, relationships, memories, hard
        // facts, life journal, education, religion, wardrobe, co-presence, world state,
        // story events, marketing traits, research findings. This is the SAME context
        // architecture used by Chat, Text, Scene, World Contacts, Narrative, Proactive,
        // and Automatic Narrative. No parallel memory system, no reduced identity.
        //
        // ownerEmailHint is set to each character's own owner_email so the canonical
        // context is built from the character's owning account perspective — their
        // world name, their user's presence, their memories, their relationships.
        // Cross-account interaction changes who is authorized to interact, not who
        // the character IS.
        // ── CANONICAL CHARACTER CONTEXT — SEQUENTIAL EXECUTION ──────────────
        // Each character enters the Gathering Room as their FULL CANONICAL SELF.
        // buildCanonicalCharacterContext is the single source of truth for character
        // identity — personality, background, family, relationships, memories, hard
        // facts, life journal, education, religion, wardrobe, co-presence, world state,
        // story events, marketing traits, research findings. This is the SAME context
        // architecture used by Chat, Text, Scene, World Contacts, Narrative, Proactive,
        // and Automatic Narrative. No parallel memory system, no reduced identity.
        //
        // ownerEmailHint is set to each character's own owner_email so the canonical
        // context is built from the character's owning account perspective — their
        // world name, their user's presence, their memories, their relationships.
        // Cross-account interaction changes who is authorized to interact, not who
        // the character IS.
        //
        // SEQUENTIAL EXECUTION: buildCanonicalCharacterContext internally makes 6+
        // cross-function invokes (enforceCharacterLocationPresence, retrieveActiveMemory,
        // resolveCharacterFamilyGraph, getCharacterTravelContext, buildWorldPhoneAwarenessBlock,
        // buildCommitmentAwarenessBlock, buildWeeklyPublicationAwarenessBlock). Calling
        // these in parallel via Promise.all for N characters creates N×6+ simultaneous
        // cross-function invokes — a thundering herd that causes rate limiting, resource
        // contention, and runtime exhaustion. Sequential execution gives each character's
        // canonical context construction full resources without contention, allowing
        // the complete canonical identity to finish within the function runtime.
        //
        // NO REDUCED-IDENTITY FALLBACK: A character either responds as their full
        // canonical self or is not included in the response generation. There is no
        // minimal-description fallback, no timeout fallback, no ad-hoc prompt. If a
        // character's canonical context fails to construct, that character is simply
        // absent from the canonical block and will not be generated by the LLM.
        const canonicalBlocks = [];
        for (const c of characterRecords) {
          try {
            const ctxRes = await base44.asServiceRole.functions.invoke('buildCanonicalCharacterContext', {
              characterId: c.record.id,
              interactionContext: 'group_chat',
              ownerEmailHint: c.record.owner_email || null,
            });
            const ctxData = ctxRes?.data || ctxRes;
            if (ctxData?.systemPrompt) {
              canonicalBlocks.push({ name: c.record.name, prompt: ctxData.systemPrompt });
            } else {
              canonicalBlocks.push(null);
            }
          } catch (err) {
            console.warn(`[gatheringRoom] Canonical context failed for ${c.record.name}: ${err?.message}`);
            canonicalBlocks.push(null);
          }
        }
        const validCanonicalBlocks = canonicalBlocks.filter(Boolean);
        const canonicalContextBlock = validCanonicalBlocks.length > 0
          ? [
              '════════════════════════════════════',
              'FULL CANONICAL IDENTITY — EACH CHARACTER IS THEIR COMPLETE SELF',
              'Each character below brings their full established identity, history,',
              'family, relationships, memories, and personality into this Gathering Room.',
              'They do NOT become a different, temporary, or reduced version of themselves',
              'merely because they are interacting with characters or users from another account.',
              'Use each character\'s full canonical identity when generating their response.',
              '════════════════════════════════════',
              ...validCanonicalBlocks.map(b => `\n=== ${b.name} — FULL CANONICAL IDENTITY ===\n${b.prompt}\n=== END ${b.name} ===`),
              '════════════════════════════════════',
            ].join('\n')
          : '';

        const prompt = [
          `You are moderating responses in a shared social space called "${room?.name || 'a Gathering Room'}".`,
          room?.description ? `The space: ${room.description}` : '',
          '',
          `The people currently present are: ${participantNames.join(', ')}.`,
          `Everyone here is simply a person. Do not speculate about or reveal whether anyone is a user, character, AI, human, NPC, or bot.`,
          `Do not refer to anyone as "the user," "a character," "an AI," or similar labels.`,
          mediaContext,
          '',
          `Recent conversation:`,
          conversationHistory || '(no conversation yet)',
          '',
          canonicalContextBlock,
          '',
          relationshipContextBlock,
          livedMemoryContextBlock,
          relationshipContextBlock || livedMemoryContextBlock ? '' : '',
          relationshipContextBlock || livedMemoryContextBlock
            ? `CRITICAL — RELATIONSHIP AND MEMORY BINDING RULES:`
            : '',
          relationshipContextBlock || livedMemoryContextBlock
            ? `- Established relationships and lived memories are DIFFERENT kinds of information. Assemble both; do not let one overwrite the other.`
            : '',
          relationshipContextBlock || livedMemoryContextBlock
            ? `- Each relationship fact is bound to the character whose record it comes from. Never transfer one character's relationship role to another participant.`
            : '',
          relationshipContextBlock || livedMemoryContextBlock
            ? `- Lived memory adds recognition of previous encounters. It does NOT establish family relationships. A memory of meeting someone does not make them family.`
            : '',
          relationshipContextBlock || livedMemoryContextBlock
            ? `- If no relationship is listed for a pair from any source, they may be strangers — do NOT invent one from surnames, ages, or proximity.`
            : '',
          relationshipContextBlock || livedMemoryContextBlock
            ? `- These facts take precedence over any inference from dialogue or generated text.`
            : '',
          relationshipContextBlock || livedMemoryContextBlock ? '' : '',
          isDirected && directedToNames.length > 0
            ? `The latest message was directed at: ${directedToNames.join(', ')}. Those people should prioritize responding if they have something natural to say. Others may also react if context makes it natural.`
            : `Based on the conversation and each character's personality, determine which character(s) naturally have a reason to respond.`,
          `Not everyone needs to respond. Some might stay silent. One character might respond, several might react, or nobody might answer immediately.`,
          '',
          `For each character who should respond, generate their response in character.`,
          `Rules:`,
          `- Stay in character.`,
          `- Keep responses brief and natural (1-3 sentences).`,
          `- Never reveal or speculate about whether participants are users, characters, AI, or any other entity type.`,
          `- Refer to everyone by name only.`,
          `- Only include characters who have something natural to say.`,
        ].filter(Boolean).join('\n');

        let llmResponses = [];
        try {
          const llmRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt,
            model: 'gemini_3_flash',
            response_json_schema: {
              type: "object",
              properties: {
                responses: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      character_name: { type: "string" },
                      response: { type: "string" }
                    },
                    required: ["character_name", "response"]
                  }
                }
              },
              required: ["responses"]
            }
          });
          llmResponses = llmRes?.responses || [];
        } catch (err) {
          console.warn(`[gatheringRoom] LLM response selection failed: ${err?.message}`);
        }

        // Commit each response as an individual message, attributed to the character's own account
        for (const resp of llmResponses) {
          if (!resp.response?.trim()) continue;
          const matchedChar = characterRecords.find(c =>
            c.record.name.toLowerCase() === resp.character_name?.toLowerCase() ||
            c.participant.participant_name.toLowerCase() === resp.character_name?.toLowerCase()
          );
          if (!matchedChar) continue;

          const trimmed = resp.response.trim();
          let charAvatarUrl = matchedChar.participant.avatar_url;
          if (!charAvatarUrl) {
            charAvatarUrl = matchedChar.record.avatar_url || matchedChar.record.image_avatar_url || null;
          }

          const charMsg = await base44.asServiceRole.entities.GatheringRoomMessage.create({
            gathering_room_id: gatheringRoomId,
            session_id: matchedChar.participant.session_id,
            owner_email: matchedChar.participant.owner_email,
            sender_participant_id: matchedChar.participant.id,
            sender_participant_name: matchedChar.participant.participant_name,
            sender_avatar_url: charAvatarUrl,
            content: trimmed,
            is_directed: false,
            directed_to_participant_ids: [],
            directed_to_participant_names: [],
            timestamp: new Date().toISOString(),
          });
          characterResponses.push(charMsg);
        }
      }
    }

    // ── 6h. MEMORY EXTRACTION — runs on EVERY message for ALL characters present ──
    // This is the SAME Memory entity used by normal Chat/Text/Scene continuity.
    // retrieveActiveMemory reads via Memory.filter({ character_id }) and
    // buildCanonicalCharacterContext injects the results into the Chat/Text prompt.
    //
    // This block runs regardless of whether any character responded. A character who
    // was present but silent still witnessed the conversation and may form a memory.
    // The LLM decides what's salient — not every casual exchange becomes memory.
    //
    // The character pool is allRoomCharacterRecords — every character with a valid
    // active session at this moment (the participation window). This includes the
    // sender if they are a character (a character who spoke remembers what they said).
    if (allRoomCharacterRecords.length > 0 && room) {
      try {
        const memoryCharacterDescriptions = allRoomCharacterRecords.map(c =>
          `${c.record.name}: ${c.record.personality_summary || 'Not specified'}`
        ).join('\n');

        const memoryPrompt = [
          `You are analyzing a conversation that just occurred in a shared social space called "${room?.name || 'a Gathering Room'}".`,
          room?.description ? `The space: ${room.description}` : '',
          '',
          `Recent conversation:`,
          conversationHistory || '(no conversation yet)',
          '',
          `The characters present were:`,
          memoryCharacterDescriptions,
          '',
          relationshipContextBlock,
          livedMemoryContextBlock,
          relationshipContextBlock || livedMemoryContextBlock
            ? `Use the established relationships and lived memories above to accurately describe who was involved. Do NOT invent or alter relationships in memory descriptions. A lived memory of meeting someone does not establish a family relationship.`
            : '',
          relationshipContextBlock || livedMemoryContextBlock ? '' : '',
          `Determine which characters would form a lasting memory from this conversation.`,
          `Only form memories for salient, meaningful interactions — not every casual exchange.`,
          `Include the location ("${room?.name || 'a Gathering Room'}") in the description so the character remembers WHERE it happened.`,
          `Do NOT reveal or speculate about whether any participant is a user, character, AI, or any entity type.`,
          `Do NOT include internal metadata like owner emails, account IDs, session IDs, or participant types.`,
          `Memory should be from the character's perspective — what they experienced, said, were told, or witnessed.`,
          `A character who was present but did not speak still witnessed the conversation and may form a memory of what they observed.`,
          `A character who spoke also forms memories of what they said and how others reacted.`,
          `When someone made a notable statement, characters who witnessed it should remember who said it and what was said.`,
          '',
          `Return a JSON object with "memories" array. Each item has:`,
          `- character_name: exact character name`,
          `- title: brief summary (5-10 words)`,
          `- description: what happened, including the location and who was involved`,
          `- emotional_impact: how it emotionally affected the character`,
          `Empty array if nothing salient enough to remember.`,
        ].filter(Boolean).join('\n');

        const memoryRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: memoryPrompt,
          model: 'gemini_3_flash',
          response_json_schema: {
            type: "object",
            properties: {
              memories: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    character_name: { type: "string" },
                    title: { type: "string" },
                    description: { type: "string" },
                    emotional_impact: { type: "string" }
                  },
                  required: ["character_name", "title", "description"]
                }
              }
            },
            required: ["memories"]
          }
        });

        const memories = memoryRes?.memories || [];
        for (const mem of memories) {
          if (!mem.title?.trim() || !mem.description?.trim()) continue;
          const matchedChar = allRoomCharacterRecords.find(c =>
            c.record.name.toLowerCase() === mem.character_name?.toLowerCase() ||
            c.participant.participant_name.toLowerCase() === mem.character_name?.toLowerCase()
          );
          if (!matchedChar) continue;

          // Write to the SAME Memory entity used by normal Chat/Text/Scene continuity.
          // retrieveActiveMemory reads via Memory.filter({ character_id }) and
          // buildCanonicalCharacterContext injects the result into the Chat/Text prompt.
          await base44.asServiceRole.entities.Memory.create({
            character_id: matchedChar.record.id,
            title: mem.title.trim(),
            description: mem.description.trim(),
            emotional_impact: mem.emotional_impact?.trim() || 'neutral',
            timestamp: nowIso,
            source_context: `gathering_room:${gatheringRoomId}:${room?.name || ''}`,
          });
        }
      } catch (memErr) {
        console.warn(`[gatheringRoom] Memory extraction failed: ${memErr?.message}`);
      }
    }

      } catch (err) {
        console.warn(`[gatheringRoom] Background LLM work failed: ${err?.message}`);
      }
    })();

    return __grResponse;
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});