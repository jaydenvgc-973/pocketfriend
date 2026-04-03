import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * enumerateAllCharacters
 * 
 * Returns all characters (active, created, default) indexed by NAME not ID.
 * Character identification should always use names, never IDs for user-facing operations.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch all characters
    const allChars = await base44.asServiceRole.entities.Character.filter({
      created_by: user.email
    });

    // Classify characters
    const activeCharacters = [];
    const inactiveCharacters = [];
    const deletedCharacters = [];

    const charsByName = {};

    for (const char of allChars) {
      const classification = {
        id: char.id,
        name: char.name,
        type: char.character_type,
        status: char.status,
        isActive: char.status === 'active',
        isCreated: char.character_type === 'user_created',
        isDefault: char.character_type === 'default',
      };

      charsByName[char.name] = classification;

      if (char.status === 'active') {
        activeCharacters.push(classification);
      } else if (char.status === 'deleted' || char.status === 'soft_deleted') {
        deletedCharacters.push(classification);
      } else {
        inactiveCharacters.push(classification);
      }
    }

    return Response.json({
      success: true,
      total: allChars.length,
      active: activeCharacters.length,
      inactive: inactiveCharacters.length,
      deleted: deletedCharacters.length,
      characters: {
        byName: charsByName,
        active: activeCharacters,
        inactive: inactiveCharacters,
        deleted: deletedCharacters,
      },
      message: `Enumerated ${allChars.length} characters. Use character names, not IDs, for all user-facing operations.`,
    });
  } catch (error) {
    console.error('[enumerateAllCharacters]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});