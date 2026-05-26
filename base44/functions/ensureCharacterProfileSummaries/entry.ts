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
    const specificCharacterId = body.character_id || null;

    // Fetch characters for this user
    const allCharacters = await base44.entities.Character.filter({
      owner_email: user.email
    });

    const characters = specificCharacterId
      ? allCharacters.filter(c => c.id === specificCharacterId)
      : allCharacters;

    const updated = [];
    const skipped = [];
    const errors = [];

    for (const char of characters) {
      // Skip if profile_summary already exists and force is not set
      if (char.profile_summary && !force) {
        skipped.push({ id: char.id, name: char.name });
        continue;
      }

      // Gather all available context for this character
      // to synthesize a meaningful, growth-reflecting profile_summary
      const contextParts = [];

      if (char.name) contextParts.push(`Name: ${char.name}`);
      if (char.age) contextParts.push(`Age: ${char.age}`);
      if (char.gender) contextParts.push(`Gender: ${char.gender}`);
      if (char.occupation) contextParts.push(`Occupation: ${char.occupation}`);
      if (char.education) contextParts.push(`Education: ${char.education}`);
      if (char.city || char.state) contextParts.push(`Location: ${[char.city, char.state].filter(Boolean).join(', ')}`);
      if (char.archetype) contextParts.push(`Archetype: ${char.archetype}`);
      if (char.sexual_orientation) contextParts.push(`Sexual orientation: ${char.sexual_orientation}`);
      if (char.religion && char.religion !== 'None') contextParts.push(`Religion: ${char.religion}`);

      // Core narrative fields
      if (char.backstory) contextParts.push(`\nBackstory: ${char.backstory}`);
      if (char.background_story) contextParts.push(`\nBackground: ${char.background_story}`);
      if (char.personality_summary) contextParts.push(`\nPersonality: ${char.personality_summary}`);
      if (char.current_situation) contextParts.push(`\nCurrent situation: ${char.current_situation}`);
      if (char.emotional_baggage) contextParts.push(`\nEmotional baggage: ${char.emotional_baggage}`);
      if (char.upset_reaction) contextParts.push(`\nHow they react when upset: ${char.upset_reaction}`);
      if (char.communication_style) contextParts.push(`\nCommunication style: ${char.communication_style}`);
      if (char.criminal_record) contextParts.push(`\nCriminal record: ${char.criminal_record}`);
      if (char.health_status) contextParts.push(`\nHealth status: ${char.health_status}`);
      if (char.family_history) contextParts.push(`\nFamily history: ${char.family_history}`);

      // Personality traits
      if (char.personality_traits && char.personality_traits.length > 0) {
        contextParts.push(`\nPersonality traits: ${char.personality_traits.join(', ')}`);
      }

      // Memories / experiences — key to understanding growth
      if (char.memories && char.memories.length > 0) {
        const memSummaries = char.memories.map(m => {
          const parts = [m.title];
          if (m.description) parts.push(m.description);
          if (m.emotional_impact) parts.push(`(Impact: ${m.emotional_impact})`);
          if (m.lesson_learned) parts.push(`(Lesson: ${m.lesson_learned})`);
          if (m.category) parts.push(`[${m.category}]`);
          return parts.join(' ');
        }).join('\n- ');
        contextParts.push(`\nKey life experiences and memories:\n- ${memSummaries}`);
      }

      // Life events
      if (char.current_life_event) {
        contextParts.push(`\nCurrent life event: ${char.current_life_event}`);
      }

      // Future goals
      if (char.future_life_goals && char.future_life_goals.length > 0) {
        const goals = char.future_life_goals.map(g => g.goal || g.description || JSON.stringify(g)).join(', ');
        contextParts.push(`\nFuture goals: ${goals}`);
      }

      // Education enrollments / completed
      if (char.education_enrollments && char.education_enrollments.length > 0) {
        const enrollments = char.education_enrollments.map(e =>
          `${e.program || e.course || e.institution || 'Unknown program'} (${e.status || 'enrolled'})`
        ).join(', ');
        contextParts.push(`\nCurrent education: ${enrollments}`);
      }
      if (char.completed_education && char.completed_education.length > 0) {
        const completedEd = char.completed_education.map(e =>
          `${e.program || e.course || e.institution || 'Unknown'} (completed)`
        ).join(', ');
        contextParts.push(`\nCompleted education: ${completedEd}`);
      }
      if (char.completed_job_training && char.completed_job_training.length > 0) {
        const completedTraining = char.completed_job_training.map(e =>
          `${e.program || e.course || e.institution || 'Unknown'} (completed training)`
        ).join(', ');
        contextParts.push(`\nCompleted job training: ${completedTraining}`);
      }

      // Emotional triggers
      if (char.emotional_triggers_high && char.emotional_triggers_high.length > 0) {
        contextParts.push(`\nHigh emotional triggers: ${char.emotional_triggers_high.join(', ')}`);
      }
      if (char.emotional_triggers_deep && char.emotional_triggers_deep.length > 0) {
        contextParts.push(`\nDeep emotional triggers: ${char.emotional_triggers_deep.join(', ')}`);
      }

      // Relationships context
      if (char.fictional_relationships && char.fictional_relationships.length > 0) {
        const relSummary = char.fictional_relationships.slice(0, 8).map(r =>
          `${r.person_name} (${r.relationship_type}${r.current_status ? ': ' + r.current_status : ''})`
        ).join(', ');
        contextParts.push(`\nKey relationships: ${relSummary}`);
      }

      // Quirks
      if (char.quirks && char.quirks.length > 0) {
        const quirkList = char.quirks.map(q => q.label || q.name || q.description || JSON.stringify(q)).join(', ');
        contextParts.push(`\nQuirks: ${quirkList}`);
      }

      // Triggered milestones
      if (char.triggered_milestones && char.triggered_milestones.length > 0) {
        contextParts.push(`\nLife milestones reached: ${char.triggered_milestones.join(', ')}`);
      }

      // Daily micro narration (most recent slice of life)
      if (char.daily_micro_narration) {
        contextParts.push(`\nRecent daily narration: ${char.daily_micro_narration}`);
      }

      // Emotional state
      if (char.emotional_state) {
        contextParts.push(`\nCurrent emotional state: ${char.emotional_state}`);
      }

      // Student status
      if (char.student_status && char.student_status !== 'not_student') {
        contextParts.push(`\nStudent status: ${char.student_status}`);
      }

      // Build the LLM prompt
      const prompt = `You are writing a dynamic, living character profile summary for a fictional character in an immersive life-simulation app.

CHARACTER DATA:
${contextParts.join('\n')}

INSTRUCTIONS:
Write a profile summary of EXACTLY 3-5 sentences that appears directly below the character's name on their profile page.

This summary must:
1. Reflect WHO THIS CHARACTER IS RIGHT NOW — their current state, not just their origins
2. Capture the SPECIFIC IMPACT of their life experiences — how their journey has actually shaped them (positively, negatively, or in complex ways depending on what they've been through)
3. Reflect their INDIVIDUAL personality, archetype, and outlook — each character is unique; a character who has been through trauma should feel different from one who has grown positively
4. Feel AUTHENTIC and HUMAN — not generic, not a template, not an AI-generated list
5. Show where they ARE NOW in their journey and hint at their trajectory or current struggles/aspirations
6. Use natural punctuation — NO em-dashes (—) as dramatic pauses, no excessive ellipses

DO NOT:
- Copy or paraphrase the backstory or background_story verbatim
- Simply list traits or facts
- Write in a generic "character bio" template style
- Use em-dashes (—) for dramatic effect
- Make everyone sound positive — if someone has been through trauma, darkness, or setbacks, let that show authentically
- Start with the character's name

Return ONLY the profile summary paragraph. No labels, no headers, no extra text.`;

      try {
        const result = await base44.integrations.Core.InvokeLLM({
          prompt,
          response_json_schema: null
        });

        let summary = typeof result === 'string' ? result.trim() : (result?.response || result?.text || '').trim();

        // Safety: strip any accidental em-dashes that slipped through
        summary = summary.replace(/\s*—\s*/g, '. ').replace(/\s+/g, ' ').trim();

        // Enforce max sentence count (keep up to 5 sentences)
        const sentences = summary.match(/[^.!?]+[.!?]+/g) || [];
        if (sentences.length > 5) {
          summary = sentences.slice(0, 5).join('').trim();
        }

        if (!summary) {
          errors.push({ id: char.id, name: char.name, error: 'LLM returned empty summary' });
          continue;
        }

        // CRITICAL: Only update profile_summary. Never touch backstory, background_story, or any other field.
        await base44.entities.Character.update(char.id, {
          profile_summary: summary
        });

        updated.push({ id: char.id, name: char.name });
      } catch (llmError) {
        errors.push({ id: char.id, name: char.name, error: llmError.message });
      }
    }

    return Response.json({
      success: true,
      updated: updated.length,
      skipped: skipped.length,
      errors: errors.length,
      details: {
        updated,
        skipped,
        errors
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});