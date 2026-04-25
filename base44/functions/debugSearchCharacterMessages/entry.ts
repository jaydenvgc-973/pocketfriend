import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterNames = ['Brian', 'Ethan', 'Andre'], keywords = ['Central Park', 'bar', 'Mace'] } = await req.json();

    // Fetch all characters and messages
    const characters = await base44.entities.Character.filter({ created_by: user.email });
    const messages = await base44.entities.Message.filter({ created_by: user.email }, '-created_date', 500);

    const results = {};

    // For each character name, find their messages mentioning keywords
    for (const charName of characterNames) {
      const char = characters.find(c => c.name?.toLowerCase().includes(charName.toLowerCase()));
      if (!char) {
        results[charName] = { found: false, message: 'Character not found' };
        continue;
      }

      const charMessages = messages.filter(m => m.character_id === char.id);
      const relevantMessages = [];

      for (const msg of charMessages) {
        const content = msg.content || '';
        const matchedKeywords = keywords.filter(kw => 
          typeof content === 'string' && content.toLowerCase().includes(kw.toLowerCase())
        );
        if (matchedKeywords.length > 0) {
          relevantMessages.push({
            timestamp: msg.timestamp,
            content: content.substring(0, 150),
            matched: matchedKeywords
          });
        }
      }

      results[charName] = {
        found: true,
        characterId: char.id,
        totalMessages: charMessages.length,
        relevantMessages,
        latestLocation: char.resolved_current_location_name,
        locationStatus: char.location_status
      };
    }

    return Response.json({ results, totalMessagesChecked: messages.length });
  } catch (error) {
    console.error('[debugSearchCharacterMessages]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});