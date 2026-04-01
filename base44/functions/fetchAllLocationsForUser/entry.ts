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

    const DEFAULT_WORLD_NAMES = ['generic park', 'generic hospital', 'generic grocery store'];
    const RESIDENTIAL_CATEGORIES = new Set(['home', 'generic']);

    const relevantLocations = allLocations.filter(loc => {
      // 1. User-created locations — always show, regardless of occupancy
      if (loc.created_by === user.email) return true;

      // 2. Generic homes linked to any of their characters
      //    FIXED: do NOT require residents to be currently attached.
      //    A generic home created for a character is always relevant even if empty.
      if (loc.is_default_generic) {
        // Check any linkage: current residents, character_id field, or character_specific type
        const hasResidentLink = (loc.resident_character_ids || []).some(id => userCharIds.has(id));
        const hasCharLink = loc.character_id && userCharIds.has(loc.character_id);
        const hasWorkerLink = (loc.worker_character_ids || []).some(id => userCharIds.has(id));
        if (hasResidentLink || hasCharLink || hasWorkerLink) return true;
        // Also include if it was created in service role but mentions a user char name
        // (fallback: include all generic homes if no other user has explicit claim)
        // We include it if there's no created_by OR if it seems globally created
        if (!loc.created_by || loc.created_by === 'system') return true;
      }

      // 3. Residential locations (home/generic) that reference any of the user's characters
      //    This covers named homes like "Ethan and Lila's home" that were system-created
      if (RESIDENTIAL_CATEGORIES.has(loc.category)) {
        const hasResidentLink = (loc.resident_character_ids || []).some(id => userCharIds.has(id));
        const hasCharLink = loc.character_id && userCharIds.has(loc.character_id);
        const hasWorkerLink = (loc.worker_character_ids || []).some(id => userCharIds.has(id));
        if (hasResidentLink || hasCharLink || hasWorkerLink) return true;
      }

      // 4. Any location (any category) directly linked from a character's profile fields
      if (charLinkedLocationIds.has(loc.id)) return true;

      // 5. NPC Hub
      if (loc.name === 'NPC Hub') return true;

      // 6. Default world locations — available to all users
      const nameLower = (loc.name || '').toLowerCase();
      if (DEFAULT_WORLD_NAMES.some(n => nameLower.includes(n))) return true;

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