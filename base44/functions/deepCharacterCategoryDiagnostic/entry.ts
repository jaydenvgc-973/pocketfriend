import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all characters
    const allCharacters = await base44.entities.Character.list('-created_date', 1000);
    const userCharacters = allCharacters.filter(c => c.created_by === user.email);

    console.log('=== USER CHARACTERS DETAILED ANALYSIS ===');
    console.log('Total user characters:', userCharacters.length);

    // Group by character_type and status
    const grouped = {};
    userCharacters.forEach(c => {
      const key = `${c.character_type || 'undefined'}_${c.status || 'undefined'}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push({
        id: c.id,
        name: c.name,
        character_type: c.character_type,
        status: c.status,
        family_members: c.family_members?.length || 0,
        fictional_relationships: c.fictional_relationships?.length || 0,
      });
    });

    console.log('Grouped by type_status:', Object.keys(grouped));

    // Check all character_type enum values that exist
    const typeValues = new Set(userCharacters.map(c => c.character_type));
    console.log('Unique character_type values in user characters:', Array.from(typeValues));

    // Look for family relationships - maybe some characters ARE family but marked wrong
    const charactersWithFamilyMembers = userCharacters.filter(c => c.family_members && c.family_members.length > 0);
    console.log('Characters with family_members field:', charactersWithFamilyMembers.length);

    // Check if any relationships reference family
    const charactersWithFictionalRels = userCharacters.filter(c => c.fictional_relationships && c.fictional_relationships.length > 0);
    console.log('Characters with fictional_relationships:', charactersWithFictionalRels.length);

    // Check if any character has is_family flag
    const charactersMarkedAsFamily = userCharacters.filter(c => {
      // Look in fictional_relationships for family markers
      if (c.fictional_relationships) {
        return c.fictional_relationships.some(rel => rel.relationship_type === 'family');
      }
      return false;
    });

    // Deep dive: show actual family_members on characters
    const familyMemberDetails = [];
    userCharacters.forEach(c => {
      if (c.family_members && c.family_members.length > 0) {
        c.family_members.forEach(fm => {
          familyMemberDetails.push({
            characterId: c.id,
            characterName: c.name,
            familyMemberName: fm.name,
            relationshipType: fm.relationship_type,
          });
        });
      }
    });

    console.log('All family member references:', familyMemberDetails.length);

    // Check system for any family_npc anywhere
    const allFamilyNPC = allCharacters.filter(c => c.character_type === 'family_npc');
    console.log('ALL family_npc in entire system:', allFamilyNPC.length);

    // Check for characters that have relationship_type indicating family
    const charactersInFamilyRelationships = userCharacters.filter(c => {
      if (c.fictional_relationships) {
        return c.fictional_relationships.some(rel => 
          ['family', 'brother', 'sister', 'mother', 'father', 'parent', 'sibling'].includes(rel.relationship_type?.toLowerCase())
        );
      }
      return false;
    });

    console.log('Characters in family relationships:', charactersInFamilyRelationships.length);

    return Response.json({
      summary: {
        totalUserCharacters: userCharacters.length,
        groupedByTypeStatus: grouped,
        uniqueCharacterTypes: Array.from(typeValues),
      },
      familyAnalysis: {
        charactersWithFamilyMembersField: charactersWithFamilyMembers.length,
        charactersWithFictionalRels: charactersWithFictionalRels.length,
        familyMemberReferences: familyMemberDetails,
        charactersInFamilyRelationships: charactersInFamilyRelationships.map(c => ({
          id: c.id,
          name: c.name,
          type: c.character_type,
          relationships: c.fictional_relationships?.filter(r => 
            ['family', 'brother', 'sister', 'mother', 'father', 'parent', 'sibling'].includes(r.relationship_type?.toLowerCase())
          ),
        })),
      },
      systemWide: {
        totalFamilyNPCInSystem: allFamilyNPC.length,
        familyNPCDetails: allFamilyNPC.map(c => ({
          id: c.id,
          name: c.name,
          createdBy: c.created_by,
        })),
      },
      allUserCharactersList: userCharacters.map(c => ({
        id: c.id,
        name: c.name,
        character_type: c.character_type,
        status: c.status,
        familyCount: c.family_members?.length || 0,
        relCount: c.fictional_relationships?.length || 0,
      })),
    });
  } catch (error) {
    console.error('Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});