import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FORCE TRAVEL STATE RESOLUTION
 * 
 * CRITICAL ENFORCEMENT: Travel is a temporary state, not persistent.
 * Any character in travel_status !== 'not_traveling' is in STALE state.
 * 
 * NO EXCEPTIONS. NO WAITING. IMMEDIATE RESOLUTION.
 * 
 * Step 1: If destination invalid → force home
 * Step 2: If destination valid → force arrival
 * Step 3: Clear all travel fields
 * 
 * Result: ZERO characters remain in traveling state.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    // Load all characters for this user — single call, no fallback retry (retry on 429 makes it worse)
    const characters = await base44.entities.Character.filter({ owner_email: user.email });

    // Identify characters in travel BEFORE loading locations
    // This avoids loading locations entirely when nothing needs fixing
    const inTravel = characters.filter(c =>
      c.travel_status && c.travel_status !== 'not_traveling'
    );

    console.log(`[forceTravelStateResolution] Found ${inTravel.length} characters in travel state`);

    // EARLY EXIT: nothing to do — skip all further reads and writes
    if (inTravel.length === 0) {
      return Response.json({
        status: 'CRITICAL_SUCCESS',
        timestamp: new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString(),
        total_in_travel_initially: 0,
        total_corrected: 0,
        total_still_traveling: 0,
        home_returns: [],
        forced_arrivals: [],
        remaining_issue: null,
      });
    }

    // Only load locations when there is actually something to resolve
    const locations = await base44.entities.LocationReference.filter({ owner_email: user.email });
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const corrections = [];
    const homeReturns = [];
    const forcedArrivals = [];

    for (const char of inTravel) {
      const destLocId = char.travel_destination_location_id;
      const destLoc = destLocId ? locationMap[destLocId] : null;

      let correction;

      // STEP 1: Destination invalid → force home
      if (!destLocId || !destLoc) {
        const homeLocId = char.current_home_location_id;
        const homeLoc = locationMap[homeLocId];
        const homeLocName = homeLoc?.name || 'Home';

        correction = {
          resolved_current_location_id: homeLocId,
          resolved_current_location_name: homeLocName,
          resolved_presence_status: 'home',
          resolved_location_type: 'home',
          travel_status: 'not_traveling',
          travel_destination_location_id: null,
          resolved_source_reason: 'stale_travel_forced_home',
        };

        homeReturns.push({
          character: char.name,
          action: 'INVALID_DESTINATION',
          detail: `destination_id ${destLocId} not found`,
          to: homeLocName,
        });
      }
      // STEP 2: Destination valid → force arrival
      else {
        correction = {
          resolved_current_location_id: destLocId,
          resolved_current_location_name: destLoc.name,
          resolved_presence_status: 'visiting',
          resolved_location_type: 'visit',
          travel_status: 'not_traveling',
          travel_destination_location_id: null,
          last_arrived_time: nowET.toISOString(),
          resolved_source_reason: 'travel_forced_completion',
        };

        forcedArrivals.push({
          character: char.name,
          action: 'FORCED_ARRIVAL',
          to: destLoc.name,
        });
      }

      // Apply correction — single owner-scoped write, no fallback retry
      try {
        await base44.entities.Character.update(char.id, correction);
        corrections.push({ character: char.name, success: true });
      } catch (writeErr) {
        console.error(`[forceTravelStateResolution] Failed to update ${char.name}:`, writeErr.message);
        corrections.push({ character: char.name, success: false, error: writeErr.message });
      }
    }

    // Derive still-traveling from in-memory corrections — no second full scan
    const failedCorrections = corrections.filter(c => !c.success).map(c => c.character);
    const stillTraveling = inTravel.filter(c => failedCorrections.includes(c.name));

    const status = stillTraveling.length === 0 ? 'CRITICAL_SUCCESS' : 'SYSTEM_STILL_BROKEN';

    return Response.json({
      status,
      timestamp: nowET.toISOString(),
      total_in_travel_initially: inTravel.length,
      total_corrected: corrections.filter(c => c.success).length,
      total_still_traveling: stillTraveling.length,
      home_returns: homeReturns,
      forced_arrivals: forcedArrivals,
      remaining_issue: stillTraveling.length > 0 ? stillTraveling.map(c => ({
        name: c.name,
        status: c.travel_status,
        destination_id: c.travel_destination_location_id,
      })) : null,
    });

  } catch (error) {
    console.error('[forceTravelStateResolution]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});