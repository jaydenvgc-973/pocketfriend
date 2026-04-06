import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Verify: Check where these 7 characters' homes SHOULD be vs where resolved_location shows them
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const targetNames = ['Mace', 'Ava', 'Carlos', 'Mia', 'Demi', 'Jordan', 'Leah'];
    
    const characters = await base44.entities.Character.filter(
      { created_by: user.email, status: 'active' }
    );

    const locationsRes = await base44.functions.invoke('fetchAllLocationsForUser', {});
    const locations = locationsRes?.data?.locations || [];
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const report = [];

    for (const char of characters) {
      if (targetNames.some(name => char.name.includes(name))) {
        const correctHome = char.current_home_location_id;
        const resolvedLoc = char.resolved_current_location_id;
        
        report.push({
          character_name: char.name,
          correct_home_id: correctHome,
          correct_home_name: correctHome ? locationMap[correctHome]?.name : 'NONE',
          resolved_location_id: resolvedLoc,
          resolved_location_name: char.resolved_current_location_name,
          mismatch: correctHome !== resolvedLoc
        });
      }
    }

    return Response.json({
      status: 'PLACEMENT_VERIFICATION',
      total_checked: report.length,
      report
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});