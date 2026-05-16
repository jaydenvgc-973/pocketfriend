import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const report = {
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_id: user.id,
      diagnostic_goal: 'Find exact line where jail_prison locations vanish from rendering',
    };

    // LAYER 1: Raw database for ALL jail/prison records
    const allLocations = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);
    
    const jailRecords = allLocations.filter(loc =>
      loc.category === 'jail_prison' || 
      loc.is_confinement_facility === true ||
      (loc.name && (loc.name.toLowerCase().includes('jail') || loc.name.toLowerCase().includes('prison')))
    );

    report.layer1_raw_all_locations_count = allLocations.length;
    report.layer1_jail_records_found = jailRecords.map(loc => ({
      id: loc.id,
      name: loc.name,
      category: loc.category,
      scope: loc.scope,
      location_type: loc.location_type,
      owner_email: loc.owner_email,
      owner_user_id: loc.owner_user_id,
      created_by: loc.created_by,
      is_active: loc.is_active,
      status: loc.status,
      is_deleted: loc.is_deleted,
      is_archived: loc.is_archived,
      is_user_created: loc.is_user_created,
      is_system_managed: loc.is_system_managed,
      is_confinement_facility: loc.is_confinement_facility,
      subtype: loc.subtype,
      created_date: loc.created_date,
      updated_date: loc.updated_date,
      belongs_to_user: loc.owner_email === user.email,
    }));

    // LAYER 2: Compare against a visible normal location (same user)
    const normalLocs = allLocations.filter(loc =>
      loc.owner_email === user.email &&
      loc.category !== 'jail_prison' &&
      loc.is_confinement_facility !== true
    );

    if (normalLocs.length > 0 && jailRecords.length > 0) {
      const normalLoc = normalLocs[0];
      const jailLoc = jailRecords[0];
      
      report.side_by_side_comparison = {
        normal_location: {
          id: normalLoc.id,
          name: normalLoc.name,
          category: normalLoc.category,
          scope: normalLoc.scope,
          location_type: normalLoc.location_type,
          owner_email: normalLoc.owner_email,
          is_deleted: normalLoc.is_deleted,
          is_archived: normalLoc.is_archived,
          status: normalLoc.status,
        },
        jail_location: {
          id: jailLoc.id,
          name: jailLoc.name,
          category: jailLoc.category,
          scope: jailLoc.scope,
          location_type: jailLoc.location_type,
          owner_email: jailLoc.owner_email,
          is_deleted: jailLoc.is_deleted,
          is_archived: jailLoc.is_archived,
          status: jailLoc.status,
        },
        field_differences: {
          category: { normal: normalLoc.category, jail: jailLoc.category, DIFFERS: normalLoc.category !== jailLoc.category },
          is_confinement_facility: { normal: normalLoc.is_confinement_facility, jail: jailLoc.is_confinement_facility, DIFFERS: normalLoc.is_confinement_facility !== jailLoc.is_confinement_facility },
        }
      };
    }

    // LAYER 3: Simulate fetchAllLocationsForUser result
    const userOwned = allLocations.filter(loc => loc.owner_email === user.email);
    const shared = allLocations.filter(loc => loc.scope === 'shared' && loc.created_by_role === 'admin');
    
    const deduped = new Map();
    [...userOwned, ...shared].forEach(loc => {
      if (!deduped.has(loc.id)) deduped.set(loc.id, loc);
    });
    const fetchResult = Array.from(deduped.values());

    report.layer3_fetch_result_total = fetchResult.length;
    report.layer3_jail_in_fetch_result = fetchResult.filter(l => l.category === 'jail_prison').map(l => ({ id: l.id, name: l.name }));

    // LAYER 4: Simulate React Query cache
    report.layer4_react_query_would_contain = report.layer3_fetch_result_total;

    // LAYER 5: Check if jail_prison category appears in UI category definitions
    report.layer5_category_support = {
      note: 'Checking if jail_prison is in any UI category allowlist or dropdown',
      CATEGORIES_enum: [
        'home', 'hotel', 'shelter', 'workplace', 'gym', 'social', 'outdoor',
        'food_drink', 'medical', 'education', 'grocery', 'religion', 'government',
        'public', 'business', 'school', 'community', 'generic', 'jail_prison'
      ],
      jail_prison_in_CATEGORIES: true,
      WORK_CATEGORIES_enum: [
        'workplace', 'gym', 'school', 'community', 'business', 'medical', 'government'
      ],
      jail_prison_in_WORK_CATEGORIES: false,
      SUBTYPE_OPTIONS_jail_prison: ['jail', 'prison', 'detention_center'],
      note2: 'jail_prison IS in CATEGORIES but NOT in WORK_CATEGORIES',
    };

    // LAYER 6: Check filter logic in getFilteredAndGrouped
    const characterIds = new Set();
    report.layer6_filter_logic = {
      note: 'Simulating getFilteredAndGrouped() logic',
      isCharacterHome_evaluation_for_jail: {
        has_character_id: jailRecords[0]?.character_id ? true : false,
        has_owner_character_id: jailRecords[0]?.owner_character_id ? true : false,
        has_resident_character_ids: (jailRecords[0]?.resident_character_ids || []).length > 0,
        in_character_set: characterIds.has(jailRecords[0]?.character_id),
        result_isCharacterHome: false, // Should be false for jail with no character links
        result_in_filtered_global: true, // Should be in global filter
      },
      filter_all_renders_sections: ['global', 'characterSpecific'],
      filter_global_renders_sections: ['all (only matching l.location_type === global && !isCharacterHome(l))'],
      filter_character_renders_sections: ['all (only matching isCharacterHome(l))'],
    };

    // LAYER 7: Check render condition
    report.layer7_render_conditions = {
      render_global_when_filter_is_all: 'if (filter === "all" && filtered.global && filtered.global.length > 0)',
      render_global_when_filter_is_global: 'if (filter === "global") { return { all: allFiltered.filter(l => l.location_type === "global" && !isCharacterHome(l)) } }',
      jail_location_type: jailRecords[0]?.location_type || 'unknown',
      jail_should_render_in_global_section: jailRecords[0]?.location_type === 'global' || jailRecords[0]?.location_type === undefined,
    };

    // LAYER 8: Check for category-based filtering in UI
    report.layer8_category_filtering = {
      note: 'Looking for any filter that excludes jail_prison category',
      search_filter_includes_category: true, // line 1602: l.category?.toLowerCase().includes(q)
      visible_category_dropdowns: ['all', 'global', 'character_specific'],
      category_displayed_on_card: true, // LocationCard should show category
    };

    // LAYER 9: Check location card rendering
    report.layer9_location_card_rendering = {
      note: 'Does LocationCard render jail_prison locations?',
      card_should_render_jail: true,
      category_display_logic: 'Shows category directly from loc.category field',
      any_category_hardfilter_in_card: false,
    };

    // LAYER 10: Search for hardcoded allowlists
    report.layer10_hardcoded_allowlists = {
      checked_for: [
        'ALLOWED_CATEGORIES',
        'VISIBLE_CATEGORIES',
        'CATEGORY_ALLOWLIST',
        'UNSUPPORTED_CATEGORIES',
        'isValidCategory()',
        'filterByCategory()',
        'canDisplay(category)',
      ],
      found_any_allowlist_excluding_jail: '❓ NEEDS VERIFICATION IN CODE',
    };

    report.conclusions = [];

    if (jailRecords.length === 0) {
      report.conclusions.push('❌ CRITICAL: No jail/prison records exist in database');
    } else {
      report.conclusions.push(`✅ Database contains ${jailRecords.length} jail/prison record(s)`);
      
      const userOwnedJails = jailRecords.filter(j => j.owner_email === user.email);
      if (userOwnedJails.length === 0) {
        report.conclusions.push('❌ CRITICAL: No jail records owned by current user');
      } else {
        report.conclusions.push(`✅ Current user owns ${userOwnedJails.length} jail record(s)`);
      }
    }

    if (report.layer3_jail_in_fetch_result.length === 0) {
      report.conclusions.push('❌ CRITICAL: Jail dropped by fetchAllLocationsForUser');
    } else {
      report.conclusions.push(`✅ Jail survives fetchAllLocationsForUser (${report.layer3_jail_in_fetch_result.length} record(s))`);
    }

    report.conclusions.push('⚠️  NEED TO VERIFY: Is jail_prison category excluded by any hardcoded allowlist in LocationCard, LocationForm, or filter logic?');
    report.conclusions.push('⚠️  NEED TO VERIFY: Does getFilteredAndGrouped() actually put jail into filtered.global?');
    report.conclusions.push('⚠️  NEED TO VERIFY: Is the render condition for filtered.global being skipped?');

    return Response.json(report, { status: 200 });
  } catch (error) {
    console.error('[DIAGNOSTIC]', error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});