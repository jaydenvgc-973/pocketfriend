import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FULL EXPORT COMPOSITION DIAGNOSTIC
 * 
 * Accounts for all 43 export records by checking:
 * - Active Character records (user + service role)
 * - Archived/deleted Character records
 * - CharacterAlias records
 * - Related character entities
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const KNOWN_EXPORTED = [
      'Andre Rivera', 'Ava Dei Park', 'Brian Anderson', 'Ethan Thompson',
      'James Anderson', 'Jonathan Anthony Smith', 'Lila Green', 'Matt Lopez',
      'Melody Jackson Perry', 'Nathan Parker'
    ];

    // SOURCE 1: User role active Character records
    const userRoleActive = await base44.entities.Character.list('-updated_date', 500);
    
    // SOURCE 2: Service role active Character records
    const serviceRoleActive = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
    
    // SOURCE 3: Character records by status (user role)
    const userRoleDeleted = await base44.entities.Character.filter({ status: 'deleted' }, null, 500).catch(() => []);
    const userRoleSoftDeleted = await base44.entities.Character.filter({ status: 'soft_deleted' }, null, 500).catch(() => []);
    const userRoleMovedAway = await base44.entities.Character.filter({ status: 'moved_away' }, null, 500).catch(() => []);
    const userRoleMerged = await base44.entities.Character.filter({ status: 'merged' }, null, 500).catch(() => []);

    // SOURCE 4: Character records by status (service role)
    const serviceRoleDeleted = await base44.asServiceRole.entities.Character.filter({ status: 'deleted' }, null, 500).catch(() => []);
    const serviceRoleSoftDeleted = await base44.asServiceRole.entities.Character.filter({ status: 'soft_deleted' }, null, 500).catch(() => []);

    // SOURCE 5: CharacterAlias records
    const characterAliasRecords = await base44.asServiceRole.entities.CharacterAlias.list(null, 500).catch(() => []);

    // SOURCE 6: Related entities
    const characterIdentityReferences = await base44.asServiceRole.entities.CharacterIdentityReference.list(null, 500).catch(() => []);
    const casualContacts = await base44.asServiceRole.entities.CasualContact.list(null, 500).catch(() => []);
    const charMergeAudits = await base44.asServiceRole.entities.CharacterMergeAudit.list(null, 500).catch(() => []);
    const charRenameAudits = await base44.asServiceRole.entities.CharacterRenameAudit.list(null, 500).catch(() => []);

    // Aggregate all Character records from all statuses
    const allCharactersByName = new Map();
    
    [...userRoleActive, ...serviceRoleActive, ...userRoleDeleted, ...userRoleSoftDeleted, 
     ...userRoleMovedAway, ...userRoleMerged, ...serviceRoleDeleted, ...serviceRoleSoftDeleted].forEach(c => {
      if (!allCharactersByName.has(c.name)) {
        allCharactersByName.set(c.name, []);
      }
      allCharactersByName.get(c.name).push({
        source: c.character_type,
        status: c.status,
        id: c.id.slice(0, 8)
      });
    });

    // Classify all records
    const recordInventory = {
      known_exported_in_active_user_role: [],
      known_exported_in_active_service_role: [],
      known_exported_in_deleted_archived: [],
      known_exported_not_found: [],
      
      user_role_unclassified_active: [],
      service_role_unclassified_active: [],
      deleted_archived_records: [],
      
      alias_records_count: characterAliasRecords.length,
      alias_names: characterAliasRecords.map(a => a.alias_name),
      
      related_entities: {
        CharacterIdentityReference_count: characterIdentityReferences.length,
        CasualContact_count: casualContacts.length,
        CharacterMergeAudit_count: charMergeAudits.length,
        CharacterRenameAudit_count: charRenameAudits.length,
      }
    };

    // Classify known exported records
    for (const name of KNOWN_EXPORTED) {
      const foundInUserActive = userRoleActive.find(c => c.name === name);
      const foundInServiceActive = serviceRoleActive.find(c => c.name === name);
      const foundInDeleted = [userRoleDeleted, userRoleSoftDeleted, userRoleMovedAway, 
                               userRoleMerged, serviceRoleDeleted, serviceRoleSoftDeleted]
        .flat().find(c => c.name === name);

      if (foundInUserActive) {
        recordInventory.known_exported_in_active_user_role.push(name);
      } else if (foundInServiceActive) {
        recordInventory.known_exported_in_active_service_role.push(name);
      } else if (foundInDeleted) {
        recordInventory.known_exported_in_deleted_archived.push(name);
      } else {
        recordInventory.known_exported_not_found.push(name);
      }
    }

    // Unclassified active records
    userRoleActive.forEach(c => {
      if (!KNOWN_EXPORTED.includes(c.name)) {
        recordInventory.user_role_unclassified_active.push(c.name);
      }
    });

    serviceRoleActive.forEach(c => {
      if (!KNOWN_EXPORTED.includes(c.name)) {
        recordInventory.service_role_unclassified_active.push(c.name);
      }
    });

    // Deleted/archived records
    [userRoleDeleted, userRoleSoftDeleted, userRoleMovedAway, userRoleMerged, 
     serviceRoleDeleted, serviceRoleSoftDeleted].flat().forEach(c => {
      recordInventory.deleted_archived_records.push({
        name: c.name,
        status: c.status,
        character_type: c.character_type
      });
    });

    // Calculate totals
    const totalActiveCharacters = userRoleActive.length + serviceRoleActive.length;
    const totalDeletedArchived = recordInventory.deleted_archived_records.length;
    const totalAliases = characterAliasRecords.length;

    // Export composition estimate
    const knownInApp = recordInventory.known_exported_in_active_user_role.length + 
                        recordInventory.known_exported_in_active_service_role.length +
                        recordInventory.known_exported_in_deleted_archived.length;

    return Response.json({
      diagnostic: 'FULL_EXPORT_COMPOSITION',
      user_email: user.email,

      CHARACTER_RECORDS_BY_STATUS: {
        active_user_role: {
          count: userRoleActive.length,
          names: userRoleActive.map(c => c.name)
        },
        active_service_role: {
          count: serviceRoleActive.length,
          names: serviceRoleActive.map(c => c.name)
        },
        deleted_user_role: userRoleDeleted.length,
        soft_deleted_user_role: userRoleSoftDeleted.length,
        moved_away_user_role: userRoleMovedAway.length,
        merged_user_role: userRoleMerged.length,
        deleted_service_role: serviceRoleDeleted.length,
        soft_deleted_service_role: serviceRoleSoftDeleted.length,
      },

      RECORD_INVENTORY: recordInventory,

      EXPORT_COMPOSITION_ESTIMATE: {
        known_exported_records: KNOWN_EXPORTED.length,
        known_found_in_active_user_role: recordInventory.known_exported_in_active_user_role.length,
        known_found_in_active_service_role: recordInventory.known_exported_in_active_service_role.length,
        known_found_in_deleted_archived: recordInventory.known_exported_in_deleted_archived.length,
        known_not_found: recordInventory.known_exported_not_found.length,
        
        unclassified_in_app: {
          user_role_active: recordInventory.user_role_unclassified_active.length,
          service_role_active: recordInventory.service_role_unclassified_active.length,
          deleted_archived: recordInventory.deleted_archived_records.length,
        },

        alias_records: totalAliases,
        
        total_character_records_in_app: totalActiveCharacters + totalDeletedArchived,
        known_exported_in_app: knownInApp,
      },

      EXPORT_GAP_BREAKDOWN: {
        export_total: 43,
        known_exported: 10,
        known_found_in_app: knownInApp,
        remaining_unclassified: 43 - knownInApp,
        
        potential_sources_for_remaining: {
          user_role_unclassified: recordInventory.user_role_unclassified_active.length,
          service_role_unclassified: recordInventory.service_role_unclassified_active.length,
          deleted_archived_total: totalDeletedArchived,
          alias_records_if_counted: totalAliases,
          
          sum_of_all_available_records: recordInventory.user_role_unclassified_active.length + 
                                         recordInventory.service_role_unclassified_active.length + 
                                         totalDeletedArchived + totalAliases,
        }
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});