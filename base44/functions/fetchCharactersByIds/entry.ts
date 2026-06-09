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
 * Security model — CONTACT GRAPH VERIFICATION:
 * - Requires authenticated session.
 * - Requested IDs are cross-checked against the calling user's actual contact
 *   graph (fictional_relationships, family_members, people_in_world across ALL
 *   owned characters). IDs not in the contact graph are silently excluded —
 *   arbitrary ID fishing is not possible.
 * - Excludes deleted/soft_deleted/merged records.
 * - Does NOT filter by character_type — all contact types are valid.
 * - Does NOT write anything — read-only.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const requestedIds = Array.isArray(body.ids)
      ? body.ids.filter(id => typeof id === 'string' && id.length > 0)
      : [];

    if (requestedIds.length === 0) {
      return Response.json({ characters: [] });
    }

    // ── STEP 1: Build the caller's verified contact graph ─────────────────────
    // Load all characters owned by this account to extract every valid contact ID.
    // This is the authorization gate — only IDs actually present in the user's
    // contact graph are eligible for service-role fetch.
    const ownedChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email },
      null, 500
    );

    const verifiedContactIds = new Set();
    for (const c of ownedChars) {
      for (const rel of (c.fictional_relationships || [])) {
        if (rel.related_character_id) verifiedContactIds.add(rel.related_character_id);
      }
      for (const fm of (c.family_members || [])) {
        const id = fm.character_id || fm.related_character_id;
        if (id) verifiedContactIds.add(id);
      }
      for (const p of (c.people_in_world || c.known_people || [])) {
        const id = p.related_character_id || p.character_id;
        if (id) verifiedContactIds.add(id);
      }
    }

    // ── STEP 2: Filter to only IDs present in the verified contact graph ───────
    const allowedIds = requestedIds.filter(id => verifiedContactIds.has(id));

    if (allowedIds.length === 0) {
      console.log(`[fetchCharactersByIds] user=${user.email} | requested=${requestedIds.length} | allowed=0 (none in contact graph)`);
      return Response.json({ characters: [] });
    }

    const safeIds = allowedIds.slice(0, 100); // cap to prevent abuse

    // ── STEP 3: Fetch verified IDs via service role ────────────────────────────
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

    console.log(`[fetchCharactersByIds] user=${user.email} | requested=${requestedIds.length} | allowed=${allowedIds.length} | found=${characters.length}`);

    return Response.json({ characters });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});