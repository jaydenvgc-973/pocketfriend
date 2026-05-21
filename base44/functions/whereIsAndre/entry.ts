/**
 * whereIsAndre - show Andre's current state
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const [andre] = await base44.entities.Character.filter({ id: '69cd1c421ecd8b69850b3a6a' }, null, 1);
    const [loc] = await base44.asServiceRole.entities.LocationReference.filter(
      { id: andre.resolved_current_location_id },
      null,
      1
    ).catch(() => []);

    const [session] = await base44.asServiceRole.entities.TravelSession.filter(
      { id: '6a0f1a889a82163d02480971' },
      null,
      1
    );

    return Response.json({
      ANDRE: {
        id: andre.id,
        name: andre.name,
        current_location: {
          id: andre.resolved_current_location_id,
          name: andre.resolved_current_location_name,
          location_name: loc?.name,
          location_owner: loc?.owner_email,
        },
        travel_status: andre.travel_status,
      },
      SESSION: {
        destination_id: session.destination_location_id,
        destination_name: session.destination_location_name,
        route_status: session.route_status,
        progress: session.progress_percent,
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});