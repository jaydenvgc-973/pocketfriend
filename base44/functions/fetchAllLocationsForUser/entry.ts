import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * STRICT ACCOUNT ISOLATION — Fetch only locations belonging to the current user's account.
 *
 * VISIBILITY RULES:
 *   1. OWNED       — owner_email === current user. This is the ONLY valid ownership check.
 *                    created_by is permanently forbidden for ownership resolution.
 *                    Visible ONLY to that user and their characters. "Global" scope here means
 *                    global across THIS user's characters — NOT across all user accounts.
 *
 *   2. CHARACTER-SPECIFIC — location tied to a character owned by this user
 *                    (owner_character_id, assigned_character_id, character_id, or resident_character_ids
 *                    match one of this user's characters).
 *
 *   3. CHARACTER-LINKED — explicitly referenced by one of this user's character profile fields
 *                    (home, work, school, etc.) AND not owned by a different account.
 *
 *   4. RESIDENT-LINKED — location has one of this user's characters as a resident
 *                    AND is not explicitly owned by a different account.
 *
 *   5. SHARED       — ONLY locations where created_by_role === 'admin' AND scope === 'shared'.
 *                    These are the ONLY locations visible across different user accounts.
 *                    Regular users can view but not edit these.
 *
 * WHAT IS NEVER ALLOWED:
 *   - Any location owned by another user account is NEVER visible to this user.
 *   - "Global" scope does NOT mean visible to all users. It means available to all
 *     characters within the SAME user's account.
 *   - There is NO fallback that makes unowned or unscoped locations visible to everyone.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all locations via service role (we apply strict filtering below)
    const allLocations = await base44.asServiceRole.entities.LocationReference.list(
      '-created_date',
      500
    );

    // Get this user's characters to resolve character-linked locations
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const userCharacters = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-created_date',
      500
    );

    // Build set of this user's character IDs
    const userCharacterIds = new Set(userCharacters.map(c => c.id));
    userCharacterIds.add(user.id); // include the user's own entity ID

    // Build set of location IDs explicitly linked from this user's character profiles
    const charLinkedLocationIds = new Set();
    for (const char of userCharacters) {
      if (char.occupation_location_id) charLinkedLocationIds.add(char.occupation_location_id);
      if (char.education_location_id) charLinkedLocationIds.add(char.education_location_id);
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

    const relevantLocations = allLocations.filter(loc => {

      // ── LAYER 1: OWNED BY THIS ACCOUNT ────────────────────────────────────
      // owner_email is the sole source of truth — created_by is permanently forbidden
      if (loc.owner_email && loc.owner_email === user.email) return true;

      // ── LAYER 2: CHARACTER-SPECIFIC for this user's characters ────────────
      const isCharSpecific = loc.location_type === 'character_specific' || loc.scope === 'character_specific';
      if (isCharSpecific) {
        if (loc.owner_character_id && userCharacterIds.has(loc.owner_character_id)) return true;
        if (loc.assigned_character_id && userCharacterIds.has(loc.assigned_character_id)) return true;
        if (loc.character_id && userCharacterIds.has(loc.character_id)) return true;
        if (loc.resident_character_ids?.some(id => userCharacterIds.has(id))) return true;
      }

      // ── LAYER 3: CHARACTER-LINKED — referenced in this user's char profiles ──
      // Only include if the location is not owned by a different user account
      if (charLinkedLocationIds.has(loc.id)) {
        if (!loc.owner_email || loc.owner_email === user.email) return true;
        return false; // Owned by another account — exclude
      }

      // ── LAYER 4: RESIDENT-LINKED — one of this user's chars lives here ────
      // Only include if not explicitly owned by another user account
      if (loc.resident_character_ids?.some(id => userCharacterIds.has(id))) {
        if (!loc.owner_email || loc.owner_email === user.email) return true;
      }

      // ── LAYER 5: ADMIN-SHARED — the ONLY cross-account visibility ─────────
      // STRICT: must be admin-created AND explicitly scoped as 'shared'
      // This is the ONLY exception to account isolation.
      if (loc.created_by_role === 'admin' && loc.scope === 'shared') return true;

      // Everything else is excluded — no fallback global visibility
      return false;
    });

    // Sort alphabetically by name
    relevantLocations.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return Response.json({
      success: true,
      locations: relevantLocations,
      totalCount: relevantLocations.length,
      summary: {
        ownedByAccount: relevantLocations.filter(l => l.owner_email === user.email).length,
        adminShared: relevantLocations.filter(l => l.created_by_role === 'admin' && l.scope === 'shared').length,
        characterLinked: relevantLocations.filter(l => charLinkedLocationIds.has(l.id)).length,
      },
    });
  } catch (error) {
    console.error('[fetchAllLocationsForUser]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});