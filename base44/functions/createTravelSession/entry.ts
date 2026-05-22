/**
 * createTravelSession
 *
 * Creates a persistent TravelSession record and sets the character's presence
 * to traveling WITHOUT immediately updating resolved_current_location_id to the destination.
 *
 * RULES:
 * - owner_email is the sole ownership source of truth — never created_by
 * - Does NOT teleport the character — origin stays as current location while in_transit
 * - resolved_current_location_id stays at origin until processTravelArrivals commits it
 * - Blockers: jailed, asleep, at_work (unless override), already in transit
 * - Duplicate active session check is ALWAYS owner_email + character_id scoped
 * - All jitter is DETERMINISTIC — based on characterId + locationIds + date, never Math.random()
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── DETERMINISTIC JITTER ──────────────────────────────────────────────────────
// Produces a stable 0.0–1.0 float from string inputs.
// Same inputs = same output, every time. No Math.random().
function deterministicFloat(...parts) {
  const str = parts.join('|');
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  // Unsigned 32-bit → 0.0–1.0
  return ((h >>> 0) % 10000) / 10000;
}

// Deterministic jitter in [minAdd, maxAdd] minutes based on seed parts
function jitterMinutes(minAdd, maxAdd, ...seedParts) {
  const f = deterministicFloat(...seedParts);
  return minAdd + f * (maxAdd - minAdd);
}

// ── TRAVEL TIME ESTIMATOR ─────────────────────────────────────────────────────
// Returns { durationMinutes, distanceMiles, positioningMode }
// All "random" ranges are now deterministic via jitterMinutes().
function estimateTravelTime({ originLoc, destLoc, travelMode = 'unknown', characterId = '' }) {
  const geoO = originLoc?.geo_mode || 'unknown';
  const geoD = destLoc?.geo_mode || 'unknown';

  // Seed for jitter: character + both location IDs + today's date (stable within a day)
  const today = new Date().toISOString().slice(0, 10);
  const seed = [characterId, originLoc?.id || 'no_origin', destLoc?.id || 'no_dest', today];

  // ── SAME BUILDING / SAME COMPLEX ──────────────────────────────────────────
  if (
    originLoc?.same_building_group_id &&
    originLoc.same_building_group_id === destLoc?.same_building_group_id
  ) {
    const dur = 1 + jitterMinutes(0, 2, ...seed, 'same_building');
    return { durationMinutes: dur, distanceMiles: 0.05, positioningMode: 'fictional_coordinates' };
  }

  // ── REAL COORDINATES (lat/lng) ─────────────────────────────────────────────
  const hasRealOrigin = geoO === 'real_world' && originLoc.latitude && originLoc.longitude;
  const hasRealDest   = geoD === 'real_world' && destLoc?.latitude && destLoc.longitude;
  if (hasRealOrigin && hasRealDest) {
    const latDiff = Math.abs(originLoc.latitude - destLoc.latitude);
    const lngDiff = Math.abs(originLoc.longitude - destLoc.longitude);
    // Rough haversine approximation (degrees → miles) — ~69 miles/degree lat, ~52 miles/degree lng in NJ
    const distMiles = Math.sqrt((latDiff * 69) ** 2 + (lngDiff * 52) ** 2);
    const mph = travelMode === 'walking' ? 3 : travelMode === 'bus' || travelMode === 'train' ? 18 : 22;
    const baseMin = Math.max(3, Math.round((distMiles / mph) * 60));
    // ±10% deterministic traffic jitter
    const jitter = jitterMinutes(-baseMin * 0.1, baseMin * 0.1, ...seed, 'real_coords');
    return {
      durationMinutes: Math.max(2, Math.round(baseMin + jitter)),
      distanceMiles: Math.round(distMiles * 10) / 10,
      positioningMode: 'real_coordinates',
    };
  }

  // ── FICTIONAL COORDINATES (map_x / map_y) ─────────────────────────────────
  const hasFicO = originLoc?.map_x != null && originLoc?.map_y != null;
  const hasFicD = destLoc?.map_x != null && destLoc?.map_y != null;
  if (hasFicO && hasFicD) {
    const dx = originLoc.map_x - destLoc.map_x;
    const dy = originLoc.map_y - destLoc.map_y;
    const mapDist = Math.sqrt(dx * dx + dy * dy); // 0–100 scale units
    // Scale: 100 units ≈ 8 miles across the Greater Paterson VGC district
    const estMiles = (mapDist / 100) * 8;
    const mph = travelMode === 'walking' ? 3 : 20;
    const baseMin = Math.max(3, Math.round((estMiles / mph) * 60));
    const jitter = jitterMinutes(-1, 2, ...seed, 'fictional_coords');
    return {
      durationMinutes: Math.max(2, Math.round(baseMin + jitter)),
      distanceMiles: Math.round(estMiles * 10) / 10,
      positioningMode: 'fictional_coordinates',
    };
  }

  // ── ANCHOR CITY REGION FALLBACK ────────────────────────────────────────────
  const anchorO = (originLoc?.anchor_city || '').toLowerCase();
  const anchorD = (destLoc?.anchor_city || '').toLowerCase();

  // Same anchor → local trip (3–5 minutes)
  if (anchorO && anchorD && anchorO === anchorD) {
    return {
      durationMinutes: Math.round(3 + jitterMinutes(0, 2, ...seed, 'same_anchor')),
      distanceMiles: 0.5,
      positioningMode: 'fallback_estimate',
    };
  }

  // Greater Paterson region (Paterson ↔ Haledon / Elmwood Park) — 5–7 minutes
  const paterRegion = ['paterson', 'haledon', 'elmwood park', 'hawthorne', 'wayne', 'clifton'];
  const isOPaterson = paterRegion.some(c => anchorO.includes(c));
  const isDPaterson = paterRegion.some(c => anchorD.includes(c));
  if (isOPaterson && isDPaterson) {
    return {
      durationMinutes: Math.round(5 + jitterMinutes(0, 2, ...seed, 'paterson_region')),
      distanceMiles: 1.5,
      positioningMode: 'fallback_estimate',
    };
  }

  // Paterson region ↔ Newark
  const newarkRegion = ['newark', 'east orange', 'belleville', 'kearny'];
  const isONewark = newarkRegion.some(c => anchorO.includes(c));
  const isDNewark = newarkRegion.some(c => anchorD.includes(c));
  if ((isOPaterson && isDNewark) || (isDPaterson && isONewark)) {
    return {
      durationMinutes: Math.round(25 + jitterMinutes(0, 10, ...seed, 'paterson_newark')),
      distanceMiles: 12,
      positioningMode: 'fallback_estimate',
    };
  }

  // NYC / West New York (longer trip)
  const nycRegion = ['new york', 'nyc', 'west new york', 'union city', 'jersey city', 'hoboken'];
  const isONYC = nycRegion.some(c => anchorO.includes(c));
  const isDNYC = nycRegion.some(c => anchorD.includes(c));
  if ((isOPaterson || isONewark) && isDNYC) {
    return {
      durationMinutes: Math.round(40 + jitterMinutes(0, 20, ...seed, 'to_nyc')),
      distanceMiles: 20,
      positioningMode: 'fallback_estimate',
    };
  }
  if (isONYC && (isDPaterson || isDNewark)) {
    return {
      durationMinutes: Math.round(40 + jitterMinutes(0, 20, ...seed, 'from_nyc')),
      distanceMiles: 20,
      positioningMode: 'fallback_estimate',
    };
  }

  // Unknown / unpositioned — assume Paterson/local area (7–10 minutes)
  return {
    durationMinutes: Math.round(7 + jitterMinutes(0, 3, ...seed, 'unknown_region')),
    distanceMiles: null,
    positioningMode: 'fallback_estimate',
  };
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Allow service-role callers (scheduled automations) — user may be null
    const user = await base44.auth.me().catch(() => null);

    const {
      characterId,
      destinationLocationId,
      travelReason,
      travelSource,         // autonomous_need | promise | manual | etc.
      sourceMessageId,
      sourceConversationId,
      sourceCommitmentId,
      travelMode,
      overrideWorkBlock,    // bool — set by convince/override flow
      ownerEmail,           // for service-role callers
      characterData,        // optional: caller can pass full character record to avoid lookup
    } = await req.json();

    if (!characterId || !destinationLocationId) {
      return Response.json({ error: 'characterId and destinationLocationId are required' }, { status: 400 });
    }

    const requestEmail = user?.email || ownerEmail;
    if (!requestEmail) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── LOAD CHARACTER ─────────────────────────────────────────────────────
    // DIAGNOSTIC DISCOVERY: asServiceRole.Character.filter({id:...}) returns 0 results
    // because Character RLS requires owner_email match even for service-role callers.
    // WORKING PATTERNS (confirmed):
    //   1. characterData passed directly by caller (zero lookup needed)
    //   2. base44.entities.Character.filter({id:...}) via user-scoped token
    //   3. base44.entities.Character.filter({owner_email:...}) + JS find (for service-role callers)
    // BROKEN PATTERNS (confirmed):
    //   - base44.asServiceRole.entities.Character.filter({id:...}) → always 0
    //   - base44.asServiceRole.entities.Character.list() → always 0
    let char = characterData || null;

    if (!char) {
      if (user) {
        // User session present — use user-scoped filter (confirmed working)
        const res = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
        char = res?.[0] || null;
      }
    }

    if (!char) {
      // No user session (service-role caller) — filter by owner_email then find by id
      if (requestEmail) {
        const res = await base44.entities.Character.filter({ owner_email: requestEmail }, null, 200).catch(() => []);
        char = res?.find(c => c.id === characterId) || null;
      }
    }

    if (!char) {
      return Response.json({
        error: 'Character not found',
        debug_id: characterId,
        debug_email: requestEmail,
        hint: 'Pass characterData in payload to bypass lookup for service-role callers',
      }, { status: 404 });
    }

    // Ownership check — owner_email only, never created_by
    if (char.owner_email && char.owner_email !== requestEmail) {
      return Response.json({ error: 'Character does not belong to your account' }, { status: 403 });
    }

    const ownerEmailFinal = char.owner_email || requestEmail;

    // ── BLOCKER CHECKS ─────────────────────────────────────────────────────
    // 1. Incarcerated / house arrest
    if (char.is_jailed === true) {
      return Response.json({
        success: false,
        blocked: true,
        blocker: 'incarcerated',
        blocker_reason: `${char.name} is incarcerated at ${char.incarceration_facility_name || 'a facility'} and cannot travel.`,
      });
    }
    if (char.house_arrest_active === true) {
      return Response.json({
        success: false,
        blocked: true,
        blocker: 'house_arrest',
        blocker_reason: `${char.name} is under house arrest and cannot leave.`,
      });
    }
    const confinedStatuses = ['incarcerated', 'confined', 'house_arrest'];
    if (confinedStatuses.includes(char.resolved_presence_status)) {
      return Response.json({
        success: false,
        blocked: true,
        blocker: 'confined',
        blocker_reason: `${char.name} is confined and cannot travel.`,
      });
    }

    // 2. Asleep — canonical sleep check:
    // DB status alone can be stale. We check BOTH DB status AND schedule-derived sleep
    // to catch characters who are in their sleep window but have a stale 'home' DB status.
    // computeAdaptiveSleepWindow logic inlined here (no local imports in Deno functions):
    const isAsleepByDB = char.resolved_presence_status === 'sleeping' || char.resolved_presence_status === 'napping';
    const isAsleepBySchedule = (() => {
      // Respect explicit stay-up decision
      if (char.decided_to_stay_up_until && new Date() < new Date(char.decided_to_stay_up_until)) return false;
      const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
      // Use stored schedule as source of truth (Priority 1)
      if (char.sleep_start_time && char.wake_up_time) {
        const s = toMin(char.sleep_start_time), w = toMin(char.wake_up_time);
        if (s !== null && w !== null) {
          return s > w ? (currentMinutes >= s || currentMinutes < w) : (currentMinutes >= s && currentMinutes < w);
        }
      }
      // Derive from work schedule (Priority 2)
      if (char.work_start_time && char.work_end_time && Array.isArray(char.work_days)) {
        const dayOfWeek = nowET.getDay();
        if (char.work_days.includes(dayOfWeek) || char.work_days.includes((dayOfWeek + 1) % 7)) {
          const ws = toMin(char.work_start_time), we = toMin(char.work_end_time);
          if (ws !== null && we !== null) {
            const isOvernight = we < ws;
            const wakeMin = (ws - 60 + 1440) % 1440;
            const sleepMin = isOvernight ? (we + 60) % 1440 : (wakeMin - 7 * 60 + 1440) % 1440;
            return sleepMin > wakeMin ? (currentMinutes >= sleepMin || currentMinutes < wakeMin) : (currentMinutes >= sleepMin && currentMinutes < wakeMin);
          }
        }
      }
      return false; // No determinable schedule — fail safe: awake
    })();
    const isAsleep = isAsleepByDB || isAsleepBySchedule;
    if (isAsleep) {
      return Response.json({
        success: false,
        blocked: true,
        blocker: 'asleep',
        blocker_reason: `${char.name} is asleep and cannot travel right now.`,
        asleep_by_db: isAsleepByDB,
        asleep_by_schedule: isAsleepBySchedule,
      });
    }

    // 3. At work (unless override allowed)
    if (!overrideWorkBlock && char.resolved_source_reason === 'work_schedule' && char.resolved_presence_status === 'at_work') {
      return Response.json({
        success: false,
        blocked: true,
        blocker: 'at_work',
        blocker_reason: `${char.name} is at work and cannot leave right now.`,
      });
    }

    // 4. Already in transit — MUST be owner_email + character_id scoped (not character_id alone)
    const activeSessions = await base44.asServiceRole.entities.TravelSession.filter({
      owner_email: ownerEmailFinal,
      character_id: characterId,
      route_status: 'in_transit',
    }, null, 1).catch(() => []);
    if (activeSessions?.length > 0) {
      const existing = activeSessions[0];
      return Response.json({
        success: false,
        blocked: true,
        blocker: 'already_traveling',
        blocker_reason: `${char.name} is already traveling to ${existing.destination_location_name || 'another location'}.`,
        active_session_id: existing.id,
      });
    }

    // ── SAME DESTINATION CHECK ──────────────────────────────────────────────
    if (char.resolved_current_location_id === destinationLocationId) {
      return Response.json({
        success: false,
        blocked: true,
        blocker: 'already_there',
        blocker_reason: `${char.name} is already at the destination.`,
      });
    }

    // ── LOAD LOCATIONS ─────────────────────────────────────────────────────
    // LocationReference: asServiceRole.filter({id:...}) confirmed working
    const [originLocArr, destLocArr] = await Promise.all([
      char.resolved_current_location_id
        ? base44.asServiceRole.entities.LocationReference.filter({ id: char.resolved_current_location_id }, null, 1).catch(() => [])
        : Promise.resolve([]),
      base44.asServiceRole.entities.LocationReference.filter({ id: destinationLocationId }, null, 1).catch(() => []),
    ]);
    const originLoc = originLocArr?.[0] || null;
    const destLoc   = destLocArr?.[0] || null;

    if (!destLoc) return Response.json({ error: 'Destination location not found' }, { status: 404 });

    // ── OWNERSHIP SCOPE VALIDATION (CRITICAL) ───────────────────────────────
    // Character and destination must belong to the same user account or destination must be public/global.
    // This prevents cross-account character/location mixing.
    // HARD RULE: If destination has any owner_email, it must match character owner exactly.
    if (destLoc.owner_email) {
      if (destLoc.owner_email !== ownerEmailFinal) {
        console.error(`[createTravelSession] CROSS-OWNER TRAVEL BLOCKED: ${char.name} (${ownerEmailFinal}) → ${destLoc.name} (${destLoc.owner_email})`);
        console.error(`[createTravelSession] CONTAMINATION PREVENTED: Character from ${ownerEmailFinal} cannot travel to location owned by ${destLoc.owner_email}`);
        return Response.json({
          success: false,
          error: 'Destination location belongs to a different account',
          blocked: true,
          blocker: 'cross_account_location',
          blocker_reason: `Cannot travel: Khalil (${ownerEmailFinal}) → ${destLoc.name} (${destLoc.owner_email}). Locations must be from the same account.`,
          character_owner: ownerEmailFinal,
          destination_owner: destLoc.owner_email,
        }, { status: 403 });
      }
    } else if (!destLoc.is_global && !destLoc.is_user_created && destLoc.scope !== 'shared') {
      // Location has no owner_email and is not explicitly public/global
      console.error(`[createTravelSession] UNOWNED LOCATION: ${char.name} → ${destLoc.name} (no owner_email, not public/global)`);
      return Response.json({
        success: false,
        error: 'Destination location ownership cannot be verified',
        blocked: true,
        blocker: 'unverified_location',
        blocker_reason: 'The destination location is not owned by your account and is not publicly available.',
      }, { status: 403 });
    }
    // If destination has no owner_email, it must be explicitly marked public/global
    if (!destLoc.owner_email && !destLoc.is_global && destLoc.scope !== 'shared') {
      console.error(`[createTravelSession] UNOWNED LOCATION: ${char.name} → ${destLoc.name} (no owner_email, not global)`);
      return Response.json({
        success: false,
        error: 'Destination location ownership cannot be verified',
        blocked: true,
        blocker: 'unverified_location',
      }, { status: 403 });
    }

    // ── ESTIMATE TRAVEL TIME (deterministic) ───────────────────────────────
    const { durationMinutes, distanceMiles, positioningMode } = estimateTravelTime({
      originLoc,
      destLoc,
      travelMode: travelMode || 'unknown',
      characterId,
    });

    const now = new Date();
    const eta = new Date(now.getTime() + durationMinutes * 60 * 1000);

    // ── CREATE TRAVEL SESSION ──────────────────────────────────────────────
    // Store character_snapshot so processTravelArrivals (scheduled, no user session)
    // can process arrivals without re-fetching Character (blocked by RLS for asServiceRole).
    const characterSnapshot = {
      id:                       char.id,
      name:                     char.name || char.display_name || char.primary_name,
      owner_email:              ownerEmailFinal,
      is_jailed:                char.is_jailed || false,
      house_arrest_active:      char.house_arrest_active || false,
      resolved_presence_status: char.resolved_presence_status || 'traveling',
      current_home_location_id: char.current_home_location_id || null,
    };

    // Commitment-driven sessions are NOT interruptible by autonomous needs/wants.
    // A character who said "I'm on my way" has made an autonomous decision.
    // That session must be protected until arrival or a legitimate hard blocker (jail, hospitalization).
    const isCommitmentDriven = (
      travelSource === 'promise' ||
      !!sourceCommitmentId
    );
    const sessionInterruptionAllowed = !isCommitmentDriven;

    const session = await base44.asServiceRole.entities.TravelSession.create({
      character_id:              characterId,
      character_name:            char.name || char.display_name || char.primary_name,
      owner_email:               ownerEmailFinal,
      origin_location_id:        originLoc?.id || null,
      origin_location_name:      originLoc?.name || null,
      destination_location_id:   destinationLocationId,
      destination_location_name: destLoc.name,
      travel_reason:             travelReason || null,
      travel_source:             travelSource || 'manual',
      source_message_id:         sourceMessageId || null,
      source_conversation_id:    sourceConversationId || null,
      source_commitment_id:      sourceCommitmentId || null,
      travel_mode:               travelMode || 'unknown',
      distance_miles:            distanceMiles || null,
      estimated_departure_time:  now.toISOString(),
      estimated_arrival_time:    eta.toISOString(),
      duration_minutes:          Math.round(durationMinutes),
      progress_percent:          0,
      route_status:              'in_transit',
      last_progress_update:      now.toISOString(),
      interruption_allowed:      sessionInterruptionAllowed,
      positioning_mode:          positioningMode,
      origin_geo_mode:           originLoc?.geo_mode || 'unknown',
      destination_geo_mode:      destLoc?.geo_mode || 'unknown',
      created_at:                now.toISOString(),
      character_snapshot:        characterSnapshot,
      character_home_location_id: char.current_home_location_id || null,
    });

    // ── UPDATE CHARACTER — IN TRANSIT ──────────────────────────────────────
    // CRITICAL: resolved_current_location_id is NOT updated here.
    // The character stays at origin. Only travel_destination fields are set.
    // processTravelArrivals will commit the destination when ETA passes.
    // Use user-scoped update when user session exists (asServiceRole.update blocked by Character RLS).
    const charUpdateApi = user ? base44.entities.Character : base44.asServiceRole.entities.Character;
    await charUpdateApi.update(characterId, {
      resolved_presence_status:        'traveling',
      resolved_source_reason:          `travel_session:${session.id}`,
      travel_status:                   'traveling_to_destination',
      travel_destination_location_id:  destinationLocationId,
      traveling_to_location_id:        destinationLocationId,
      traveling_to_location_name:      destLoc.name,
      last_location_update_time:       now.toISOString(),
      // resolved_current_location_id deliberately NOT changed — stays at origin
    });

    console.log(`[createTravelSession] ✅ ${char.name} → ${destLoc.name} | ETA: ${eta.toISOString()} | ${Math.round(durationMinutes)}min | mode: ${positioningMode} | session: ${session.id}`);

    return Response.json({
      success: true,
      session_id: session.id,
      character_name: char.name,
      destination: destLoc.name,
      estimated_arrival: eta.toISOString(),
      duration_minutes: Math.round(durationMinutes),
      distance_miles: distanceMiles,
      positioning_mode: positioningMode,
      origin: originLoc?.name || 'unknown origin',
      travel_source: travelSource || 'manual',
    });

  } catch (error) {
    console.error('[createTravelSession]', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});