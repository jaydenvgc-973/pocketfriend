import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// ── SANITIZED CROSS-ACCOUNT PARTICIPANT PROJECTION ──────────────────────────
// Returns all valid active participants in a Gathering Room, regardless of
// which account owns them. The browser receives ONLY:
//   - id (stable room-facing participant ID)
//   - participant_name
//   - avatar_url
//   - is_self (true only for the requesting user's own user-participant)
//   - is_owned (true for participants belonging to the requesting user's account)
//   - joined_at
//
// It does NOT receive: owner_email, participant_type, session_id, account IDs,
// or any internal authorization fields. Entity type (user vs character) is never
// disclosed to the browser.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(req.url);
    const gatheringRoomId = url.searchParams.get('gathering_room_id');
    if (!gatheringRoomId) {
      return Response.json({ error: 'Missing gathering_room_id' }, { status: 400 });
    }

    const now = new Date();

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

    // 4. Build sanitized projection — no entity type, no owner info
    const sanitized = validParticipants.map(p => {
      const isSelf = p.participant_type === 'user' && p.participant_id === user.id;
      const isOwned = p.owner_email === user.email;
      let avatarUrl = p.avatar_url;
      if (p.participant_type === 'user' && userAvatarMap[p.participant_id]) {
        avatarUrl = userAvatarMap[p.participant_id];
      }
      return {
        id: p.id,
        participant_name: p.participant_name,
        avatar_url: avatarUrl,
        is_self: isSelf,
        is_owned: isOwned,
        joined_at: p.joined_at,
      };
    });

    return Response.json({ participants: sanitized });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});