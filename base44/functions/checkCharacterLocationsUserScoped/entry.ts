/**
 * checkCharacterLocationsUserScoped
 * 
 * Uses user auth to check character locations (respects RLS)
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get user's characters (user-scoped RLS)
    const allChars = await base44.entities.Character.list();

    const names = ['Melody Jackson Perry', 'Andre Rivera', 'Nathan Parker', 'Ethan Thompson', 'Matt Lopez', 'Ava Dei Park'];
    const report = {
      user_email: user.email,
      total_characters: allChars.length,
      found: [],
      not_found: [],
    };

    for (const searchName of names) {
      const char = allChars.find(c => 
        c.name === searchName || c.display_name === searchName || c.primary_name === searchName
      );

      if (!char) {
        report.not_found.push(searchName);
        continue;
      }

      report.found.push({
        id: char.id,
        name: char.name,
        travel_status: char.travel_status,
        current_location_id: char.resolved_current_location_id,
        current_location_name: char.resolved_current_location_name,
        presence_status: char.resolved_presence_status,
      });
    }

    return Response.json(report);

  } catch (error) {
    console.error('[checkCharacterLocationsUserScoped]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});