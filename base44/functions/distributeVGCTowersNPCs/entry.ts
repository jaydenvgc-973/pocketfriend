import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentMinutes = hour * 60 + minute;

    // Active window: 10:00 AM (600) to 1:00 AM next day (60 + 1440 = handled via overnight logic)
    // Overnight: active if hour >= 10 OR hour < 1
    const isActiveWindow = hour >= 10 || hour < 1;

    // Lockdown window: 1:00 AM to 10:00 AM → return all NPCs home
    const isLockdown = hour >= 1 && hour < 10;

    // Load all data
    const [allCharacters, allLocations] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email, status: 'active' }),
      base44.entities.LocationReference.list(),
    ]);

    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    // Find VGC Towers
    const vgcTowers = allLocations.find(l => l.name === 'VGC Towers');
    if (!vgcTowers) return Response.json({ error: 'VGC Towers not found' }, { status: 400 });
    const VGC_ID = vgcTowers.id;

    // ── IDENTIFY VGC TOWERS NPC CHARACTERS ──────────────────────────────────────
    // Only Character entities whose current_home_location_id === VGC Towers
    // AND character_type is npc, family_npc, or background (NOT active)
    // NEVER include protected_active characters — user explicitly marked them as active
    const vgcResidents = allCharacters.filter(c =>
      c.current_home_location_id === VGC_ID &&
      ['npc', 'family_npc', 'background', 'promoted_npc'].includes(c.character_type) &&
      !c.protected_active
    );

    const log = [];

    // ── LOCKDOWN: Return everyone home ──────────────────────────────────────────
    if (isLockdown) {
      const updates = [];
      for (const npc of vgcResidents) {
        // Only touch NPCs that are out socially
        if (npc.presence_state === 'social_visit' || npc.presence_state === 'in_transit') {
          updates.push(base44.entities.Character.update(npc.id, {
            resolved_current_location_id: VGC_ID,
            resolved_current_location_name: 'VGC Towers',
            presence_state: 'home',
            presence_reason: 'default_home',
            source_of_move: 'system',
            valid_from: now.toISOString(),
            valid_until: null,
            return_location_id: null,
          }));
          log.push(`${npc.name} → returned home (lockdown)`);
        }
      }
      await Promise.all(updates);
      return Response.json({ success: true, mode: 'lockdown', returned: updates.length, log });
    }

    // ── ACTIVE WINDOW ────────────────────────────────────────────────────────────

    // Build guaranteed-open locations (always valid during active window)
    const GUARANTEED_NAMES = ['anderson\'s bar', 'andersons bar', 'escuelita\'s nightclub', 'escuelitas nightclub', 'escuelita nightclub'];
    const guaranteedLocations = allLocations.filter(l =>
      GUARANTEED_NAMES.some(n => l.name.toLowerCase().replace(/[''']/g, "'").includes(n.replace(/[''']/g, "'")))
    );

    // Build valid social destinations
    const socialLocations = allLocations.filter(loc => {
      if (loc.id === VGC_ID) return false;
      if (loc.category === 'home') return false;
      if (loc.location_type === 'character_specific') return false;
      // Check if it's guaranteed open
      const isGuaranteed = guaranteedLocations.some(g => g.id === loc.id);
      if (isGuaranteed) return true;
      // Otherwise check operating hours
      if (isLocationClosed(loc, now)) return false;
      return true;
    });

    if (socialLocations.length === 0) {
      return Response.json({ success: true, mode: 'active', message: 'No valid social locations open', distributed: 0 });
    }

    // ── ELIGIBILITY CHECK ─────────────────────────────────────────────────────
    const BLOCKED_STATES = ['work', 'school', 'hospital', 'supervised'];
    const SLEEP_START = 2 * 60;  // 2:00 AM
    const SLEEP_END = 8 * 60;    // 8:00 AM

    const eligible = [];
    const ineligible = [];

    for (const npc of vgcResidents) {
      // Block if priority state is already set (work, school, etc.)
      if (BLOCKED_STATES.includes(npc.presence_state)) {
        ineligible.push({ name: npc.name, reason: npc.presence_state });
        continue;
      }

      // Block if sleeping (2AM-8AM — but we're in active window so this only matters edge cases)
      if (currentMinutes >= SLEEP_START && currentMinutes < SLEEP_END) {
        ineligible.push({ name: npc.name, reason: 'sleeping' });
        continue;
      }

      // Block if on work schedule
      if (isOnWorkSchedule(npc, now)) {
        ineligible.push({ name: npc.name, reason: 'work_schedule' });
        continue;
      }

      eligible.push(npc);
    }

    // ── RETENTION RULE: Minimum 3 stay at VGC Towers ─────────────────────────
    // Priority: already sleeping → lowest activity → no movement history → stable random
    const MIN_STAY = 3;
    const stayingNPCs = selectStayers(eligible, MIN_STAY, now);
    const travelingNPCs = eligible.filter(n => !stayingNPCs.find(s => s.id === n.id));

    // Mark stayers as home
    const stayerUpdates = stayingNPCs
      .filter(n => n.presence_state !== 'home')
      .map(n => base44.entities.Character.update(n.id, {
        resolved_current_location_id: VGC_ID,
        resolved_current_location_name: 'VGC Towers',
        presence_state: 'home',
        presence_reason: 'default_home',
        source_of_move: 'system',
        valid_from: now.toISOString(),
      }));
    await Promise.all(stayerUpdates);

    // ── DISTRIBUTE / ROTATE TRAVELING NPCs ───────────────────────────────────
    const ROTATION_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
    const updates = [];

    for (let i = 0; i < travelingNPCs.length; i++) {
      const npc = travelingNPCs[i];

      // Check if NPC needs rotation (been at current location too long)
      const needsRotation = shouldRotate(npc, ROTATION_THRESHOLD_MS, now);
      const isAlreadyOut = npc.presence_state === 'social_visit' && npc.resolved_current_location_id && npc.resolved_current_location_id !== VGC_ID;

      if (isAlreadyOut && !needsRotation) {
        // NPC is already out and doesn't need rotating yet — leave them
        log.push(`${npc.name} → staying at ${npc.resolved_current_location_name} (no rotation needed)`);
        continue;
      }

      // Filter by age restriction
      const npcAge = npc.age || null;
      const ageFilteredLocations = socialLocations.filter(loc => {
        if (npcAge && npcAge < 21) {
          // Block age-restricted venues
          if (loc.age_restricted) return false;
          const nameLC = loc.name.toLowerCase();
          const blockedKeywords = ['bar', 'club', 'lounge', 'pub', 'tavern', 'nightclub'];
          if (blockedKeywords.some(kw => nameLC.includes(kw))) return false;
        }
        return true;
      });

      if (ageFilteredLocations.length === 0) {
        // FALLBACK: no age-appropriate destinations → retain at VGC Towers (never leave nowhere)
        log.push(`${npc.name} → FALLBACK: no age-appropriate locations, returning to VGC Towers`);
        updates.push({
          id: npc.id,
          name: npc.name,
          data: {
            resolved_current_location_id: VGC_ID,
            resolved_current_location_name: 'VGC Towers',
            presence_state: 'home',
            presence_reason: 'no_valid_destination_fallback',
            source_of_move: 'system',
            valid_from: now.toISOString(),
            valid_until: null,
            return_location_id: null,
          }
        });
        continue;
      }

      // Pick a different location than their current one if possible
      const currentLocId = npc.resolved_current_location_id;
      const otherLocations = ageFilteredLocations.filter(l => l.id !== currentLocId);
      const pool = otherLocations.length > 0 ? otherLocations : ageFilteredLocations;

      // Distribute evenly using index + hash of name for stable variety
      const nameHash = npc.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const selectedLoc = pool[(i + nameHash) % pool.length];

      const isRotation = isAlreadyOut && needsRotation;
      const reason = isRotation ? 'vgc_rotation' : 'vgc_distribution';

      updates.push({
        id: npc.id,
        name: npc.name,
        data: {
          resolved_current_location_id: selectedLoc.id,
          resolved_current_location_name: selectedLoc.name,
          presence_state: 'social_visit',
          presence_reason: reason,
          source_of_move: 'system',
          valid_from: now.toISOString(),
          valid_until: new Date(now.getTime() + ROTATION_THRESHOLD_MS * 2).toISOString(),
          return_location_id: VGC_ID,
        }
      });

      log.push(`${npc.name} → ${selectedLoc.name} (${reason})`);
    }

    // Write all updates atomically
    await Promise.all(updates.map(u => base44.entities.Character.update(u.id, u.data)));

    // FINAL VALIDATION: ensure every VGC resident ends with a valid resolved location
    // Any NPC that still has no resolved_current_location_id gets a fallback to VGC Towers
    const allFreshChars = await base44.entities.Character.filter({ created_by: user.email, status: 'active' });
    const finalNPCStates = [];
    const nowhereFixUpdates = [];

    for (const npc of vgcResidents) {
      const fresh = allFreshChars.find(c => c.id === npc.id) || npc;
      const hasLocation = fresh.resolved_current_location_id && fresh.resolved_current_location_id.length > 0;
      if (!hasLocation) {
        // NPC ended up nowhere — apply critical fallback
        nowhereFixUpdates.push(base44.entities.Character.update(npc.id, {
          resolved_current_location_id: VGC_ID,
          resolved_current_location_name: 'VGC Towers',
          presence_state: 'home',
          presence_reason: 'nowhere_fallback_applied',
          source_of_move: 'system',
          valid_from: now.toISOString(),
          valid_until: null,
        }));
        log.push(`${npc.name} → NOWHERE_FIX: was missing resolved location, restored to VGC Towers`);
        finalNPCStates.push({ name: npc.name, status: 'INVALID_NOWHERE_STATE → fixed_to_hub' });
      } else {
        finalNPCStates.push({ name: npc.name, status: fresh.presence_state, location: fresh.resolved_current_location_name });
      }
    }
    if (nowhereFixUpdates.length > 0) await Promise.all(nowhereFixUpdates);

    return Response.json({
      success: true,
      mode: 'active',
      timestamp: now.toISOString(),
      totalVGCResidents: vgcResidents.length,
      eligible: eligible.length,
      ineligible: ineligible.length,
      stayingAtHome: stayingNPCs.length,
      distributed: updates.length,
      nowhereFixed: nowhereFixUpdates.length,
      guaranteedLocationsFound: guaranteedLocations.map(l => l.name),
      socialLocationsAvailable: socialLocations.length,
      finalNPCStates,
      log,
    });

  } catch (error) {
    console.error('[distributeVGCTowersNPCs]', error.message);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});

