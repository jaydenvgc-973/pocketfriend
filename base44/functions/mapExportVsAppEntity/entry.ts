import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * MAP EXPORT VS APP ENTITY
 * 
 * For known exported character names, search across ALL character-related entities.
 * Report exactly where each record is stored and why it may not appear in basic Character queries.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Names we know are in the export (from the diagnostic conversation)
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

    // Fetch from ALL entities
    const Character = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
    const CharacterAlias = await base44.asServiceRole.entities.CharacterAlias.list('-updated_date', 500);
    const Memory = await base44.asServiceRole.entities.CharacterMemory.list('-updated_date', 500);

    // Map each known exported name to where it's found
    const recordLocations = {};

    for (const exportedName of KNOWN_EXPORTED_NAMES) {
      const locations = [];

      // Search Character
      const charMatch = Character.find(c => c.name === exportedName);
      if (charMatch) {
        locations.push({
          entity: 'Character',
          id: charMatch.id.slice(0, 8),
          owner_email: charMatch.owner_email,
          character_type: charMatch.character_type,
          status: charMatch.status,
          visibility_scope: charMatch.visibility_scope,
        });
      }

      // Search CharacterAlias
      const aliasMatches = CharacterAlias.filter(a => a.alias_name === exportedName);
      if (aliasMatches.length > 0) {
        locations.push({
          entity: 'CharacterAlias',
          count: aliasMatches.length,
          sample: {
            id: aliasMatches[0].id.slice(0, 8),
            character_id: aliasMatches[0].character_id.slice(0, 8),
            alias_name: aliasMatches[0].alias_name,
            source_type: aliasMatches[0].source_type,
          },
        });
      }

      // Search Memory for character names
      const memoryMatches = Memory.filter(m => 
        m.memory_text?.includes(exportedName) || 
        m.related_character_id?.includes(exportedName)
      );

      recordLocations[exportedName] = {
        found_in_entities: locations.length > 0,
        locations,
        total_locations: locations.length,
        status: locations.length === 0 ? 'NOT FOUND' : locations.length === 1 ? 'UNIQUE' : 'DUPLICATED',
      };
    }

    // Summary
    const foundCount = Object.values(recordLocations).filter(r => r.found_in_entities).length;
    const notFoundCount = KNOWN_EXPORTED_NAMES.length - foundCount;

    // Count by entity type
    const byEntity = {};
    Object.values(recordLocations).forEach(r => {
      r.locations.forEach(loc => {
        if (!byEntity[loc.entity]) byEntity[loc.entity] = 0;
        byEntity[loc.entity]++;
      });
    });

    return Response.json({
      diagnostic: 'EXPORT_VS_APP_ENTITY_MAP',
      user_email: user.email,
      
      known_exported_names: KNOWN_EXPORTED_NAMES.length,
      found_in_app: foundCount,
      not_found_in_app: notFoundCount,

      records_by_location: recordLocations,

      summary: {
        Character_entity_total: Character.length,
        CharacterAlias_entity_total: CharacterAlias.length,
        Memory_entity_total: Memory.length,
        
        exported_names_found_by_entity: byEntity,
      },

      ANALYSIS: {
        conclusion: notFoundCount === 0 ? 'All 10 known exported names found in app data.' : `${notFoundCount} exported names not found in Character or CharacterAlias entities.`,
        mismatch_explanation: 'If export shows 43 but only ~21 found in Character entity, then export likely includes: Character records + CharacterAlias records + other character-related records.',
        next_step: 'Cross-reference export column headers and row data against these entity structures to confirm composition.',
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});