import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const issues = [];
    const fixes = [];

    // 1. GET ALL CHARACTERS
    const characters = await base44.entities.Character.filter({ created_by: user.email });
    
    // 2. CHECK EACH CHARACTER'S FICTIONAL_RELATIONSHIPS
    for (const char of characters) {
      const rels = char.fictional_relationships || [];
      
      for (const rel of rels) {
        // Check if related_character_id exists
        if (!rel.related_character_id) {
          issues.push(`${char.name}: Relationship to "${rel.person_name}" missing related_character_id`);
        } else {
          const relChar = characters.find(c => c.id === rel.related_character_id);
          if (!relChar) {
            issues.push(`${char.name}: Relationship to "${rel.person_name}" points to non-existent character (ID: ${rel.related_character_id})`);
          }
        }
      }
    }

    // 3. CHECK CONVERSATIONS
    const allConversations = await base44.entities.Conversation.filter({ created_by: user.email });
    
    for (const char of characters) {
      const charConvos = allConversations.filter(c => 
        c.character_ids && c.character_ids.includes(char.id)
      );
      
      if (charConvos.length === 0) {
        issues.push(`${char.name}: No conversations found`);
      }
    }

    // 4. CHECK MESSAGES
    const allMessages = await base44.entities.Message.filter({ created_by: user.email }, "-created_date", 100);
    
    const msgsByCharId = {};
    for (const msg of allMessages) {
      if (msg.character_id) {
        if (!msgsByCharId[msg.character_id]) {
          msgsByCharId[msg.character_id] = 0;
        }
        msgsByCharId[msg.character_id]++;
      }
    }

    for (const char of characters) {
      const msgCount = msgsByCharId[char.id] || 0;
      if (msgCount === 0) {
        issues.push(`${char.name}: No messages in conversation history`);
      }
    }

    // 5. CHECK LOCATIONS
    const allLocations = await base44.entities.LocationReference.filter({ created_by: user.email });
    
    for (const char of characters) {
      if (char.occupation_location_id) {
        const locExists = allLocations.find(l => l.id === char.occupation_location_id);
        if (!locExists) {
          issues.push(`${char.name}: occupation_location_id points to non-existent location (${char.occupation_location_id})`);
        }
      }
      if (char.education_location_id) {
        const locExists = allLocations.find(l => l.id === char.education_location_id);
        if (!locExists) {
          issues.push(`${char.name}: education_location_id points to non-existent location (${char.education_location_id})`);
        }
      }
      if (char.current_location_id) {
        const locExists = allLocations.find(l => l.id === char.current_location_id);
        if (!locExists) {
          issues.push(`${char.name}: current_location_id points to non-existent location (${char.current_location_id})`);
        }
      }
    }

    // 6. CHECK MEMORIES
    const allMemories = await base44.entities.Memory.filter({ created_by: user.email });
    
    for (const mem of allMemories) {
      const charExists = characters.find(c => c.id === mem.character_id);
      if (!charExists) {
        issues.push(`Memory: Orphaned memory (ID: ${mem.id}) points to non-existent character (${mem.character_id})`);
      }
    }

    // 7. CHECK NPC CONTACT PANEL DATA
    const npcIssues = [];
    for (const char of characters) {
      const rels = char.fictional_relationships || [];
      for (const rel of rels) {
        // This is what NPCContactPanel relies on
        if (!rel.person_name) {
          npcIssues.push(`${char.name}: Relationship missing person_name`);
        }
        if (!rel.relationship_type) {
          npcIssues.push(`${char.name}: Relationship to "${rel.person_name}" missing relationship_type`);
        }
        // related_character_id is critical for navigation
        if (!rel.related_character_id) {
          npcIssues.push(`${char.name}: Relationship to "${rel.person_name}" missing related_character_id (navigation will fail)`);
        }
      }
    }

    // 8. SUMMARY STATS
    const totalRels = characters.reduce((sum, c) => sum + (c.fictional_relationships || []).length, 0);
    const totalConvos = allConversations.length;
    const totalMsgs = allMessages.length;
    const totalMems = allMemories.length;

    return Response.json({
      summary: {
        total_characters: characters.length,
        total_relationships: totalRels,
        total_conversations: totalConvos,
        total_messages: totalMsgs,
        total_memories: totalMems,
        total_locations: allLocations.length
      },
      issues_found: issues.length,
      issues: issues,
      npc_contact_panel_issues: npcIssues.length,
      npc_issues: npcIssues,
      character_breakdown: characters.map(c => ({
        name: c.name,
        id: c.id,
        fictional_relationships: c.fictional_relationships || [],
        conversations: allConversations.filter(cv => cv.character_ids?.includes(c.id)).length,
        messages: msgsByCharId[c.id] || 0,
        memories: allMemories.filter(m => m.character_id === c.id).length
      }))
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});