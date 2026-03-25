import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const payload = await req.json();
    const message = payload.data;

    // Only process character messages in group conversations
    if (!message || message.sender_type !== 'character' || !message.conversation_id) {
      return Response.json({ skipped: true, reason: 'Not a character message' });
    }

    // Load the conversation to get all character_ids
    const conversations = await base44.asServiceRole.entities.Conversation.filter({ id: message.conversation_id });
    const conversation = conversations[0];

    if (!conversation || conversation.type !== 'group') {
      return Response.json({ skipped: true, reason: 'Not a group conversation' });
    }

    const characterIds = conversation.character_ids || [];
    if (characterIds.length < 2) {
      return Response.json({ skipped: true, reason: 'Not enough characters in group' });
    }

    // Load all characters in this group
    const allCharacters = await Promise.all(
      characterIds.map(id => base44.asServiceRole.entities.Character.get(id))
    );
    const characters = allCharacters.filter(Boolean);

    if (characters.length < 2) {
      return Response.json({ skipped: true, reason: 'Could not load characters' });
    }

    // For each character, ensure every other character in the group is in their fictional_relationships
    for (const character of characters) {
      const existingRelationships = character.fictional_relationships || [];
      let updated = false;

      for (const otherCharacter of characters) {
        if (otherCharacter.id === character.id) continue;

        // Check if relationship already exists
        const alreadyLinked = existingRelationships.some(
          r => r.related_character_id === otherCharacter.id
        );

        if (!alreadyLinked) {
          existingRelationships.push({
            person_name: otherCharacter.name,
            related_character_id: otherCharacter.id,
            relationship_type: 'acquaintance',
            description: `Met in a group chat.`,
            current_status: 'Recently met in a group chat.',
            emotional_impact: 'Still getting to know each other.',
            last_interaction_summary: `First spoke in a group chat conversation.`,
            history_summary: 'Met through a shared group chat.',
            user_respect_level: 50,
            friendship_level: 10,
            romantic_level: 0,
            attraction_level: 0,
            chosen_family_level: 0,
          });
          updated = true;
        }
      }

      if (updated) {
        await base44.asServiceRole.entities.Character.update(character.id, {
          fictional_relationships: existingRelationships,
        });
      }
    }

    return Response.json({ success: true, linked: characters.map(c => c.name) });
  } catch (error) {
    console.error('linkGroupChatCharacters error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});