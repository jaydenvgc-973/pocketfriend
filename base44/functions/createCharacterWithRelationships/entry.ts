import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { characterData, characterRelationships } = await req.json();

    // Stamp ownership fields so this character is isolated to the creating user's account
    const { system_prompt_url, ...charDataWithoutPrompt } = characterData;

    const newChar = await base44.entities.Character.create({
      ...charDataWithoutPrompt,
      system_prompt_url: system_prompt_url || undefined,
      owner_user_id: user.id,
      owner_email: user.email,
      created_by_role: user.role || 'user',
      visibility_scope: charDataWithoutPrompt.visibility_scope || 'account_private',
    });

    // Handle bidirectional relationships
    if (characterRelationships && characterRelationships.length > 0) {
      for (const rel of characterRelationships) {
        const relatedChar = await base44.entities.Character.filter({ id: rel.related_character_id });
        if (relatedChar[0]) {
          const existingRels = relatedChar[0].fictional_relationships || [];
          const filtered = existingRels.filter(r => r.person_name !== rel.person_name);
          const reciprocal = {
            ...rel,
            person_name: newChar.name,
            related_character_id: newChar.id,
            description: `${newChar.name} is a ${rel.relationship_type} of ${relatedChar[0].name}.`,
          };
          filtered.push(reciprocal);
          await base44.entities.Character.update(relatedChar[0].id, {
            fictional_relationships: filtered,
          });
        }
      }
    }

    return Response.json({
      success: true,
      character: newChar,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});