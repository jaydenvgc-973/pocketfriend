import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// ── BACKEND-AUTHORITATIVE OCCUPANCY CALCULATION ───────────────────────────────
// This function is the SOLE authority for Gathering Room occupancy.
// It counts only participants whose parent session is:
//   - status: 'active'
//   - not past expires_at
// Stale participants from ended/expired sessions do NOT count.
//
// The result is written to the GatheringRoom entity as current_occupancy + is_full.
// The client reads these sanitized fields — never raw sessions or participants.
//
// Called internally by: admitToGatheringRoom, exitGatheringRoom,
// expireGatheringRoomSessions, sendGatheringRoomMessage (after lazy expiration).

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const gatheringRoomId = body.gathering_room_id;

    if (!gatheringRoomId) {
      return Response.json({ error: 'Missing gathering_room_id' }, { status: 400 });
    }

    const now = new Date();

    // ── 1. Find all active sessions for this room ──
    const sessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { gathering_room_id: gatheringRoomId, status: 'active' },
      null, 50
    );

    // Valid sessions: active AND not past expiration
    const validSessionIds = new Set(
      sessions
        .filter(s => new Date(s.expires_at).getTime() > now.getTime())
        .map(s => s.id)
    );

    // ── 2. Count participants from valid sessions only ──
    const participants = await base44.asServiceRole.entities.GatheringRoomParticipant.filter(
      { gathering_room_id: gatheringRoomId },
      null, 50
    );
    const validParticipantCount = participants.filter(
      p => validSessionIds.has(p.session_id)
    ).length;

    // ── 3. Update the room with sanitized occupancy + manage last_emptied_at ──
    // last_emptied_at tracks when the room transitioned to zero participants.
    // It is used by admitToGatheringRoom to detect the 30-minute empty-room
    // expiration boundary. Set once when the room becomes empty; cleared when
    // the room becomes occupied again. This is the authoritative room-presence
    // timing — all occupancy changes (admit, exit, expire) flow through here.
    const MAX_CAPACITY = 8;
    const nowIso = now.toISOString();
    const rooms = await base44.asServiceRole.entities.GatheringRoom.filter({ id: gatheringRoomId }, null, 1);
    const room = rooms[0];

    const updateFields = {
      current_occupancy: validParticipantCount,
      is_full: validParticipantCount >= MAX_CAPACITY,
    };

    if (room) {
      if (validParticipantCount === 0 && !room.last_emptied_at) {
        // Room just became empty — stamp the time (only if not already stamped)
        updateFields.last_emptied_at = nowIso;
      } else if (validParticipantCount > 0 && room.last_emptied_at) {
        // Room is occupied again — clear the empty timestamp
        updateFields.last_emptied_at = null;
      }
    }

    await base44.asServiceRole.entities.GatheringRoom.update(gatheringRoomId, updateFields);

    return Response.json({
      success: true,
      gathering_room_id: gatheringRoomId,
      occupancy: validParticipantCount,
      capacity: MAX_CAPACITY,
      is_full: validParticipantCount >= MAX_CAPACITY,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});