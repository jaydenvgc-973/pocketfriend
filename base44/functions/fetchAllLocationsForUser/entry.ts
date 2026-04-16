import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * STRICT ACCOUNT ISOLATION — Fetch only locations belonging to the current user's account.
 *
 * VISIBILITY RULES (three-layer model):
 *   1. PRIVATE  — owner_email === current user. Visible only to creator. Admin is NOT exempt.
 *   2. SHARED   — explicitly shared by admin (created_by_role=admin, scope=shared OR is_generic_shared).
 *                 Visible to all accounts.
 *   3. GLOBAL   — system-level locations with no owner. Visible to all accounts.
 *
 * ADMIN ACCOUNT RULE:
 *   Admin does NOT automatically see locations created by other user accounts.
 *   Admin only sees their own locations + shared/global locations — same as any user.
 *   This prevents private user world data from appearing in admin's gameplay interfaces.
 *
 * NO LOCATION DRIFTING. NO CROSS-ACCOUNT CONTAMINATION.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all locations (service role bypasses RLS — we apply strict filtering below)
    const allLocations = await base44.asServiceRole.entities.LocationReference.list(
      '-created_date',
      500
    );

    // Get this account's own characters (to resolve character-linked locations)
    const userCharacters = await base44.entities.Character.filter(
      { created_by: user.email },
      '-created_date',
      500
    );

    // Build a set of location IDs explicitly linked from THIS user's character profiles
    const charLinkedLocationIds = new Set();
    for (const char of userCharacters) {
      if (char.occupation_location_id) charLinkedLocationIds.add(char.occupation_location_id);
      if (char.education_location_id) charLinkedLocationIds.add(char.education_location_id);
      // Include home and current resolved locations
      if (char.current_home_location_id) charLinkedLocationIds.add(char.current_home_location_id);
      if (char.resolved_current_location_id) charLinkedLocationIds.add(char.resolved_current_location_id);
      if (char.current_work_location_id) charLinkedLocationIds.add(char.current_work_location_id);
      if (char.current_school_location_id) charLinkedLocationIds.add(char.current_school_location_id);
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

    // ── STRICT ACCOUNT ISOLATION FILTER ─────────────────────────────────────────────
    // Each account sees only: their own locations + admin-created shared/global locations.
    // Admin role grants NO special visibility into other users' private locations.

    // Build a set of all character IDs that belong to this user
    const userCharacterIds = new Set(userCharacters.map(c => c.id));

    const relevantLocations = allLocations.filter(loc => {
      // ── LAYER 1: OWNED BY THIS ACCOUNT (private) ──────────────────────────────────
      // Primary ownership field
      if (loc.owner_email && loc.owner_email === user.email) return true;
      // Legacy ownership via created_by (only when owner_email is absent)
      if (!loc.owner_email && loc.created_by === user.email) return true;

      // ── LAYER 2: CHARACTER-SPECIFIC — created for one of this user's characters ──
      // Covers service-created homes/workplaces where created_by is a service account
      // but the location is tied to a character owned by this user.
      if (loc.location_type === 'character_specific' || loc.scope === 'character_specific') {
        if (loc.owner_character_id && userCharacterIds.has(loc.owner_character_id)) return true;
        if (loc.assigned_character_id && userCharacterIds.has(loc.assigned_character_id)) return true;
        if (loc.character_id && userCharacterIds.has(loc.character_id)) return true;
      }

      // ── LAYER 3: CHARACTER-LINKED — referenced by one of this user's characters ──
      // Includes any location explicitly linked from character profile fields
      // (home, work, school, etc.) provided it has no owner from another account.
      if (charLinkedLocationIds.has(loc.id)) {
        const locOwner = loc.owner_email || null;
        if (!locOwner || locOwner === user.email) return true;
        return false; // Linked but owned by another account — exclude
      }

      // ── LAYER 4: SHARED — only admin-promoted locations cross account boundaries ──
      // A location must have been explicitly created/promoted by an admin to be shared.
      // User-created locations with scope='shared' do NOT bleed to other accounts.
      const isAdminCreated = loc.created_by_role === 'admin' || loc.is_generic_shared === true;
      const isSharedScope = loc.scope === 'shared' || loc.location_type === 'shared';
      if (isAdminCreated && isSharedScope) return true;

      // ── LAYER 5: GLOBAL — system locations with no owner ─────────────────────────
      // True global locations have no owner_email and no created_by, and are not private.
      const hasNoOwner = !loc.owner_email && !loc.created_by;
      if (hasNoOwner && loc.scope !== 'account_global' && loc.location_type !== 'character_specific') return true;

      return false;
    });

    // Sort alphabetically by name
    relevantLocations.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return Response.json({
      success: true,
      locations: relevantLocations,
      totalCount: relevantLocations.length,
      summary: {
        ownedByAccount: relevantLocations.filter(l => (l.owner_email || l.created_by) === user.email).length,
        shared: relevantLocations.filter(l => (l.created_by_role === 'admin' || l.is_generic_shared) && (l.scope === 'shared' || l.location_type === 'shared')).length,
        global: relevantLocations.filter(l => !l.owner_email && !l.created_by).length,
        characterLinked: relevantLocations.filter(l => charLinkedLocationIds.has(l.id)).length,
        residentialTotal: relevantLocations.filter(l => RESIDENTIAL_CATEGORIES.has(l.category)).length,
      },
    });
  } catch (error) {
    console.error('[fetchAllLocationsForUser]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});