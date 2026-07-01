/**
 * recordLocationHistoryEvent
 *
 * REPAIRED: this used to be a caller-trusted historical writer with no auth,
 * no ownership check, no state verification, an arrivalTime a caller could
 * backdate/fabricate, and a confirmed comparison bug (`open.id === locationId`
 * instead of `open.location_id === locationId`, which meant "same location,
 * skip" never actually matched).
 *
 * It is now a thin, authenticated wrapper around writeVerifiedLocationHistory —
 * the single authoritative LocationHistory writer. All verification (owner
 * match, character-state match, correct record-closing, no fabricated
 * timestamps) happens there. This function no longer contains its own
 * LocationHistory logic.
 *
 * Payload:
 *   characterId      string  — Character ID
 *   ownerEmail       string  — Owner email (cross-checked against the actual Character record)
 *   locationId       string  — Destination location ID (must already equal Character.resolved_current_location_id)
 *   eventType        string  — arrival|departure|return_home|work_start|work_end|school_start|...
 *   travelSource     string  — schedule|autonomous|promise|commitment|need_fulfillment|manual|system|other
 *   travelReason     string  — human-readable reason
 *
 * NOTE: arrivalTime is intentionally NOT accepted — arrival time is always
 * server "now" so a caller cannot fabricate or backdate a canonical arrival.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate: if a session exists, it must match ownerEmail. Scheduled/
    // service callers with no session rely on the character-state verification
    // performed by writeVerifiedLocationHistory as the real authority gate.
    let user = null;
    try { user = await base44.auth.me(); } catch { /* scheduled/service context */ }

    const {
      characterId,
      ownerEmail,
      locationId,
      eventType = 'arrival',
      travelSource = 'system',
      travelReason,
    } = await req.json();

    if (!characterId || !ownerEmail || !locationId) {
      return Response.json({ error: 'characterId, ownerEmail, and locationId are required' }, { status: 400 });
    }

    if (user && user.email !== ownerEmail) {
      return Response.json({ error: 'Forbidden — ownerEmail does not match authenticated session' }, { status: 403 });
    }

    const result = await base44.asServiceRole.functions.invoke('writeVerifiedLocationHistory', {
      character_id: characterId,
      owner_email: ownerEmail,
      location_id: locationId,
      event_type: eventType,
      travel_source: travelSource,
      travel_reason: travelReason || null,
    });

    if (!result?.data?.success) {
      // Refuse to write — no fallback, no silent success. Report exactly why.
      return Response.json({
        success: false,
        error: result?.data?.error || 'writeVerifiedLocationHistory failed',
      }, { status: 409 });
    }

    console.log(`[recordLocationHistoryEvent] Verified write | char=${characterId} | loc=${locationId} | event=${eventType}`);

    return Response.json({ success: true, record_id: result.data.record_id });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});