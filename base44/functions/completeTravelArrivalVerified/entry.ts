/**
 * completeTravelArrivalVerified — TRANSIT TRIGGER REMOVED
 *
 * Previously loaded arrival_due sessions (ETA-based trigger) and completed
 * transit arrivals. That transit trigger is forbidden.
 *
 * The verified-write pattern (Character write + read-back + LocationHistory
 * proof + rollback) is preserved in achieveCharacterDestination, which is
 * the instant teleport authority.
 *
 * This function now accepts a direct character_id + destination and delegates
 * to achieveCharacterDestination for instant teleport + proof. No transit
 * session, no ETA, no arrival_due trigger.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { character_id, destination_location_id, _owner_email_hint } = body;

    // If no direct character_id provided, return transit-removed message
    if (!character_id || !destination_location_id) {
      return Response.json({
        success: true,
        transit_travel_removed: true,
        reason: 'Transit arrival trigger removed. Provide character_id + destination_location_id for direct instant teleport, or use achieveCharacterDestination.',
        results: [],
      });
    }

    // Delegate to instant teleport authority
    const result = await base44.asServiceRole.functions.invoke('achieveCharacterDestination', {
      character_id,
      destination_location_id,
      presence_status: 'visiting',
      location_type: 'visit',
      source_reason: 'instant_teleport_via_completeTravelArrivalVerified',
    }).catch(e => ({ data: { success: false, error: e.message } }));

    const d = result?.data || {};
    if (!d.success) {
      return Response.json({ success: false, error: d.error || 'achieveCharacterDestination failed' }, { status: 500 });
    }

    return Response.json({
      success: true,
      instant_teleport: true,
      character_name: d.character_name,
      destination: d.destination_name,
      proof_written: true,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});