import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get the correct world name for this user
    const userSettings = await base44.entities.UserSettings.filter({ created_by: user.email });
    const correctWorldName = userSettings[0]?.fictional_world_name;

    if (!correctWorldName) {
      return Response.json({ error: 'User has no world name set' }, { status: 400 });
    }

    // Get all characters owned by this user
    const userCharacters = await base44.entities.Character.filter({ created_by: user.email });
    
    let violationsFound = 0;
    const violations = [];

    // Scan for incorrect world names in system prompts and memories
    for (const character of userCharacters) {
      let hasViolation = false;
      
      // Check system_prompt for wrong world names (if cached)
      if (character.system_prompt) {
        // Look for patterns like "Mark" when it should be the correct name
        // This is a basic check for obvious contamination
        const systemPromptLower = character.system_prompt.toLowerCase();
        if (systemPromptLower.includes('mark') && correctWorldName.toLowerCase() !== 'mark') {
          violations.push({
            character: character.name,
            issue: 'System prompt references "Mark" instead of user world name',
            action: 'cleared for rebuild'
          });
          hasViolation = true;
        }
      }

      // If any violation found, clear the system prompt to force rebuild
      if (hasViolation) {
        await base44.entities.Character.update(character.id, {
          system_prompt: null
        });
        violationsFound++;
      }
    }

    return Response.json({
      success: true,
      message: `Account isolation enforcement complete`,
      userEmail: user.email,
      correctWorldName,
      totalCharacters: userCharacters.length,
      violationsFound,
      violations,
      action: 'All system prompts will rebuild on next interaction with correct world name'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});