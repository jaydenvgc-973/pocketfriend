import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * triggerCharacterInviteOut
 *
 * FIXED: Invite location pool is now strictly scoped to user-accessible locations only.
 * Previously used LocationReference.list() which returned ALL locations in the DB —
 * allowing characters to invite users to other users' private locations.
 *
 * Fix: fetch user-accessible locations via fetchAllLocationsForUser, then apply
 * additional invite-eligibility filters before any location is selected.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const excludeCharacterIds = payload.excludeCharacterIds || [];

    // Get active characters for this user only
    const allCharacters = await base44.entities.Character.filter({
      created_by: user.email,
      status: 'active',
    });

    const characters = allCharacters.filter(c => !excludeCharacterIds.includes(c.id));
    if (characters.length === 0) return Response.json({ invitations: [] });

    // ── LOCATION ACCESS FIX ──────────────────────────────────────────────────
    // Fetch ONLY locations this user has access to (same logic as fetchAllLocationsForUser).
    // This prevents characters from inviting users to locations they cannot see or access.
    const locationsRes = await base44.functions.invoke('fetchAllLocationsForUser', {}).catch(() => null);
    const userLocations = locationsRes?.data?.locations || [];

    // Invite-eligible: must have a name, not deleted, not a generic placeholder
    const eligibleLocations = userLocations.filter(l =>
      l.name &&
      l.status !== 'deleted' &&
      !l.is_deleted &&
      !l.is_default_generic  // exclude generic system placeholders (park/hospital/grocery/worship)
    );

    if (eligibleLocations.length === 0) {
      return Response.json({ invitations: [], reason: 'No eligible user-accessible locations found' });
    }

    // Build a quick lookup by ID from the eligible set
    const eligibleLocMap = Object.fromEntries(eligibleLocations.map(l => [l.id, l]));

    // Helper: check if location is open right now
    const isLocationOpen = (location) => {
      if (!location.operating_hours || location.operating_hours.length === 0) return true;
      const now = new Date();
      const dayOfWeek = now.getDay();
      const currentTime = now.getHours() * 60 + now.getMinutes();
      const todayHours = location.operating_hours.find(h => h.day_of_week === dayOfWeek);
      if (!todayHours) return false;
      const [openHour, openMin] = todayHours.open_time.split(':').map(Number);
      const [closeHour, closeMin] = todayHours.close_time.split(':').map(Number);
      return currentTime >= openHour * 60 + openMin && currentTime < closeHour * 60 + closeMin;
    };

    // Helper: check if character is asleep
    const isCharacterAsleep = (char) => {
      if (!char.sleep_start_time || !char.wake_up_time) return false;
      const now = new Date();
      const currentTime = now.getHours() * 60 + now.getMinutes();
      const sleepTime = parseInt(char.sleep_start_time) * 60 + parseInt((char.sleep_start_time.split(':')[1]) || 0);
      const wakeTime  = parseInt(char.wake_up_time)    * 60 + parseInt((char.wake_up_time.split(':')[1])    || 0);
      if (sleepTime > wakeTime) return currentTime >= sleepTime || currentTime < wakeTime;
      return currentTime >= sleepTime && currentTime < wakeTime;
    };

    // Randomly select 1–3 characters (cap at 2 after rate-limit in checkAndTriggerInvites)
    const count = Math.floor(Math.random() * 3) + 1;
    const selected = [];
    const used = new Set();
    for (let i = 0; i < count && selected.length < characters.length; i++) {
      let char;
      let attempts = 0;
      do {
        char = characters[Math.floor(Math.random() * characters.length)];
        attempts++;
      } while (used.has(char.id) && attempts < 10);
      if (!used.has(char.id)) { used.add(char.id); selected.push(char); }
    }

    const invitations = selected
      .filter(char => !isCharacterAsleep(char))
      .map(char => {
        // Character's home and work — ONLY if they are in the user's eligible location pool.
        // This is the core fix: a character cannot use a location the user doesn't have access to.
        const charHome = char.current_home_location_id ? eligibleLocMap[char.current_home_location_id] : null;
        const charWork = char.occupation_location_id   ? eligibleLocMap[char.occupation_location_id]   : null;

        // Social venues: only from user-accessible locations with appropriate categories
        const socialVenues = eligibleLocations.filter(l =>
          ['social', 'food_drink', 'gym', 'outdoor'].includes(l.category) &&
          isLocationOpen(l)
        );

        let inviteType, targetLocation;
        const rand = Math.random();

        // If character is on shift at an accessible work location, optionally invite there
        if (charWork && isLocationOpen(charWork)) {
          const now = new Date();
          const currentTime = now.getHours() * 60 + now.getMinutes();
          const workStart = parseInt((char.work_start_time || '09:00').split(':')[0]) * 60 + parseInt((char.work_start_time || '09:00').split(':')[1] || 0);
          const workEnd   = parseInt((char.work_end_time   || '17:00').split(':')[0]) * 60 + parseInt((char.work_end_time   || '17:00').split(':')[1] || 0);
          if (currentTime >= workStart && currentTime < workEnd && rand < 0.4) {
            inviteType = 'goout';
            targetLocation = charWork;
          }
        }

        // Otherwise pick home or social venue — all from eligible (user-accessible) pool only
        if (!targetLocation) {
          if (rand < 0.35 && charHome) {
            inviteType = 'home';
            targetLocation = charHome;
          } else if (socialVenues.length > 0) {
            inviteType = 'goout';
            targetLocation = socialVenues[Math.floor(Math.random() * socialVenues.length)];
          } else if (charHome) {
            inviteType = 'home';
            targetLocation = charHome;
          } else {
            return null; // No eligible location available for this character
          }
        }

        // Final guard: confirm chosen location is still in the eligible set
        if (!eligibleLocMap[targetLocation.id]) return null;

        return {
          characterId: char.id,
          characterName: char.name,
          characterAvatar: char.avatar_url,
          inviteType,
          locationId: targetLocation.id,
          locationName: targetLocation.name,
          locationCategory: targetLocation.category,
        };
      })
      .filter(Boolean);

    return Response.json({ invitations });
  } catch (error) {
    console.error('[triggerCharacterInviteOut]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});