import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// ── AUTHORITATIVE SESSION EXPIRATION ──────────────────────────────────────────
// This function is the authoritative 30-minute expiration mechanism for Gathering
// Room sessions. It is invoked by a scheduled automation (the platform's existing
// time-bound event authority), NOT by client interaction and NOT by polling.
//
// Lazy expiration remains inside admitToGatheringRoom and sendGatheringRoomMessage
// as a defensive integrity safeguard — but THIS function is the primary timer.
// It runs independently of user activity and releases capacity at the expiration
// time without requiring any subsequent user action.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const now = new Date();
    const nowIso = now.toISOString();
    const cooldownUntil = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

    // ── 1. FIND ALL EXPIRED ACTIVE SESSIONS ──────────────────────────────────
    const allActiveSessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      { status: 'active' },
      null, 100
    );
    const expiredSessions = allActiveSessions.filter(
      s => new Date(s.expires_at).getTime() < now.getTime()
    );

    let expiredCount = 0;
    const roomIdsToUpdate = new Set();

    for (const sess of expiredSessions) {
      // ── 2. END SESSION ──
      await base44.asServiceRole.entities.GatheringRoomSession.update(sess.id, {
        status: 'expired',
        ended_at: nowIso,
      });

      // ── 3. REMOVE ALL PARTICIPANTS (user + characters) ──
      await base44.asServiceRole.entities.GatheringRoomParticipant.deleteMany({
        session_id: sess.id,
      });

      // ── 4. CREATE COOLDOWN ──
      await base44.asServiceRole.entities.GatheringRoomCooldown.create({
        gathering_room_id: sess.gathering_room_id,
        gathering_room_name: sess.gathering_room_name,
        owner_email: sess.owner_email,
        owner_user_id: sess.owner_user_id,
        cooldown_until: cooldownUntil,
        reason: 'expired',
        character_ids: sess.character_ids || [],
        created_at: nowIso,
      });

      // ── 5. CLEAR CANONICAL CHARACTER LOCATION ──
      // Transition each character out of Gathering Room location using the existing
      // canonical location fields. The frontend resolver will recompute their real
      // location (home, work, etc.) on next render.
      for (const charId of (sess.character_ids || [])) {
        try {
          const chars = await base44.asServiceRole.entities.Character.filter({ id: charId }, null, 1);
          const char = chars[0];
          if (char && char.resolved_location_type === 'gathering_room') {
            await base44.asServiceRole.entities.Character.update(charId, {
              resolved_location_type: null,
              resolved_presence_status: 'home',
              resolved_current_location_id: char.current_home_location_id || null,
              resolved_current_location_name: null,
              resolved_source_reason: 'gathering_room_exit',
              resolved_last_updated_at: nowIso,
              gathering_room_session_id: null,
            });
          }
        } catch (_) {}
      }

      roomIdsToUpdate.add(sess.gathering_room_id);
      expiredCount++;
    }

    // ── 6. RECALCULATE OCCUPANCY + REGENERATE SCENE IMAGES for changed rooms ──
    for (const roomId of roomIdsToUpdate) {
      try {
        await base44.asServiceRole.functions.invoke('recalculateGatheringRoomOccupancy', {
          gathering_room_id: roomId,
        });
      } catch (_) {}
      try {
        await base44.asServiceRole.functions.invoke('generateGatheringRoomScene', {
          gathering_room_id: roomId,
        });
      } catch (_) {}
    }

    // ── 7. CLEAN UP ORPHANED PARTICIPANTS from non-active sessions ────────────
    // Defensive integrity safeguard: delete participants whose parent session
    // is no longer active. This catches any deletion failures from exit/expire
    // and ensures stale participant records never inflate occupancy counts.
    const recentSessions = await base44.asServiceRole.entities.GatheringRoomSession.filter(
      {}, '-ended_at', 50
    );
    const nonActiveSessions = recentSessions.filter(s => s.status !== 'active');
    let orphanedCount = 0;
    for (const sess of nonActiveSessions) {
      const orphans = await base44.asServiceRole.entities.GatheringRoomParticipant.filter(
        { session_id: sess.id }, null, 20
      );
      if (orphans.length > 0) {
        await base44.asServiceRole.entities.GatheringRoomParticipant.deleteMany({ session_id: sess.id });
        orphanedCount += orphans.length;
      }
    }

    return Response.json({
      success: true,
      expired_count: expiredCount,
      orphaned_participants_removed: orphanedCount,
      checked_at: nowIso,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});