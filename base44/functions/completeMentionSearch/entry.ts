import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email });
    // NO LIMIT - fetch all messages
    const allMessages = await base44.entities.Message.filter({ created_by: user.email }, "-created_date");
    const allMemories = await base44.entities.Memory.filter({ created_by: user.email });

    const peopleToCheeck = [
      "Sofia Garcia",
      "Carlos Mendez",
      "Jasmine Rodriguez",
      "Kiara",
      "Nick Decker"
    ];

    const results = {};

    for (const personName of peopleToCheeck) {
      const mentionedBy = new Map(); // character -> mention count

      // Check all messages (no limit)
      for (const msg of allMessages) {
        if (msg.content && msg.content.toLowerCase().includes(personName.toLowerCase())) {
          const charId = msg.character_id;
          if (!mentionedBy.has(charId)) {
            mentionedBy.set(charId, 0);
          }
          mentionedBy.set(charId, mentionedBy.get(charId) + 1);
        }
      }

      // Check memories (no limit)
      for (const mem of allMemories) {
        if ((mem.title && mem.title.toLowerCase().includes(personName.toLowerCase())) ||
            (mem.description && mem.description.toLowerCase().includes(personName.toLowerCase()))) {
          const charId = mem.character_id;
          if (!mentionedBy.has(charId)) {
            mentionedBy.set(charId, 0);
          }
          mentionedBy.set(charId, mentionedBy.get(charId) + 1);
        }
      }

      // Convert to array with character names
      const mentions = Array.from(mentionedBy.entries()).map(([charId, count]) => {
        const char = characters.find(c => c.id === charId);
        return {
          character: char ? char.name : `Unknown (${charId})`,
          mentions: count
        };
      }).sort((a, b) => b.mentions - a.mentions);

      results[personName] = mentions;
    }

    return Response.json({
      total_messages_searched: allMessages.length,
      complete_mention_count: results
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});