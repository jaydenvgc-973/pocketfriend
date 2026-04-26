import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * EXPORT COMPLETE INVENTORY - ALL 43 RECORDS LISTED INDIVIDUALLY
 * 
 * Every record must be named, classified, and accounted for.
 * No pooling. No grouping. All 43 records explicit.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const KNOWN_EXPORTED = [
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

    // Fetch all records from all sources
    const userRoleCharacters = await base44.entities.Character.list('-updated_date', 500);
    const serviceRoleCharacters = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
    const characterAliases = await base44.asServiceRole.entities.CharacterAlias.list(null, 500).catch(() => []);
    const userRoleDeleted = await base44.entities.Character.filter(
      { status: { $in: ['deleted', 'soft_deleted', 'moved_away', 'merged'] } },
      null,
      500
    ).catch(() => []);
    const serviceRoleDeleted = await base44.asServiceRole.entities.Character.filter(
      { status: { $in: ['deleted', 'soft_deleted', 'moved_away', 'merged'] } },
      null,
      500
    ).catch(() => []);

    // Build complete inventory - ALL records
    const completeInventory = [];

    // Add known exported records first (10 records)
    for (const exportedName of KNOWN_EXPORTED) {
      const userMatch = userRoleCharacters.find(c => c.name === exportedName);
      const serviceMatch = serviceRoleCharacters.find(c => c.name === exportedName);
      const aliasMatch = characterAliases.find(a => a.alias_name === exportedName);
      const userArchived = userRoleDeleted.find(c => c.name === exportedName);
      const serviceArchived = serviceRoleDeleted.find(c => c.name === exportedName);

      if (userMatch) {
        completeInventory.push({
          rank: completeInventory.length + 1,
          name: exportedName,
          entity: 'Character',
          role_scope: 'user',
          status: userMatch.status,
          character_type: userMatch.character_type,
          id: userMatch.id,
          identifier_type: 'primary_name',
          source_export_known: true,
        });
      } else if (serviceMatch) {
        completeInventory.push({
          rank: completeInventory.length + 1,
          name: exportedName,
          entity: 'Character',
          role_scope: 'service',
          status: serviceMatch.status,
          character_type: serviceMatch.character_type,
          id: serviceMatch.id,
          identifier_type: 'primary_name',
          source_export_known: true,
        });
      } else if (aliasMatch) {
        completeInventory.push({
          rank: completeInventory.length + 1,
          name: exportedName,
          entity: 'CharacterAlias',
          role_scope: 'service',
          status: 'alias',
          character_id_reference: aliasMatch.character_id,
          id: aliasMatch.id,
          identifier_type: 'alias_name',
          source_export_known: true,
        });
      } else if (userArchived) {
        completeInventory.push({
          rank: completeInventory.length + 1,
          name: exportedName,
          entity: 'Character',
          role_scope: 'user',
          status: userArchived.status,
          character_type: userArchived.character_type,
          id: userArchived.id,
          identifier_type: 'primary_name_archived',
          source_export_known: true,
        });
      } else if (serviceArchived) {
        completeInventory.push({
          rank: completeInventory.length + 1,
          name: exportedName,
          entity: 'Character',
          role_scope: 'service',
          status: serviceArchived.status,
          character_type: serviceArchived.character_type,
          id: serviceArchived.id,
          identifier_type: 'primary_name_archived',
          source_export_known: true,
        });
      }
    }

    // Add unclassified records (not in known 10)
    const classifiedNames = new Set(KNOWN_EXPORTED);

    // User role active unclassified
    userRoleCharacters
      .filter(c => !classifiedNames.has(c.name))
      .forEach(c => {
        completeInventory.push({
          rank: completeInventory.length + 1,
          name: c.name,
          entity: 'Character',
          role_scope: 'user',
          status: c.status,
          character_type: c.character_type,
          id: c.id,
          identifier_type: 'primary_name',
          source_export_known: false,
        });
      });

    // Service role active unclassified
    serviceRoleCharacters
      .filter(c => !classifiedNames.has(c.name))
      .forEach(c => {
        completeInventory.push({
          rank: completeInventory.length + 1,
          name: c.name,
          entity: 'Character',
          role_scope: 'service',
          status: c.status,
          character_type: c.character_type,
          id: c.id,
          identifier_type: 'primary_name',
          source_export_known: false,
        });
      });

    // User role archived unclassified
    userRoleDeleted
      .filter(c => !classifiedNames.has(c.name))
      .forEach(c => {
        completeInventory.push({
          rank: completeInventory.length + 1,
          name: c.name,
          entity: 'Character',
          role_scope: 'user',
          status: c.status,
          character_type: c.character_type,
          id: c.id,
          identifier_type: 'primary_name_archived',
          source_export_known: false,
        });
      });

    // Service role archived unclassified
    serviceRoleDeleted
      .filter(c => !classifiedNames.has(c.name))
      .forEach(c => {
        completeInventory.push({
          rank: completeInventory.length + 1,
          name: c.name,
          entity: 'Character',
          role_scope: 'service',
          status: c.status,
          character_type: c.character_type,
          id: c.id,
          identifier_type: 'primary_name_archived',
          source_export_known: false,
        });
      });

    // Alias records unclassified
    characterAliases
      .filter(a => !classifiedNames.has(a.alias_name))
      .forEach(a => {
        completeInventory.push({
          rank: completeInventory.length + 1,
          name: a.alias_name,
          entity: 'CharacterAlias',
          role_scope: 'service',
          status: 'alias',
          character_id_reference: a.character_id,
          id: a.id,
          identifier_type: 'alias_name',
          source_export_known: false,
        });
      });

    return Response.json({
      task: 'EXPORT_COMPLETE_INVENTORY',
      user_email: user.email,
      timestamp: new Date().toISOString(),

      SUMMARY: {
        total_records: completeInventory.length,
        export_total_expected: 43,
        difference: 43 - completeInventory.length,
      },

      COMPLETE_RECORD_LIST: completeInventory,

      BREAKDOWN_BY_CLASSIFICATION: {
        known_exported_from_export: completeInventory.filter(r => r.source_export_known === true).length,
        unclassified_not_in_export: completeInventory.filter(r => r.source_export_known === false).length,
      },

      BREAKDOWN_BY_ENTITY: {
        Character_records: completeInventory.filter(r => r.entity === 'Character').length,
        CharacterAlias_records: completeInventory.filter(r => r.entity === 'CharacterAlias').length,
      },

      BREAKDOWN_BY_ROLE: {
        user_role_records: completeInventory.filter(r => r.role_scope === 'user').length,
        service_role_records: completeInventory.filter(r => r.role_scope === 'service').length,
      },

      BREAKDOWN_BY_STATUS: {
        active: completeInventory.filter(r => r.status === 'active').length,
        archived_deleted: completeInventory.filter(r => ['deleted', 'soft_deleted', 'moved_away', 'merged'].includes(r.status)).length,
        alias: completeInventory.filter(r => r.status === 'alias').length,
      },
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});