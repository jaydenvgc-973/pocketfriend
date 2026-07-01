import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * writeVerifiedLocationHistory — THE SINGLE AUTHORITATIVE LOCATIONHISTORY WRITER
 *
 * Every function that needs to write a LocationHistory proof record must call
 * this function instead of writing LocationHistory directly. This is the fix
 * for LocationHistory authority fragmentation (5 independent copy-pasted
 * implementations, one with a confirmed field-comparison bug).
 *
 * HARD RULES:
 * 1. Caller must have ALREADY written Character.resolved_current_location_id
 *    to the target location_id before calling this. This function verifies
 *    that fact — it does NOT move the character. It refuses to write a
 *    LocationHistory record for a location the Character record does not
 *    already confirm.
 * 2. owner_email is cross-checked against the actual Character.owner_email —
 *    never trusted blindly from the caller.
 * 3. arrival_time is always server "now" — callers cannot backdate or fabricate
 *    arrival timestamps.
 * 4. Prior open (is_current:true) records for this character are closed
 *    correctly (open.location_id compared against location_id — the bug in
 *    the old recordLocationHistoryEvent implementation compared open.id,
 *    the record's own primary key, which could never match).
 * 5. Fails visibly — returns { success:false, error } instead of throwing
 *    into a swallowed catch. Callers must check `success`.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Optional auth: if a live user session exists, it must match owner_email.
    // Scheduled/service callers have no session — the character-state check
    // below is the real authority gate in that case.
    let sessionUser = null;
    try { sessionUser = await base44.auth.me(); } catch { /* scheduled/service context */ }

    const {
      character_id,
      owner_email,
      location_id,
      event_type = 'arrival',
      travel_source = 'system',
      travel_reason = null,
    } = await req.json();

    if (!character_id || !owner_email || !location_id) {
      return Response.json({ success: false, error: 'character_id, owner_email, and location_id are required' }, { status: 400 });
    }

    if (sessionUser && sessionUser.email !== owner_email) {
      return Response.json({ success: false, error: 'owner_email does not match authenticated session' }, { status: 403 });
    }

    // ── VERIFY CHARACTER + OWNER ─────────────────────────────────────────
    const [char] = await base44.asServiceRole.entities.Character.filter({ id: character_id }, null, 1);
    if (!char) {
      return Response.json({ success: false, error: 'character_not_found' }, { status: 404 });
    }
    if (char.owner_email !== owner_email) {
      return Response.json({ success: false, error: 'owner_mismatch', character_owner: char.owner_email }, { status: 403 });
    }

    // ── VERIFY CANONICAL STATE SUPPORTS THIS EVENT ───────────────────────
    // This function documents a transition that must have ALREADY happened.
    // It refuses to fabricate history for a location the Character record
    // does not already confirm.
    if (char.resolved_current_location_id !== location_id) {
      return Response.json({
        success: false,
        error: 'character_state_mismatch',
        reason: `Character.resolved_current_location_id (${char.resolved_current_location_id}) does not match requested location_id (${location_id}). The Character write must happen before requesting this proof.`,
      }, { status: 409 });
    }

    const [destLoc] = await base44.asServiceRole.entities.LocationReference.filter({ id: location_id }, null, 1);
    const nowIso = new Date().toISOString();

    // ── CLOSE PRIOR OPEN RECORDS (correct field comparison) ──────────────
    const openRecords = await base44.asServiceRole.entities.LocationHistory.filter(
      { character_id, owner_email, is_current: true }, null, 20
    );
    for (const open of openRecords) {
      if (open.location_id === location_id) continue; // already-current record for this location
      const arrivalMs = new Date(open.arrival_time).getTime();
      const durationMinutes = Math.round((Date.now() - arrivalMs) / 60000);
      await base44.asServiceRole.entities.LocationHistory.update(open.id, {
        is_current: false,
        departure_time: nowIso,
        duration_minutes: durationMinutes > 0 ? durationMinutes : null,
      });
    }

    // ── PREVENT DUPLICATE CURRENT RECORD FOR THE SAME LOCATION ───────────
    const alreadyCurrentForThisLocation = openRecords.find(o => o.location_id === location_id);
    if (alreadyCurrentForThisLocation) {
      return Response.json({ success: true, record_id: alreadyCurrentForThisLocation.id, note: 'already_current_no_duplicate_created' });
    }

    // ── WRITE THE NEW ARRIVAL RECORD ──────────────────────────────────────
    const record = await base44.asServiceRole.entities.LocationHistory.create({
      character_id,
      character_name: char.name || 'Unknown',
      owner_email,
      location_id,
      location_name: destLoc?.name || '',
      location_category: destLoc?.category || 'other',
      event_type,
      arrival_time: nowIso,
      travel_source,
      travel_reason,
      is_current: true,
    });

    return Response.json({ success: true, record_id: record.id });
  } catch (error) {
    console.error('[writeVerifiedLocationHistory] ERROR:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});