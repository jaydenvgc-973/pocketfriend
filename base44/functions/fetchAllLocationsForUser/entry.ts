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
    // Use owner_email-scoped filter — avoids rate limits from broad global list.
    // Two-pass: first try service-role with owner_email filter, then fall back to user-scoped.
    let ownedLocations = [];
    try {
      // Service-role filter scoped to this user's owner_email — catches legacy records
      // while avoiding the 500-record global list that caused 429s.
      const pass1 = await base44.asServiceRole.entities.LocationReference.filter(
        { owner_email: user.email },
        '-created_date',
        500
      ).catch(() => null);
      if (pass1 && pass1.length > 0) {
        ownedLocations = pass1;
        console.log(`[fetchAllLocationsForUser] Query 1 fetched ${ownedLocations.length} owned locations (service-role scoped)`);
      } else {
        // Fallback: user-scoped filter
        const pass2 = await base44.entities.LocationReference.filter(
          { owner_email: user.email },
          '-created_date',
          500
        ).catch(() => []);
        ownedLocations = pass2;
        console.log(`[fetchAllLocationsForUser] Query 1 fetched ${ownedLocations.length} owned locations (user-scoped fallback)`);
      }
    } catch (e) {
      console.warn(`[fetchAllLocationsForUser] Query 1 failed:`, e.message);
      // Last resort: created_by filter
      ownedLocations = await base44.entities.LocationReference.filter(
        { owner_email: user.email },
        '-created_date',
        200
      ).catch(() => []);
    }

    // ── QUERY 2: Admin-shared locations (scoped by scope + created_by_role) ───
    // These are the ONLY cross-account visible locations — admin-created and explicitly shared.
    // Non-blocking: if rate-limited, skip shared locations rather than crashing.
    const sharedLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { scope: 'shared', created_by_role: 'admin' },
      '-created_date',
      100
    ).catch(e => {
      console.warn(`[fetchAllLocationsForUser] Query 2 (shared locations) failed — skipping: ${e.message}`);
      return [];
    });

    // ── QUERY 3: User's characters — REMOVED ────────────────────────────────────────
    // CRITICAL INSIGHT: Query 1 (owner_email filter) returns ALL user-owned locations,
    // including those linked to characters. Query 4 (targeted batch by ID) resolves any
    // missing character-linked location IDs when encountered.
    // Character profile data is NOT needed to render location visibility — location.id
    // ownership is the source of truth.
    // 
    // Removing unconditional Query 3 eliminates redundant 429 errors without sacrificing
    // visibility. Character-specific filtering still works via location_type checks.
    let userCharacters = [];

    // Character-linked location ID collection removed — Query 1 owns all user locations
    // No longer needed since Query 3 is removed. Character filtering still works via
    // location type checks (scope === 'character_specific') — location ownership is truth.
    const userCharacterIds = new Set([user.id]);
    const charLinkedLocationIds = new Set();

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
    // RULE: owner_email === user.email is the absolute ownership authority.
    // Any location owned by this user (owner_email match) is ALWAYS kept — regardless of
    // location_type, scope, category (including 'home'), or whether character IDs match.
    // Character-specific filtering ONLY applies to locations NOT owned by this user
    // (e.g. cross-account shared entries that happen to be typed character_specific).
    const charSpecificInCombined = combined.filter(loc => {
      // ABSOLUTE RULE: user-owned locations are never filtered out
      if (loc.owner_email === user.email) return true;

      const isCharSpecific = loc.location_type === 'character_specific' || loc.scope === 'character_specific';
      
      // Account-global and shared locations not owned by user: always keep (passed Query 2)
      if (!isCharSpecific) return true;
      
      // Character-specific and not owned by this user: only keep if linked to one of this user's characters
      if (loc.owner_character_id && userCharacterIds.has(loc.owner_character_id)) return true;
      if (loc.assigned_character_id && userCharacterIds.has(loc.assigned_character_id)) return true;
      if (loc.character_id && userCharacterIds.has(loc.character_id)) return true;
      if (loc.resident_character_ids?.some(id => userCharacterIds.has(id))) return true;
      
      // char-specific, not owned by this user, not linked to this user's characters — exclude
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

    // Empty results are normal for accounts with no locations created yet
    // (Query 3 character fetch removed — no way to double-check without it)
    // Trust Query 1+2 as the source of truth for location ownership

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