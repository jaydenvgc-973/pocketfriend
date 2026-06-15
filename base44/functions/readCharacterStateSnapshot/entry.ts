import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * readCharacterStateSnapshot — READ-ONLY GENERAL CHARACTER STATE VIEWER
 *
 * Returns targeted presence, sleep, nap, needs, and location fields for ANY
 * character by ID. Does NOT write anything. Safe for assistant NPC investigation.
 *
 * Used by: Vick's assistant NPCs for observation and verification.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    const { characterId } = await req.json().catch(() => ({}));
    if (!characterId) {
      return Response.json({ error: 'characterId is required' }, { status: 400 });
    }

    // Try user-scoped first, then service role
    let chars = [];
    if (user?.email) {
      chars = await base44.entities.Character.filter({ owner_email: user.email, id: characterId }, null, 3).catch(() => []);
    }
    if (!chars.length) {
      chars = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 5).catch(() => []);
    }
    if (!chars.length) {
      const all = await base44.asServiceRole.entities.Character.list(null, 500).catch(() => []);
      chars = all.filter(c => c.id === characterId);
    }

    if (!chars.length) {
      return Response.json({ error: 'Character not found', tried_user: !!user?.email }, { status: 404 });
    }

    const c = chars[0];

    // Check if user is present at character's location
    let userPresence = null;
    if (user?.email) {
      const settings = await base44.asServiceRole.entities.UserSettings.filter(
        { owner_email: c.owner_email || user.email }, null, 1
      ).catch(() => []);
      if (settings.length > 0) {
        userPresence = {
          user_presence_status: settings[0].user_presence_status,
          user_current_location_id: settings[0].user_current_location_id,
          user_current_location_name: settings[0].user_current_location_name,
          co_present: settings[0].user_current_location_id === c.resolved_current_location_id,
        };
      }
    }

    return Response.json({
      character_id: c.id,
      character_name: c.name,
      character_type: c.character_type,
      owner_email: c.owner_email,
      status: c.status,
      // ── Presence & location ──────────────────────────────────────────
      resolved_presence_status: c.resolved_presence_status,
      resolved_current_location_id: c.resolved_current_location_id,
      resolved_current_location_name: c.resolved_current_location_name,
      resolved_location_type: c.resolved_location_type,
      resolved_source_reason: c.resolved_source_reason,
      current_home_location_id: c.current_home_location_id,
      // ── Activity ─────────────────────────────────────────────────────
      current_activity: c.current_activity,
      travel_status: c.travel_status,
      travel_destination_location_id: c.travel_destination_location_id,
      // ── Sleep / nap ──────────────────────────────────────────────────
      last_sleep_start: c.last_sleep_start,
      last_wake_time: c.last_wake_time,
      last_nap_time: c.last_nap_time,
      wake_up_time: c.wake_up_time,
      sleep_start_time: c.sleep_start_time,
      sleep_interrupted_at: c.sleep_interrupted_at,
      sleep_debt_hours: c.sleep_debt_hours,
      // ── Needs ────────────────────────────────────────────────────────
      energy_value: c.energy_value,
      hunger_value: c.hunger_value,
      social_value: c.social_value,
      health_value: c.health_value,
      mental_value: c.mental_value,
      hygiene_value: c.hygiene_value,
      comfort_value: c.comfort_value,
      financial_need_value: c.financial_need_value,
      // ── Work / school ───────────────────────────────────────────────
      occupation: c.occupation,
      occupation_location_id: c.occupation_location_id,
      occupation_location_name: c.occupation_location_name,
      work_start_time: c.work_start_time,
      work_end_time: c.work_end_time,
      work_days: c.work_days,
      student_status: c.student_status,
      education_location_id: c.education_location_id,
      // ── Confinement ──────────────────────────────────────────────────
      is_jailed: c.is_jailed,
      house_arrest_active: c.house_arrest_active,
      incarceration_status: c.incarceration_status,
      // ── Locks ─────────────────────────────────────────────────────────
      sleep_lock: c.sleep_lock,
      hunger_lock: c.hunger_lock,
      presence_stay_lock: c.presence_stay_lock,
      // ── Timestamps ───────────────────────────────────────────────────
      last_need_simulated_at: c.last_need_simulated_at,
      resolved_last_updated_at: c.resolved_last_updated_at,
      updated_date: c.updated_date,
      // ── Traits (social-relevant) ─────────────────────────────────────
      social_energy: c.social_energy,
      // ── Co-presence ──────────────────────────────────────────────────
      user_presence: userPresence,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});