/**
 * resolveVGCTowersPresence
 *
 * Hourly presence resolution for VGC Towers NPC residents.
 *
 * Strict rules:
 * - Only applies to character_type in [npc_family_member, npc_fictitious_person]
 * - Only applies if home_location_name === "VGC Towers"
 * - Travel window: 10:00 AM – 1:00 AM
 * - Destinations: open, non-residential public locations only
 * - Age-gates bars/clubs to 21+
 * - Does NOT assign jobs, workplaces, or schools
 * - Updates current_live_location_id on the character entity
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Correct character_type values from schema
const ELIGIBLE_TYPES = ['npc', 'family_npc', 'background', 'promoted_npc'];
const ELIGIBLE_CATEGORIES = ['food_drink', 'gym', 'social', 'outdoor', 'public', 'community', 'religion', 'grocery'];
const AGE_RESTRICTED_CATEGORIES = ['social']; // bars/clubs within social — filtered by subtype
const ADULT_ONLY_SUBTYPES = ['bar', 'club', 'nightclub', 'lounge'];

function isWithinTravelWindow(now) {
  const hour = now.getHours();
  // 10:00 AM (10) to 1:00 AM (1) — wraps midnight
  return hour >= 10 || hour < 1;
}

function isAsleep(character) {
  if (character.resolved_presence_status === 'sleeping' || character.resolved_presence_status === 'napping') return true;
  if (!character.sleep_start_time || !character.wake_up_time) return false;
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  const current = h * 60 + m;
  const [sh, sm] = character.sleep_start_time.split(':').map(Number);
  const [wh, wm] = character.wake_up_time.split(':').map(Number);
  const sleep = sh * 60 + sm;
  const wake = wh * 60 + wm;
  if (sleep > wake) return current >= sleep || current < wake;
  return current >= sleep && current < wake;
}

function isLocationOpenNow(loc, now) {
  const hours = loc.operating_hours;
  if (!hours || hours.length === 0) return true; // no hours = always open
  const dayOfWeek = now.getDay();
  const currentMin = now.getHours() * 60 + now.getMinutes();
  for (const h of hours) {
    if (h.day_of_week != null && h.day_of_week !== dayOfWeek) continue;
    const [oh, om] = h.open_time.split(':').map(Number);
    const [ch, cm] = h.close_time.split(':').map(Number);
    const openMin = oh * 60 + om;
    const closeMin = ch * 60 + cm;
    if (closeMin < openMin) {
      if (currentMin >= openMin || currentMin < closeMin) return true;
    } else {
      if (currentMin >= openMin && currentMin < closeMin) return true;
    }
  }
  return false;
}

function isAdultOnlyLocation(loc) {
  const subtypes = loc.subtype || [];
  return subtypes.some(s => ADULT_ONLY_SUBTYPES.includes(s?.toLowerCase()));
}

function isEligible(char, vgcId) {
  if (!ELIGIBLE_TYPES.includes(char.character_type)) return false;
  // Match against actual ID field (home_location_name is not a real schema field)
  if (char.current_home_location_id !== vgcId && char.resolved_current_location_id !== vgcId && char.home_location_id !== vgcId) return false;
  if (char.is_homeless) return false;
  if (isAsleep(char)) return false;
  // Respect stronger systems
  if (char.is_at_work || char.resolved_presence_status === 'at_work') return false;
  if (char.is_at_school || char.resolved_presence_status === 'at_school') return false;
  if (char.is_in_hospital) return false;
  if (char.is_in_locked_event) return false;
  if (char.is_using_user_directed_travel) return false;
  return true;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();

    if (!isWithinTravelWindow(now)) {
      // Outside travel window — send eligible residents home
      const allChars = await base44.asServiceRole.entities.Character.filter({ created_by: user.email, status: 'active' });
      const allVgcLocs = await base44.asServiceRole.entities.LocationReference.filter({ created_by: user.email });
      const vgcHome = allVgcLocs.find(l => l.name === 'VGC Towers');
      const toReturn = allChars.filter(c =>
        isEligible(c, vgcHome?.id) &&
        c.current_live_location_id &&
        c.current_live_location_id !== c.home_location_id
      );
      for (const char of toReturn) {
        await base44.asServiceRole.entities.Character.update(char.id, {
          current_live_location_id: char.home_location_id || null,
          current_live_location_name: char.home_location_name || 'VGC Towers',
          current_location_source: 'home',
          current_activity: 'idle',
        });
      }
      return Response.json({ message: 'Outside travel window — residents returned home', returned: toReturn.length });
    }

    // Get all locations scoped to current user
    const allLocations = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: user.email });
    const vgcTowers = allLocations.find(l => l.name === 'VGC Towers');

    // Valid travel destinations: open, non-residential, allowed category
    const validDestinations = allLocations.filter(loc => {
      if (loc.category === 'home') return false;
      if (!ELIGIBLE_CATEGORIES.includes(loc.category)) return false;
      if (loc.id === vgcTowers?.id) return false;
      if (!isLocationOpenNow(loc, now)) return false;
      return true;
    });

    if (validDestinations.length === 0) {
      return Response.json({ message: 'No valid travel destinations available right now' });
    }

    // Get all characters scoped to current user
    const allChars = await base44.asServiceRole.entities.Character.filter({ created_by: user.email, status: 'active' });
    const eligible = allChars.filter(c => isEligible(c, vgcTowers?.id));

    if (eligible.length === 0) {
      return Response.json({ message: 'No eligible VGC Towers NPC residents found' });
    }

    let movedCount = 0;
    let stayedCount = 0;

    for (const char of eligible) {
      // ~40% chance to move each cycle — prevents forced movement every hour
      const shouldMove = Math.random() < 0.4;

      if (!shouldMove) {
        // Keep current location if it's still valid
        if (char.current_live_location_id && char.current_live_location_id !== char.home_location_id) {
          const currentLoc = allLocations.find(l => l.id === char.current_live_location_id);
          if (currentLoc && isLocationOpenNow(currentLoc, now)) {
            stayedCount++;
            continue;
          }
        }
        // Otherwise send home
        await base44.asServiceRole.entities.Character.update(char.id, {
          current_live_location_id: char.home_location_id || vgcTowers?.id || null,
          current_live_location_name: char.home_location_name || 'VGC Towers',
          current_location_source: 'home',
          current_activity: 'idle',
        });
        stayedCount++;
        continue;
      }

      // Filter destinations by age
      const age = char.age || 0;
      const ageFilteredDests = validDestinations.filter(loc => {
        if (age < 21 && isAdultOnlyLocation(loc)) return false;
        return true;
      });

      if (ageFilteredDests.length === 0) {
        stayedCount++;
        continue;
      }

      // Pick a destination, weighted away from current location
      const choices = ageFilteredDests.filter(l => l.id !== char.current_live_location_id && l.owner_email === user.email);
      const pool = choices.length > 0 ? choices : ageFilteredDests;
      const dest = pool[Math.floor(Math.random() * pool.length)];

      // CRITICAL: Enforce user data isolation — destination must belong to same user
      if (dest.owner_email !== user.email) {
        console.warn(`[DATA_ISOLATION] Blocked cross-user NPC travel: char ${char.id} (user: ${char.owner_email}) → location ${dest.id} (owner: ${dest.owner_email})`);
        stayedCount++;
        continue;
      }

      await base44.asServiceRole.entities.Character.update(char.id, {
        current_live_location_id: dest.id,
        current_live_location_name: dest.name,
        current_location_source: 'travel',
        current_activity: 'socializing',
      });
      movedCount++;
    }

    return Response.json({
      success: true,
      eligible: eligible.length,
      moved: movedCount,
      stayed: stayedCount,
      destinations: validDestinations.length,
    });

  } catch (error) {
    console.error('resolveVGCTowersPresence error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});