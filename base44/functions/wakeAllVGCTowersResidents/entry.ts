import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * WAKE ALL VGC TOWERS RESIDENTS — IMMEDIATE
 *
 * Finds every VGC Towers NPC resident whose resolved_presence_status is
 * 'sleeping' or 'napping' and resets them to 'home' (awake at VGC Towers).
 * VGC travel schedule rules: residents are awake during the active window
 * (10 AM – 1 AM ET). Only sleep during the lockdown window (1 AM – 10 AM ET).
 *
 * This is a direct wake-up, not a distribution. Distribution follows via the
 * normal hourly automation cycle after residents are awake.
 */

const NPC_ELIGIBLE_TYPES = new Set([
  'npc_regular', 'npc_family_member', 'npc_fictitious',
  'family_npc', 'npc', 'background', 'npc_fictitious_person', 'promoted_npc'
]);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const log = [];

    // Load all locations
    const [accountLocations, sharedLocations] = await Promise.all([
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'account_global' }, null, 500),
      base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' }, null, 200),
    ]);

    const seenIds = new Set();
    const allLocations = [...accountLocations, ...sharedLocations].filter(l => {
      if (seenIds.has(l.id)) return false;
      seenIds.add(l.id);
      return true;
    });

    const vgcTowersList = allLocations.filter(l => l.name === 'VGC Towers');
    log.push(`${vgcTowersList.length} VGC Towers location(s) found`);

    if (vgcTowersList.length === 0) {
      return Response.json({ success: true, woke: 0, message: 'No VGC Towers found', log });
    }

    let totalWoke = 0;
    let totalSkipped = 0;

    for (const vgcTowers of vgcTowersList) {
      const VGC_ID = vgcTowers.id;
      const ownerEmail = vgcTowers.owner_email;

      log.push(`[${ownerEmail}] VGC=${VGC_ID.slice(0,8)}...`);

      // Fetch ALL active characters whose home is this VGC Towers
      // (broader than roster — catches residents that may have fallen out of the roster array)
      let allForAccount = [];
      try {
        allForAccount = await base44.asServiceRole.entities.Character.filter(
          { status: 'active', owner_email: ownerEmail }, null, 500
        );
      } catch {
        // fallback: try without owner_email
        allForAccount = [];
      }

      const vgcHomeResidents = allForAccount.filter(c =>
        c.current_home_location_id === VGC_ID
      );

      log.push(`[${ownerEmail}] ${vgcHomeResidents.length} residents with home=VGC`);

      // Also try roster-based fetch as backup if home-query returned nothing
      if (vgcHomeResidents.length === 0) {
        const rosterIds = [
          ...(vgcTowers.resident_character_ids || []),
          ...((vgcTowers.residents || []).map(r => r.character_id).filter(Boolean)),
        ];
        const uniqueRosterIds = [...new Set(rosterIds)];
        log.push(`[${ownerEmail}] Home-query empty, falling back to ${uniqueRosterIds.length} roster IDs`);

        for (const rid of uniqueRosterIds) {
          try {
            const results = await base44.asServiceRole.entities.Character.filter(
              { id: rid, status: 'active' }, null, 1
            );
            if (results && results.length > 0 && results[0].current_home_location_id === VGC_ID) {
              vgcHomeResidents.push(results[0]);
            }
          } catch { /* skip */ }
        }
        log.push(`[${ownerEmail}] Roster fallback: ${vgcHomeResidents.length} residents`);
      }

      // Filter to wrongfully sleeping NPC residents at VGC
      const sleepingResidents = [];
      for (const char of vgcHomeResidents) {
        if (!NPC_ELIGIBLE_TYPES.has(char.character_type)) continue;
        if (char.protected_active) continue;

        const status = char.resolved_presence_status || '';
        if (status !== 'sleeping' && status !== 'napping') continue;

        // Must be at VGC (or missing location)
        const locId = char.resolved_current_location_id;
        if (locId && locId !== VGC_ID) continue;

        sleepingResidents.push(char);
      }

      log.push(`[${ownerEmail}] ${sleepingResidents.length} wrongfully sleeping at VGC`);

      for (const npc of sleepingResidents) {
        try {
          await base44.asServiceRole.entities.Character.update(npc.id, {
            resolved_presence_status: 'home',
            resolved_location_type: 'home',
            resolved_source_reason: 'wake_from_vgc_sleep_violation',
            presence_state: 'home',
            presence_reason: 'wake_forced',
            resolved_current_location_id: VGC_ID,
            resolved_current_location_name: 'VGC Towers',
            valid_from: now.toISOString(),
            last_location_update_time: now.toISOString(),
            // Clear stale sleep metadata
            last_sleep_start: null,
          });
          totalWoke++;
          log.push(`  WOKE: ${npc.name} (was ${npc.resolved_presence_status}) → home at VGC Towers`);
        } catch (err) {
          totalSkipped++;
          log.push(`  FAILED: ${npc.name} → ${err.message}`);
        }
      }
    }

    const hour = nowET.getHours();
    const inActiveWindow = hour >= 10 || hour < 1;

    return Response.json({
      success: true,
      timestamp: now.toISOString(),
      timeET: `${hour.toString().padStart(2,'0')}:${nowET.getMinutes().toString().padStart(2,'0')} ET`,
      inActiveWindow,
      accounts: vgcTowersList.length,
      woke: totalWoke,
      skipped: totalSkipped,
      nextStep: inActiveWindow
        ? 'Residents are now awake. Distribution will pick them up on the next hourly cycle.'
        : 'Lockdown window. Residents are home and awake until next active window at 10 AM.',
      log,
    });
  } catch (error) {
    console.error('[wakeAllVGCTowersResidents]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});