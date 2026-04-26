import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * EXPORT SCOPE ANALYSIS - ROLE ISOLATED
 * 
 * Compares 43-record export against role-isolated datasets without mixing scopes.
 * Uses known exported names to determine export composition.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Known exported character names from earlier diagnostics
    const KNOWN_EXPORTED_NAMES = [
      'Andre Rivera',
      'Ava Dei Park',
      'Brian Anderson',
      'Ethan Thompson',
      'James Anderson',
      'Jonathan Anthony Smith',
      'Lila Green',
      'Matt Lopez',
      'Melody Jackson Perry',
      'Nathan Parker',
    ];

    // QUERY 1: User role Character records (user-created characters)
    const userRoleRecords = await base44.entities.Character.list('-updated_date', 500);
    const userRoleNames = new Set(userRoleRecords.map(c => c.name));
    const userRoleCharacterTypes = {};
    userRoleRecords.forEach(c => {
      userRoleCharacterTypes[c.name] = c.character_type;
    });

    // QUERY 2: Service role Character records (NPC records)
    const serviceRoleRecords = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
    const serviceRoleNames = new Set(serviceRoleRecords.map(c => c.name));
    const serviceRoleCharacterTypes = {};
    serviceRoleRecords.forEach(c => {
      serviceRoleCharacterTypes[c.name] = c.character_type;
    });

    // QUERY 3: CharacterAlias records
    const characterAliasRecords = await base44.asServiceRole.entities.CharacterAlias.list(null, 500);
    const aliasNames = new Set(characterAliasRecords.map(a => a.alias_name));

    // QUERY 4: Get all Character records (user role) to check statuses
    const userRoleRecordMap = new Map(userRoleRecords.map(c => [c.name, c]));
    const serviceRoleRecordMap = new Map(serviceRoleRecords.map(c => [c.name, c]));

    // Classification of known exported records
    const exportRecordClassification = {};

    for (const exportedName of KNOWN_EXPORTED_NAMES) {
      const foundInUserRole = userRoleNames.has(exportedName);
      const foundInServiceRole = serviceRoleNames.has(exportedName);
      const foundInAlias = aliasNames.has(exportedName);
      
      const userRoleRecord = userRoleRecordMap.get(exportedName);
      const serviceRoleRecord = serviceRoleRecordMap.get(exportedName);

      exportRecordClassification[exportedName] = {
        found_in_user_role: foundInUserRole,
        found_in_service_role: foundInServiceRole,
        found_in_alias: foundInAlias,
        user_role_character_type: userRoleRecord?.character_type || null,
        service_role_character_type: serviceRoleRecord?.character_type || null,
        user_role_status: userRoleRecord?.status || null,
        service_role_status: serviceRoleRecord?.status || null,
        classification: foundInUserRole ? 'USER_CREATED_CHARACTER' : foundInServiceRole ? 'NPC_CHARACTER' : foundInAlias ? 'ALIAS_ONLY' : 'NOT_FOUND_IN_APP',
      };
    }

    // Summary counts
    const exportedInUserRole = Object.values(exportRecordClassification).filter(r => r.found_in_user_role).length;
    const exportedInServiceRole = Object.values(exportRecordClassification).filter(r => r.found_in_service_role).length;
    const exportedInAlias = Object.values(exportRecordClassification).filter(r => r.found_in_alias).length;
    const exportedNotFound = Object.values(exportRecordClassification).filter(r => r.classification === 'NOT_FOUND_IN_APP').length;

    // Unclassified records: those NOT in known 10
    const userRoleUnclassified = Array.from(userRoleNames).filter(n => !KNOWN_EXPORTED_NAMES.includes(n));
    const serviceRoleUnclassified = Array.from(serviceRoleNames).filter(n => !KNOWN_EXPORTED_NAMES.includes(n));

    return Response.json({
      diagnostic: 'EXPORT_SCOPE_ANALYSIS_ROLE_ISOLATED',
      user_email: user.email,

      known_exported_records_count: KNOWN_EXPORTED_NAMES.length,
      
      dataset_summary: {
        user_role_Character_records: {
          query_method: 'base44.entities.Character.list()',
          role: 'user',
          total_records: userRoleRecords.length,
          description: 'User-owned active_created_character records'
        },
        service_role_Character_records: {
          query_method: 'base44.asServiceRole.entities.Character.list()',
          role: 'service',
          total_records: serviceRoleRecords.length,
          description: 'NPC fictitious, family_member, regular records'
        },
        CharacterAlias_records: {
          query_method: 'base44.asServiceRole.entities.CharacterAlias.list()',
          total_records: characterAliasRecords.length,
          description: 'Character name aliases'
        }
      },

      known_exported_records_classification: exportRecordClassification,

      classification_summary: {
        exported_found_in_user_role_only: exportedInUserRole,
        exported_found_in_service_role_only: exportedInServiceRole,
        exported_found_in_alias_only: exportedInAlias,
        exported_not_found_in_app: exportedNotFound,
        total_classified: KNOWN_EXPORTED_NAMES.length,
      },

      unclassified_records: {
        in_user_role_but_not_in_known_export: userRoleUnclassified,
        in_service_role_but_not_in_known_export: serviceRoleUnclassified,
      },

      export_composition_hypothesis: {
        confirmed_in_export: Object.entries(exportRecordClassification)
          .filter(([_, r]) => r.found_in_user_role || r.found_in_service_role)
          .map(([name, r]) => ({
            name,
            source: r.found_in_user_role ? 'USER_ROLE' : 'SERVICE_ROLE',
            character_type: r.found_in_user_role ? r.user_role_character_type : r.service_role_character_type,
          })),
        
        not_found_in_app: Object.entries(exportRecordClassification)
          .filter(([_, r]) => r.classification === 'NOT_FOUND_IN_APP')
          .map(([name]) => name),
      },

      EXPORT_GAP_ANALYSIS: {
        known_exported_count: KNOWN_EXPORTED_NAMES.length,
        found_in_app: exportedInUserRole + exportedInServiceRole,
        not_found_in_app: exportedNotFound,
        hypothesis: 'If 10 known names represent the export composition, and all 10 are found split between user and service roles, then the export likely combines both role scopes.',
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});