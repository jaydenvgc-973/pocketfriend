import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Fetch all locations relevant to the user:
 * - User-created locations (created_by: user.email)
 * - System-created generic homes for their characters
 * - NPC Hub
 * 
 * This bridges the RLS gap where service-role-created locations aren't visible to frontend queries.
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

    // Get user's characters so we can filter relevantly
    const userCharacters = await base44.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      '-created_date',
      500
    );
    const userCharIds = new Set(userCharacters.map(c => c.id));

    // Filter to: user-created + generic homes + NPC Hub + default world locations
    const DEFAULT_WORLD_NAMES = ['generic park', 'generic hospital', 'generic grocery store'];

    const relevantLocations = allLocations.filter(loc => {
      // User-created
      if (loc.created_by === user.email) return true;

      // Generic homes for their characters
      if (loc.is_default_generic) {
        const hasUserChar = (loc.resident_character_ids || []).some(id => userCharIds.has(id));
        if (hasUserChar) return true;
      }

      // NPC Hub (shared, contains their NPCs)
      if (loc.name === 'NPC Hub') return true;

      // Default world locations (park, hospital, grocery) — available to all users
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
        npcHub: relevantLocations.some(l => l.name === 'NPC Hub') ? 1 : 0,
      },
    });
  } catch (error) {
    console.error('[fetchAllLocationsForUser]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});