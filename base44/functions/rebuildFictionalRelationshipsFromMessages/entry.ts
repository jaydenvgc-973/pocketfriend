import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Reconstructs fictional_relationships for each character
 * from message history and character memory
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all characters
    const characters = await base44.asServiceRole.entities.Character.filter({
      created_by: user.email,
      status: 'active'
    });

    // Get all messages
    const messages = await base44.asServiceRole.entities.Message.list();

    // Get all character memories
    const memories = await base44.asServiceRole.entities.CharacterMemory.list();

    // Map all character names to IDs for linking
    const charNameToId = {};
    characters.forEach(c => {
      charNameToId[c.name?.toLowerCase()] = c.id;
    });

    // For each character, find who they interacted with
    const characterNetworks = {};

    characters.forEach(char => {
      characterNetworks[char.id] = new Map(); // name -> relationship data
    });

    // Extract from messages: who messaged whom
    messages.forEach(msg => {
      if (msg.character_id && msg.character_name) {
        const sourceId = msg.character_id;
        
        // Parse message content for character mentions
        const content = msg.content?.toLowerCase() || '';
        
        // Find other character names mentioned
        characters.forEach(otherChar => {
          if (otherChar.id !== sourceId) {
            const otherNameLower = otherChar.name?.toLowerCase();
            if (otherNameLower && content.includes(otherNameLower)) {
              if (!characterNetworks[sourceId].has(otherChar.id)) {
                characterNetworks[sourceId].set(otherChar.id, {
                  person_name: otherChar.name,
                  related_character_id: otherChar.id,
                  relationship_type: 'acquaintance',
                  description: '',
                  friendship_level: 50,
                  trust_level: 50,
                  attraction_level: 0,
                  respect_level: 50
                });
              }
            }
          }
        });
      }
    });

    // Extract from memories: who characters know
    memories.forEach(mem => {
      if (mem.character_id && mem.memory_type === 'relationship') {
        const sourceId = mem.character_id;
        if (mem.related_character_id) {
          const relatedChar = characters.find(c => c.id === mem.related_character_id);
          if (relatedChar && relatedChar.id !== sourceId) {
            if (!characterNetworks[sourceId].has(mem.related_character_id)) {
              characterNetworks[sourceId].set(mem.related_character_id, {
                person_name: relatedChar.name,
                related_character_id: mem.related_character_id,
                relationship_type: 'friend',
                description: mem.memory_text || '',
                friendship_level: 75,
                trust_level: 60,
                attraction_level: 0,
                respect_level: 50
              });
            }
          }
        }
      }
    });

    // Apply updates to each character — MERGE only, never replace.
    // For each character in the computed network, fetch the CURRENT canonical
    // fictional_relationships from the DB and add only NEW entries (by related_character_id).
    // Existing entries are NEVER overwritten, modified, or removed.
    // This function may only ADD entries that do not already exist.
    let updatedCount = 0;
    for (const char of characters) {
      const network = characterNetworks[char.id];
      if (network.size === 0) continue;

      // Fresh read immediately before write — prevents race condition with concurrent writes
      const freshArr = await base44.asServiceRole.entities.Character.filter({ id: char.id }).catch(() => []);
      const freshChar = freshArr[0];
      if (!freshChar) continue;

      const currentRels = freshChar.fictional_relationships || [];
      const existingIds = new Set(currentRels.map(r => r.related_character_id).filter(Boolean));

      // Only add entries for characters not already in the canonical list
      const newEntries = Array.from(network.values()).filter(
        entry => entry.related_character_id && !existingIds.has(entry.related_character_id)
      );

      if (newEntries.length === 0) continue; // Nothing to add — canonical list is authoritative

      await base44.asServiceRole.entities.Character.update(char.id, {
        fictional_relationships: [...currentRels, ...newEntries],
      });
      updatedCount++;
    }

    return Response.json({
      success: true,
      message: `Rebuilt fictional_relationships for ${updatedCount} characters`,
      charactersProcessed: updatedCount
    });
  } catch (error) {
    console.error('Rebuild error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});