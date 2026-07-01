/**
 * startCharacterTravel — TRANSIT TRAVEL REMOVED
 *
 * Previously calculated travel time from distance, set ETA, created in-transit
 * route_status with progress_percent. That behavior is forbidden.
 *
 * Characters now teleport instantly. Delegates to achieveCharacterDestination.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { character_id, destination_location_id, travel_reason, travel_source, owner_email } = await req.json();
    if (!character_id || !destination_location_id) {
      return Response.json({ success: false, error: 'Missing character_id or destination_location_id' }, { status: 400 });
    }

    const result = await base44.asServiceRole.functions.invoke('achieveCharacterDestination', {
      character_id,
      destination_location_id,
      presence_status: travel_source === 'work_schedule' ? 'at_work' :
                        travel_source === 'school_schedule' ? 'at_school' : 'visiting',
      location_type: travel_source === 'work_schedule' ? 'work' :
                     travel_source === 'school_schedule' ? 'school' : 'visit',
      source_reason: travel_reason || travel_source || 'instant_teleport',
    }).catch(e => ({ data: { success: false, error: e.message } }));

    const d = result?.data || {};
    if (!d.success) {
      return Response.json({ success: false, error: d.error || 'achieveCharacterDestination failed' }, { status: 500 });
    }

    return Response.json({
      success: true,
      character_id,
      destination_name: d.destination_name,
      instant_teleport: true,
      proof_written: true,
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});