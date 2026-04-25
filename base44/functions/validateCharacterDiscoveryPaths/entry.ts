import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * VALIDATE CHARACTER DISCOVERY — Using EXACT existing UI paths
 * 
 * Path 1: Home page query (dual-query merge for legacy characters)
 * Path 2: Travel page query (active_created_character explicit filter)
 * Path 3: getCharactersForHomepage resolver (from characterEditableListResolver)
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ─────────────────────────────────────────────────────────────
    // PATH 1: Home Page Query (Dual-Query Merge)
    // ─────────────────────────────────────────────────────────────
    const [byCreatedBy, byOwnerEmail] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email }, "-created_date"),
      base44.entities.Character.filter({ owner_email: user.email }, "-created_date"),
    ]);

    const homeMerged = [];
    const homeSeen = new Set();
    for (const c of [...byCreatedBy, ...byOwnerEmail]) {
      if (homeSeen.has(c.id)) continue;
      homeSeen.add(c.id);
      if (c.is_test_character === true) continue;
      if (c.diagnostic_only === true) continue;
      if (c.exclude_from_homepage === true) continue;
      homeMerged.push(c);
    }

    // ─────────────────────────────────────────────────────────────
    // PATH 2: Travel Page Query (Active Created Filter)
    // ─────────────────────────────────────────────────────────────
    const travelQuery = await base44.entities.Character.filter({
      created_by: user.email,
      status: "active",
      character_type: "active_created_character"
    });

    // ─────────────────────────────────────────────────────────────
    // PATH 3: Raw Active Created (No Status Filter)
    // ─────────────────────────────────────────────────────────────
    const allActiveCreated = await base44.entities.Character.filter({
      created_by: user.email,
      character_type: "active_created_character"
    });

    // ─────────────────────────────────────────────────────────────
    // PATH 4: Owner Email Path (for legacy characters)
    // ─────────────────────────────────────────────────────────────
    const ownerEmailCreated = await base44.entities.Character.filter({
      owner_email: user.email,
      status: "active",
      character_type: "active_created_character"
    });

    // ─────────────────────────────────────────────────────────────
    // Build discovery report
    // ─────────────────────────────────────────────────────────────
    const report = {
      user_email: user.email,
      timestamp: new Date().toISOString(),
      discovery_paths: {
        path_1_home_dual_merge: {
          description: "Home page: created_by + owner_email merge, excluding test/diagnostic",
          created_by_count: byCreatedBy.filter(c => c.is_test_character !== true && c.diagnostic_only !== true && c.exclude_from_homepage !== true).length,
          owner_email_count: byOwnerEmail.filter(c => c.is_test_character !== true && c.diagnostic_only !== true && c.exclude_from_homepage !== true).length,
          merged_after_dedup: homeMerged.length,
          characters: homeMerged.map(c => ({
            id: c.id,
            name: c.name,
            created_by: c.created_by,
            owner_email: c.owner_email,
            character_type: c.character_type,
            status: c.status,
            is_test: c.is_test_character,
            exclude_from_homepage: c.exclude_from_homepage,
          })),
        },
        path_2_travel_active_created: {
          description: "Travel page: created_by + status:active + type:active_created_character",
          count: travelQuery.length,
          characters: travelQuery.map(c => ({
            id: c.id,
            name: c.name,
            created_by: c.created_by,
            owner_email: c.owner_email,
            character_type: c.character_type,
            status: c.status,
          })),
        },
        path_3_all_active_created: {
          description: "All active_created_character (no status filter)",
          count: allActiveCreated.length,
          characters: allActiveCreated.map(c => ({
            id: c.id,
            name: c.name,
            status: c.status,
          })),
        },
        path_4_owner_email_active: {
          description: "Owner email path: owner_email + status:active + type:active_created_character",
          count: ownerEmailCreated.length,
          characters: ownerEmailCreated.map(c => ({
            id: c.id,
            name: c.name,
            created_by: c.created_by,
            owner_email: c.owner_email,
          })),
        },
      },
      summary: {
        path_1_matches_10: homeMerged.length === 10 ? "✓ YES" : `✗ NO (found ${homeMerged.length})`,
        path_2_matches_10: travelQuery.length === 10 ? "✓ YES" : `✗ NO (found ${travelQuery.length})`,
        which_path_correct: homeMerged.length >= travelQuery.length ? "Path 1 (Home dual-merge)" : "Path 2 (Travel single filter)",
        recommendation: homeMerged.length === 10 ? "Use Path 1 (Home dual-merge) for movement discovery" : "Use Path 2 OR investigate legacy character ownership fields",
      },
    };

    return Response.json(report);

  } catch (error) {
    console.error('[validateCharacterDiscoveryPaths]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});