/**
 * checkCharacterLocations
 *
 * Shows where the 6 characters actually are.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const names = ['Melody Jackson Perry', 'Andre Rivera', 'Nathan Parker', 'Ethan Thompson', 'Matt Lopez', 'Ava Dei Park'];

    const report = [];

    for (const name of names) {
      const [char] = await base44.asServiceRole.entities.Character.filter(
        { display_name: name },
        null,
        1
      ).catch(() => [null]);

      if (!char) {
        report.push({
          name,
          error: 'Not found',
        });
        continue;
      }

      report.push({
        id: char.id,
        name: char.name,
        travel_status: char.travel_status,
        current_location_id: char.resolved_current_location_id,
        current_location_name: char.resolved_current_location_name,
        presence_status: char.resolved_presence_status,
      });
    }

    console.log('[checkCharacterLocations]', JSON.stringify(report, null, 2));

    return Response.json(report);

  } catch (error) {
    console.error('[checkCharacterLocations]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});