import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const gatheringRoomId = body.gathering_room_id;
    const characterIds = Array.isArray(body.character_ids) ? body.character_ids : [];

    if (!gatheringRoomId) {
      return Response.json({ error: 'Missing gathering_room_id' }, { status: 400 });
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

    // ── 3. EXISTING SESSION CHECK: user already in this room? ──
    const existingSessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { gathering_room_id: gatheringRoomId, owner_email: user.email, status: 'active' },
      null, 1
    );
    if (existingSessions.length > 0) {
      return Response.json({
        error: 'already_in_room',
        session_id: existingSessions[0].id,
        expires_at: existingSessions[0].expires_at,
      }, { status: 409 });
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

    // ── 5. COUNT CURRENT ACTIVE PARTICIPANTS (cross-account) ──
    const activeParticipants = await base44.asServiceRole.entities.GatheringRoomParticipant.filter(
      { gathering_room_id: gatheringRoomId },
      null, 20
    );
    const currentCount = activeParticipants.length;

    // ── 6. PARTY SIZE: user + characters (all count toward same capacity) ──
    const partySize = 1 + characterIds.length;

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

    // ── 9. RESOLVE USER DISPLAY INFO ──
    const settingsList = await base44.asServiceRole.entities.UserSettings.filter(
      { owner_email: user.email },
      null, 1
    );
    const settings = settingsList[0];
    const userDisplayName = settings?.fictional_world_name || user.full_name || 'You';
    const userAvatarUrl = settings?.avatar_url || settings?.image_avatar_url || null;

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

    // ── 13. REGENERATE SCENE IMAGE with current occupants ────────────────────
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