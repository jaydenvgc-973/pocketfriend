import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * CHAT LOCATION CHANGE VALIDATOR
 * 
 * When a character claims a location in chat that differs from current state,
 * validate whether that movement is plausible or reject it with clear reasoning.
 * 
 * Do NOT default to home. Do NOT erase claimed locations.
 * Either confirm the move or explain why it's invalid.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, claimedLocationName } = await req.json();
    if (!characterId || !claimedLocationName) {
      return Response.json({ error: 'Missing characterId or claimedLocationName' }, { status: 400 });
    }

    // Fetch character and all locations
    const char = await base44.entities.Character.filter({ id: characterId }).then(r => r[0]);
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    const locRes = await base44.functions.invoke('fetchAllLocationsForUser', {});
    const allLocs = locRes?.data?.locations || [];

    // Find claimed location by name (case-insensitive, partial match allowed)
    const claimedLower = claimedLocationName.toLowerCase();
    const claimedLoc = allLocs.find(l => 
      l.name?.toLowerCase().includes(claimedLower) || 
      claimedLower.includes(l.name?.toLowerCase())
    );

    if (!claimedLoc) {
      return Response.json({
        valid: false,
        reason: `Location "${claimedLocationName}" not found in account`,
        claimedLocationName,
        currentLocationId: char.resolved_current_location_id,
        currentLocationName: char.resolved_current_location_name,
      });
    }

    // Check if location is open/valid (operating hours check)
    const now = new Date();
    const nowET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfWeek = nowET.getDay();
    const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();

    const isOpen = (() => {
      if (!claimedLoc.operating_hours || claimedLoc.operating_hours.length === 0) return true; // no hours = always open
      const todayEntries = claimedLoc.operating_hours.filter(h => h.day_of_week === dayOfWeek);
      const agnosticEntries = claimedLoc.operating_hours.filter(h => h.day_of_week == null);
      const relevantEntries = todayEntries.length > 0 ? todayEntries : agnosticEntries;

      return relevantEntries.some(h => {
        if (!h.open_time || !h.close_time) return true;
        const [oh, om] = h.open_time.split(':').map(Number);
        const [ch, cm] = h.close_time.split(':').map(Number);
        const openMin = oh * 60 + om;
        const closeMin = ch * 60 + cm;
        if (openMin <= closeMin) return currentMinutes >= openMin && currentMinutes <= closeMin;
        return currentMinutes >= openMin || currentMinutes <= closeMin;
      });
    })();

    if (!isOpen) {
      return Response.json({
        valid: false,
        reason: `"${claimedLoc.name}" is currently closed`,
        claimedLocationId: claimedLoc.id,
        claimedLocationName: claimedLoc.name,
        currentLocationId: char.resolved_current_location_id,
        currentLocationName: char.resolved_current_location_name,
      });
    }

    // Check if character is on an active required shift at a different location
    const homeLocId = char.current_home_location_id;
    const workLocId = char.occupation_location_id;
    const isAtWork = char.resolved_current_location_id === workLocId;

    if (isAtWork && workLocId !== claimedLoc.id) {
      // Check if work schedule is currently active
      const workLoc = allLocs.find(l => l.id === workLocId);
      const onShiftNow = (() => {
        if (!workLoc?.worker_shifts?.[characterId]) return false;
        const shift = workLoc.worker_shifts[characterId];
        if (!shift.start || !shift.end || !shift.days) return false;
        if (!shift.days.includes(dayOfWeek)) return false;
        const [startH, startM] = shift.start.split(':').map(Number);
        const [endH, endM] = shift.end.split(':').map(Number);
        const startMin = startH * 60 + startM;
        const endMin = endH * 60 + endM;
        return currentMinutes >= startMin && currentMinutes <= endMin;
      })();

      if (onShiftNow) {
        return Response.json({
          valid: false,
          reason: `Character is on an active work shift at "${workLoc?.name}" and cannot leave during shift hours`,
          claimedLocationId: claimedLoc.id,
          claimedLocationName: claimedLoc.name,
          currentLocationId: workLocId,
          currentLocationName: workLoc?.name,
        });
      }
    }

    // Movement is valid — character can go to claimed location
    return Response.json({
      valid: true,
      claimedLocationId: claimedLoc.id,
      claimedLocationName: claimedLoc.name,
      isOpen: true,
      currentLocationId: char.resolved_current_location_id,
      currentLocationName: char.resolved_current_location_name,
      reason: `Character can travel to "${claimedLoc.name}"`,
    });
  } catch (error) {
    console.error('[validateChatLocationChange]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});