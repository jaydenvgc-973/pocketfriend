import { createClientFromRequest } from 'npm:@base44/sdk@0.8.59';

/**
 * fetchSharedResidencyCandidates
 *
 * Cross-account people available to a GATEWAY HOUSE resident when the user edits
 * that character's relationships. Characters living at Gateway House may have
 * family on another user's account, so the relationship selector must be able to
 * show and reference those characters — by their real record id, never a copy.
 *
 * Eligibility is decided by residence: the source character's home must be the
 * shared residency property (canonical_location_key = gateway_house). Everywhere
 * else, cross-account selection stays closed.
 *
 * Returns a sanitized projection only (id, name, type, avatar, resident flag —
 * never the other account's profile, memories, needs, finances or private fields).
 */
const GATEWAY_HOUSE_KEY = 'gateway_house';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { source_character_id, search = '' } = await req.json().catch(() => ({}));
    if (!source_character_id) {
      return Response.json({ eligible: false, reason: 'missing_source_character', people: [] }, { status: 400 });
    }

    // The relationship is added to the caller's own character only.
    const sourceChars = await base44.entities.Character.filter({ id: source_character_id }, null, 1).catch(() => []);
    const source = sourceChars[0];
    if (!source || source.owner_email !== user.email) {
      return Response.json({ eligible: false, reason: 'source_character_not_yours', people: [] });
    }

    // Residence authority: the character's home location.
    const homeIds = [source.current_home_location_id, source.resolved_current_location_id].filter(Boolean);
    if (homeIds.length === 0) {
      return Response.json({ eligible: false, reason: 'no_home_location', people: [] });
    }
    const homes = await base44.asServiceRole.entities.LocationReference
      .filter({ id: { $in: homeIds } }, null, 5)
      .catch(() => []);
    const home = homes.find((h) => h.canonical_location_key === GATEWAY_HOUSE_KEY) || null;
    if (!home) {
      return Response.json({ eligible: false, reason: 'not_a_shared_residency_resident', people: [] });
    }

    const residentIds = new Set(home.resident_character_ids || []);
    const q = String(search || '').trim().toLowerCase();

    // Cross-account candidates. Legacy records may carry no status field — they
    // stay visible (missing newer fields never means removed).
    const all = await base44.asServiceRole.entities.Character
      .list('-created_date', 500)
      .catch(() => []);

    const people = all
      .filter((c) => {
        if (!c?.id || c.id === source.id) return false;
        if (c.owner_email === user.email) return false;                 // own characters are already listed in the panel
        if (['merged', 'deleted', 'soft_deleted', 'moved_away'].includes(c.status)) return false;
        if (c.is_test_character === true || c.diagnostic_only === true || c.test_character === true) return false;
        if (q && !String(c.name || '').toLowerCase().includes(q)) return false;
        return true;
      })
      .map((c) => ({
        id: c.id,
        name: c.name,
        character_type: c.character_type || null,
        avatar_url: c.avatar_url || c.image_avatar_url || null,
        is_resident: residentIds.has(c.id) || c.current_home_location_id === home.id,
      }))
      .sort((a, b) => {
        if (a.is_resident !== b.is_resident) return a.is_resident ? -1 : 1;
        return String(a.name || '').localeCompare(String(b.name || ''));
      })
      .slice(0, 80);

    return Response.json({
      eligible: true,
      location_id: home.id,
      location_name: home.name,
      people,
    });
  } catch (error) {
    console.error('[fetchSharedResidencyCandidates]', error.message);
    return Response.json({ eligible: false, reason: error.message, people: [] }, { status: 500 });
  }
});