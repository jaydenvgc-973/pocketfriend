import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * triggerCharacterInviteOut
 *
 * Generates invite proposals for characters going out.
 * KEY BEHAVIORS:
 * - Characters go to the location regardless of whether user accepts
 * - Invites are checked for freshness (location open, char not asleep)
 * - Invite must connect to real presence update
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const excludeCharacterIds = payload.excludeCharacterIds || [];

    const allCharacters = await base44.entities.Character.filter({
      created_by: user.email,
      status: 'active',
    });

    const characters = allCharacters.filter(c => !excludeCharacterIds.includes(c.id));
    if (characters.length === 0) return Response.json({ invitations: [] });

    // Fetch only user-accessible locations
    const locationsRes = await base44.functions.invoke('fetchAllLocationsForUser', {}).catch(() => null);
    const userLocations = locationsRes?.data?.locations || [];

    // Invite-eligible: must have a name, not generic placeholder, not deleted
    const eligibleLocations = userLocations.filter(l =>
      l.name &&
      l.status !== 'deleted' &&
      !l.is_deleted &&
      !l.is_default_generic
    );

    if (eligibleLocations.length === 0) {
      return Response.json({ invitations: [], reason: 'No eligible locations found' });
    }

    const eligibleLocMap = Object.fromEntries(eligibleLocations.map(l => [l.id, l]));

    const now = new Date();
    const currentHour = now.getHours();
    const currentDayMinutes = now.getHours() * 60 + now.getMinutes();

    // Check if a location is currently open
    const isLocationOpen = (location) => {
      if (!location.operating_hours || location.operating_hours.length === 0) return true;
      const dayOfWeek = now.getDay();
      const todayHours = location.operating_hours.find(h => h.day_of_week === dayOfWeek);
      if (!todayHours) return false;
      const [openHour, openMin] = todayHours.open_time.split(':').map(Number);
      const [closeHour, closeMin] = todayHours.close_time.split(':').map(Number);
      // Ensure there's at least 30 minutes left before closing
      const closeMinutes = closeHour * 60 + closeMin;
      return currentDayMinutes >= openHour * 60 + openMin && currentDayMinutes < closeMinutes - 30;
    };

    // Check if a location will be open for at least 1 more hour (worth inviting to)
    const hasRemainingTime = (location) => {
      if (!location.operating_hours || location.operating_hours.length === 0) return true;
      const dayOfWeek = now.getDay();
      const todayHours = location.operating_hours.find(h => h.day_of_week === dayOfWeek);
      if (!todayHours) return false;
      const [closeHour, closeMin] = todayHours.close_time.split(':').map(Number);
      const closeMinutes = closeHour * 60 + closeMin;
      return closeMinutes - currentDayMinutes >= 60; // At least 60 minutes left
    };

    const isCharacterAsleep = (char) => {
      if (!char.sleep_start_time || !char.wake_up_time) return false;
      const sleepTime = parseInt(char.sleep_start_time.split(':')[0]) * 60 + parseInt((char.sleep_start_time.split(':')[1]) || 0);
      const wakeTime  = parseInt(char.wake_up_time.split(':')[0])    * 60 + parseInt((char.wake_up_time.split(':')[1])    || 0);
      if (sleepTime > wakeTime) return currentDayMinutes >= sleepTime || currentDayMinutes < wakeTime;
      return currentDayMinutes >= sleepTime && currentDayMinutes < wakeTime;
    };

    // Pick appropriate social venues based on time of day
    const getSocialVenuesForTime = () => {
      return eligibleLocations.filter(l => {
        if (!isLocationOpen(l) || !hasRemainingTime(l)) return false;
        const cat = l.category;
        // Morning: cafes, gyms, outdoor, food
        if (currentHour >= 6 && currentHour < 12) {
          return ['food_drink', 'gym', 'outdoor', 'social'].includes(cat);
        }
        // Afternoon: food, social, outdoor, gym, generic
        if (currentHour >= 12 && currentHour < 17) {
          return ['food_drink', 'social', 'outdoor', 'gym', 'generic'].includes(cat);
        }
        // Evening: everything including bars, restaurants, social
        if (currentHour >= 17 && currentHour < 23) {
          return ['food_drink', 'social', 'outdoor', 'generic', 'community'].includes(cat);
        }
        // Late night: bars/social only
        return ['social', 'food_drink'].includes(cat);
      });
    };

    const count = Math.min(2, Math.floor(Math.random() * 3) + 1);
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

    const invitations = [];

    for (const char of selected) {
      // Skip asleep characters — no invite possible, they're sleeping
      if (isCharacterAsleep(char)) continue;

      const charHome = char.current_home_location_id ? eligibleLocMap[char.current_home_location_id] : null;
      const charWork = char.occupation_location_id   ? eligibleLocMap[char.occupation_location_id]   : null;

      const socialVenues = getSocialVenuesForTime();

      let inviteType, targetLocation;
      const rand = Math.random();

      // Work invite — only if char is currently on shift AND location is open with time remaining
      if (charWork && isLocationOpen(charWork) && hasRemainingTime(charWork)) {
        const workStart = parseInt((char.work_start_time || '09:00').split(':')[0]) * 60 + parseInt((char.work_start_time || '09:00').split(':')[1] || 0);
        const workEnd   = parseInt((char.work_end_time   || '17:00').split(':')[0]) * 60 + parseInt((char.work_end_time   || '17:00').split(':')[1] || 0);
        if (currentDayMinutes >= workStart && currentDayMinutes < workEnd && rand < 0.35) {
          inviteType = 'goout';
          targetLocation = charWork;
        }
      }

      // Social venue invite
      if (!targetLocation) {
        if (rand < 0.3 && charHome) {
          inviteType = 'home';
          targetLocation = charHome;
        } else if (socialVenues.length > 0) {
          inviteType = 'goout';
          targetLocation = socialVenues[Math.floor(Math.random() * socialVenues.length)];
        } else if (charHome) {
          inviteType = 'home';
          targetLocation = charHome;
        } else {
          continue; // No eligible location
        }
      }

      if (!targetLocation || !eligibleLocMap[targetLocation.id]) continue;

      // RULE: Character goes to their planned location regardless of user response.
      // Update character presence immediately to reflect they're heading there.
      const activityLabel = inviteType === 'home'
        ? `at home — has company planned`
        : `heading to ${targetLocation.name}`;

      // Async presence update — character goes whether or not user accepts
      base44.asServiceRole.entities.Character.update(char.id, {
        current_activity: activityLabel,
        current_situation: `Out — ${activityLabel}`,
        life_last_updated: now.toISOString(),
      }).catch(() => {});

      invitations.push({
        characterId: char.id,
        characterName: char.name,
        characterAvatar: char.avatar_url,
        inviteType,
        locationId: targetLocation.id,
        locationName: targetLocation.name,
        locationCategory: targetLocation.category,
        // Include timestamp so frontend can detect staleness
        inviteIssuedAt: now.toISOString(),
        // Include closing time if available so frontend can auto-expire
        locationClosesAt: (() => {
          const hours = targetLocation.operating_hours;
          if (!hours || !hours.length) return null;
          const todayHours = hours.find(h => h.day_of_week === now.getDay());
          if (!todayHours) return null;
          return todayHours.close_time;
        })(),
      });
    }

    return Response.json({ invitations });
  } catch (error) {
    console.error('[triggerCharacterInviteOut]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});