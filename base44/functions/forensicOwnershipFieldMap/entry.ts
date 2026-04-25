import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FORENSIC OWNERSHIP MAP — Full field audit for every character the UI uses.
 * 
 * Uses EXACT Home.jsx dual-path (created_by + owner_email) to fetch real characters.
 * Then shows every ownership/identity field for each one.
 * Then runs Travel.jsx path and shows which characters it misses and why.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // HOME.JSX EXACT DUAL PATH
    const [byCreatedBy, byOwnerEmail] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email }, "-created_date"),
      base44.entities.Character.filter({ owner_email: user.email }, "-created_date"),
    ]);

    // Dedup
    const seen = new Set();
    const allHomeChars = [];
    for (const c of [...byCreatedBy, ...byOwnerEmail]) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        allHomeChars.push(c);
      }
    }

    // Homepage filter (same as Home.jsx)
    const homeVisible = allHomeChars.filter(c =>
      c.is_test_character !== true &&
      c.diagnostic_only !== true &&
      c.exclude_from_homepage !== true
    );

    // TRAVEL.JSX EXACT SINGLE PATH
    const travelChars = await base44.entities.Character.filter({
      created_by: user.email,
      status: "active",
      character_type: "active_created_character"
    });

    const travelIds = new Set(travelChars.map(c => c.id));

    // For each character the Home UI shows, build a full ownership/type/status map
    const characterMap = homeVisible.map(c => {
      const foundByCreatedBy = byCreatedBy.some(x => x.id === c.id);
      const foundByOwnerEmail = byOwnerEmail.some(x => x.id === c.id);
      const foundByTravel = travelIds.has(c.id);

      return {
        id: c.id,
        name: c.name,
        character_type: c.character_type,
        status: c.status,
        created_by: c.created_by,
        owner_email: c.owner_email,
        owner_user_id: c.owner_user_id,
        is_test_character: c.is_test_character || false,
        diagnostic_only: c.diagnostic_only || false,
        exclude_from_homepage: c.exclude_from_homepage || false,
        is_default: c.is_default || false,

        // DISCOVERY PATH RESULTS
        found_by_created_by: foundByCreatedBy,
        found_by_owner_email: foundByOwnerEmail,
        found_by_travel_path: foundByTravel,
        missed_by_travel: !foundByTravel,

        // WHY TRAVEL MISSES IT (if applicable)
        travel_miss_reasons: (() => {
          const reasons = [];
          if (!foundByTravel) {
            if (c.created_by !== user.email) reasons.push(`created_by="${c.created_by}" does not match user.email="${user.email}"`);
            if (c.status !== 'active') reasons.push(`status="${c.status}" is not "active"`);
            if (c.character_type !== 'active_created_character') reasons.push(`character_type="${c.character_type}" is not "active_created_character"`);
          }
          return reasons;
        })(),

        // LOCATION FIELDS
        current_home_location_id: c.current_home_location_id || null,
        resolved_current_location_id: c.resolved_current_location_id || null,
        resolved_current_location_name: c.resolved_current_location_name || null,
        location_status: c.location_status || 'home',
        travel_status: c.travel_status || 'not_traveling',
        resolved_presence_status: c.resolved_presence_status || null,

        // WORK/SCHOOL
        current_work_location_id: c.current_work_location_id || null,
        occupation_location_id: c.occupation_location_id || null,
        current_school_location_id: c.current_school_location_id || null,
        education_location_id: c.education_location_id || null,
        work_days: c.work_days || null,
        work_start_time: c.work_start_time || null,
        work_end_time: c.work_end_time || null,
      };
    });

    // Segregate by type
    const activeCreated = characterMap.filter(c => c.character_type === 'active_created_character');
    const missedByTravel = characterMap.filter(c => c.missed_by_travel && c.character_type === 'active_created_character');

    return Response.json({
      success: true,
      audit_type: 'forensic_ownership_field_map',
      timestamp: new Date().toISOString(),
      user_email: user.email,

      discovery_summary: {
        home_jsx_path: {
          by_created_by: byCreatedBy.length,
          by_owner_email: byOwnerEmail.length,
          merged_and_deduped: allHomeChars.length,
          after_homepage_filter: homeVisible.length,
        },
        travel_jsx_path: {
          query: { created_by: user.email, status: 'active', character_type: 'active_created_character' },
          result_count: travelChars.length,
        },
        active_created_characters_total: activeCreated.length,
        active_created_missed_by_travel: missedByTravel.length,
      },

      // ALL ACTIVE CREATED CHARACTERS — FULL FIELD MAP
      active_created_characters: activeCreated,

      // CHARACTERS TRAVEL PAGE CANNOT SEE
      travel_invisible_active_created: missedByTravel,

      // NON-ACTIVE-CREATED for reference
      other_character_types: characterMap
        .filter(c => c.character_type !== 'active_created_character')
        .map(c => ({ id: c.id, name: c.name, type: c.character_type, status: c.status })),
    });

  } catch (error) {
    console.error('[forensicOwnershipFieldMap]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});