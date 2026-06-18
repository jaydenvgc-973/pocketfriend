import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED RESOLVER LOGIC (inlined from frontend lib/ for backend access)
// This logic is an exact copy of what the UI pages use to ensure Vick sees
// what the user sees. No estimations. No guesses.
// ═══════════════════════════════════════════════════════════════════════════════

function toMinutes(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

function nowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

const NPC_TYPES = new Set([
  'npc_fictitious', 'npc_family_member', 'npc_regular', 'npc',
  'family_npc', 'background', 'promoted_npc', 'npc_fictitious_person',
]);

function computeAdaptiveSleepWindow(character) {
  const SLEEP_DURATION_MIN = 7 * 60;
  const PRE_SHIFT_BUFFER   = 60;
  const DECOMPRESSION_MIN  = 60;

  if (character.sleep_start_time && character.wake_up_time) {
    const s = toMinutes(character.sleep_start_time);
    const w = toMinutes(character.wake_up_time);
    if (s !== null && w !== null) return { sleepStartMin: s, wakeMin: w, source: 'stored_schedule' };
  }

  if (NPC_TYPES.has(character.character_type)) {
    return { sleepStartMin: 0, wakeMin: 8 * 60, source: 'npc_forced_default' };
  }

  if (character.work_start_time && character.work_end_time && Array.isArray(character.work_days) && character.work_days.length > 0) {
    const startMin = toMinutes(character.work_start_time);
    const endMin   = toMinutes(character.work_end_time);
    if (startMin !== null && endMin !== null) {
      const et = nowET();
      const today = et.getDay();
      const tomorrow = (today + 1) % 7;
      const yesterday = (today + 6) % 7;
      const isOvernightShift = endMin < startMin;
      if (isOvernightShift) {
        if (character.work_days.includes(yesterday) || character.work_days.includes(today)) {
          const sleepStartMin = (endMin + DECOMPRESSION_MIN) % 1440;
          const wakeMin = (sleepStartMin + SLEEP_DURATION_MIN) % 1440;
          return { sleepStartMin, wakeMin, source: 'overnight_work' };
        }
      } else {
        if (character.work_days.includes(today) || character.work_days.includes(tomorrow)) {
          const wakeMin = (startMin - PRE_SHIFT_BUFFER + 1440) % 1440;
          const sleepStartMin = (wakeMin - SLEEP_DURATION_MIN + 1440) % 1440;
          return { sleepStartMin, wakeMin, source: 'work_schedule' };
        }
      }
    }
  }
  return { sleepStartMin: 23 * 60, wakeMin: 7 * 60, source: 'no_structured_timing' };
}

function isScheduledSleeping(character) {
  const window = computeAdaptiveSleepWindow(character);
  if (!window || window.sleepStartMin == null || window.wakeMin == null) return false;
  const et = nowET();
  const now = et.getHours() * 60 + et.getMinutes();
  const { sleepStartMin, wakeMin } = window;
  if (sleepStartMin > wakeMin) return now >= sleepStartMin || now < wakeMin;
  return now >= sleepStartMin && now < wakeMin;
}

function isCharacterAsleep(character) {
  if (!character) return false;
  const status = character.resolved_presence_status || '';
  if (status === 'sleeping' || status === 'napping' || status === 'passed_out') return true;
  if (character.character_type === 'active_created_character') {
    if (status !== 'sleeping' && status !== 'napping') return false;
    if (character.last_sleep_start) {
      const sleepDurationHours = (nowET().getTime() - new Date(character.last_sleep_start).getTime()) / 3_600_000;
      if (sleepDurationHours >= 8) return false;
    }
    return isScheduledSleeping(character);
  }
  return isScheduledSleeping(character);
}

function isOnWorkShift(character) {
    const et = nowET();
    const cur = et.getHours() * 60 + et.getMinutes();
    const dow = et.getDay();

    if (character.work_start_time && character.work_end_time &&
        Array.isArray(character.work_days) && character.work_days.includes(dow)) {
        const s = toMinutes(character.work_start_time);
        const e = toMinutes(character.work_end_time);
        if (s !== null && e !== null) {
            if (e < s) return cur >= s || cur < e;
            return cur >= s && cur < e;
        }
    }
    return false;
}

function resolveHomeCardState(character, locationMap) {
    if (!character) {
        return { status: 'unknown', label: 'Unknown', sublabel: null, isSleeping: false, source: 'home_card_resolver' };
    }
    const locName = character.resolved_current_location_name || null;
    const presenceStatus = character.resolved_presence_status || character.location_status;
    const isAsleep = isCharacterAsleep(character);

    if ((character.health_value ?? 80) < 20) return { status: 'health_critical', label: 'Health Emergency', sublabel: locName, isSleeping: false, source: 'home_card_resolver' };
    if ((character.energy_value ?? 75) < 10 && presenceStatus !== 'at_work') return { status: 'energy_critical', label: 'Exhausted', sublabel: locName, isSleeping: false, source: 'home_card_resolver' };
    if ((character.hunger_value ?? 70) < 15) return { status: 'hunger_critical', label: 'Looking for food', sublabel: locName, isSleeping: false, source: 'home_card_resolver' };
    if (isAsleep) return { status: 'sleeping', label: 'Sleeping', sublabel: locName, isSleeping: true, source: 'home_card_resolver' };
    if (isOnWorkShift(character)) return { status: 'at_work', label: 'At work', sublabel: locName || character.occupation_location_name || 'Work', isSleeping: false, source: 'home_card_resolver' };

    const hasValidLocation = !!character.resolved_current_location_id && !!locName;
    return hasValidLocation
        ? { status: 'at_location', label: `At ${locName}`, sublabel: null, isSleeping: false, source: 'home_card_resolver' }
        : { status: 'away', label: 'Away', sublabel: 'No valid location assigned', isSleeping: false, source: 'home_card_resolver' };
}

function resolveTravelAvailability(character) {
    if (!character) return { available: false, reason: 'Unknown status', source: 'travel_availability_resolver' };
    if (character.is_jailed) return { available: false, reason: 'Incarcerated', source: 'travel_availability_resolver' };
    if (isCharacterAsleep(character)) return { available: false, reason: 'Asleep', source: 'travel_availability_resolver' };
    if (isOnWorkShift(character)) return { available: false, reason: 'At work', source: 'travel_availability_resolver' };
    if (character.resolved_presence_status === 'at_school') return { available: false, reason: 'At school', source: 'travel_availability_resolver' };
    return { available: true, reason: null, source: 'travel_availability_resolver' };
}


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterId, ownerEmail } = await req.json();

    if (!characterId) {
      return new Response(JSON.stringify({ error: 'characterId is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    let character = null;
    const query = ownerEmail ? { id: characterId, owner_email: ownerEmail } : { id: characterId };
    const chars = await base44.entities.Character.filter(query);
    character = chars[0] || null;

    if (!character) {
      return new Response(JSON.stringify({ error: `Character not found for id: ${characterId}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    const locations = await base44.entities.LocationReference.list(null, 500).catch(() => []);
    const locationMap = locations.reduce((acc, loc) => { acc[loc.id] = loc; return acc; }, {});

    const et = nowET();
    
    const homeCardResult = resolveHomeCardState(character, locationMap);
    const travelResult = resolveTravelAvailability(character);

    const snapshot = {
      character_id: character.id,
      character_name: character.name,
      checked_at_app_time_et: et.toISOString(),
      database_state: {
        presence_status: { value: character.resolved_presence_status || null, source: 'database_character_record' },
        resolved_current_location_name: { value: character.resolved_current_location_name || null, source: 'database_character_record' },
      },
      page_facing_state: {
        home_card: {
            displayed_status: { value: homeCardResult.label, source: homeCardResult.source },
            displayed_location: { value: homeCardResult.sublabel, source: homeCardResult.source },
        },
        travel_page: {
            available_for_travel: { value: travelResult.available, source: travelResult.source },
            unavailable_reason: { value: travelResult.reason, source: travelResult.source },
        },
      },
      estimated_state: {},
      contradictions: [],
      missing_access: [
          {
              resolver: "who_is_coming_list",
              reason: "Who's Coming list requires a full roster of active characters and their resolved locations to build a spatial occupancy map. The backend cannot compute this for all characters in a single function.",
              affected_pages: ["travel_page"],
          }
      ]
    };

    if (snapshot.database_state.presence_status.value !== homeCardResult.status) {
        snapshot.contradictions.push({
            field: 'presence_status',
            database_value: snapshot.database_state.presence_status.value,
            ui_value: homeCardResult.status,
            affected_page: 'Home',
            severity: 'medium',
        });
    }

    return new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, stack: error.stack }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});