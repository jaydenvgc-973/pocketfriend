// ═══════════════════════════════════════════════════════════════════════════
// READ-ONLY VERIFICATION OBSERVER — Sole sanctioned observation path
// ═══════════════════════════════════════════════════════════════════════════
//
// This function is the sole sanctioned observation path for verification work.
// It is STRUCTURALLY READ-ONLY: the body contains zero write operations.
// There is no `update`, no `create`, no `delete`, no `bulkCreate`, no `bulkUpdate`,
// no `updateMany`, no `deleteMany` anywhere in this file. It cannot modify any
// production state by construction.
//
// Per src/VERIFICATION_PROTOCOL.md, all future verification observation must
// route through this function instead of ad-hoc exec_tool / test_backend_function
// calls that can accidentally write protected production state.
//
// If a verification step requires anything beyond a read, it is out of scope
// unless the assignment explicitly authorizes the write. This function will not
// perform it.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized', writes_performed: 0 }, { status: 401 });

    let payload = {};
    try { payload = await req.json(); } catch (_) { /* no body — still allowed for health check */ }
    const { character_id, owner_email } = payload;

    // Health / mode check — confirms the observer is read-only without touching data.
    if (!character_id) {
      return Response.json({
        ok: true,
        verification_mode: 'observation_only',
        writes_performed: 0,
        note: 'observeVerificationState is structurally read-only. Pass character_id to observe a character.',
      });
    }

    const effectiveOwner = owner_email || user.email;

    // ── READS ONLY ───────────────────────────────────────────────────────────
    // No write operation appears below this point or anywhere in this function.
    const chars = await base44.asServiceRole.entities.Character.filter(
      { id: character_id, owner_email: effectiveOwner }
    );
    if (!chars?.length) {
      return Response.json({ error: 'Character not found or ownership mismatch', writes_performed: 0 }, { status: 404 });
    }
    const character = chars[0];

    const sleepTransitions = await base44.asServiceRole.entities.SleepTransition.filter(
      { character_id, owner_email: effectiveOwner }, '-timestamp', 10
    ).catch(() => []);

    const currentLocationHistory = await base44.asServiceRole.entities.LocationHistory.filter(
      { character_id, owner_email: effectiveOwner, is_current: true }, null, 5
    ).catch(() => []);

    const recentLocationHistory = await base44.asServiceRole.entities.LocationHistory.filter(
      { character_id, owner_email: effectiveOwner }, '-arrival_time', 5
    ).catch(() => []);

    return Response.json({
      observed_at: new Date().toISOString(),
      verification_mode: 'observation_only',
      writes_performed: 0,
      character: {
        name: character.name,
        resolved_presence_status: character.resolved_presence_status,
        resolved_current_location_id: character.resolved_current_location_id,
        resolved_current_location_name: character.resolved_current_location_name,
        resolved_location_type: character.resolved_location_type,
        resolved_source_reason: character.resolved_source_reason,
        presence_stay_lock: character.presence_stay_lock,
        presence_stay_lock_reason: character.presence_stay_lock_reason,
        last_sleep_start: character.last_sleep_start,
        last_nap_time: character.last_nap_time,
        last_wake_time: character.last_wake_time,
        pending_alarm_time: character.pending_alarm_time,
        is_test_character: character.is_test_character,
        work_days: character.work_days,
        status: character.status,
        energy_value: character.energy_value,
      },
      sleep_transitions: sleepTransitions.map(s => ({
        transition_type: s.transition_type,
        from_status: s.from_status,
        to_status: s.to_status,
        authority: s.authority,
        timestamp: s.timestamp,
      })),
      current_location_history: currentLocationHistory.map(l => ({
        location_name: l.location_name,
        event_type: l.event_type,
        is_current: l.is_current,
        arrival_time: l.arrival_time,
      })),
      recent_location_history: recentLocationHistory.map(l => ({
        location_name: l.location_name,
        event_type: l.event_type,
        is_current: l.is_current,
        arrival_time: l.arrival_time,
        departure_time: l.departure_time,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message, writes_performed: 0 }, { status: 500 });
  }
});