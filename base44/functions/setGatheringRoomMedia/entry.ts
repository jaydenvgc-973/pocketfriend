import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// ── GATHERING ROOM SHARED MEDIA ──────────────────────────────────────────────
// Sets or clears the active shared media (video, music) in a Gathering Room.
// Only a participant with an active session can set media.
// The media state is stored on the GatheringRoom entity's active_media field
// and propagated to all participants via realtime subscriptions.
// Uses the existing media architecture — no second media system.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const gatheringRoomId = body.gathering_room_id;
    const mediaType = body.media_type || 'none'; // 'video' | 'music' | 'image' | 'none'
    const title = body.title || null;
    const url = body.url || null;
    const thumbnail = body.thumbnail || null;
    const description = body.description || null;
    const embedType = body.embed_type || null; // 'iframe' | 'video' — for playback rendering

    if (!gatheringRoomId) {
      return Response.json({ error: 'Missing gathering_room_id' }, { status: 400 });
    }

    // ── 1. VERIFY SENDER HAS ACTIVE SESSION ──
    const sessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { gathering_room_id: gatheringRoomId, owner_email: user.email, status: 'active' },
      null, 1
    );
    const session = sessions[0];
    if (!session) {
      return Response.json({ error: 'You do not have an active session in this Gathering Room.' }, { status: 403 });
    }

    // ── 2. RESOLVE SENDER PARTICIPANT NAME ──
    const participants = await base44.asServiceRole.entities.GatheringRoomParticipant.filter(
      { gathering_room_id: gatheringRoomId, session_id: session.id, participant_type: 'user' },
      null, 1
    );
    const senderName = participants[0]?.participant_name || 'Someone';

    // ── 3. UPDATE ROOM ACTIVE MEDIA ──
    const nowIso = new Date().toISOString();
    const activeMedia = mediaType === 'none' ? null : {
      media_type: mediaType,
      title,
      url,
      thumbnail,
      description,
      embed_type: embedType,
      started_at: nowIso,
      started_by_participant_name: senderName,
    };

    await base44.asServiceRole.entities.GatheringRoom.update(gatheringRoomId, {
      active_media: activeMedia,
    });

    return Response.json({
      success: true,
      active_media: activeMedia,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});