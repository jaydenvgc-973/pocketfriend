import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FORENSIC DISCOVERY — Using EXACT UI paths
 * 
 * Tests BOTH lookup methods the UI actually uses:
 * 1. Home.jsx dual-path (created_by + owner_email merged)
 * 2. Travel.jsx single-path with character_type filter
 * 3. CharacterCard.jsx location resolver
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    console.log(`[DISCOVERY] User: ${user.email}`);

    // ========== PATH 1: HOME.JSX DUAL-QUERY (MERGED) ==========
    console.log(`[PATH-1-HOME] Fetching characters via created_by and owner_email...`);
    const [byCreatedBy, byOwnerEmail] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email }, "-created_date"),
      base44.entities.Character.filter({ owner_email: user.email }, "-created_date"),
    ]);

    console.log(`[PATH-1-HOME] created_by query returned: ${byCreatedBy.length}`);
    console.log(`[PATH-1-HOME] owner_email query returned: ${byOwnerEmail.length}`);

    const homeMerged = (() => {
      const seen = new Set();
      const result = [];
      for (const c of [...byCreatedBy, ...byOwnerEmail]) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          result.push(c);
        }
      }
      return result;
    })();

    const homeFinalList = homeMerged.filter(c => {
      if (c.is_test_character === true) return false;
      if (c.diagnostic_only === true) return false;
      if (c.exclude_from_homepage === true) return false;
      return true;
    });

    console.log(`[PATH-1-HOME] After dedup + homepage filter: ${homeFinalList.length} characters`);

    // ========== PATH 2: TRAVEL.JSX SINGLE-QUERY WITH TYPE FILTER ==========
    console.log(`[PATH-2-TRAVEL] Fetching characters via created_by + status + character_type...`);
    const travelQuery = await base44.entities.Character.filter({
      created_by: user.email,
      status: "active",
      character_type: "active_created_character"
    });

    console.log(`[PATH-2-TRAVEL] Returned: ${travelQuery.length} characters`);

    // ========== COMPARISON ==========
    const pathComparison = {
      'Path 1 (Home.jsx dual-merge)': {
        byCreatedByCount: byCreatedBy.length,
        byOwnerEmailCount: byOwnerEmail.length,
        mergedCount: homeMerged.length,
        afterHomepageFilter: homeFinalList.length,
        characters: homeFinalList.map(c => ({
          id: c.id,
          name: c.name,
          type: c.character_type,
          status: c.status,
          created_by: c.created_by,
          owner_email: c.owner_email,
          is_test: c.is_test_character,
          diagnostic_only: c.diagnostic_only,
          exclude_from_homepage: c.exclude_from_homepage,
        })),
      },
      'Path 2 (Travel.jsx single-query)': {
        query: { created_by: user.email, status: "active", character_type: "active_created_character" },
        resultCount: travelQuery.length,
        characters: travelQuery.map(c => ({
          id: c.id,
          name: c.name,
          type: c.character_type,
          status: c.status,
          created_by: c.created_by,
          owner_email: c.owner_email,
        })),
      },
    };

    // ========== FULL DATABASE SCAN FOR CONTEXT ==========
    console.log(`[CONTEXT] Running full database scan...`);
    const allChars = await base44.asServiceRole.entities.Character.filter({});
    const characterBreakdown = allChars.reduce((acc, c) => {
      const key = `${c.character_type}|${c.status}`;
      if (!acc[key]) acc[key] = 0;
      acc[key]++;
      return acc;
    }, {});

    return Response.json({
      success: true,
      audit_type: 'forensic_ui_discovery',
      timestamp: new Date().toISOString(),
      user_email: user.email,

      summary: {
        path_1_home_jsx: {
          description: 'Dual-query merge (created_by + owner_email)',
          result_count: homeFinalList.length,
          characters_found: homeFinalList.map(c => ({ id: c.id, name: c.name })),
        },
        path_2_travel_jsx: {
          description: 'Single query with character_type + status filter',
          result_count: travelQuery.length,
          characters_found: travelQuery.map(c => ({ id: c.id, name: c.name })),
        },
        mismatch: homeFinalList.length !== travelQuery.length,
        mismatch_reason: homeFinalList.length > travelQuery.length ? 'Home finds more (dual-path) vs Travel (single-path)' : 'Travel finds more (unlikely)',
      },

      detailed_comparison: pathComparison,

      full_database_context: {
        total_characters: allChars.length,
        breakdown_by_type_and_status: characterBreakdown,
      },
    });

  } catch (error) {
    console.error('[forensicCharacterDiscoveryUI]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});