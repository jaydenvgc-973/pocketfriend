import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all characters for this user
    const characters = await base44.entities.Character.filter({
      owner_email: user.email
    });

    const updated = [];
    const skipped = [];

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const force = body.force === true;

    for (const char of characters) {
      // Skip if profile_summary already exists (unless force mode)
      if (char.profile_summary && !force) {
        skipped.push(char.id);
        continue;
      }

      // Build comprehensive context for LLM synthesis
      const contextParts = [];

      if (char.backstory) contextParts.push(`Backstory: ${char.backstory}`);
      if (char.background_story) contextParts.push(`Background: ${char.background_story}`);
      if (char.current_situation) contextParts.push(`Current Situation: ${char.current_situation}`);
      if (char.personality_summary) contextParts.push(`Personality: ${char.personality_summary}`);
      if (char.archetype) contextParts.push(`Archetype: ${char.archetype}`);
      if (char.occupation) contextParts.push(`Occupation: ${char.occupation}`);
      if (char.education) contextParts.push(`Education: ${char.education}`);
      
      // Add relationship context if available
      const relationshipCount = (char.fictional_relationships || []).length;
      if (relationshipCount > 0) {
        contextParts.push(`Number of significant relationships: ${relationshipCount}`);
      }

      // Add emotional/experiential context
      if (char.emotional_baggage) contextParts.push(`Emotional Context: ${char.emotional_baggage}`);
      if (char.emotional_triggers_high?.length > 0) {
        contextParts.push(`High Emotional Triggers: ${char.emotional_triggers_high.join(', ')}`);
      }

      // Add life experience summary
      const memoriesCount = (char.memories || []).length;
      if (memoriesCount > 0) {
        contextParts.push(`Life Experiences Recorded: ${memoriesCount} significant memories/events`);
      }

      const contextStr = contextParts.join('\n');

      // Construct sophisticated prompt for LLM
      const prompt = `You are tasked with synthesizing a character's profile summary based on their life journey, archetype, personality, and experiences.

CHARACTER DATA:
${contextStr}

CHARACTER NAME: ${char.name}
CHARACTER AGE: ${char.age || 'Unknown'}

CRITICAL INSTRUCTIONS:
1. Synthesize a profile summary that reflects this character's AUTHENTIC GROWTH and EVOLUTION based on their experiences.
2. Growth can be positive (development, learning, becoming wiser) or negative (trauma, hardening, becoming more guarded). Reflect BOTH types accurately.
3. Consider the character's archetype and personality - some experiences will impact them differently based on WHO THEY ARE.
4. The summary should show HOW their experiences have CHANGED them, not just WHO they are.
5. Use natural, human-like punctuation. Avoid excessive em-dashes (—) used as dramatic pauses.
6. Generate exactly 3-5 sentences. No more, no less (unless you must expand slightly for accuracy).
7. Write in third person, present tense where appropriate.

GENERATE ONLY THE PROFILE SUMMARY TEXT. DO NOT INCLUDE ANY PREAMBLE OR EXPLANATION.`;

      // Call LLM to synthesize the summary
      const llmResponse = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: false
      });

      let summary = llmResponse;
      
      // Ensure summary is properly formatted
      if (typeof summary === 'string') {
        summary = summary.trim();
      } else if (typeof summary === 'object' && summary.text) {
        summary = summary.text.trim();
      }

      // Verify we have a reasonable summary
      if (!summary || summary.length < 20) {
        // Fallback if LLM failed to generate
        const age = char.age ? ` ${char.age} years old` : '';
        const location = char.city ? ` from ${char.city}` : '';
        summary = `${char.name}${age}${location}.`;
      }

      // Update character with the synthesized summary
      await base44.entities.Character.update(char.id, {
        profile_summary: summary
      });

      updated.push({
        id: char.id,
        name: char.name,
        source: 'llm_synthesis'
      });
    }

    return Response.json({
      success: true,
      updated: updated.length,
      skipped: skipped.length,
      details: {
        updated,
        skipped_count: skipped.length
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});