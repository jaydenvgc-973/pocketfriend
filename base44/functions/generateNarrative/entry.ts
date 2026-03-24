import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterId, chatHistory } = await req.json();

    if (!characterId || !chatHistory) {
      return Response.json({ error: 'characterId and chatHistory are required' }, { status: 400 });
    }

    const character = await base44.entities.Character.filter({ id: characterId });
    if (!character || character.length === 0) {
        return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    const characterName = character[0].name;

    const formattedChatHistory = chatHistory.map(m => `"${m.sender_type === "user" ? "User" : characterName}": "${m.content}"`).join("\n");

    const prompt = `Based on the following chat history between the User and ${characterName}, generate a concise and impactful narrative. This narrative should describe an event, an NPC action, a change in location, or an environmental detail that subtly advances the story or adds flavor to the current scene. It should feel like a game master or narrator setting the scene. The narrative should be no more than 3 sentences.

Chat History:
${formattedChatHistory}

Narrative:`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt: prompt,
      model: 'gemini_3_flash'
    });

    return Response.json({ success: true, narrative: response });

  } catch (error) {
    console.error('Error generating narrative:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});