// ── HELPERS ──────────────────────────────────────────────────────────────────

function selectStayers(eligible, minCount, now) {
  if (eligible.length <= minCount) return eligible;

  // Priority: sleeping → no valid_from → oldest valid_from (been out longest → NOT them, pick recently moved)
  const scored = eligible.map(npc => {
    let score = 0;
    if (npc.presence_state === 'sleeping') score += 100;
    if (!npc.valid_from) score += 50;
    if (npc.presence_state === 'home') score += 30;
    return { npc, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, minCount).map(s => s.npc);
}

function shouldRotate(npc, thresholdMs, now) {
  if (!npc.valid_from) return true;
  const movedAt = new Date(npc.valid_from).getTime();
  return (now.getTime() - movedAt) >= thresholdMs;
}

function isOnWorkSchedule(npc, now) {
  if (!npc.work_days || !npc.work_start_time || !npc.work_end_time) return false;
  const dayOfWeek = now.getDay();
  if (!npc.work_days.includes(dayOfWeek)) return false;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = npc.work_start_time.split(':').map(Number);
  const [eh, em] = npc.work_end_time.split(':').map(Number);
  return currentMinutes >= sh * 60 + sm && currentMinutes < eh * 60 + em;
}

function isLocationClosed(location, currentTime) {
  if (!location.operating_hours || location.operating_hours.length === 0) return false;
  const dayOfWeek = currentTime.getDay();
  const currentMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const todayEntries = location.operating_hours.filter(h => h.day_of_week === dayOfWeek);
  const dayAgnostic = location.operating_hours.filter(h => h.day_of_week == null);
  const entries = todayEntries.length > 0 ? todayEntries : dayAgnostic;
  if (entries.length === 0) return location.operating_hours.some(h => h.day_of_week != null);
  return !entries.some(h => isInWindow(currentMinutes, h.open_time, h.close_time));
}

function isInWindow(currentMinutes, openStr, closeStr) {
  if (!openStr || !closeStr) return false;
  const [oh, om] = openStr.split(':').map(Number);
  const [ch, cm] = closeStr.split(':').map(Number);
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;
  if (openMin <= closeMin) return currentMinutes >= openMin && currentMinutes <= closeMin;
  return currentMinutes >= openMin || currentMinutes <= closeMin;
}