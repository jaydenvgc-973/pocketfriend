import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const locations = await base44.entities.LocationReference.list();

    const fixes = [];

    // For each character, remove them from all homes except their primary home
    for (const char of characters) {
      const primaryHome = char.current_home_location_id;
      if (!primaryHome) continue;

      const placesTheyAppear = locations.filter(l =>
        l.resident_character_ids?.includes(char.id) ||
        l.resident_character_names?.includes(char.name)
      );

      for (const loc of placesTheyAppear) {
        // Keep only in primary home
        if (loc.id !== primaryHome) {
          const updatedResidents = (loc.resident_character_ids || []).filter(id => id !== char.id);
          const updatedNames = (loc.resident_character_names || []).filter(name => name !== char.name);
          
          await base44.entities.LocationReference.update(loc.id, {
            resident_character_ids: updatedResidents,
            resident_character_names: updatedNames,
          });

          fixes.push(`Removed ${char.name} from ${loc.name}`);
        }
      }
    }

    // Ensure primary homes have the character in occupancy
    for (const char of characters) {
      if (char.current_home_location_id) {
        const home = locations.find(l => l.id === char.current_home_location_id);
        if (home) {
          const hasCharId = home.resident_character_ids?.includes(char.id);
          const hasCharName = home.resident_character_names?.includes(char.name);

          const updates = {};
          if (!hasCharId) {
            updates.resident_character_ids = [...(home.resident_character_ids || []), char.id];
          }
          if (!hasCharName) {
            updates.resident_character_names = [...(home.resident_character_names || []), char.name];
          }

          if (Object.keys(updates).length > 0) {
            await base44.entities.LocationReference.update(home.id, updates);
            fixes.push(`Ensured ${char.name} is in ${home.name}`);
          }
        }
      }
    }

    // Also initialize holiday_observation_enabled in UserSettings
    const userSettings = await base44.entities.UserSettings.filter({ created_by: user.email });
    if (userSettings[0]) {
      if (!('holiday_observation_enabled' in userSettings[0])) {
        await base44.entities.UserSettings.update(userSettings[0].id, {
          holiday_observation_enabled: true,
        });
        fixes.push('Enabled holiday_observation_enabled in UserSettings');
      }
    } else {
      await base44.entities.UserSettings.create({
        holiday_observation_enabled: true,
      });
      fixes.push('Created UserSettings with holiday_observation_enabled');
    }

    return Response.json({
      timestamp: new Date().toISOString(),
      fixed: fixes.length,
      fixes,
      status: 'SUCCESS',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});