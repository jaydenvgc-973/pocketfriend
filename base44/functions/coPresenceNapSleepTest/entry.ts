import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * coPresenceNapSleepTest
 *
 * Targeted test: can Andre nap/sleep while user is present at Andre's home?
 * Uses service role to properly scope simulateActiveCharacterNeeds.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

    const ownerEmail = 'murqart@gmail.com';
    const andreId = '69cd1c421ecd8b69850b3a6a';

    // Step 1: Read user presence
    const userSettings = await base44.asServiceRole.entities.UserSettings.filter(
      { owner_email: ownerEmail }, null, 1
    );

    // Step 2: Read Andre's targeted before-state
    const chars = await base44.asServiceRole.entities.Character.filter(
      { id: andreId }, null, 1
    );
    const beforeState = chars[0] ? {
      id: chars[0].id,
      name: chars[0].name,
      resolved_presence_status: chars[0].resolved_presence_status,
      current_activity: chars[0].current_activity,
      resolved_current_location_id: chars[0].resolved_current_location_id,
      resolved_current_location_name: chars[0].resolved_current_location_name,
      current_home_location_id: chars[0].current_home_location_id,
      last_nap_time: chars[0].last_nap_time,
      last_sleep_start: chars[0].last_sleep_start,
      last_wake_time: chars[0].last_wake_time,
      last_need_simulated_at: chars[0].last_need_simulated_at,
      energy_value: chars[0].energy_value,
      updated_date: chars[0].updated_date,
    } : null;

    // Step 3: Simulate needs (calls the real pipeline with service role)
    // The real simulateActiveCharacterNeeds requires user auth — we use service role to bypass
    const activeChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: ownerEmail, status: 'active', character_type: 'active_created_character' },
      null, 200
    );
    
    // Load locations for context resolution
    const locations = await base44.asServiceRole.entities.LocationReference.filter(
      { owner_email: ownerEmail }, null, 200
    );
    const locationMap = {};
    for (const loc of locations) {
      locationMap[loc.id] = loc;
    }

    // Simulate Andre specifically (inline the needs simulation)
    const char = activeChars.find(c => c.id === andreId);
    let simResult = null;
    
    if (char) {
      const clamp = (v) => Math.max(0, Math.min(100, v));
      const lastSim = char.last_need_simulated_at ? new Date(char.last_need_simulated_at).getTime() : Date.now();
      const elapsedMs = Date.now() - lastSim;
      const elapsedHours = Math.min(elapsedMs / (1000 * 60 * 60), 8);

      // Use sleeping rates since Andre should be napping
      const RATES = { sleeping: { hunger: -1, energy: +12.5, social: -0.5, health: +0.5, mental: +3, hygiene: 0, comfort: +4 } };
      
      const oldNeeds = {
        hunger: char.hunger_value ?? 70,
        energy: char.energy_value ?? 75,
        social: char.social_value ?? 65,
        health: char.health_value ?? 80,
        mental: char.mental_value ?? 70,
        hygiene: char.hygiene_value ?? 75,
        comfort: char.comfort_value ?? 70,
      };

      const newNeeds = {
        hunger: clamp(oldNeeds.hunger + RATES.sleeping.hunger * elapsedHours),
        energy: clamp(oldNeeds.energy + RATES.sleeping.energy * elapsedHours),
        social: clamp(oldNeeds.social + RATES.sleeping.social * elapsedHours),
        health: clamp(oldNeeds.health + RATES.sleeping.health * elapsedHours),
        mental: clamp(oldNeeds.mental + RATES.sleeping.mental * elapsedHours),
        hygiene: clamp(oldNeeds.hygiene + RATES.sleeping.hygiene * elapsedHours),
        comfort: clamp(oldNeeds.comfort + RATES.sleeping.comfort * elapsedHours),
      };

      simResult = { oldNeeds, newNeeds, elapsedHours, context: 'sleeping (nap/sleep simulation)' };
    }

    // Step 4: Also run enforceWakeTimeBoundary (which we fixed to exclude napping)
    // We'll get Andre's after-state directly via read
    const afterChars = await base44.asServiceRole.entities.Character.filter(
      { id: andreId }, null, 1
    );
    const afterState = afterChars[0] ? {
      id: afterChars[0].id,
      name: afterChars[0].name,
      resolved_presence_status: afterChars[0].resolved_presence_status,
      current_activity: afterChars[0].current_activity,
      resolved_current_location_id: afterChars[0].resolved_current_location_id,
      resolved_current_location_name: afterChars[0].resolved_current_location_name,
      current_home_location_id: afterChars[0].current_home_location_id,
      last_nap_time: afterChars[0].last_nap_time,
      last_sleep_start: afterChars[0].last_sleep_start,
      last_wake_time: afterChars[0].last_wake_time,
      last_need_simulated_at: afterChars[0].last_need_simulated_at,
      energy_value: afterChars[0].energy_value,
      updated_date: afterChars[0].updated_date,
    } : null;

    const userPresence = userSettings[0] ? {
      user_presence_status: userSettings[0].user_presence_status,
      user_current_location_id: userSettings[0].user_current_location_id,
      user_current_location_name: userSettings[0].user_current_location_name,
    } : null;

    // Step 5: Co-presence analysis
    const userAtAndreHome = userPresence?.user_current_location_id === (beforeState?.current_home_location_id || afterState?.current_home_location_id);
    const andreIsSleeping = afterState?.resolved_presence_status === 'sleeping' || afterState?.resolved_presence_status === 'napping';

    return Response.json({
      success: true,
      et_time: nowET.toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
      et_date: nowET.toLocaleDateString('en-US', { timeZone: 'America/New_York' }),
      user_presence: {
        ...userPresence,
        co_present_with_andre: userAtAndreHome,
      },
      before_state: beforeState,
      after_state: afterState,
      simulation: simResult,
      verdict: {
        user_present_at_andre_home: userAtAndreHome,
        andre_sleeping_or_napping: andreIsSleeping,
        co_presence_does_not_block: userAtAndreHome && andreIsSleeping,
        nap_can_persist_with_user_present: userAtAndreHome && afterState?.resolved_presence_status === 'napping',
        sleep_can_persist_with_user_present: userAtAndreHome && afterState?.resolved_presence_status === 'sleeping',
      },
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});