import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const characterNames = body.characterNames || ['Ethan Nathan Thompson'];

    // Get correct world name
    const settingsList = await base44.entities.UserSettings.filter({ created_by: user.email });
    const settings = settingsList[0];
    const correctWorldName = settings?.fictional_world_name || 'Jayden';

    // Get all characters owned by this user
    const allCharacters = await base44.entities.Character.filter({ created_by: user.email });
    
    const cleared = [];
    const notFound = [];

    for (const charName of characterNames) {
      const targetChar = allCharacters.find(c => c.name === charName);
      
      if (!targetChar) {
        notFound.push(charName);
        continue;
      }

      // CRITICAL FIX: Clear the system_prompt to force rebuild on next chat
      // This ensures the character will rebuild with the CORRECT user identity
      await base44.entities.Character.update(targetChar.id, {
        system_prompt: null
      });

      cleared.push(charName);
    }

    return Response.json({
      success: true,
      message: `Cleared system prompts for ${cleared.length} character(s). They will rebuild with correct identity "${correctWorldName}" on next interaction.`,
      userEmail: user.email,
      correctWorldName,
      cleared,
      notFound,
      action: 'CRITICAL FIX APPLIED: Next chat will rebuild system prompts with CORRECT user identity. All character memory contamination will be recontextualized properly.'
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});