import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const gatheringRoomId = body.gathering_room_id;
    const characterIds = Array.isArray(body.character_ids) ? body.character_ids : [];
    // character_only: the user authorizes their character to participate alone (Carry
    // on without me). Same entry function, same participant records, same capacity —
    // the user is simply not a participant of the session.
    const characterOnly = body.character_only === true;

    if (!gatheringRoomId) {
      return Response.json({ error: 'Missing gathering_room_id' }, { status: 400 });
    }
    if (characterOnly && characterIds.length === 0) {
      return Response.json({ error: 'character_only entry requires at least one character' }, { status: 400 });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // ── 1. LAZY EXPIRATION: expire stale sessions in this room before admission ──
    // Event-driven: triggered by user interaction, not polling.
    const allSessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { gathering_room_id: gatheringRoomId, status: 'active' },
      null, 50
    );
    const staleSessions = allSessions.filter(s => new Date(s.expires_at).getTime() < now.getTime());

    for (const sess of staleSessions) {
      await base44.asServiceRole.entities.GatheringRoomSession.update(sess.id, {
        status: 'expired',
        ended_at: nowIso,
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

    // ── 2. COOLDOWN CHECK: is this user on cooldown for this room? ──
    const cooldowns = await base44.asServiceRole.entities.GatheringRoomCooldown.filter(
      { gathering_room_id: gatheringRoomId, owner_email: user.email },
      null, 10
    );
    const activeCooldown = cooldowns.find(c => new Date(c.cooldown_until).getTime() > now.getTime());
    if (activeCooldown) {
      return Response.json({
        error: 'cooldown_active',
        cooldown_until: activeCooldown.cooldown_until,
        reason: activeCooldown.reason,
      }, { status: 403 });
    }

    // ── 3. ONE ACTIVE SESSION GLOBALLY: terminate any existing active session ──
    // A user may have at most ONE active Gathering Room session globally.
    // Check across ALL rooms, not just this one. If an active session exists:
    // - In THIS room → return already_in_room
    // - in ANOTHER room → terminate it through the canonical exit authority first
    const allUserActiveSessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { owner_email: user.email, status: 'active' },
      null, 10
    );
    const trulyActiveSessions = allUserActiveSessions.filter(
      s => new Date(s.expires_at).getTime() > now.getTime()
    );

    for (const sess of trulyActiveSessions) {
      // An active session in THIS room is handled after the room, capacity and
      // participant checks below (step 9.5), because joining or admitting into it
      // must never create a duplicate participant or a second session.
      if (sess.gathering_room_id === gatheringRoomId) continue;
      // Active session in ANOTHER room — terminate it through canonical exit authority
      await base44.asServiceRole.entities.GatheringRoomSession.update(sess.id, {
        status: 'exited',
        ended_at: nowIso,
      });
      await base44.asServiceRole.entities.GatheringRoomParticipant.deleteMany({ session_id: sess.id });
      await base44.asServiceRole.entities.GatheringRoomCooldown.create({
        gathering_room_id: sess.gathering_room_id,
        gathering_room_name: sess.gathering_room_name,
        owner_email: user.email,
        owner_user_id: user.id,
        cooldown_until: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
        reason: 'exited',
        character_ids: sess.character_ids || [],
        created_at: nowIso,
      });
      // Clear canonical character locations for the other session's characters
      for (const charId of (sess.character_ids || [])) {
        try {
          const chars = await base44.asServiceRole.entities.Character.filter({ id: charId }, null, 1);
          const char = chars[0];
          if (char && char.resolved_source_reason === 'gathering_room') {
            await base44.asServiceRole.entities.Character.update(charId, {
              resolved_location_type: null,
              resolved_presence_status: 'home',
              resolved_current_location_id: char.current_home_location_id || null,
              resolved_current_location_name: null,
              resolved_source_reason: 'gathering_room_exit',
              resolved_last_updated_at: nowIso,
            });
          }
        } catch (_) {}
      }
      // Recalculate occupancy + regenerate scene image for the other room
      try {
        await base44.asServiceRole.functions.invoke('recalculateGatheringRoomOccupancy', {
          gathering_room_id: sess.gathering_room_id,
        });
      } catch (_) {}
      try {
        await base44.asServiceRole.functions.invoke('generateGatheringRoomScene', {
          gathering_room_id: sess.gathering_room_id,
        });
      } catch (_) {}
    }

    // ── 4. CHARACTER OWNERSHIP VERIFICATION ──
    // Every character must be owned by the requesting user. No cross-account characters.
    const ownedChars = [];
    for (const cid of characterIds) {
      const chars = await base44.asServiceRole.entities.Character.filter(
        { id: cid, owner_email: user.email },
        null, 1
      );
      if (!chars[0]) {
        return Response.json({
          error: `Character ${cid} is not owned by you and cannot be brought into the Gathering Room.`,
        }, { status: 403 });
      }
      ownedChars.push(chars[0]);
    }

    // ── 5. COUNT VALID ACTIVE PARTICIPANTS (server-authoritative) ──────────────
    // Only participants from active, non-expired sessions count toward occupancy.
    // This is the same validity rule applied by recalculateGatheringRoomOccupancy.
    // The client never performs this calculation — the backend is the sole authority.
    const roomSessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { gathering_room_id: gatheringRoomId, status: 'active' },
      null, 50
    );
    const validSessionIds = new Set(
      roomSessions
        .filter(s => new Date(s.expires_at).getTime() > now.getTime())
        .map(s => s.id)
    );
    const allRoomParticipants = await base44.asServiceRole.entities.GatheringRoomParticipant.filter(
      { gathering_room_id: gatheringRoomId },
      null, 50
    );
    const currentCount = allRoomParticipants.filter(p => validSessionIds.has(p.session_id)).length;

    // ── 5.5. THIS ACCOUNT'S EXISTING SESSION IN THIS ROOM ────────────────────
    // A character sent ahead (Carry on without me) is already counted in currentCount.
    // Counting it again would refuse an entry that only needs the user's own slot, so
    // the party size is measured against what is actually still missing. Resolved once
    // here and reused in step 9.5 — never queried twice.
    const existingRoomSession = trulyActiveSessions.find(
      s => s.gathering_room_id === gatheringRoomId
    ) || null;
    const existingSessionParticipants = existingRoomSession
      ? await base44.asServiceRole.entities.GatheringRoomParticipant.filter(
          { session_id: existingRoomSession.id }, null, 50
        )
      : [];
    const userAlreadyParticipant = existingSessionParticipants.some(p => p.participant_type === 'user');
    const presentCharIds = new Set(
      existingSessionParticipants
        .filter(p => p.participant_type === 'character')
        .map(p => p.participant_id)
    );
    const missingCharIds = characterIds.filter(id => !presentCharIds.has(id));

    // ── 6. PARTY SIZE: user + characters, counting only those not already inside ──
    // A character-only entry occupies slots for its characters alone.
    const partySize = (characterOnly || userAlreadyParticipant ? 0 : 1) + missingCharIds.length;

    // ── 7. CAPACITY CHECK: atomic reject-if-over ──
    const MAX_CAPACITY = 8;
    if (currentCount + partySize > MAX_CAPACITY) {
      return Response.json({
        error: 'capacity_exceeded',
        current_occupancy: currentCount,
        requested_party: partySize,
        would_be: currentCount + partySize,
        available_slots: MAX_CAPACITY - currentCount,
        message: `This room has ${currentCount} participants and ${MAX_CAPACITY - currentCount} slot(s) open. Your party of ${partySize} exceeds available capacity. Please select fewer characters.`,
      }, { status: 409 });
    }

    // ── 8. VERIFY ROOM EXISTS AND IS ACTIVE ──
    const rooms = await base44.asServiceRole.entities.GatheringRoom.filter(
      { id: gatheringRoomId },
      null, 1
    );
    const room = rooms[0];
    if (!room) return Response.json({ error: 'Gathering Room not found' }, { status: 404 });
    if (!room.is_active) return Response.json({ error: 'This Gathering Room is not currently available.' }, { status: 403 });

    // ── 8.5. GATHERING EPOCH — 30-minute empty-room expiration boundary ──────
    // The gathering_epoch scopes the live transcript to the CURRENT gathering.
    // Messages from a previous gathering (timestamp < gathering_epoch) are
    // excluded from the live 20-message window — they do NOT repopulate the
    // active room. Character memory is preserved independently via the Memory
    // entity and is NOT affected by epoch changes.
    //
    // Rules:
    //   - No epoch yet (first-ever entry or legacy room) → start a new gathering.
    //   - Room was empty before this admission AND last_emptied_at >= 30 min ago
    //     → the previous gathering has expired; start a new gathering (new epoch).
    //   - Room was empty before this admission AND last_emptied_at < 30 min ago
    //     → the gathering is still active; keep the existing epoch (continues).
    //   - Room was NOT empty (someone is already here) → keep the existing epoch.
    const THIRTY_MIN_MS = 30 * 60 * 1000;
    const lastEmptiedMs = room.last_emptied_at ? new Date(room.last_emptied_at).getTime() : null;
    const needsNewEpoch = !room.gathering_epoch ||
      (currentCount === 0 && lastEmptiedMs !== null && (now.getTime() - lastEmptiedMs) >= THIRTY_MIN_MS);

    if (needsNewEpoch) {
      await base44.asServiceRole.entities.GatheringRoom.update(gatheringRoomId, {
        gathering_epoch: nowIso,
      });
    }

    // ── 9. RESOLVE USER DISPLAY INFO ──
    const settingsList = await base44.asServiceRole.entities.UserSettings.filter(
      { owner_email: user.email },
      null, 1
    );
    const settings = settingsList[0];
    const userDisplayName = settings?.fictional_world_name || user.full_name || 'You';
    // User avatar comes from the User entity (same source as UserCard on Home),
    // NOT from UserSettings which does not have avatar fields.
    const userAvatarUrl = user.generated_avatar_urls?.[0] || user.reference_image_urls?.[0] || null;

    // ── 9.5. EXISTING SESSION IN THIS ROOM ───────────────────────────────────
    // The user's own session may already be here (Travel entry, or a character sent
    // ahead with Carry on without me). Joining or admitting into it reuses that same
    // session and its participants — never a duplicate participant, never a second
    // session for the account, and never a reset of existing participation.
    if (existingRoomSession) {
      // Participants, present characters and the user's own participation were resolved
      // once in step 5.5 and are reused here — never queried or decided twice.
      const hasUserParticipant = userAlreadyParticipant;

      // Character-only entry where the character is already inside: leave the existing
      // participation untouched.
      if (characterOnly && missingCharIds.length === 0) {
        return Response.json({
          success: true,
          already_present: true,
          session_id: existingRoomSession.id,
          gathering_room_id: gatheringRoomId,
          gathering_room_name: room.name,
          expires_at: existingRoomSession.expires_at,
        });
      }

      // The user is joining a session that already holds their character(s) and the
      // user is already a participant — nothing to add (existing behavior).
      if (!characterOnly && hasUserParticipant && missingCharIds.length === 0) {
        return Response.json({
          error: 'already_in_room',
          session_id: existingRoomSession.id,
          expires_at: existingRoomSession.expires_at,
        }, { status: 409 });
      }

      // Capacity is verified again here — occupancy may have changed since the
      // invitation was generated.
      const slotsNeeded = (characterOnly || hasUserParticipant ? 0 : 1) + missingCharIds.length;
      if (currentCount + slotsNeeded > MAX_CAPACITY) {
        return Response.json({
          error: 'capacity_exceeded',
          current_occupancy: currentCount,
          requested_party: slotsNeeded,
          available_slots: MAX_CAPACITY - currentCount,
          message: `This room has ${currentCount} participants and ${MAX_CAPACITY - currentCount} slot(s) open. The invitation can no longer be completed.`,
        }, { status: 409 });
      }

      if (!characterOnly && !hasUserParticipant) {
        await base44.asServiceRole.entities.GatheringRoomParticipant.create({
          gathering_room_id: gatheringRoomId,
          session_id: existingRoomSession.id,
          owner_email: user.email,
          participant_type: 'user',
          participant_id: user.id,
          participant_name: userDisplayName,
          avatar_url: userAvatarUrl,
          joined_at: nowIso,
        });
      }

      for (const cid of missingCharIds) {
        const c = ownedChars.find(ch => ch.id === cid);
        if (!c) continue;
        await base44.asServiceRole.entities.GatheringRoomParticipant.create({
          gathering_room_id: gatheringRoomId,
          session_id: existingRoomSession.id,
          owner_email: user.email,
          participant_type: 'character',
          participant_id: c.id,
          participant_name: c.name,
          avatar_url: c.avatar_url || c.image_avatar_url || null,
          joined_at: nowIso,
        });
        // Same canonical location fields as any other entry — no parallel truth.
        await base44.asServiceRole.entities.Character.update(c.id, {
          resolved_current_location_id: gatheringRoomId,
          resolved_current_location_name: room.name,
          resolved_location_type: 'visit',
          resolved_presence_status: 'visiting',
          resolved_source_reason: 'gathering_room',
          resolved_last_updated_at: nowIso,
        }).catch(() => {});
      }

      if (missingCharIds.length > 0) {
        const mergedCharIds = Array.from(new Set([...(existingRoomSession.character_ids || []), ...missingCharIds]));
        await base44.asServiceRole.entities.GatheringRoomSession.update(existingRoomSession.id, {
          character_ids: mergedCharIds,
          character_names: mergedCharIds.map(id => ownedChars.find(c => c.id === id)?.name).filter(Boolean),
        }).catch(() => {});
      }

      try {
        await base44.asServiceRole.functions.invoke('recalculateGatheringRoomOccupancy', {
          gathering_room_id: gatheringRoomId,
        });
      } catch (_) {}

      return Response.json({
        success: true,
        joined_existing_session: true,
        session_id: existingRoomSession.id,
        gathering_room_id: gatheringRoomId,
        gathering_room_name: room.name,
        expires_at: existingRoomSession.expires_at,
      });
    }

    // ── 10. CREATE SESSION (30-minute hard limit) ──
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    const session = await base44.asServiceRole.entities.GatheringRoomSession.create({
      gathering_room_id: gatheringRoomId,
      gathering_room_name: room.name,
      owner_email: user.email,
      owner_user_id: user.id,
      owner_display_name: userDisplayName,
      owner_avatar_url: userAvatarUrl,
      character_ids: characterIds,
      character_names: ownedChars.map(c => c.name),
      started_at: nowIso,
      expires_at: expiresAt,
      status: 'active',
    });

    // ── 11. CREATE PARTICIPANTS (user + each owned character) ──
    // User participant first, then characters — local display order is handled frontend-side.
    // A character-only entry (Carry on without me) creates no user participant: the user
    // stays where they are and is never present in the room.
    if (!characterOnly) {
      await base44.asServiceRole.entities.GatheringRoomParticipant.create({
        gathering_room_id: gatheringRoomId,
        session_id: session.id,
        owner_email: user.email,
        participant_type: 'user',
        participant_id: user.id,
        participant_name: userDisplayName,
        avatar_url: userAvatarUrl,
        joined_at: nowIso,
      });
    }

    for (const c of ownedChars) {
      await base44.asServiceRole.entities.GatheringRoomParticipant.create({
        gathering_room_id: gatheringRoomId,
        session_id: session.id,
        owner_email: user.email,
        participant_type: 'character',
        participant_id: c.id,
        participant_name: c.name,
        avatar_url: c.avatar_url || c.image_avatar_url || null,
        joined_at: nowIso,
      });
    }

    // ── 11.5. POST-CREATION CAPACITY VALIDATION (atomic race safety) ──────────
    // The pre-creation capacity check (step 7) is based on valid active membership
    // (the authoritative source). But under concurrency, two requests could both
    // pass the check and both create participants, exceeding capacity.
    //
    // This post-creation validation is the atomic safety net. After all participants
    // are created, we recount valid active participants. If the total exceeds
    // MAX_CAPACITY, we determine which sessions must roll back using a deterministic
    // tiebreaker: sessions created earlier (oldest started_at) win. The newest
    // session(s) that push the count over capacity must roll back.
    //
    // current_occupancy is NOT used here — the authority is the valid participant
    // count, same as recalculateGatheringRoomOccupancy.
    //
    // This guarantees: no state above MAX_CAPACITY survives in normal operation.
    const postSessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { gathering_room_id: gatheringRoomId, status: 'active' },
      'started_at', 50
    );
    const postValidSessions = postSessions.filter(
      s => new Date(s.expires_at).getTime() > now.getTime()
    );
    const postValidSessionIds = new Set(postValidSessions.map(s => s.id));
    const postParticipants = await base44.asServiceRole.entities.GatheringRoomParticipant.filter(
      { gathering_room_id: gatheringRoomId },
      null, 50
    );
    const postCount = postParticipants.filter(
      p => postValidSessionIds.has(p.session_id)
    ).length;

    if (postCount > MAX_CAPACITY) {
      // Over capacity — determine which sessions to keep (oldest first)
      let cumulative = 0;
      const keepSet = new Set();
      for (const sess of postValidSessions) {
        const sessCount = postParticipants.filter(
          p => p.session_id === sess.id
        ).length;
        if (cumulative + sessCount <= MAX_CAPACITY) {
          keepSet.add(sess.id);
          cumulative += sessCount;
        }
      }

      if (!keepSet.has(session.id)) {
        // Our session lost the race — roll back completely
        await base44.asServiceRole.entities.GatheringRoomParticipant.deleteMany({
          session_id: session.id,
        });
        await base44.asServiceRole.entities.GatheringRoomSession.update(session.id, {
          status: 'exited',
          ended_at: nowIso,
        });
        // Recalculate occupancy after rollback so current_occupancy self-corrects
        try {
          await base44.asServiceRole.functions.invoke('recalculateGatheringRoomOccupancy', {
            gathering_room_id: gatheringRoomId,
          });
        } catch (_) {}
        return Response.json({
          error: 'capacity_exceeded',
          current_occupancy: MAX_CAPACITY,
          requested_party: partySize,
          message: 'The room filled up while you were entering. Please try again.',
        }, { status: 409 });
      }
    }

    // ── 12. SET CANONICAL CHARACTER LOCATION ──────────────────────────────────
    // Each owned character's resolved location is set to the Gathering Room.
    // This integrates with the existing location resolver via a guard in
    // locationResolutionEngine.js that checks resolved_source_reason === 'gathering_room'.
    // Uses existing fields (resolved_current_location_id, resolved_presence_status, etc.)
    // — no new resolver, no parallel location truth.
    // Only the character's OWN authoritative account record is updated.
    for (const c of ownedChars) {
      try {
        await base44.asServiceRole.entities.Character.update(c.id, {
          resolved_current_location_id: gatheringRoomId,
          resolved_current_location_name: room.name,
          resolved_location_type: 'visit',
          resolved_presence_status: 'visiting',
          resolved_source_reason: 'gathering_room',
          resolved_last_updated_at: nowIso,
        });
      } catch (_) {}
    }

    // ── 13. RECALCULATE ROOM OCCUPANCY + REGENERATE SCENE IMAGE ──────────────
    // Occupancy is backend-authoritative. The sanitized count is written to the
    // GatheringRoom entity so Travel reads it without raw session/participant access.
    try {
      await base44.asServiceRole.functions.invoke('recalculateGatheringRoomOccupancy', {
        gathering_room_id: gatheringRoomId,
      });
    } catch (_) {}
    try {
      await base44.asServiceRole.functions.invoke('generateGatheringRoomScene', {
        gathering_room_id: gatheringRoomId,
      });
    } catch (_) {}

    return Response.json({
      success: true,
      session_id: session.id,
      gathering_room_id: gatheringRoomId,
      gathering_room_name: room.name,
      expires_at: expiresAt,
      party_size: partySize,
      participants_created: partySize,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});