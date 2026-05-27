/**
 * syncWorshipMemberships
 *
 * Backfill: for every character owned by the authenticated user,
 * scan ALL LocationReference records with category='religion' and check if the character
 * appears in religious_members[] or worker_character_ids[].
 *
 * If found but Character.religious_location_id is not set, write it.
 * This repairs the "No church linked" display for characters already listed at a worship location.
 *
 * Safe: only writes if the character field is missing or empty.
 * Never removes existing links.
 * Can be run for a specific character_id or for all characters on the account.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { character_id: targetCharId, dry_run = false } = body;

    // 1. Load characters to check
    let characters;
    if (targetCharId) {
      characters = await base44.entities.Character.filter({ id: targetCharId, owner_email: user.email });
    } else {
      characters = await base44.entities.Character.filter({ owner_email: user.email, status: 'active' });
    }
    if (!characters.length) return Response.json({ success: true, synced: 0, message: 'No characters found' });

    // 2. Load all religion-category locations visible to this user
    const worshipLocs = await base44.asServiceRole.entities.LocationReference.filter({ category: 'religion' });
    if (!worshipLocs.length) return Response.json({ success: true, synced: 0, message: 'No worship locations found' });

    const charIds = new Set(characters.map(c => c.id));
    const charMap = Object.fromEntries(characters.map(c => [c.id, c]));

    const results = [];
    let synced = 0;

    for (const loc of worshipLocs) {
      const memberIds = (loc.religious_members || []).map(m => m.character_id);
      const workerIds = loc.worker_character_ids || [];
      // Also include staff/clergy listed in worker_job_titles (stored as { charId: jobTitle })
      const jobTitleIds = Object.keys(loc.worker_job_titles || {}).filter(id => !id.startsWith('npc__'));
      const allLinkedIds = [...new Set([...memberIds, ...workerIds, ...jobTitleIds])];

      for (const charId of allLinkedIds) {
        if (!charIds.has(charId)) continue; // not this user's character
        const char = charMap[charId];
        if (!char) continue;

        // Already linked to this location — skip
        if (char.religious_location_id === loc.id) continue;

        // Character has a DIFFERENT location already set — note it but don't override
        if (char.religious_location_id && char.religious_location_id !== loc.id) {
          results.push({
            character: char.name,
            action: 'skipped_has_different_link',
            existing: char.religious_location_name,
            found_at: loc.name,
          });
          continue;
        }

        // Write the link
        results.push({
          character: char.name,
          action: dry_run ? 'would_link' : 'linked',
          location: loc.name,
          location_id: loc.id,
        });

        if (!dry_run) {
          await base44.entities.Character.update(charId, {
            religious_location_id: loc.id,
            religious_location_name: loc.name,
          });
          // Update charMap so subsequent iterations don't double-link
          charMap[charId] = { ...char, religious_location_id: loc.id, religious_location_name: loc.name };
        }
        synced++;
      }
    }

    return Response.json({
      success: true,
      dry_run,
      synced,
      characters_checked: characters.length,
      worship_locations_checked: worshipLocs.length,
      results,
      message: dry_run
        ? `Dry run: would sync ${synced} character(s) to their worship location(s).`
        : `Synced ${synced} character(s) to their worship location(s).`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});