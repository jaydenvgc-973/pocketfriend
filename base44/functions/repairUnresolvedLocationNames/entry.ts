import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * repairUnresolvedLocationNames
 *
 * Targeted source-level repair for Character records whose
 * resolved_current_location_name contains "Unresolved" (stale resolver output).
 *
 * Resolution priority (per character, no invention):
 *   1. resolved_current_location_id points to a real LocationReference → use it
 *   2. current_home_location_id exists → resolve to home
 *   3. Character appears in a LocationReference.residents[] or resident_character_ids[] → resolve to that home
 *   4. Character appears in a LocationReference.resident_family_members[] by name → resolve to that home
 *   5. No proven source → clear the stale "Unresolved" value only (set to null), do NOT invent
 *
 * Does NOT:
 *   - move characters to locations they don't belong in
 *   - invent or guess locations
 *   - use Fix Locations blanket repair
 *   - touch characters that are not stale
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Fetch the 6 known stale character IDs from the proof ─────────────────────
  // These were identified by verifyTravelRosterFixes as having "Unresolved" in
  // resolved_current_location_name. We target them directly to avoid collateral writes.
  const STALE_NAMES = ['Hayden', 'Mikey', 'Shawn', 'Linda Thompson', 'Thomas', 'Sam'];

  // Fetch all characters for this owner
  let allChars = [];
  try {
    allChars = await base44.entities.Character.filter({ owner_email: user.email }, 'created_date', 300);
  } catch (err) {
    return Response.json({ error: `Failed to fetch characters: ${err.message}` }, { status: 500 });
  }

  // Find the stale targets
  const staleChars = allChars.filter(c => {
    const locName = c.resolved_current_location_name || '';
    return locName.toLowerCase().includes('unresolved');
  });

  if (staleChars.length === 0) {
    return Response.json({ message: 'No stale characters found — nothing to repair', repaired: [] });
  }

  // ── Fetch all locations for resolution ───────────────────────────────────────
  let allLocs = [];
  try {
    const locRes = await base44.functions.invoke('fetchAllLocationsForUser', {});
    allLocs = locRes?.data?.locations || [];
  } catch {
    // fallback to service role
    allLocs = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);
  }

  const locById = Object.fromEntries(allLocs.map(l => [l.id, l]));

  // Build lookup: character_id → home location
  const residentIdToHomeLocId = {};
  const residentNameToHomeLocId = {};
  for (const loc of allLocs) {
    if (loc.category !== 'home' && loc.category !== 'generic') continue;

    // resident_character_ids
    for (const rid of (loc.resident_character_ids || [])) {
      if (!residentIdToHomeLocId[rid]) residentIdToHomeLocId[rid] = loc.id;
    }
    // residents[]
    for (const r of (loc.residents || [])) {
      if (r.character_id && !residentIdToHomeLocId[r.character_id]) {
        residentIdToHomeLocId[r.character_id] = loc.id;
      }
    }
    // resident_family_members[] — name-based fallback
    for (const f of (loc.resident_family_members || [])) {
      const nm = (f.name || '').trim().toLowerCase();
      if (nm && !residentNameToHomeLocId[nm]) residentNameToHomeLocId[nm] = loc.id;
    }
  }

  const results = [];

  for (const char of staleChars) {
    const charNorm = (char.name || '').trim().toLowerCase();
    let resolvedLocId = null;
    let resolvedLocName = null;
    let resolvedStatus = null;
    let resolutionSource = null;

    // Priority 1: existing resolved_current_location_id points to a real location
    if (char.resolved_current_location_id && locById[char.resolved_current_location_id]) {
      const loc = locById[char.resolved_current_location_id];
      // Only trust it if the name is NOT "Unresolved"
      if (!(loc.name || '').toLowerCase().includes('unresolved')) {
        resolvedLocId = loc.id;
        resolvedLocName = loc.name;
        resolvedStatus = char.resolved_presence_status || 'home';
        resolutionSource = 'existing_resolved_location_id';
      }
    }

    // Priority 2: current_home_location_id
    if (!resolvedLocId && char.current_home_location_id && locById[char.current_home_location_id]) {
      const loc = locById[char.current_home_location_id];
      resolvedLocId = loc.id;
      resolvedLocName = loc.name;
      resolvedStatus = 'home';
      resolutionSource = 'current_home_location_id';
    }

    // Priority 3: resident arrays on locations (by character id)
    if (!resolvedLocId && residentIdToHomeLocId[char.id]) {
      const locId = residentIdToHomeLocId[char.id];
      const loc = locById[locId];
      if (loc) {
        resolvedLocId = loc.id;
        resolvedLocName = loc.name;
        resolvedStatus = 'home';
        resolutionSource = 'resident_array_on_location';
      }
    }

    // Priority 4: resident_family_members[] by name
    if (!resolvedLocId && residentNameToHomeLocId[charNorm]) {
      const locId = residentNameToHomeLocId[charNorm];
      const loc = locById[locId];
      if (loc) {
        resolvedLocId = loc.id;
        resolvedLocName = loc.name;
        resolvedStatus = 'home';
        resolutionSource = 'resident_family_members_name_match';
      }
    }

    // Apply repair
    const update = {};
    if (resolvedLocId) {
      // Proven source — write full resolution
      update.resolved_current_location_id = resolvedLocId;
      update.resolved_current_location_name = resolvedLocName;
      update.resolved_presence_status = resolvedStatus;
      update.resolved_location_type = 'home';
      // Also backfill current_home_location_id if missing
      if (!char.current_home_location_id && resolvedStatus === 'home') {
        update.current_home_location_id = resolvedLocId;
      }
    } else {
      // Priority 5: No proven source — clear stale "Unresolved" value only
      // This makes the selector show "Available" instead of "At Unresolved"
      update.resolved_current_location_name = null;
      update.resolved_current_location_id = null;
      update.resolved_presence_status = null;
      resolutionSource = 'cleared_stale_unresolved';
    }

    try {
      await base44.entities.Character.update(char.id, update);
      results.push({
        id: char.id,
        name: char.name,
        was: char.resolved_current_location_name,
        now: resolvedLocName || 'null (cleared)',
        source: resolutionSource,
        verdict: resolvedLocId ? `✅ Resolved to "${resolvedLocName}" via ${resolutionSource}` : `✅ Cleared stale "Unresolved" → will show "Available" in selector`,
      });
    } catch (err) {
      results.push({
        id: char.id,
        name: char.name,
        error: err.message,
        verdict: `❌ Update failed: ${err.message}`,
      });
    }
  }

  const resolved = results.filter(r => r.source && r.source !== 'cleared_stale_unresolved');
  const cleared = results.filter(r => r.source === 'cleared_stale_unresolved');
  const failed = results.filter(r => r.error);

  return Response.json({
    summary: 'Targeted stale resolved_current_location_name repair',
    stale_found: staleChars.length,
    repaired_with_proven_source: resolved.length,
    cleared_no_source: cleared.length,
    failed: failed.length,
    results,
    verdict: failed.length === 0
      ? `✅ All ${staleChars.length} stale records repaired — no "At Unresolved" labels will appear`
      : `⚠️ ${failed.length} repair(s) failed`,
  });
});