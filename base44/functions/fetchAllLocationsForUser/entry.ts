import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Fetch all locations relevant to the user:
 * - User-created locations (created_by: user.email)
 * - Generic homes for their characters (even if currently empty/unoccupied)
 * - Named homes linked to their characters via character_id, resident_character_ids, or worker_character_ids
 * - NPC Hub
 * - Default world locations (park, hospital, grocery store)
 *
 * IMPORTANT: A location existing is enough to show it. Empty/vacant locations must appear.
 * Never filter out a location just because resident_count = 0 or no current occupants.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all locations (service role bypasses RLS)
    const allLocations = await base44.asServiceRole.entities.LocationReference.list(
      '-created_date',
      500
    );

    // Get user's characters (active + moved_away — both can have linked homes)
    const userCharacters = await base44.entities.Character.filter(
      { created_by: user.email },
      '-created_date',
      500
    );
    const userCharIds = new Set(userCharacters.map(c => c.id));

    // Build a set of all location IDs referenced from character profiles
    // (occupation_location_id, education_location_id, home via resident_character_ids)
    const charLinkedLocationIds = new Set();
    for (const char of userCharacters) {
      if (char.occupation_location_id) charLinkedLocationIds.add(char.occupation_location_id);
      if (char.education_location_id) charLinkedLocationIds.add(char.education_location_id);
      if (char.additional_occupation_locations) {
        for (const loc of char.additional_occupation_locations) {
          if (loc.location_id) charLinkedLocationIds.add(loc.location_id);
        }
      }
      if (char.additional_education_locations) {
        for (const loc of char.additional_education_locations) {
          if (loc.location_id) charLinkedLocationIds.add(loc.location_id);
        }
      }
    }

    const RESIDENTIAL_CATEGORIES = new Set(['home', 'generic']);

    const relevantLocations = allLocations.filter(loc => {
      // 1. User-created locations — always show
      if (loc.created_by === user.email) return true;

      // 2. DISABLED: Do NOT auto-show generic locations (park, hospital, grocery)
      //    These should never be auto-created. Only show if explicitly created by user.
      // if (loc.is_default_generic) return true;

      // 3. Residential locations that reference any of the user's characters
      if (RESIDENTIAL_CATEGORIES.has(loc.category)) {
        const hasResidentLink = (loc.resident_character_ids || []).some(id => userCharIds.has(id));
        const hasCharLink = loc.character_id && userCharIds.has(loc.character_id);
        if (hasResidentLink || hasCharLink) return true;
      }

      // 4. Any location directly linked from a character's profile fields
      if (charLinkedLocationIds.has(loc.id)) return true;

      // 5. NPC Hub
      if (loc.name === 'NPC Hub') return true;

      return false;
    });

    return Response.json({
      success: true,
      locations: relevantLocations,
      totalCount: relevantLocations.length,
      summary: {
        userCreated: relevantLocations.filter(l => l.created_by === user.email).length,
        genericHomes: relevantLocations.filter(l => l.is_default_generic).length,
        residentialTotal: relevantLocations.filter(l => RESIDENTIAL_CATEGORIES.has(l.category)).length,
        npcHub: relevantLocations.some(l => l.name === 'NPC Hub') ? 1 : 0,
      },
    });
  } catch (error) {
    console.error('[fetchAllLocationsForUser]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});