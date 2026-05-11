import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * createOwnedNpcCharacter — Backend function for safe NPC creation
 * 
 * Server-side character creation that:
 * - Authenticates the user
 * - Stamps owner_email from auth context (never from payload)
 * - Rejects active_created_character creation
 * - Uses service role to bypass RLS
 * - Returns the created character
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized: User not authenticated' }, { status: 401 });
    }

    const { name, characterType, linkedActiveCharacterId, relationshipType, familyTitle } = await req.json();

    // ── VALIDATION ──────────────────────────────────────────────────────────
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return Response.json({ error: 'Character name is required' }, { status: 400 });
    }

    const validNPCTypes = ['npc_fictitious', 'npc_family_member', 'npc_regular'];
    if (!characterType || !validNPCTypes.includes(characterType)) {
      return Response.json({
        error: `Character type must be one of: ${validNPCTypes.join(', ')}. Got: ${characterType}`
      }, { status: 400 });
    }

    // ── GUARD: Reject active_created_character ──────────────────────────────
    if (characterType === 'active_created_character') {
      return Response.json({
        error: 'Active Creative Characters must be created from the dedicated character creation page, not from this lightweight panel.'
      }, { status: 400 });
    }

    // ── BUILD SAFE PAYLOAD (server-side only) ───────────────────────────────
    // owner_email is ALWAYS set from authenticated user, never from request payload
    const charData = {
      name: name.trim(),
      character_type: characterType,
      owner_email: user.email,
      owner_user_id: user.id || null,
      created_by_role: user.role || 'user',
      status: 'active',
      exclude_from_homepage: true,
    };

    console.log('[createOwnedNpcCharacter] Creating NPC:', JSON.stringify({
      name: charData.name,
      character_type: charData.character_type,
      owner_email: charData.owner_email,
      owner_user_id_present: !!charData.owner_user_id,
      linkedActiveCharacterId: linkedActiveCharacterId || null,
      relationshipType: relationshipType || null,
      familyTitle: familyTitle || null,
    }));

    // ── CREATE via service role (bypasses RLS) ──────────────────────────────
    const newNPC = await base44.asServiceRole.entities.Character.create(charData);

    return Response.json({
      success: true,
      character: newNPC,
      linkedActiveCharacterId,
      relationshipType,
      familyTitle,
    });
  } catch (error) {
    console.error('[createOwnedNpcCharacter] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});