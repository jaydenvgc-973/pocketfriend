/**
 * getCharacterById — Service-role character lookup by ID.
 * Used by the chat page as a fallback when user-scoped RLS blocks the read
 * (e.g., for NPC characters created via service account with owner_email set correctly).
 * Verifies ownership via owner_email before returning.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    // Use service role to bypass RLS and locate the character
    const chars = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1);
    const character = chars?.[0] || null;

    if (!character) {
      return Response.json({ character: null, error: 'Character not found' }, { status: 404 });
    }

    // Ownership check: only return if this character belongs to the requesting user
    const ownerEmail = character.owner_email;
    if (!ownerEmail || ownerEmail !== user.email) {
      console.warn(`[getCharacterById] Ownership mismatch: character owner_email="${ownerEmail}" | requesting user="${user.email}"`);
      return Response.json({ character: null, error: 'Access denied: character does not belong to this account' }, { status: 403 });
    }

    return Response.json({ character });
  } catch (error) {
    console.error('[getCharacterById] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});