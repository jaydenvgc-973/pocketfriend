import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Fix: Force characters to their correct homes, not Ethan's Family Home
 * Affected: Mace, Ava, Carlos, Mia, Demi, Jordan, Leah
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const targetNames = ['Mace', 'Ava', 'Carlos', 'Mia', 'Demi', 'Jordan', 'Leah'];
    
    const characters = await base44.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      "-updated_date"
    );

    const locationsRes = await base44.functions.invoke('fetchAllLocationsForUser', {});
    const locations = locationsRes?.data?.locations || [];
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const fixed = [];

    for (const char of characters) {
      if (targetNames.some(name => char.name.includes(name))) {
        // Force them to their correct home
        const correctHome = char.current_home_location_id;
        if (correctHome && correctHome !== char.resolved_current_location_id) {
          const homeLoc = locationMap[correctHome];
          
          await base44.entities.Character.update(char.id, {
            resolved_current_location_id: correctHome,
            resolved_current_location_name: homeLoc?.name || 'Home',
            resolved_location_type: 'home',
            resolved_presence_status: 'home',
            resolved_source_reason: 'corrected_to_actual_home',
            resolved_last_updated_at: new Date().toISOString()
          });

          fixed.push({
            character_id: char.id,
            character_name: char.name,
            corrected_from: char.resolved_current_location_name,
            corrected_to: homeLoc?.name || 'Home',
            actual_home_id: correctHome
          });
        }
      }
    }

    return Response.json({
      status: 'CHARACTER_HOME_CORRECTION',
      fixed_count: fixed.length,
      fixed
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});