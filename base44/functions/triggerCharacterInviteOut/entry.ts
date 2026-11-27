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

    // owner_email is the sole ownership source of truth — created_by is permanently forbidden.
    // LEGACY COMPATIBILITY: status filter includes null/missing — legacy characters without
    // a status field are still valid and must remain eligible for invitations.
    const allCharacters = await base44.entities.Character.filter({
      owner_email: user.email,
    });

    // Exclude deleted/moved_away characters, but INCLUDE legacy chars with no status field.
    // Also exclude NPCs, service characters, test characters, and diagnostic-only records.
    const characters = allCharacters.filter(c =>
      !excludeCharacterIds.includes(c.id) &&
      c.status !== 'deleted' &&
      c.status !== 'moved_away' &&
      c.status !== 'soft_deleted' &&
      c.status !== 'merged' &&
      c.character_type !== 'npc_fictitious' &&
      c.character_type !== 'npc_family_member' &&
      c.character_type !== 'npc_world_service' &&
      c.character_type !== 'npc_regular' &&
      !c.is_test_character &&
      !c.diagnostic_only &&
      !c.exclude_from_roster
    );
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

    // ── GATHERING ROOMS ───────────────────────────────────────────────────
    // The established Gathering Rooms are social destinations of their own. They are
    // existing records — never duplicated as ordinary locations, never registered as
    // Scenes locations. Occupancy is the backend-authoritative room.current_occupancy
    // field; rooms with other people present receive more consideration, but presence
    // never guarantees selection and empty rooms stay eligible.
    const gatheringRooms = await base44.asServiceRole.entities.GatheringRoom
      .filter({ is_active: true }, 'sort_order', 20)
      .catch(() => []);

    // Cross-account presence, read once per generation from the existing session and
    // participant records of rooms that currently have people in them. No polling.
    const occupiedRoomIds = gatheringRooms
      .filter(r => (r.current_occupancy || 0) > 0)
      .map(r => r.id);
    const roomCrossAccountCount = {};
    if (occupiedRoomIds.length > 0) {
      const roomSessions = await base44.asServiceRole.entities.GatheringRoomSession
        .filter({ status: 'active' }, null, 100).catch(() => []);
      const validSessionIds = new Set(
        roomSessions
          .filter(s => new Date(s.expires_at).getTime() > Date.now())
          .map(s => s.id)
      );
      const roomParticipants = await base44.asServiceRole.entities.GatheringRoomParticipant
        .filter({ gathering_room_id: { $in: occupiedRoomIds } }, null, 100).catch(() => []);
      for (const p of roomParticipants) {
        if (!validSessionIds.has(p.session_id)) continue;
        if (p.owner_email && p.owner_email !== user.email) {
          roomCrossAccountCount[p.gathering_room_id] = (roomCrossAccountCount[p.gathering_room_id] || 0) + 1;
        }
      }
    }

    // Eligible rooms for one character: the room must have room for the proposed visit
    // (the character plus the user when the character is not already inside).
    const gatheringRoomCandidatesFor = (char) => {
      const candidates = [];
      for (const room of gatheringRooms) {
        const alreadyPresent = char.resolved_source_reason === 'gathering_room' &&
          char.resolved_current_location_id === room.id;
        const capacity = room.max_capacity || 8;
        const occupancy = room.current_occupancy || 0;
        const slotsNeeded = alreadyPresent ? 1 : 2;
        if (capacity - occupancy < slotsNeeded) continue;
        const crossAccount = roomCrossAccountCount[room.id] || 0;
        let weight = 1;                     // empty rooms remain eligible
        if (occupancy > 0) weight = 3;      // people already there — more consideration
        if (crossAccount > 0) weight = 6;   // other accounts present — strongest pull
        if (alreadyPresent) weight += 2;    // join them where they already are
        candidates.push({ room, alreadyPresent, weight });
      }
      return candidates;
    };

    const pickWeightedRoom = (candidates) => {
      const total = candidates.reduce((sum, c) => sum + c.weight, 0);
      let roll = Math.random() * total;
      for (const c of candidates) {
        roll -= c.weight;
        if (roll <= 0) return c;
      }
      return candidates[candidates.length - 1];
    };

    // ── EASTERN TIME ──────────────────────────────────────────────────────
    // UTC is forbidden for app logic. All schedule comparisons (location hours,
    // sleep checks, time-of-day venue selection) are evaluated in America/New_York.
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
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
      // Hospitalized characters are in a protected recovery state — social
      // invitations must not interrupt medical care.
      if (char.resolved_presence_status === 'hospitalized') continue;

      // INCARCERATED CHARACTER INVITE DESTINATION: An incarcerated character
      // cannot autonomously invite the user to an outside location. The invite
      // destination must be the correctional facility where they are currently
      // incarcerated. This does not prevent explicit Story Event participation
      // from temporarily placing them elsewhere — it only restricts autonomous
      // homepage invites to the facility.
      if (char.is_jailed === true) {
        const facilityId = char.incarceration_facility_id;
        const facilityName = char.incarceration_facility_name || 'Correctional Facility';
        if (!facilityId) continue; // No facility — cannot invite
        const facilityLoc = eligibleLocMap[facilityId] || null;
        const activityLabel = `at ${facilityName} — has company visiting`;
        base44.asServiceRole.entities.Character.update(char.id, {
          current_activity: activityLabel,
          current_situation: `Incarcerated — ${activityLabel}`,
          life_last_updated: now.toISOString(),
        }).catch(() => {});
        invitations.push({
          characterId: char.id,
          characterName: char.name,
          characterAvatar: char.avatar_url,
          inviteType: 'goout',
          locationId: facilityId,
          locationName: facilityName,
          locationCategory: facilityLoc?.category || 'jail_prison',
          inviteIssuedAt: now.toISOString(),
          locationClosesAt: null,
        });
        continue;
      }

      const charHome = char.current_home_location_id ? eligibleLocMap[char.current_home_location_id] : null;
      const charWork = char.occupation_location_id   ? eligibleLocMap[char.occupation_location_id]   : null;

      const socialVenues = getSocialVenuesForTime();

      let inviteType, targetLocation;
      let gatheringPick = null;
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

      // Social venue invite — ordinary venues and the established Gathering Rooms
      // share this same invitation path. A Gathering Room is not a separate kind of
      // invitation; it is one more place the character can suggest.
      if (!targetLocation) {
        const roomCandidates = gatheringRoomCandidatesFor(char);
        if (roomCandidates.length > 0 && Math.random() < 0.45) {
          gatheringPick = pickWeightedRoom(roomCandidates);
        } else if (rand < 0.3 && charHome) {
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

      // Gathering Room invitation. Generating the invitation never admits the
      // character: entry happens only through the existing entry function, after the
      // user authorizes it with Let's go or Carry on without me.
      if (gatheringPick) {
        const room = gatheringPick.room;
        if (!gatheringPick.alreadyPresent) {
          const roomPlanLabel = `planning to hang out at ${room.name}`;
          base44.asServiceRole.entities.Character.update(char.id, {
            current_activity: roomPlanLabel,
            current_situation: `Out — ${roomPlanLabel}`,
            life_last_updated: now.toISOString(),
          }).catch(() => {});
        }
        invitations.push({
          characterId: char.id,
          characterName: char.name,
          characterAvatar: char.avatar_url,
          inviteType: 'goout',
          isGatheringRoom: true,
          gatheringRoomId: room.id,
          gatheringRoomName: room.name,
          characterAlreadyPresent: gatheringPick.alreadyPresent,
          locationId: room.id,
          locationName: room.name,
          locationCategory: room.category || 'social',
          inviteIssuedAt: now.toISOString(),
          locationClosesAt: null,
        });
        continue;
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