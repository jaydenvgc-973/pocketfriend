/**
 * checkCharacterLocationsV2 - Search by name field
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Get all characters, then match by name
    const allChars = await base44.asServiceRole.entities.Character.filter(
      {},
      '-updated_date',
      500
    );

    const names = ['Melody Jackson Perry', 'Andre Rivera', 'Nathan Parker', 'Ethan Thompson', 'Matt Lopez', 'Ava Dei Park'];
    const report = [];

    for (const searchName of names) {
      const char = allChars.find(c => 
        c.name === searchName || c.display_name === searchName || c.primary_name === searchName
      );

      if (!char) {
        report.push({
          search_name: searchName,
          error: 'Not found in database',
        });
        continue;
      }

      report.push({
        id: char.id,
        name: char.name,
        display_name: char.display_name,
        travel_status: char.travel_status,
        current_location_id: char.resolved_current_location_id,
        current_location_name: char.resolved_current_location_name,
        presence_status: char.resolved_presence_status,
      });
    }

    return Response.json(report);

  } catch (error) {
    console.error('[checkCharacterLocationsV2]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});