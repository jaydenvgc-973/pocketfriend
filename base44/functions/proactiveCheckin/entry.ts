import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Allow scheduled (no user) and admin triggers
  try {
    const user = await base44.auth.me();
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  } catch (_) {
    // Scheduled — no user token
  }

  const allCharacters = await base44.asServiceRole.entities.Character.list();
  const characters = allCharacters.filter(c => !c.status || c.status === 'active');

  const results = [];

  for (const character of characters) {
    try {
      // Find last conversation for this character
      const conversations = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [character.id] });
      
      let hoursSinceLastMessage = Infinity;
      if (conversations.length > 0) {
        // Sort by last_message_date descending
        const sorted = conversations
          .filter(c => c.last_message_date)
          .sort((a, b) => new Date(b.last_message_date) - new Date(a.last_message_date));

        if (sorted.length > 0) {
          const lastDate = new Date(sorted[0].last_message_date);
          hoursSinceLastMessage = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60);
        }
      }

      // Decide if this character should reach out
      const friendship = character.friendship_level ?? 75;
      const respect = character.user_respect_level ?? 50;
      const chosenFamily = character.chosen_family_level ?? 0;
      const emotionalState = character.emotional_state || 'calm';

      // Thresholds: closer = reaches out sooner
      const closeness = (friendship + respect + chosenFamily) / 3;
      let checkInAfterHours;
      if (closeness >= 70) checkInAfterHours = 24;       // very close: reaches out after 1 day
      else if (closeness >= 50) checkInAfterHours = 48;  // decent: after 2 days
      else if (closeness >= 30) checkInAfterHours = 72;  // distant: after 3 days
      else checkInAfterHours = 120;                       // low bond: after 5 days

      // Irritated/defensive characters wait longer to reach out
      if (['irritated', 'defensive', 'closed-off'].includes(emotionalState)) {
        checkInAfterHours *= 1.5;
      }

      if (hoursSinceLastMessage < checkInAfterHours) {
        results.push({ id: character.id, name: character.name, status: 'skipped', reason: `Only ${Math.round(hoursSinceLastMessage)}h elapsed, threshold is ${checkInAfterHours}h` });
        continue;
      }

      // Check if there's already an undelivered pending message
      const existing = await base44.asServiceRole.entities.PendingMessage.filter({ character_id: character.id, delivered: false });
      if (existing.length > 0) {
        results.push({ id: character.id, name: character.name, status: 'skipped', reason: 'Already has pending message' });
        continue;
      }

      const now = new Date();
      const timeOfDay = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
      const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
      const daysElapsed = Math.round(hoursSinceLastMessage / 24);

      const systemPrompt = character.system_prompt || '';

      const prompt = `${systemPrompt}

---
SITUATION: It is ${dayOfWeek} at ${timeOfDay}. You haven't talked to the user in about ${daysElapsed} day${daysElapsed !== 1 ? 's' : ''}. You are deciding to reach out to them first.

RELATIONSHIP CONTEXT:
- Friendship: ${friendship}/100
- Respect: ${respect}/100
- Chosen Family: ${chosenFamily}/100
- Your current mood: ${emotionalState}
- What's going on in your life right now: ${character.current_life_event || 'nothing major'}

Write ONE natural, unprompted message you'd actually send. 
Rules:
- Stay fully in character — no assistant language whatsoever
- Don't mention "checking in" explicitly unless it fits your personality
- Based on your mood and closeness, this could be casual, warm, blunt, or just sharing something that happened
- Could reference something in your current life, a thought you had, something you saw, or just wanting to reach out
- Short — 1 to 3 sentences max
- Real and unpolished, like an actual text
- If it feels natural to share a photo (something you saw, your fit, food), include [IMAGE: detailed description]
- ONLY output the message itself — no labels, no names, nothing else`;

      const messageText = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt });
      const cleanText = messageText.replace(/^[\w\s]+:\s*/i, '').trim();

      // Handle optional image
      let imageUrl = null;
      const imageMatch = cleanText.match(/\[IMAGE:\s*(.+?)\]/i);
      let finalText = cleanText;
      if (imageMatch) {
        const imagePrompt = imageMatch[1];
        finalText = cleanText.replace(imageMatch[0], '').trim();
        const refImages = character.reference_image_urls?.length
          ? character.reference_image_urls
          : character.avatar_url ? [character.avatar_url] : null;
        const lockedPrompt = refImages
          ? `MATCH THE EXACT APPEARANCE of the person in the reference photo(s). ${imagePrompt}`
          : imagePrompt;
        const imgResult = refImages
          ? await base44.asServiceRole.integrations.Core.GenerateImage({ prompt: lockedPrompt, existing_image_urls: refImages })
          : await base44.asServiceRole.integrations.Core.GenerateImage({ prompt: lockedPrompt });
        imageUrl = imgResult.url;
      }

      await base44.asServiceRole.entities.PendingMessage.create({
        character_id: character.id,
        content: finalText,
        image_url: imageUrl || undefined,
        emotional_state: emotionalState,
        delivered: false,
      });

      results.push({ id: character.id, name: character.name, status: 'message_queued' });
    } catch (err) {
      results.push({ id: character.id, name: character.name, status: 'error', error: err.message });
    }
  }

  return Response.json({ results });
});