import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * DISCOVER ALTERNATE DATA SOURCES
 * 
 * The export shows 43 records.
 * Character entity shows 38 (17 + 21).
 * 5 records are elsewhere.
 * 
 * Check related entities that might hold character data:
 * - CharacterAlias
 * - CharacterIdentityReference
 * - CharacterDeletionAudit
 * - CharacterMergeAudit
 * - Any other character-related entity
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const userEmail = user.email;

    // List of character-related entities to check
    const entityNames = [
      'Character',
      'CharacterAlias',
      'CharacterIdentityReference',
      'CharacterDeletionAudit',
      'CharacterMergeAudit',
      'CharacterMergeLog',
      'CharacterRenameAudit',
      'Memory',
      'CharacterMemory',
    ];

    const findings = {};

    for (const entityName of entityNames) {
      try {
        // Try to list records from this entity
        const records = await base44.asServiceRole.entities[entityName].list('-updated_date', 500).catch(() => []);
        findings[entityName] = {
          exists: true,
          total_records: records.length,
          sample_names: records.slice(0, 5).map(r => ({ 
            id: r.id?.slice(0, 8),
            name: r.name || r.alias_name || r.character_id || r.title || '(no name)',
            created_by: r.created_by,
          })),
        };
      } catch (err) {
        findings[entityName] = {
          exists: false,
          error: err.message,
        };
      }
    }

    // Special check: Look for any CHARACTER names in Memory or CharacterMemory
    try {
      const targetNames = [
        'Andre Rivera',
        'Ava Dei Park',
        'Brian Anderson',
        'Ethan Thompson',
        'James Anderson',
        'Jonathan Anthony Smith',
        'Lila Green',
        'Matt Lopez',
        'Melody Jackson Perry',
        'Nathan Parker'
      ];

      const memories = await base44.asServiceRole.entities.CharacterMemory.list('-updated_date', 500).catch(() => []);
      const memoryCharacterIds = new Set(memories.map(m => m.character_id).filter(Boolean));
      
      findings['CharacterMemory_analysis'] = {
        total_memory_records: memories.length,
        unique_character_ids_referenced: memoryCharacterIds.size,
        first_5_referenced_ids: Array.from(memoryCharacterIds).slice(0, 5),
      };
    } catch (err) {
      findings['CharacterMemory_analysis'] = { error: err.message };
    }

    return Response.json({
      diagnostic: 'ALTERNATE_DATA_SOURCES',
      user_email: userEmail,
      expected_missing_count: 5,
      
      findings,

      summary: {
        character_entity_count: findings.Character?.total_records || 0,
        total_records_across_all_entities: Object.values(findings)
          .filter(f => f.total_records)
          .reduce((sum, f) => sum + f.total_records, 0),
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});