import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FIELD PATH AUDIT
 * 
 * For a known exported character, show:
 * - Where owner_email is stored (top-level vs data.owner_email)
 * - Where character_type is stored (top-level vs data.character_type)
 * - Full record structure to identify nested vs flat
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const targetName = 'Melody Jackson Perry';

    // Search across all sources without filters
    const userList = await base44.entities.Character.list('-updated_date', 500);
    const serviceList = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
    const allRecords = [...userList, ...serviceList];

    // Find exact match
    const found = allRecords.find(c => c.name === targetName);

    if (!found) {
      return Response.json({
        audit: 'FIELD_PATH_SEARCH',
        target: targetName,
        result: 'NOT_FOUND_IN_CHARACTER_ENTITY',
        search_scope: 'User list + Service role list (500 records each)',
        total_searched: allRecords.length,
        IMPLICATION: 'Character exists in export but not in base44.entities.Character — different data source confirmed.',
      });
    }

    // Found it — analyze field structure
    return Response.json({
      audit: 'FIELD_PATH_AUDIT',
      target: targetName,
      found: true,
      
      record_structure: {
        id: found.id,
        name: found.name,
        
        // Check top-level fields
        owner_email_toplevel: found.owner_email || null,
        character_type_toplevel: found.character_type || null,
        status_toplevel: found.status || null,
        
        // Check for nested data object
        has_data_object: typeof found.data === 'object' && found.data !== null,
        data_object_keys: typeof found.data === 'object' ? Object.keys(found.data || {}).slice(0, 20) : null,
        
        // If data exists, check for nested fields
        data_owner_email: found.data?.owner_email || null,
        data_character_type: found.data?.character_type || null,
        data_status: found.data?.status || null,
      },

      field_locations: {
        owner_email: {
          toplevel: found.owner_email ? 'YES' : 'NO',
          nested_in_data: found.data?.owner_email ? 'YES' : 'NO',
          value: found.owner_email || found.data?.owner_email,
        },
        character_type: {
          toplevel: found.character_type ? 'YES' : 'NO',
          nested_in_data: found.data?.character_type ? 'YES' : 'NO',
          value: found.character_type || found.data?.character_type,
        },
        status: {
          toplevel: found.status ? 'YES' : 'NO',
          nested_in_data: found.data?.status ? 'YES' : 'NO',
          value: found.status || found.data?.status,
        },
      },

      full_record_snapshot: {
        id: found.id,
        name: found.name,
        created_date: found.created_date,
        created_by: found.created_by,
        owner_email: found.owner_email,
        owner_user_id: found.owner_user_id,
        character_type: found.character_type,
        status: found.status,
        visibility_scope: found.visibility_scope,
        data_scope: found.data_scope,
        is_test_character: found.is_test_character,
        diagnostic_only: found.diagnostic_only,
        exclude_from_homepage: found.exclude_from_homepage,
        data_object_exists: !!found.data,
        total_keys_in_record: Object.keys(found).length,
      },

      CONCLUSION: {
        character_found: true,
        owner_email_path: found.data?.owner_email && !found.owner_email ? 'data.owner_email' : found.owner_email ? 'owner_email' : 'NOT FOUND',
        character_type_path: found.data?.character_type && !found.character_type ? 'data.character_type' : found.character_type ? 'character_type' : 'NOT FOUND',
        record_structure_type: found.data ? 'HYBRID (top-level + nested data)' : 'FLAT (top-level only)',
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});