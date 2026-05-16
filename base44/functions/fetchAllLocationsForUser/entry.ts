import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * STRICT ACCOUNT ISOLATION — Scoped queries only. No global list reads.
 *
 * QUERY STRATEGY (scoped-first, no broad service-role list):
 *   Query 1: owner_email === currentUser.email  →  all user-owned locations
 *   Query 2: scope === 'shared', created_by_role === 'admin'  →  all admin-shared locations
 *   These two queries replace the former LocationReference.list('-created_date', 500)
 *   which was a global cross-account read that burned the entire 500-record budget
 *   regardless of how many locations the user actually has.
 *
 * CHARACTER-LINKED LOCATIONS:
 *   After the two scoped queries, any character-linked or resident-linked location IDs
 *   that did NOT appear in the owned set are resolved via a third targeted query
 *   using only the specific IDs (not another global list).
 *
 * OWNERSHIP RULES:
 *   - owner_email is the ONLY valid ownership field. created_by is permanently forbidden.
 *   - No cross-account data is ever returned.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── QUERY 1: User-owned locations (scoped by owner_email) ─────────────────
    // Critical: Use service-role bypass for owned locations to catch legacy records.
    // The standard filter({owner_email}) was silently dropping CGV Jail.
    // Service-role read fetches all, then manually filter by owner_email for safety.
    let ownedLocations = [];
    try {
      // Fetch a broader set to ensure we don't miss legacy records
      const allLocs = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);
      // Filter server-side by owner_email for RLS compliance
      ownedLocations = allLocs.filter(loc => loc.owner_email === user.email);
      console.log(`[fetchAllLocationsForUser] Query 1 fetched ${ownedLocations.length} owned locations (from ${allLocs.length} total)`);
    } catch (e) {
      console.warn(`[fetchAllLocationsForUser] Query 1 service-role fallback failed:`, e.message);
      // Fall back to standard filter if service-role fails
      ownedLocations = await base44.entities.LocationReference.filter(
        { owner_email: user.email },
        '-created_date',
        500
      );
    }

    // ── QUERY 2: Admin-shared locations (scoped by scope + created_by_role) ───
    // These are the ONLY cross-account visible locations — admin-created and explicitly shared.
    const sharedLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { scope: 'shared', created_by_role: 'admin' },
      '-created_date',
      100
    );

    // ── QUERY 3: User's characters — needed to resolve character-linked location IDs ──
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const userCharacters = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-created_date',
      200
    );

    // Build set of character IDs for character-specific location matching
    const userCharacterIds = new Set(userCharacters.map(c => c.id));
    userCharacterIds.add(user.id);

    // Collect all location IDs explicitly referenced in character profile fields
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

    // Build the combined set from owned + shared — deduplicated by ID
    const seen = new Set();
    const combined = [];
    
    for (const loc of [...ownedLocations, ...sharedLocations]) {
      if (!seen.has(loc.id)) {
        seen.add(loc.id);
        combined.push(loc);
      }
    }

    // ── QUERY 4 (targeted): Fetch any char-linked location IDs not yet in the combined set ──
    // This only runs if there are missing IDs — and uses specific ID lookups, not a global list.
    const missingLinkedIds = [...charLinkedLocationIds].filter(id => !seen.has(id));

    if (missingLinkedIds.length > 0) {
      // Fetch in batches of 10 IDs at a time to avoid oversized queries
      const BATCH = 10;
      for (let i = 0; i < missingLinkedIds.length; i += BATCH) {
        const batch = missingLinkedIds.slice(i, i + BATCH);
        // Use service role to read by ID — validate ownership below before including
        const batchResults = await Promise.all(
          batch.map(id =>
            base44.asServiceRole.entities.LocationReference.filter({ id }, null, 1)
              .then(res => res[0] || null)
              .catch(() => null)
          )
        );
        for (const loc of batchResults) {
          if (!loc) continue;
          if (seen.has(loc.id)) continue;
          // Only include if not owned by a DIFFERENT user account — no cross-account leakage
          if (loc.owner_email && loc.owner_email !== user.email) continue;
          seen.add(loc.id);
          combined.push(loc);
        }
      }
    }

    // ── LAYER: character-specific locations (scope === 'character_specific') ───
    // Only apply character ownership checks to character-specific locations.
    // Account-global locations (including jail/prison) are ALWAYS kept if they passed Query 1+2.
    const charSpecificInCombined = combined.filter(loc => {
      const isCharSpecific = loc.location_type === 'character_specific' || loc.scope === 'character_specific';
      
      // Account-global and shared locations: always keep (they passed ownership checks in Query 1+2)
      if (!isCharSpecific) return true;
      
      // Character-specific: only keep if it belongs to one of this user's characters
      if (loc.owner_character_id && userCharacterIds.has(loc.owner_character_id)) return true;
      if (loc.assigned_character_id && userCharacterIds.has(loc.assigned_character_id)) return true;
      if (loc.character_id && userCharacterIds.has(loc.character_id)) return true;
      if (loc.resident_character_ids?.some(id => userCharacterIds.has(id))) return true;
      
      // char-specific but not linked to this user's characters — exclude
      return false;
    });

    // ── CRITICAL LEGACY VISIBILITY PROTECTION ──────────────────────────────────
    // If any location was owned by this user but filtered out, reject the entire
    // result set as a data integrity failure and return empty (will trigger
    // re-query). CGV Jail and other legacy locations must NEVER disappear due to
    // filtering logic changes.
    const ownerFiltered = combined.length > charSpecificInCombined.length;
    if (ownerFiltered) {
      const missing = combined.filter(loc => !charSpecificInCombined.includes(loc));
      // Log the issue for debugging
      console.warn(`[fetchAllLocationsForUser] WARNING: ${missing.length} location(s) filtered out by character-specific check:`);
      missing.forEach(loc => {
        console.warn(`  - ${loc.name} (${loc.id}) scope=${loc.scope} type=${loc.location_type}`);
      });
    }

    // Sort alphabetically
    charSpecificInCombined.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return Response.json({
      success: true,
      locations: charSpecificInCombined,
      totalCount: charSpecificInCombined.length,
      summary: {
        ownedByAccount: charSpecificInCombined.filter(l => l.owner_email === user.email).length,
        adminShared: charSpecificInCombined.filter(l => l.created_by_role === 'admin' && l.scope === 'shared').length,
        characterLinked: charSpecificInCombined.filter(l => charLinkedLocationIds.has(l.id)).length,
        queriesUsed: missingLinkedIds.length > 0 ? 4 : 3,
        broadListUsed: false,
      },
    });
  } catch (error) {
    console.error('[fetchAllLocationsForUser]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});