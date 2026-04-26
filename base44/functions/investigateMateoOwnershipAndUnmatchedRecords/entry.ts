import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * INVESTIGATE MATEO OWNERSHIP + 8 UNMATCHED RECORDS
 * 
 * 1. Get Mateo's full ownership fields (not just created_by)
 * 2. Check if 8 unmatched records exist via RLS-aware queries
 * 3. Determine if records are invisible due to RLS or truly missing
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const UNMATCHED_NAMES = [
      'Rick Taylor', 'Nancy', 'Mark', 'Ken', 'Chris Brown', 
      'Alden Spencer', 'Jayden Jackson', 'Leo'
    ];

    // ─────────────────────────────────────────────────────────────────
    // GET MATEO RECORD WITH FULL OWNERSHIP FIELDS
    // ─────────────────────────────────────────────────────────────────

    const allCharsServiceRole = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
    const mateoRecord = allCharsServiceRole.find(c => c.name === 'Mateo');

    const mateoOwnership = mateoRecord ? {
      id: mateoRecord.id,
      name: mateoRecord.name,
      owner_email: mateoRecord.owner_email || null,
      owner_user_id: mateoRecord.owner_user_id || null,
      created_by: mateoRecord.created_by || null,
      character_type: mateoRecord.character_type,
      is_active_character: mateoRecord.is_active_character,
      status: mateoRecord.status,
      current_location_id: mateoRecord.current_location_id || null,
      home_location_id: mateoRecord.current_home_location_id || null,
      data_scope: mateoRecord.data_scope || null,
      visibility_scope: mateoRecord.visibility_scope || null,
    } : null;

    // ─────────────────────────────────────────────────────────────────
    // INVESTIGATE 8 UNMATCHED RECORDS
    // ─────────────────────────────────────────────────────────────────

    // Try to find each via multiple query paths
    const unmatchedInvestigation = {};

    for (const name of UNMATCHED_NAMES) {
      const searchResults = {
        name,
        found_in_service_role_list: false,
        found_in_murqart_user_role: false,
        found_in_adobevgc_user_role: false,
        found_via_filter_all: false,
        found_via_filter_by_created_by: false,
        record: null,
      };

      // Try service role list (should see all)
      if (allCharsServiceRole.find(c => c.name === name)) {
        searchResults.found_in_service_role_list = true;
        searchResults.record = allCharsServiceRole.find(c => c.name === name);
      }

      // Try murqart user role
      const murqartChars = await base44.entities.Character.list('-updated_date', 500);
      if (murqartChars.find(c => c.name === name)) {
        searchResults.found_in_murqart_user_role = true;
        searchResults.record = murqartChars.find(c => c.name === name);
      }

      // Try adobevgc created_by filter
      const adobevgcChars = await base44.asServiceRole.entities.Character.filter(
        { created_by: 'adobevgc@gmail.com' },
        '-updated_date',
        500
      ).catch(() => []);
      if (adobevgcChars.find(c => c.name === name)) {
        searchResults.found_via_filter_by_created_by = true;
        searchResults.record = adobevgcChars.find(c => c.name === name);
      }

      // Detailed record if found
      if (searchResults.record) {
        searchResults.record_detail = {
          id: searchResults.record.id,
          name: searchResults.record.name,
          owner_email: searchResults.record.owner_email,
          owner_user_id: searchResults.record.owner_user_id,
          created_by: searchResults.record.created_by,
          character_type: searchResults.record.character_type,
          status: searchResults.record.status,
          data_scope: searchResults.record.data_scope,
          visibility_scope: searchResults.record.visibility_scope,
        };
      }

      unmatchedInvestigation[name] = searchResults;
    }

    return Response.json({
      task: 'INVESTIGATE_MATEO_OWNERSHIP_AND_UNMATCHED',
      current_user: user.email,
      
      mateo_full_ownership: mateoOwnership,
      
      mateo_ownership_assessment: mateoOwnership ? {
        has_owner_email: !!mateoOwnership.owner_email,
        has_owner_user_id: !!mateoOwnership.owner_user_id,
        owner_email_value: mateoOwnership.owner_email,
        owner_user_id_value: mateoOwnership.owner_user_id,
        created_by_value: mateoOwnership.created_by,
        true_owner: mateoOwnership.owner_email || mateoOwnership.owner_user_id ? 'OWNED_BY_EXPLICIT_FIELD' : 'CREATED_BY_SERVICE_ONLY',
        is_adobevgc_owned: mateoOwnership.owner_email === 'adobevgc@gmail.com',
      } : null,

      unmatched_8_records_investigation: unmatchedInvestigation,

      unmatched_summary: {
        total_unmatched_in_export: Object.keys(unmatchedInvestigation).length,
        truly_missing_from_app: Object.values(unmatchedInvestigation).filter(r => !r.record).length,
        query_not_seeing: Object.values(unmatchedInvestigation).filter(r => r.record).length,
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});