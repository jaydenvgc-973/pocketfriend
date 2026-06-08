/**
 * fetchCharactersByIds
 *
 * Service-role fetch of Character records by a list of IDs.
 * Used by characterContactsResolver to recover contact records that are
 * invisible to the user-scoped RLS query (e.g. null owner_email legacy records,
 * cross-account shared NPCs, or world-service characters).
 *
 * This is a CONTACT GRAPH resolver, NOT an NPC-only route.
 * It fetches any valid character type by ID — active_created_character,
 * npc_regular, npc_fictitious, npc_family_member, npc_world_service, etc.
 *
 * Security:
 * - Requires authenticated session.
 * - Returns ONLY records whose ID was explicitly requested (no bulk scan).
 * - Excludes deleted/soft_deleted records.
 * - Does NOT filter by character_type — all types are valid contacts.
 * - Does NOT write anything — read-only.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids.filter(id => typeof id === 'string' && id.length > 0) : [];

    if (ids.length === 0) {
      return Response.json({ characters: [] });
    }

    // Cap to prevent abuse — contact graphs are typically small
    const MAX_IDS = 100;
    const safeIds = ids.slice(0, MAX_IDS);

    // Fetch each requested ID via service role — bypasses owner_email RLS
    // so null-owner legacy records and shared NPCs are visible
    const results = await Promise.all(
      safeIds.map(id =>
        base44.asServiceRole.entities.Character.filter({ id }).catch(() => [])
      )
    );

    const characters = results
      .flat()
      .filter(c =>
        c &&
        c.status !== 'deleted' &&
        c.status !== 'soft_deleted' &&
        c.status !== 'merged'
      );

    console.log(`[fetchCharactersByIds] user=${user.email} | requested=${safeIds.length} | found=${characters.length}`);

    return Response.json({ characters });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});