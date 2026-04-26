import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Fix Locations — Presence Truth Sync
 *
 * Uses the SAME presence truth already used by Home cards, Travel page, Scene, Chat, etc.
 * Does NOT re-infer location from scratch.
 * Does NOT reset characters home by default.
 * Does NOT touch NPC travel, VGC Towers, or resident/family displays.
 *
 * Priority of truth (in order):
 *   1. resolved_current_location_id (already set by location resolver / travel / scene)
 *   2. traveling_to_location_id (if travel_status is active travel)
 *   3. current_home_location_id (only if resolved fields are fully blank/stale)
 *
 * Scoped to: active_created_character, owner_email = current user. No cross-account.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── 1. Load characters (owner-scoped, active only) ────────────────────────
    const characters = await base44.entities.Character.filter({
      owner_email: user.email,
      character_type: 'active_created_character',
      status: 'active'
    });

    if (!characters.length) {
      return Response.json({ success: true, corrected_count: 0, message: 'No active characters found.' });
    }

    // ── 2. Load locations for this account (to resolve names) ────────────────
    const allLocations = await base44.entities.LocationReference.filter({ owner_email: user.email });
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    const corrections = [];
    const noChanges = [];
    const skipped = [];

    for (const char of characters) {
      try {
        // ── 3. Read the CURRENT presence truth fields ─────────────────────────
        // These are what every other page uses. Do not re-derive from scratch.
        const resolvedId      = char.resolved_current_location_id || null;
        const resolvedName    = char.resolved_current_location_name || null;
        const resolvedStatus  = char.resolved_presence_status || null;
        const resolvedUpdated = char.resolved_last_updated_at || null;
        const travelStatus    = char.travel_status || 'not_traveling';
        const travelDestId    = char.traveling_to_location_id || char.travel_destination_location_id || null;
        const travelDestName  = char.traveling_to_location_name || null;
        const homeId          = char.current_home_location_id || null;
        const homeName        = homeId ? (locationMap[homeId]?.name || 'Home') : null;

        // ── 4. Determine what should be shown (truth, not re-inference) ───────

        let truthId     = resolvedId;
        let truthName   = resolvedName;
        let truthStatus = resolvedStatus;
        let truthReason = 'resolved_current_location (active truth)';

        // If character is actively traveling, travel destination is the truth
        if (
          (travelStatus === 'traveling_to_work' ||
           travelStatus === 'traveling_to_school' ||
           travelStatus === 'traveling_to_destination') &&
          travelDestId
        ) {
          truthId     = travelDestId;
          truthName   = travelDestName || locationMap[travelDestId]?.name || 'Destination';
          truthStatus = 'traveling';
          truthReason = `Traveling: travel_status=${travelStatus}`;
        }

        // If resolved fields are entirely empty (stale/never set), fall back to home only
        if (!truthId && homeId) {
          truthId     = homeId;
          truthName   = homeName;
          truthStatus = 'home';
          truthReason = 'No resolved presence — defaulted to home (safe fallback only when all fields blank)';
        }

        // ── 5. Verify the resolved location still exists on this account ──────
        if (truthId && !locationMap[truthId]) {
          // The location this char points to doesn't exist in user's locations
          // Check if it's a shared location (scope=shared) — those are valid too
          const sharedCheck = await base44.entities.LocationReference.filter({ id: truthId }, null, 1).catch(() => []);
          const loc = sharedCheck?.[0];
          if (!loc || (loc.owner_email && loc.owner_email !== user.email && loc.scope !== 'shared' && loc.location_type !== 'shared')) {
            // Stale pointer — reset to home safely
            if (homeId) {
              truthId     = homeId;
              truthName   = homeName;
              truthStatus = 'home';
              truthReason = `Stale location pointer (${truthId} no longer valid) — reset to home`;
            } else {
              skipped.push({ name: char.name, reason: 'Stale location pointer and no home assigned' });
              continue;
            }
          }
        }

        if (!truthId) {
          skipped.push({ name: char.name, reason: 'No location truth could be determined' });
          continue;
        }

        // ── 6. Check if anything actually needs updating ──────────────────────
        const displayMatches =
          char.resolved_current_location_id   === truthId &&
          char.resolved_current_location_name === truthName &&
          char.resolved_presence_status       === truthStatus;

        if (displayMatches) {
          noChanges.push(char.name);
          continue;
        }

        // ── 7. Apply correction (display fields only) ─────────────────────────
        await base44.entities.Character.update(char.id, {
          resolved_current_location_id:   truthId,
          resolved_current_location_name: truthName,
          resolved_presence_status:       truthStatus,
          resolved_source_reason:         truthReason,
          resolved_last_updated_at:       new Date().toISOString(),
        });

        corrections.push({
          character_name: char.name,
          was:  `${char.resolved_current_location_name || 'Unknown'} (${char.resolved_presence_status || '?'})`,
          now:  `${truthName} (${truthStatus})`,
          reason: truthReason,
        });

      } catch (charErr) {
        console.error(`[FIX_LOCATIONS] Error on ${char.name}:`, charErr.message);
        skipped.push({ name: char.name, reason: charErr.message });
      }
    }

    // ── 8. Build human-readable summary ──────────────────────────────────────
    let summary = '';
    if (corrections.length === 0 && skipped.length === 0) {
      summary = 'Location check complete. No location conflicts found.';
    } else {
      const lines = corrections.map(c =>
        `${c.character_name} updated: was "${c.was}" → now "${c.now}".`
      );
      if (skipped.length > 0) {
        lines.push(`Could not safely fix: ${skipped.map(s => `${s.name} (${s.reason})`).join('; ')}.`);
      }
      summary = `Location check complete. ${corrections.length > 0 ? lines.join(' ') : ''} ${skipped.length > 0 ? `Some could not be repaired automatically.` : ''}`.trim();
    }

    console.log(`[FIX_LOCATIONS] Done. Corrected: ${corrections.length}, unchanged: ${noChanges.length}, skipped: ${skipped.length}`);

    return Response.json({
      success: true,
      corrected_count: corrections.length,
      summary,
      corrections,
      skipped,
    });

  } catch (error) {
    console.error('[FIX_LOCATIONS] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});