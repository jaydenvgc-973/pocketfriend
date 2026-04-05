import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Get fresh character data
    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const locations = await base44.entities.LocationReference.list();

    const report = {
      timestamp: new Date().toISOString(),
      charCheck: [],
      fixes: [],
    };

    for (const char of characters) {
      const check = {
        name: char.name,
        hasCurrentLocationId: !!char.current_location_id,
        currentLocationIdValue: char.current_location_id || null,
        hasHomeId: !!char.current_home_location_id,
        homeIdValue: char.current_home_location_id || null,
      };
      
      report.charCheck.push(check);

      // If character has home location but NOT current location, fix it
      if (char.current_home_location_id && !char.current_location_id) {
        const homeExists = locations.some(l => l.id === char.current_home_location_id);
        if (homeExists) {
          await base44.entities.Character.update(char.id, {
            current_location_id: char.current_home_location_id,
          });
          report.fixes.push({
            name: char.name,
            fixed: `Set current_location_id to ${char.current_home_location_id}`,
          });
        }
      }
    }

    // Re-fetch to verify all fixed
    const verifyChars = await base44.entities.Character.filter({ created_by: user.email });
    const verification = {
      timestamp: new Date().toISOString(),
      allHaveLocation: verifyChars.every(c => !!c.current_location_id),
      charWithLocation: verifyChars.filter(c => !!c.current_location_id).length,
      charWithoutLocation: verifyChars.filter(c => !c.current_location_id).length,
      details: verifyChars.map(c => ({
        name: c.name,
        hasLocation: !!c.current_location_id,
        locationId: c.current_location_id || null,
      })),
    };

    return Response.json({
      initialCheck: report,
      verification,
      status: verification.allHaveLocation ? 'SUCCESS: All characters have current_location_id' : 'PARTIAL: Some still missing',
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});