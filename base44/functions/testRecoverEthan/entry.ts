import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const chars = await base44.entities.Character.filter({ created_by: user.email });
    const ethan = chars.find(c => c.name && c.name.toLowerCase().includes('ethan'));

    if (!ethan) {
      return Response.json({ error: 'Ethan not found' }, { status: 404 });
    }

    // Check relationship data
    const relationships = await base44.entities.CharacterRelationship.filter({ source_character_id: ethan.id });
    const relatedTo = await base44.entities.CharacterRelationship.filter({ target_character_id: ethan.id });

    // Check memories
    const memories = await base44.entities.CharacterMemory.filter({ character_id: ethan.id });

    // Check aliases
    const aliases = ethan.aliases || [];

    // Check family list
    const familyMembers = ethan.family_members || [];

    // Check duplicate homes
    const locations = await base44.entities.LocationReference.list();
    const ethanHomes = locations.filter(l => 
      l.resident_character_ids?.includes(ethan.id) || 
      l.resident_character_names?.includes(ethan.name)
    );

    const issues = [];
    if (ethanHomes.length > 1) {
      issues.push(`CRITICAL: Ethan is in ${ethanHomes.length} homes instead of 1`);
    }
    if (!ethan.profile_summary) {
      issues.push('MISSING: profile_summary');
    }
    if (!ethan.backstory) {
      issues.push('MISSING: backstory');
    }
    if (aliases.length === 0) {
      issues.push('MISSING: aliases (empty array)');
    }

    return Response.json({
      timestamp: new Date().toISOString(),
      character: ethan.name,
      issues,
      relationshipCount: {
        asSource: relationships.length,
        asTarget: relatedTo.length,
      },
      memoryCount: memories.length,
      aliasCount: aliases.length,
      familyMemberCount: familyMembers.length,
      homeCount: ethanHomes.length,
      homes: ethanHomes.map(h => ({ id: h.id, name: h.name })),
      issueCount: issues.length,
      status: issues.length === 0 ? 'OK' : `${issues.length} ISSUES`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});