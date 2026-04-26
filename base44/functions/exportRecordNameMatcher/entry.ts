import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * EXPORT RECORD NAME MATCHER
 * 
 * Identifies which specific records from the app could compose the 43-record export.
 * Uses fuzzy matching on known exported name to resolve "Jonathan Anthony Smith" discrepancy.
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

    // Get all Character records (all statuses)
    const userRoleAll = await base44.entities.Character.list('-updated_date', 500);
    const serviceRoleAll = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
    const allCharacters = [...userRoleAll, ...serviceRoleAll];

    // Get CharacterAlias
    const aliases = await base44.asServiceRole.entities.CharacterAlias.list(null, 500).catch(() => []);

    // Match exported names to app records (exact + fuzzy)
    const matchResults = {};
    const allAppNames = allCharacters.map(c => c.name);
    const allAliasNames = aliases.map(a => a.alias_name);

    for (const exportedName of KNOWN_EXPORTED) {
      // Exact match
      const exactMatch = allCharacters.find(c => c.name === exportedName);
      
      // Fuzzy match (normalize spaces, case-insensitive)
      const normalized = exportedName.toLowerCase().replace(/\s+/g, ' ').trim();
      const fuzzyMatch = allCharacters.find(c => 
        c.name.toLowerCase().replace(/\s+/g, ' ').trim() === normalized
      );

      // Alias match
      const aliasMatch = aliases.find(a => a.alias_name === exportedName);

      matchResults[exportedName] = {
        exact_match: exactMatch ? {
          name: exactMatch.name,
          source: 'Character',
          type: exactMatch.character_type,
          role: userRoleAll.includes(exactMatch) ? 'user' : 'service'
        } : null,
        fuzzy_match: fuzzyMatch && !exactMatch ? {
          name: fuzzyMatch.name,
          source: 'Character (fuzzy)',
          type: fuzzyMatch.character_type,
          role: userRoleAll.includes(fuzzyMatch) ? 'user' : 'service'
        } : null,
        alias_match: aliasMatch ? {
          alias: aliasMatch.alias_name,
          character_id: aliasMatch.character_id
        } : null,
        found: !!(exactMatch || fuzzyMatch || aliasMatch),
      };
    }

    // Create potential 43-record export roster
    const exportRoster = [];
    
    // Add all matched exported records
    Object.values(matchResults).forEach((match, idx) => {
      if (match.exact_match) {
        exportRoster.push({
          export_rank: idx + 1,
          name: match.exact_match.name,
          source: 'Character entity',
          role: match.exact_match.role,
          match_type: 'EXACT'
        });
      } else if (match.fuzzy_match) {
        exportRoster.push({
          export_rank: idx + 1,
          name: match.fuzzy_match.name,
          source: 'Character entity',
          role: match.fuzzy_match.role,
          match_type: 'FUZZY (normalized)'
        });
      }
    });

    // Add all unclassified active records
    const unclassified = allCharacters.filter(c => !KNOWN_EXPORTED.some(exp => {
      const norm_exp = exp.toLowerCase().replace(/\s+/g, ' ').trim();
      const norm_char = c.name.toLowerCase().replace(/\s+/g, ' ').trim();
      return norm_exp === norm_char;
    }));

    unclassified.forEach(char => {
      exportRoster.push({
        name: char.name,
        source: 'Character entity',
        role: userRoleAll.includes(char) ? 'user' : 'service',
        match_type: 'UNCLASSIFIED_ACTIVE'
      });
    });

    // Add alias names as potential export records
    aliases.slice(0, 15).forEach(alias => {
      exportRoster.push({
        name: alias.alias_name,
        source: 'CharacterAlias entity',
        match_type: 'ALIAS'
      });
    });

    return Response.json({
      diagnostic: 'EXPORT_RECORD_NAME_MATCHER',
      user_email: user.email,

      MATCH_RESULTS: matchResults,

      UNMATCHED_EXPORTED_NAMES: Object.entries(matchResults)
        .filter(([_, m]) => !m.found)
        .map(([name]) => name),

      POTENTIAL_43_RECORD_ROSTER: {
        total_records: exportRoster.length,
        by_source: {
          character_exact_matches: exportRoster.filter(r => r.match_type === 'EXACT').length,
          character_fuzzy_matches: exportRoster.filter(r => r.match_type === 'FUZZY (normalized)').length,
          character_unclassified: exportRoster.filter(r => r.match_type === 'UNCLASSIFIED_ACTIVE').length,
          alias_records: exportRoster.filter(r => r.source === 'CharacterAlias entity').length,
        },
        records: exportRoster,
      },

      EXPORT_COMPOSITION_FINAL: {
        exported_10_known_records: KNOWN_EXPORTED.length,
        found_as_exact_character: exportRoster.filter(r => r.match_type === 'EXACT').length,
        found_as_fuzzy_character: exportRoster.filter(r => r.match_type === 'FUZZY (normalized)').length,
        unclassified_character_records: exportRoster.filter(r => r.match_type === 'UNCLASSIFIED_ACTIVE').length,
        potential_alias_records_in_export: Math.min(15, aliases.length),
        
        estimated_export_composition: {
          known_exported: 9,
          unclassified_user_created: 8,
          unclassified_service_npc: 21,
          remaining_to_reach_43: 43 - (9 + 8 + 21),
        }
      }
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});