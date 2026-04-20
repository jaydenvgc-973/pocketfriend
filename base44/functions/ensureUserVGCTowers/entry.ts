import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ensureUserVGCTowers
 *
 * Guarantees each user has their own private VGC Towers location instance.
 * - If the user already has one (scope=account_global, name='VGC Towers'), returns it.
 * - If not, creates a new private instance for this user.
 * - NEVER returns a shared (scope=shared) VGC Towers — that would be cross-contamination.
 *
 * Returns: { vgc_towers_id, vgc_towers_name, created: bool }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Search for a user-scoped VGC Towers (created_by this user OR owner_email this user)
    const [byCreated, byOwner] = await Promise.all([
      base44.entities.LocationReference.filter({ created_by: user.email, name: 'VGC Towers' }),
      base44.entities.LocationReference.filter({ owner_email: user.email, name: 'VGC Towers' }),
    ]);

    // Deduplicate and filter to only account-private instances (not shared/global)
    const seen = new Set();
    const userInstances = [...byCreated, ...byOwner].filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      // Must be user-owned (not a shared admin record)
      return l.scope !== 'shared';
    });

    if (userInstances.length > 0) {
      const existing = userInstances[0];
      // Ensure ownership fields are correct
      if (!existing.owner_email || !existing.scope) {
        await base44.entities.LocationReference.update(existing.id, {
          owner_email: user.email,
          scope: 'account_global',
          created_by_role: 'user',
        });
      }
      return Response.json({
        vgc_towers_id: existing.id,
        vgc_towers_name: existing.name,
        created: false,
      });
    }

    // No user-scoped VGC Towers found — create one
    const sharedVGC = await base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared', name: 'VGC Towers' }).then(r => r[0] || null);

    const newVGC = await base44.entities.LocationReference.create({
      name: 'VGC Towers',
      category: 'home',
      scope: 'account_global',
      location_type: 'global',
      owner_email: user.email,
      created_by_role: 'user',
      is_user_created: true,
      description: 'Residential complex where NPCs live',
      bedroom_count: 20,
      // Copy images from shared instance if available
      image_urls: sharedVGC?.image_urls || [],
      zones: sharedVGC?.zones || [],
      resident_character_ids: [],
      resident_character_names: [],
    });

    console.log(`[ensureUserVGCTowers] Created new VGC Towers for ${user.email}: ${newVGC.id}`);

    return Response.json({
      vgc_towers_id: newVGC.id,
      vgc_towers_name: newVGC.name,
      created: true,
    });
  } catch (error) {
    console.error('[ensureUserVGCTowers]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});