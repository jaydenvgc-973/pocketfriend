import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * deleteCharacter (soft delete)
 * 
 * Soft-delete a character:
 * - Set status = soft_deleted
 * - Create CharacterDeletionAudit
 * - Do NOT remove messages, memories, or other history
 * - Hide from active character lists and initiation engine
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    const char = await base44.entities.Character.get(characterId);
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    // ─────────────────────────────────────────────────────────
    // DELETION CONSTRAINTS
    // ─────────────────────────────────────────────────────────
    if (char.character_type === 'npc_world_service' || char.is_world_service === true) {
      return Response.json({ error: 'World-service characters cannot be deleted. Vick Servicio is a permanent world operator.' }, { status: 403 });
    }
    if (char.is_protected) {
      return Response.json({ error: 'Cannot delete protected character' }, { status: 403 });
    }
    if (char.is_default) {
      return Response.json({ error: 'Cannot delete default character' }, { status: 403 });
    }
    // ─────────────────────────────────────────────────────────
    // SOFT DELETE
    // ─────────────────────────────────────────────────────────

    // 1. Set status to soft_deleted (clear active flag too so it stops appearing)
    await base44.entities.Character.update(characterId, {
      status: 'soft_deleted',
      is_active_character: false,
    });

    // 2. Create audit record
    await base44.entities.CharacterDeletionAudit.create({
      character_id: characterId,
      deletion_type: 'soft_delete',
    });

    return Response.json({
      success: true,
      character_id: characterId,
      character_name: char.name,
      message: `Character "${char.name}" soft-deleted. All history preserved for recovery.`,
    });
  } catch (error) {
    console.error('[deleteCharacter]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});