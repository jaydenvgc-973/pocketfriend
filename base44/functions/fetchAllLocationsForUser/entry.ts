import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Fetch all locations relevant to the user:
 * - User-created locations (created_by: user.email, location_type: 'global')
 * - Admin-created shared locations (location_type: 'shared')
 * - Character-specific locations linked to their characters
 * - For admins: All global locations they created + all shared locations
 * - For regular users: Their global + all shared + character-linked
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
    const isAdmin = user.role === 'admin';

    // Filter locations based on multi-tenant ownership rules:
    // shared scope (or legacy location_type=shared) → visible to all
    // account_global / character_specific → only visible to owner
    // Admin sees everything
    const relevantLocations = allLocations.filter(loc => {
      // Shared locations (admin-created, available to all)
      // STRICT: only pass through if creator_account_type is admin OR created_by_role is admin.
      // A user-created location with scope='shared' should NOT bleed to other users — only admin
      // can promote a location to truly shared/global visibility.
      if (loc.scope === 'shared' || loc.location_type === 'shared') {
        // Only allow if it was admin-created (not user-created with shared scope accidentally set)
        if (loc.created_by_role === 'admin' || loc.is_generic_shared === true) return true;
        // If owner_email is set and matches this user, it's fine (they created it)
        if (loc.owner_email && loc.owner_email === user.email) return true;
        // Otherwise, 'shared' from a user account must not bleed to other users
        if (loc.owner_email && loc.owner_email !== user.email) return false;
        // No owner_email + shared scope + admin creator = global
        if (!loc.owner_email && !loc.created_by) return true;
        return false;
      }

      // Admin: see all locations
      if (isAdmin) return true;

      // Ownership via new field (preferred)
      if (loc.owner_email && loc.owner_email === user.email) return true;

      // Ownership via legacy created_by (only when owner_email is not set)
      if (!loc.owner_email && loc.created_by === user.email) return true;

      // Character-linked locations for this user's characters.
      // STRICT: only include if the location is also owned by this user OR has no owner
      // (preventing cross-account location leakage via character work/school links).
      if (charLinkedLocationIds.has(loc.id)) {
        const locOwner = loc.owner_email || loc.created_by || null;
        if (!locOwner || locOwner === user.email) return true;
        // Location is linked from a character profile BUT owned by a different user — exclude it
        return false;
      }

      return false;
    });

    return Response.json({
      success: true,
      locations: relevantLocations,
      totalCount: relevantLocations.length,
      summary: {
        userCreated: relevantLocations.filter(l => l.created_by === user.email).length,
        shared: relevantLocations.filter(l => l.location_type === 'shared').length,
        characterLinked: relevantLocations.filter(l => charLinkedLocationIds.has(l.id)).length,
        residentialTotal: relevantLocations.filter(l => RESIDENTIAL_CATEGORIES.has(l.category)).length,
      },
    });
  } catch (error) {
    console.error('[fetchAllLocationsForUser]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});