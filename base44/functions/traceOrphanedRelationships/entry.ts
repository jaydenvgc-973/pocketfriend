import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const allMessages = await base44.entities.Message.filter({ created_by: user.email }, "-created_date", 500);
    const allMemories = await base44.entities.Memory.filter({ created_by: user.email });

    // List of orphaned people from diagnostic
    const orphanedPeople = [
      "Sofia Garcia",
      "Carlos Mendez",
      "Jasmine Rodriguez",
      "Kiara",
      "Mace",
      "Nick Decker",
      "Leah Park",
      "Mia Chen"
    ];

    const results = {};

    // For each orphaned person, find which characters mention them
    for (const personName of orphanedPeople) {
      const mentionedBy = new Set();
      const mentionedInContexts = [];

      // Check messages
      for (const msg of allMessages) {
        if (msg.content && msg.content.toLowerCase().includes(personName.toLowerCase())) {
          mentionedBy.add(msg.character_id);
          mentionedInContexts.push({
            type: "message",
            character_id: msg.character_id,
            content_preview: msg.content.substring(0, 150),
            conversation_id: msg.conversation_id
          });
        }
      }

      // Check memories
      for (const mem of allMemories) {
        if ((mem.title && mem.title.toLowerCase().includes(personName.toLowerCase())) ||
            (mem.description && mem.description.toLowerCase().includes(personName.toLowerCase()))) {
          mentionedBy.add(mem.character_id);
          mentionedInContexts.push({
            type: "memory",
            character_id: mem.character_id,
            title: mem.title,
            description_preview: mem.description.substring(0, 150)
          });
        }
      }

      // Map character IDs to names
      const characterMentions = Array.from(mentionedBy).map(charId => {
        const char = characters.find(c => c.id === charId);
        return char ? char.name : `Unknown (${charId})`;
      });

      results[personName] = {
        mentioned_by_characters: characterMentions,
        mention_count: mentionedInContexts.length,
        contexts: mentionedInContexts.slice(0, 5) // First 5 mentions
      };
    }

    return Response.json({
      orphaned_relationships_mapping: results,
      recommendation: "These people belong with the characters who actually mention them in conversations and memories, not consolidated in Matt Lopez's record"
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});