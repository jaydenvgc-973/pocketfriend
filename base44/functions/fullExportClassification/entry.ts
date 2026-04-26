import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FULL EXPORT CLASSIFICATION - COMPREHENSIVE
 * 
 * Classifies all 43 export records individually by:
 * - entity type
 * - role scope
 * - identifier (ID, normalized name, alias)
 * 
 * Success condition: Every export record is accounted for
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Known exported names (10 records)
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

    // ─────────────────────────────────────────────────
    // QUERY 1: User Role Active Characters
    // ─────────────────────────────────────────────────
    const userRoleCharacters = await base44.entities.Character.list('-updated_date', 500);

    // ─────────────────────────────────────────────────
    // QUERY 2: Service Role Active Characters
    // ─────────────────────────────────────────────────
    const serviceRoleCharacters = await base44.asServiceRole.entities.Character.list('-updated_date', 500);

    // ─────────────────────────────────────────────────
    // QUERY 3: Character Aliases
    // ─────────────────────────────────────────────────
    const characterAliases = await base44.asServiceRole.entities.CharacterAlias.list(null, 500).catch(() => []);

    // ─────────────────────────────────────────────────
    // QUERY 4: Archived/Deleted Records (user role)
    // ─────────────────────────────────────────────────
    const userRoleDeleted = await base44.entities.Character.filter(
      { status: { $in: ['deleted', 'soft_deleted', 'moved_away', 'merged'] } },
      null,
      500
    ).catch(() => []);

    // ─────────────────────────────────────────────────
    // QUERY 5: Archived/Deleted Records (service role)
    // ─────────────────────────────────────────────────
    const serviceRoleDeleted = await base44.asServiceRole.entities.Character.filter(
      { status: { $in: ['deleted', 'soft_deleted', 'moved_away', 'merged'] } },
      null,
      500
    ).catch(() => []);

    // ─────────────────────────────────────────────────
    // RECORD CLASSIFICATION
    // ─────────────────────────────────────────────────

    const classificationResults = {
      user_role_active: [],
      service_role_active: [],
      character_alias_records: [],
      user_role_archived_deleted: [],
      service_role_archived_deleted: [],
      unmatched_known_exported: [],
    };

    // Classify known exported names
    for (const exportedName of KNOWN_EXPORTED) {
      const userRoleMatch = userRoleCharacters.find(c => c.name === exportedName);
      const serviceRoleMatch = serviceRoleCharacters.find(c => c.name === exportedName);
      const aliasMatches = characterAliases.filter(a => a.alias_name === exportedName);
      const userRoleArchivedMatch = userRoleDeleted.find(c => c.name === exportedName);
      const serviceRoleArchivedMatch = serviceRoleDeleted.find(c => c.name === exportedName);

      if (userRoleMatch) {
        classificationResults.user_role_active.push({
          name: exportedName,
          id: userRoleMatch.id,
          character_type: userRoleMatch.character_type,
          status: userRoleMatch.status,
          entity: 'Character',
          role_scope: 'user',
          identifier_type: 'primary_name',
        });
      } else if (serviceRoleMatch) {
        classificationResults.service_role_active.push({
          name: exportedName,
          id: serviceRoleMatch.id,
          character_type: serviceRoleMatch.character_type,
          status: serviceRoleMatch.status,
          entity: 'Character',
          role_scope: 'service',
          identifier_type: 'primary_name',
        });
      } else if (aliasMatches.length > 0) {
        classificationResults.character_alias_records.push({
          alias_name: exportedName,
          count: aliasMatches.length,
          character_ids: aliasMatches.map(a => a.character_id),
          entity: 'CharacterAlias',
          role_scope: 'service',
          identifier_type: 'alias_name',
        });
      } else if (userRoleArchivedMatch) {
        classificationResults.user_role_archived_deleted.push({
          name: exportedName,
          id: userRoleArchivedMatch.id,
          status: userRoleArchivedMatch.status,
          entity: 'Character',
          role_scope: 'user',
          identifier_type: 'primary_name_archived',
        });
      } else if (serviceRoleArchivedMatch) {
        classificationResults.service_role_archived_deleted.push({
          name: exportedName,
          id: serviceRoleArchivedMatch.id,
          status: serviceRoleArchivedMatch.status,
          entity: 'Character',
          role_scope: 'service',
          identifier_type: 'primary_name_archived',
        });
      } else {
        classificationResults.unmatched_known_exported.push(exportedName);
      }
    }

    // ─────────────────────────────────────────────────
    // UNCLASSIFIED RECORDS (NOT IN KNOWN 10)
    // ─────────────────────────────────────────────────

    const classifiedNames = new Set([
      ...classificationResults.user_role_active.map(r => r.name),
      ...classificationResults.service_role_active.map(r => r.name),
      ...classificationResults.character_alias_records.map(r => r.alias_name),
      ...classificationResults.user_role_archived_deleted.map(r => r.name),
      ...classificationResults.service_role_archived_deleted.map(r => r.name),
    ]);

    const unclassifiedUserRoleActive = userRoleCharacters.filter(c => !classifiedNames.has(c.name));
    const unclassifiedServiceRoleActive = serviceRoleCharacters.filter(c => !classifiedNames.has(c.name));
    const unclassifiedUserRoleArchived = userRoleDeleted.filter(c => !classifiedNames.has(c.name));
    const unclassifiedServiceRoleArchived = serviceRoleDeleted.filter(c => !classifiedNames.has(c.name));
    const unclassifiedAliases = characterAliases.filter(a => !classifiedNames.has(a.alias_name));

    // ─────────────────────────────────────────────────
    // FINAL TALLY
    // ─────────────────────────────────────────────────

    const knownExportedInApp = 
      classificationResults.user_role_active.length +
      classificationResults.service_role_active.length +
      classificationResults.character_alias_records.length +
      classificationResults.user_role_archived_deleted.length +
      classificationResults.service_role_archived_deleted.length;

    const totalUnclassified =
      unclassifiedUserRoleActive.length +
      unclassifiedServiceRoleActive.length +
      unclassifiedUserRoleArchived.length +
      unclassifiedServiceRoleArchived.length +
      unclassifiedAliases.length;

    return Response.json({
      task: 'FULL_EXPORT_CLASSIFICATION',
      user_email: user.email,
      timestamp: new Date().toISOString(),

      KNOWN_EXPORTED_CLASSIFICATION: {
        total_known_exported: KNOWN_EXPORTED.length,
        found_in_user_role_active: classificationResults.user_role_active.length,
        found_in_service_role_active: classificationResults.service_role_active.length,
        found_as_character_alias: classificationResults.character_alias_records.length,
        found_in_user_role_archived: classificationResults.user_role_archived_deleted.length,
        found_in_service_role_archived: classificationResults.service_role_archived_deleted.length,
        not_found_anywhere: classificationResults.unmatched_known_exported.length,
      },

      KNOWN_EXPORTED_DETAILS: classificationResults,

      UNCLASSIFIED_RECORDS: {
        user_role_active_unclassified: {
          count: unclassifiedUserRoleActive.length,
          names: unclassifiedUserRoleActive.map(c => c.name),
        },
        service_role_active_unclassified: {
          count: unclassifiedServiceRoleActive.length,
          names: unclassifiedServiceRoleActive.map(c => c.name),
        },
        user_role_archived_unclassified: {
          count: unclassifiedUserRoleArchived.length,
          names: unclassifiedUserRoleArchived.map(c => c.name),
        },
        service_role_archived_unclassified: {
          count: unclassifiedServiceRoleArchived.length,
          names: unclassifiedServiceRoleArchived.map(c => c.name),
        },
        alias_unclassified: {
          count: unclassifiedAliases.length,
          names: unclassifiedAliases.map(a => a.alias_name),
        },
      },

      EXPORT_INVENTORY: {
        export_total_expected: 43,
        known_exported_accounted: knownExportedInApp,
        unclassified_available: totalUnclassified,
        total_records_in_system: knownExportedInApp + totalUnclassified,
        gap_to_43: 43 - (knownExportedInApp + totalUnclassified),
      },

      EXPORT_COMPOSITION_ESTIMATE: {
        confirmed_known_exported: knownExportedInApp,
        estimate_remaining_unclassified: Math.min(totalUnclassified, 43 - knownExportedInApp),
        total_estimated_export_records: knownExportedInApp + Math.min(totalUnclassified, 43 - knownExportedInApp),
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});