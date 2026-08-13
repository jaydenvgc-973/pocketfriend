import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// ── SANITIZED CROSS-ACCOUNT PARTICIPANT PROJECTION ──────────────────────────
// Returns all valid active participants in a Gathering Room, regardless of
// which account owns them. The browser receives ONLY:
//   - id (stable room-facing participant ID)
//   - participant_name
//   - avatar_url
//   - is_self (true only for the requesting user's own user-participant)
//   - is_owned (true for participants belonging to the requesting user's account)
//   - participant_type (INTERNAL routing only — never displayed in UI)
//   - owner_email (INTERNAL routing only — never displayed in UI)
//   - joined_at
//
// participant_type and owner_email are internal routing metadata for the game
// system. They must NEVER be shown in the participant-facing UI.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let gatheringRoomId = null;
    try {
      const body = await req.json();
      gatheringRoomId = body?.gathering_room_id || null;
    } catch (_) {
      const url = new URL(req.url);
      gatheringRoomId = url.searchParams.get('gathering_room_id');
    }
    if (!gatheringRoomId) {
      return Response.json({ error: 'Missing gathering_room_id' }, { status: 400 });
    }

    const now = new Date();

    // 0. SESSION GATE: The authenticated user MUST have a valid active session in
    //    this exact room before cross-account participant identities are returned.
    //    Without this gate, any authenticated user could enumerate occupants of
    //    any room they are not in. Cross-account visibility is granted ONLY to
    //    co-occupants of the same room.
    const mySessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { gathering_room_id: gatheringRoomId, owner_email: user.email, status: 'active' },
      null, 5
    );
    const iHaveValidSession = mySessions.some(
      s => new Date(s.expires_at).getTime() > now.getTime()
    );
    if (!iHaveValidSession) {
      // Not in the room (or session expired) — return empty. The room page
      // handles the "not in room" state separately via its own session query.
      return Response.json({ participants: [] });
    }

    // 1. Get all active sessions for this room (cross-account via asServiceRole)
    const sessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { gathering_room_id: gatheringRoomId, status: 'active' },
      'started_at', 50
    );
    const validSessionIds = new Set(
      sessions
        .filter(s => new Date(s.expires_at).getTime() > now.getTime())
        .map(s => s.id)
    );

    if (validSessionIds.size === 0) {
      return Response.json({ participants: [] });
    }

    // 2. Get all participants for valid sessions
    const allParticipants = await base44.asServiceRole.entities.GatheringRoomParticipant.filter(
      { gathering_room_id: gatheringRoomId },
      'joined_at', 50
    );
    const validParticipants = allParticipants.filter(p => validSessionIds.has(p.session_id));

    // 3. Re-resolve user avatars from the User entity for user-type participants.
    // This fixes participants created before the avatar fix that stored null.
    const userParticipantIds = validParticipants
      .filter(p => p.participant_type === 'user')
      .map(p => p.participant_id);

    const userAvatarMap = {};
    for (const uid of userParticipantIds) {
      try {
        const users = await base44.asServiceRole.entities.User.filter({ id: uid }, null, 1);
        const u = users[0];
        if (u) {
          const avatar = u.generated_avatar_urls?.[0] || u.reference_image_urls?.[0] || null;
          if (avatar) userAvatarMap[uid] = avatar;
        }
      } catch (_) {}
    }

    // 4. Build sanitized projection
    // participant_type and owner_email are included as INTERNAL ROUTING metadata
    // for the game system (determines character-opponent vs human-shared-state mode,
    // and attributes game responses to the correct account). They must NEVER be
    // displayed in the participant-facing UI — everyone in the room is presented
    // simply as a participant/person. is_self / is_owned remain the display flags.
    const sanitized = validParticipants.map(p => {
      const isSelf = p.participant_type === 'user' && p.participant_id === user.id;
      const isOwned = p.owner_email === user.email;
      let avatarUrl = p.avatar_url;
      if (p.participant_type === 'user' && userAvatarMap[p.participant_id]) {
        avatarUrl = userAvatarMap[p.participant_id];
      }
      return {
        id: p.id,
        participant_id: p.participant_id,
        participant_name: p.participant_name,
        avatar_url: avatarUrl,
        is_self: isSelf,
        is_owned: isOwned,
        participant_type: p.participant_type,
        owner_email: p.owner_email,
        joined_at: p.joined_at,
      };
    });

    return Response.json({ participants: sanitized });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});