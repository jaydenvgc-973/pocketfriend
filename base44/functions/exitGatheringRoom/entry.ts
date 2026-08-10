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

    return Response.json({
      success: true,
      session_id: session.id,
      cooldown_until: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});