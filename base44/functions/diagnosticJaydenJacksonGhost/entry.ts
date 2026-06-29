import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;

    // Get ALL characters for this user — no pagination, no truncation
    const allCharacters = await base44.asServiceRole.entities.Character.filter({ owner_email: ownerEmail }, '-created_date', 500);

    const results = {
      totalCharactersForOwner: allCharacters.length,
      matchingNpcFamilyMembers: [],
      characterWithJaydenJacksonRelationship: []
    };

    // Search for npc_family_member characters
    allCharacters.forEach(char => {
      if (char.character_type === 'npc_family_member') {
        results.matchingNpcFamilyMembers.push({
          id: char.id,
          name: char.name,
          display_name: char.display_name,
          full_name: char.full_name,
          character_type: char.character_type,
          status: char.status,
          exclude_from_roster: char.exclude_from_roster,
          owner_email: char.owner_email,
          fictional_relationships: char.fictional_relationships || []
        });
      }

      // Search for fictional_relationships containing "Jayden" or "Jackson"
      if (char.fictional_relationships && Array.isArray(char.fictional_relationships)) {
        const matchingRels = char.fictional_relationships.filter(rel => {
          const text = JSON.stringify(rel).toLowerCase();
          return text.includes('jayden') || text.includes('jackson');
        });

        if (matchingRels.length > 0) {
          results.characterWithJaydenJacksonRelationship.push({
            id: char.id,
            name: char.name,
            display_name: char.display_name,
            full_name: char.full_name,
            character_type: char.character_type,
            status: char.status,
            exclude_from_roster: char.exclude_from_roster,
            owner_email: char.owner_email,
            fictional_relationships: matchingRels
          });
        }
      }
    });

    // Also search for characters with null/missing status
    const nullStatusChars = allCharacters.filter(c => !c.status);
    if (nullStatusChars.length > 0) {
      results.charactersWithNullStatus = nullStatusChars.map(c => ({
        id: c.id,
        name: c.name,
        display_name: c.display_name,
        full_name: c.full_name,
        character_type: c.character_type,
        status: c.status,
        exclude_from_roster: c.exclude_from_roster,
        owner_email: c.owner_email
      }));
    }

    return Response.json(results, { status: 200 });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});