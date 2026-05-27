import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const force = body.force === true;
    // Optionally target a single character by ID
    const targetCharacterId = body.character_id || null;

    // Fetch characters for this user
    const allCharacters = await base44.entities.Character.filter({ owner_email: user.email });

    const characters = targetCharacterId
      ? allCharacters.filter(c => c.id === targetCharacterId)
      : allCharacters;

    const updated = [];
    const skipped = [];
    const errors = [];

    for (const char of characters) {
      // Skip if profile_summary already exists and not forcing
      if (char.profile_summary && !force) {
        skipped.push({ id: char.id, name: char.name });
        continue;
      }

      // Build context for the LLM — DO NOT copy these fields directly into profile_summary
      // These are INPUT CONTEXT ONLY. backstory and background_story are sacred and untouched.
      const contextParts = [];

      if (char.name) contextParts.push(`Name: ${char.name}`);
      if (char.age || char.age_range) contextParts.push(`Age: ${char.age || char.age_range}`);
      if (char.gender) contextParts.push(`Gender: ${char.gender}`);
      if (char.ethnicities?.length) contextParts.push(`Ethnicity: ${char.ethnicities.join(', ')}`);
      if (char.city || char.state) contextParts.push(`Location: ${[char.city, char.state].filter(Boolean).join(', ')}`);
      if (char.occupation) contextParts.push(`Occupation: ${char.occupation}`);
      if (char.education) contextParts.push(`Education: ${char.education}`);
      if (char.archetype) contextParts.push(`Archetype: ${char.archetype}`);
      if (char.personality_summary) contextParts.push(`Personality: ${char.personality_summary}`);
      if (char.current_situation) contextParts.push(`Current situation: ${char.current_situation}`);
      if (char.emotional_baggage) contextParts.push(`Emotional baggage: ${char.emotional_baggage}`);
      if (char.communication_style) contextParts.push(`Communication style: ${char.communication_style}`);

      // Use backstory and background_story as INPUT CONTEXT ONLY — never copy them verbatim
      if (char.backstory) contextParts.push(`Backstory context: ${char.backstory}`);
      if (char.background_story) contextParts.push(`Background context: ${char.background_story}`);

      // Include top personality traits if present
      const activeTraits = [];
      const traitKeys = [
        'trait_loyal', 'trait_blunt', 'trait_compassionate', 'trait_dry_humor',
        'trait_competitive', 'trait_stubborn', 'trait_empathetic', 'trait_leader',
        'trait_risk_taker', 'trait_flirty', 'trait_cynical', 'trait_generous',
        'trait_oversharer', 'trait_night_owl', 'trait_volatile', 'trait_toxic'
      ];
      traitKeys.forEach(k => { if (char[k]) activeTraits.push(k.replace('trait_', '').replace(/_/g, ' ')); });
      if (activeTraits.length) contextParts.push(`Key traits: ${activeTraits.join(', ')}`);

      if (char.personality_traits?.length) {
        contextParts.push(`Vibe tags: ${char.personality_traits.join(', ')}`);
      }

      if (contextParts.length === 0) {
        skipped.push({ id: char.id, name: char.name, reason: 'no context available' });
        continue;
      }

      const contextBlock = contextParts.join('\n');

      const prompt = `You are writing a concise character profile summary for a fictional character in a life simulation app.

Using only the information provided below, write a 3 to 5 sentence character summary that captures who this person is — their personality, what drives them, where they are in life right now, and what makes them distinct. 

STRICT RULES:
- Do NOT copy the backstory or background verbatim. Use them as context to inform the summary, but write something fresh.
- Do NOT mention image generation, photography prompts, cinematic descriptions, or anything visual/technical.
- Do NOT use em-dashes (—) as dramatic pauses.
- Write in third person, present tense.
- Keep it grounded, human, and personal. No flowery AI language.
- Output ONLY the summary text. No labels, no headers, no quotes around it.

CHARACTER INFORMATION:
${contextBlock}`;

      try {
        const result = await base44.integrations.Core.InvokeLLM({ prompt });

        const summary = (typeof result === 'string' ? result : result?.response || '')
          .trim()
          .replace(/^["']|["']$/g, '') // strip surrounding quotes if any
          .replace(/\s*—\s*/g, '. ')   // replace em-dashes
          .replace(/\s+/g, ' ')
          .trim();

        if (!summary) {
          errors.push({ id: char.id, name: char.name, reason: 'LLM returned empty response' });
          continue;
        }

        // ONLY write to profile_summary — backstory and background_story are never touched
        await base44.entities.Character.update(char.id, {
          profile_summary: summary
        });

        updated.push({ id: char.id, name: char.name });
      } catch (llmErr) {
        errors.push({ id: char.id, name: char.name, reason: llmErr.message });
      }
    }

    return Response.json({
      success: true,
      updated: updated.length,
      skipped: skipped.length,
      errors: errors.length,
      details: { updated, skipped, errors }
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});