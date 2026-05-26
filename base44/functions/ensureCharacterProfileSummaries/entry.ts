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

    for (const char of characters) {
      // Skip if profile_summary already exists
      if (char.profile_summary) {
        skipped.push(char.id);
        continue;
      }

      // Derive profile_summary from available fields
      let summary = null;
      
      if (char.personality_summary) {
        summary = char.personality_summary;
      } else if (char.current_situation) {
        summary = char.current_situation;
      } else if (char.background_story) {
        summary = char.background_story;
      } else if (char.backstory) {
        summary = char.backstory;
      } else {
        // Fallback: create a basic summary from name and basic info
        const age = char.age ? ` ${char.age} years old` : '';
        const location = char.city ? ` from ${char.city}` : '';
        summary = `${char.name}${age}${location}.`;
      }

      // Update character with the derived summary
      await base44.entities.Character.update(char.id, {
        profile_summary: summary
      });

      updated.push({
        id: char.id,
        name: char.name,
        source: char.personality_summary
          ? 'personality_summary'
          : char.current_situation
          ? 'current_situation'
          : char.background_story
          ? 'background_story'
          : char.backstory
          ? 'backstory'
          : 'generated'
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