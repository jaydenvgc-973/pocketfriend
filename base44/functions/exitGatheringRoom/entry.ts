import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const gatheringRoomId = body.gathering_room_id;

    if (!gatheringRoomId) {
      return Response.json({ error: 'Missing gathering_room_id' }, { status: 400 });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // ── 1. FIND ACTIVE SESSION for this user + room ──
    const sessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { gathering_room_id: gatheringRoomId, owner_email: user.email, status: 'active' },
      null, 1
    );
    const session = sessions[0];

    if (!session) {
      return Response.json({ error: 'No active session found in this Gathering Room.' }, { status: 404 });
    }

    // ── 2. END SESSION ──
    await base44.asServiceRole.entities.GatheringRoomSession.update(session.id, {
      status: 'exited',
      ended_at: nowIso,
    });

    // ── 3. REMOVE ALL PARTICIPANTS from this session (user + characters) ──
    await base44.asServiceRole.entities.GatheringRoomParticipant.deleteMany({
      session_id: session.id,
    });

    // ── 4. CREATE COOLDOWN (5-minute same-room cooldown) ──
    await base44.asServiceRole.entities.GatheringRoomCooldown.create({
      gathering_room_id: gatheringRoomId,
      gathering_room_name: session.gathering_room_name,
      owner_email: user.email,
      owner_user_id: user.id,
      cooldown_until: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      reason: 'exited',
      character_ids: session.character_ids || [],
      created_at: nowIso,
    });

    // ── 5. CLEAR CANONICAL CHARACTER LOCATION ──────────────────────────────────
    // Transition each character out of the Gathering Room through the existing
    // canonical location fields. The frontend resolver will recompute their real
    // location (home, work, etc.) on next render since resolved_source_reason
    // no longer equals 'gathering_room'.
    for (const charId of (session.character_ids || [])) {
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

    // ── 6. ABANDON ACTIVE GAMES where this user is a participant ──
    // When a user leaves a Gathering Room, any active or pending games they're
    // participating in are abandoned/cancelled. This prevents stale game instances
    // from persisting after participants leave. The game belongs to this room only
    // — it does not carry to another venue.
    try {
      const activeGames = await base44.asServiceRole.entities.GatheringRoomGame.filter(
        { gathering_room_id: gatheringRoomId, status: { $in: ['active', 'pending'] } },
        null, 50
      );
      for (const g of activeGames) {
        const userInGame = (g.participants || []).some(p => p.owner_email === user.email);
        if (userInGame) {
          const newStatus = g.status === 'pending' ? 'cancelled' : 'abandoned';
          await base44.asServiceRole.entities.GatheringRoomGame.update(g.id, {
            status: newStatus,
            completed_at: nowIso,
          });
        }
      }
    } catch (_) {}

    // ── 7. RECALCULATE ROOM OCCUPANCY + REGENERATE SCENE IMAGE ──
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
      cooldown_until: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});