/**
 * checkAndreNow - quick Andre state check
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const allChars = await base44.entities.Character.filter({ owner_email: user.email }, null, 200);
    const andre = allChars.find(c => 
      (c.name && c.name.toLowerCase().includes('andre')) ||
      (c.display_name && c.display_name.toLowerCase().includes('andre'))
    );

    if (!andre) return Response.json({ error: 'Andre not found' }, { status: 404 });

    const sessions = await base44.asServiceRole.entities.TravelSession.filter(
      { character_id: andre.id },
      '-created_at',
      5
    );

    return Response.json({
      ANDRE: {
        id: andre.id,
        name: andre.name,
        owner_email: andre.owner_email,
        travel_status: andre.travel_status,
        canonical_location: andre.resolved_current_location_name,
      },
      ACTIVE_SESSIONS: sessions.slice(0, 2).map(s => ({
        id: s.id,
        status: s.route_status,
        progress: s.progress_percent,
        origin: s.origin_location_name,
        destination: s.destination_location_name,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});