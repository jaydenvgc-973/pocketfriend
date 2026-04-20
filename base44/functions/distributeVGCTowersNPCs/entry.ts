import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    // CRITICAL: Use Eastern Time for all time-of-day logic, not server UTC
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = nowET.getHours();
    const minute = nowET.getMinutes();
    const currentMinutes = hour * 60 + minute;

    const isLockdown = hour >= 1 && hour < 10;

    // Load this user's characters + ALL locations (user-owned + shared)
    // CRITICAL: Fetch by BOTH created_by AND owner_email — some NPCs are created by service
    // accounts but owned by this user. Use asServiceRole for owner_email query to bypass RLS.
    const [byCreatedBy, byOwnerEmail, userLocations, sharedLocations] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email, status: 'active' }),
      base44.asServiceRole.entities.Character.filter({ owner_email: user.email, status: 'active' }),
      base44.entities.LocationReference.filter({ created_by: user.email }),
      base44.entities.LocationReference.filter({ scope: 'shared' }),
    ]);

    // Deduplicate characters — merge both sets by id
    const charSeen = new Set();
    const allCharacters = [...byCreatedBy, ...byOwnerEmail].filter(c => {
      if (charSeen.has(c.id)) return false;
      charSeen.add(c.id);
      return true;
    });

    // Merge and deduplicate locations — user-owned takes precedence
    const seenIds = new Set();
    const allLocations = [...userLocations, ...sharedLocations].filter(l => {
      if (seenIds.has(l.id)) return false;
      seenIds.add(l.id);
      return true;
    });

    // Find VGC Towers — search across ALL locations (it may be shared or user-owned)
    const vgcTowers = allLocations.find(l => l.name === 'VGC Towers');
    if (!vgcTowers) return Response.json({ error: 'VGC Towers not found in any locations', allLocationNames: allLocations.map(l => l.name) }, { status: 400 });
    const VGC_ID = vgcTowers.id;

    // ── IDENTIFY VGC TOWERS NPC RESIDENTS ──────────────────────────────────────
    // CRITICAL: Only characters created by THIS USER with NPC type homed to VGC Towers
    const vgcResidents = allCharacters.filter(c =>
      c.current_home_location_id === VGC_ID &&
      ['npc', 'family_npc', 'background', 'promoted_npc', 'npc_fictitious_person'].includes(c.character_type) &&
      !c.protected_active
    );

    const log = [];

    // ── LOCKDOWN: Return everyone home ──────────────────────────────────────────
    if (isLockdown) {
      const updates = vgcResidents
        .filter(npc => npc.presence_state === 'social_visit' || npc.presence_state === 'in_transit')
        .map(npc => {
          log.push(`${npc.name} → returned home (lockdown)`);
          return base44.entities.Character.update(npc.id, {
            resolved_current_location_id: VGC_ID,
            resolved_current_location_name: 'VGC Towers',
            presence_state: 'home',
            presence_reason: 'lockdown',
            source_of_move: 'system',
            valid_from: now.toISOString(),
            valid_until: null,
            return_location_id: null,
          });
        });
      await Promise.all(updates);
      return Response.json({ success: true, mode: 'lockdown', returned: updates.length, log });
    }

    // ── ACTIVE WINDOW ────────────────────────────────────────────────────────────

    // Valid social destinations:
    // - NOT VGC Towers itself
    // - NOT residential/home category
    // - NOT character-specific locations (prevents cross-account pollution)
    // - NOT closed right now
    // - Must belong to this user OR be a shared location (scope: shared)
    const socialLocations = allLocations.filter(loc => {
      if (loc.id === VGC_ID) return false;
      if (loc.category === 'home') return false;
      if (loc.location_type === 'character_specific') return false;
      if (loc.scope === 'character_specific') return false;
      // Only allow user-owned or shared — never another user's private location
      const isUserOwned = loc.created_by === user.email;
      const isShared = loc.scope === 'shared';
      if (!isUserOwned && !isShared) return false;
      if (isLocationClosed(loc, nowET)) return false;
      return true;
    });

    if (socialLocations.length === 0) {
      return Response.json({ success: true, mode: 'active', message: 'No valid social locations open', distributed: 0, log });
    }

    // ── ELIGIBILITY CHECK ─────────────────────────────────────────────────────
    const BLOCKED_STATES = ['work', 'school', 'hospital', 'supervised'];
    const SLEEP_START = 2 * 60;  // 2:00 AM
    const SLEEP_END = 8 * 60;    // 8:00 AM

    const eligible = [];
    const ineligible = [];

    for (const npc of vgcResidents) {
      if (BLOCKED_STATES.includes(npc.presence_state)) {
        ineligible.push({ name: npc.name, reason: npc.presence_state });
        continue;
      }
      if (currentMinutes >= SLEEP_START && currentMinutes < SLEEP_END) {
        ineligible.push({ name: npc.name, reason: 'sleeping_hours' });
        continue;
      }
      if (isOnWorkSchedule(npc, nowET)) {
        ineligible.push({ name: npc.name, reason: 'work_schedule' });
        continue;
      }
      eligible.push(npc);
    }

    // ── NO RETENTION RULE — ALL eligible NPCs travel ─────────────────────────
    const ROTATION_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
    const updates = [];

    for (let i = 0; i < eligible.length; i++) {
      const npc = eligible[i];

      const needsRotation = shouldRotate(npc, ROTATION_THRESHOLD_MS, now);
      const isAlreadyOut = npc.presence_state === 'social_visit' &&
        npc.resolved_current_location_id &&
        npc.resolved_current_location_id !== VGC_ID;

      if (isAlreadyOut && !needsRotation) {
        log.push(`${npc.name} → staying at ${npc.resolved_current_location_name} (no rotation needed)`);
        continue;
      }

      // Age filter
      const npcAge = npc.age || null;
      const ageFilteredLocations = socialLocations.filter(loc => {
        if (npcAge && npcAge < 21) {
          if (loc.age_restricted) return false;
          const nameLC = loc.name.toLowerCase();
          if (['bar', 'club', 'lounge', 'pub', 'tavern', 'nightclub'].some(kw => nameLC.includes(kw))) return false;
        }
        return true;
      });

      const pool = ageFilteredLocations.length > 0 ? ageFilteredLocations : socialLocations;
      const currentLocId = npc.resolved_current_location_id;
      const differentLocations = pool.filter(l => l.id !== currentLocId);
      const finalPool = differentLocations.length > 0 ? differentLocations : pool;

      const nameHash = npc.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const selectedLoc = finalPool[(i + nameHash) % finalPool.length];

      const reason = (isAlreadyOut && needsRotation) ? 'vgc_rotation' : 'vgc_distribution';

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

    await Promise.all(updates.map(u => base44.entities.Character.update(u.id, u.data)));

    // FINAL STATE VERIFICATION — use asServiceRole for owner_email to bypass RLS on service-created NPCs
    const [freshByCreated, freshByOwner] = await Promise.all([
      base44.entities.Character.filter({ created_by: user.email, status: 'active' }),
      base44.asServiceRole.entities.Character.filter({ owner_email: user.email, status: 'active' }),
    ]);
    const freshSeen = new Set();
    const allFreshChars = [...freshByCreated, ...freshByOwner].filter(c => {
      if (freshSeen.has(c.id)) return false;
      freshSeen.add(c.id);
      return true;
    });
    const finalNPCStates = [];
    const nowhereFixUpdates = [];

    for (const npc of vgcResidents) {
      const fresh = allFreshChars.find(c => c.id === npc.id) || npc;
      const hasLocation = fresh.resolved_current_location_id && fresh.resolved_current_location_id.length > 0;
      if (!hasLocation) {
        nowhereFixUpdates.push(base44.entities.Character.update(npc.id, {
          resolved_current_location_id: VGC_ID,
          resolved_current_location_name: 'VGC Towers',
          presence_state: 'home',
          presence_reason: 'nowhere_fallback',
          source_of_move: 'system',
          valid_from: now.toISOString(),
        }));
        log.push(`${npc.name} → NOWHERE_FIX: restored to VGC Towers`);
        finalNPCStates.push({ name: npc.name, location: 'VGC Towers (fixed)', presence_state: 'home', flag: 'NOWHERE_FIX' });
      } else {
        finalNPCStates.push({
          name: npc.name,
          location: fresh.resolved_current_location_name,
          presence_state: fresh.presence_state,
          is_traveling: fresh.presence_state === 'social_visit',
        });
      }
    }
    if (nowhereFixUpdates.length > 0) await Promise.all(nowhereFixUpdates);

    return Response.json({
      success: true,
      mode: 'active',
      timestamp: now.toISOString(),
      hoursET: hour,
      totalVGCResidents: vgcResidents.length,
      eligible: eligible.length,
      ineligible,
      distributed: updates.length,
      nowhereFixed: nowhereFixUpdates.length,
      socialLocationsAvailable: socialLocations.map(l => l.name),
      finalNPCStates,
      log,
    });

  } catch (error) {
    console.error('[distributeVGCTowersNPCs]', error.message);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});

// ── HELPERS ──────────────────────────────────────────────────────────────────

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
  if (entries.length === 0) return false;
  return !entries.some(h => isInWindow(currentMinutes, h.open_time, h.close_time));
}

function isInWindow(currentMinutes, openStr, closeStr) {
  if (!openStr || !closeStr) return true;
  const [oh, om] = openStr.split(':').map(Number);
  const [ch, cm] = closeStr.split(':').map(Number);
  const openMin = oh * 60 + om;
  const closeMin = ch * 60 + cm;
  if (openMin <= closeMin) return currentMinutes >= openMin && currentMinutes <= closeMin;
  return currentMinutes >= openMin || currentMinutes <= closeMin;
}