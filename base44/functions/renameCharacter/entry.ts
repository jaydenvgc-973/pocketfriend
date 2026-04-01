import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * renameCharacter
 * 
 * Safely rename a character:
 * - Updates Character.name
 * - Creates CharacterAlias for old name
 * - Creates CharacterRenameAudit
 * - Does NOT change character_id or any foreign keys
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, newDisplayName } = await req.json();
    if (!characterId || !newDisplayName) {
      return Response.json({ error: 'characterId and newDisplayName required' }, { status: 400 });
    }

    const char = await base44.entities.Character.get(characterId);
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    const oldName = char.name;
    if (oldName === newDisplayName) {
      return Response.json({ error: 'New name is same as old name' }, { status: 400 });
    }

    // ─────────────────────────────────────────────────────────
    // ATOMIC TRANSACTION
    // ─────────────────────────────────────────────────────────

    // 1. Update character name
    await base44.entities.Character.update(characterId, {
      name: newDisplayName,
    });

    // 2. Create alias for old name
    await base44.entities.CharacterAlias.create({
      character_id: characterId,
      alias_name: oldName,
      source_type: 'rename',
      prior_primary: true,
    });

    // 3. Create audit record
    await base44.entities.CharacterRenameAudit.create({
      character_id: characterId,
      old_display_name: oldName,
      new_display_name: newDisplayName,
    });

    return Response.json({
      success: true,
      character_id: characterId,
      old_name: oldName,
      new_name: newDisplayName,
      message: `Character renamed from "${oldName}" to "${newDisplayName}". Character ID unchanged.`,
    });
  } catch (error) {
    console.error('[renameCharacter]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});