import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // EXHAUSTIVE PULL - NO LIMITS
    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const allMessages = await base44.entities.Message.filter({ created_by: user.email });
    const allMemories = await base44.entities.Memory.filter({ created_by: user.email });
    const allConversations = await base44.entities.Conversation.filter({ created_by: user.email });
    const allLocations = await base44.entities.LocationReference.filter({ created_by: user.email });

    const issues = [];
    const analysis = {
      total_characters: characters.length,
      total_messages: allMessages.length,
      total_memories: allMemories.length,
      total_conversations: allConversations.length,
      total_locations: allLocations.length,
      orphaned_relationships: [],
      broken_character_references: [],
      characters_with_gaps: [],
      npc_placement_issues: [],
    };

    // 1. Check for orphaned relationships (related_character_id points to nowhere)
    for (const char of characters) {
      const rels = char.fictional_relationships || [];
      for (const rel of rels) {
        if (!rel.related_character_id) {
          analysis.orphaned_relationships.push({
            owner: char.name,
            person: rel.person_name,
            issue: 'missing related_character_id'
          });
        } else {
          const relChar = characters.find(c => c.id === rel.related_character_id);
          if (!relChar) {
            analysis.orphaned_relationships.push({
              owner: char.name,
              person: rel.person_name,
              related_id: rel.related_character_id,
              issue: 'related_character_id points to non-existent character'
            });
          }
        }
      }
    }

    // 2. Check for broken references in locations
    for (const char of characters) {
      if (char.occupation_location_id && !allLocations.find(l => l.id === char.occupation_location_id)) {
        analysis.broken_character_references.push({
          character: char.name,
          issue: `occupation_location_id ${char.occupation_location_id} not found`
        });
      }
      if (char.education_location_id && !allLocations.find(l => l.id === char.education_location_id)) {
        analysis.broken_character_references.push({
          character: char.name,
          issue: `education_location_id ${char.education_location_id} not found`
        });
      }
    }

    // 3. Check for data gaps (characters with no conversations, no messages, no memories)
    for (const char of characters) {
      const hasConvo = allConversations.some(c => c.character_ids && c.character_ids.includes(char.id));
      const hasMsg = allMessages.some(m => m.character_id === char.id);
      const hasMem = allMemories.some(m => m.character_id === char.id);
      
      if (!hasConvo && !hasMsg && !hasMem && char.status === 'active') {
        analysis.characters_with_gaps.push({
          character: char.name,
          id: char.id,
          gaps: ['no_conversations', 'no_messages', 'no_memories']
        });
      }
    }

    // 4. Check NPC placement - are they appearing in their owners' fictional_relationships?
    const npcCharacters = characters.filter(c => c.character_type === 'npc' || c.character_type === 'fictional_entity');
    for (const npc of npcCharacters) {
      // Find which character claims this NPC in their fictional_relationships
      const owners = characters.filter(c => 
        (c.fictional_relationships || []).some(r => r.related_character_id === npc.id)
      );
      
      if (owners.length === 0) {
        analysis.npc_placement_issues.push({
          npc: npc.name,
          id: npc.id,
          issue: 'NPC not listed in any character\'s fictional_relationships'
        });
      } else if (owners.length > 1) {
        analysis.npc_placement_issues.push({
          npc: npc.name,
          id: npc.id,
          issue: `NPC claimed by multiple owners: ${owners.map(o => o.name).join(', ')}`
        });
      }
    }

    // 5. Check that all fictional_relationships have valid person_name and relationship_type
    for (const char of characters) {
      const rels = char.fictional_relationships || [];
      for (const rel of rels) {
        if (!rel.person_name) {
          issues.push({
            character: char.name,
            issue: 'fictional_relationship missing person_name'
          });
        }
        if (!rel.relationship_type) {
          issues.push({
            character: char.name,
            person: rel.person_name,
            issue: 'fictional_relationship missing relationship_type'
          });
        }
      }
    }

    return Response.json({
      diagnostic_phase: 1,
      analysis,
      critical_issues: issues.length,
      issues: issues,
      ready_for_fixes: analysis.orphaned_relationships.length > 0 || analysis.broken_character_references.length > 0
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});