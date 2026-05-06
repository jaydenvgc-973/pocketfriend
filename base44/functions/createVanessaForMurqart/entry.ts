import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * One-time: Create Vanessa as a proper npc_family_member Character record
 * for murqart@gmail.com. She is Matt Lopez's older sister.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.email !== 'murqart@gmail.com') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const VGC_ID = '69e624f9701ccdb1a1c8753f';
    const now = new Date().toISOString();

    // Guard: don't create a duplicate
    const existing = await base44.entities.Character.filter({
      owner_email: 'murqart@gmail.com',
      name: 'Vanessa',
      character_type: 'npc_family_member',
    });
    if (existing.length > 0) {
      return Response.json({ success: false, message: 'Vanessa already exists as npc_family_member', id: existing[0].id });
    }

    // Use user-scoped create (Character RLS only allows role=user to create)
    const vanessa = await base44.entities.Character.create({
      name: 'Vanessa',
      character_type: 'npc_family_member',
      status: 'active',
      owner_email: 'murqart@gmail.com',
      owner_user_id: '69bfd8da2f47364437a2deab',
      created_by_role: 'user',
      data_scope: 'private_user',
      visibility_scope: 'account_private',
      current_home_location_id: VGC_ID,
      resolved_current_location_id: VGC_ID,
      resolved_current_location_name: 'VGC Towers',
      resolved_presence_status: 'home',
      resolved_location_type: 'home',
      resolved_source_reason: 'npc_default_home',
      resolved_last_updated_at: now,
      location_status: 'home',
      travel_status: 'not_traveling',
      location_visibility_state: 'visible',
      family_history: "Matt Lopez's older sister. Protective — tries to hold things together even when nobody asked her to. Can overstep but acts from a place of care.",
      ethnicities: ['Latino / Hispanic'],
      personality_traits: ['protective', 'organized', 'tends to overstep', 'holds things together', 'caretaker by nature'],
      gender: 'female',
      exclude_from_homepage: true,
      exclude_from_roster: false,
      is_test_character: false,
      diagnostic_only: false,
      is_default: false,
      is_homeless: false,
      hunger_value: 70,
      energy_value: 75,
      social_value: 65,
      health_value: 80,
      mental_value: 70,
      financial_need_value: 60,
      hygiene_value: 75,
      comfort_value: 70,
      friendship_level: 75,
      trust_level: 50,
      user_respect_level: 50,
      romantic_level: 0,
      attraction_level: 0,
      chosen_family_level: 0,
      relational_jealousy: 0,
      envy_jealousy: 0,
      voice_enabled: true,
      voice_name: 'alloy',
      student_status: 'not_student',
      sleep_debt_hours: 0,
      jail_sentence_days: 7,
      is_jailed: false,
      is_protected: false,
      protected_active: false,
      is_active_character: false,
      created_by_user: true,
      fictional_relationships: [],
      family_members: [],
      aliases: [],
      memories: [],
      quirks: [],
      work_days: [],
      education_enrollments: [],
      character_closet: [],
      triggered_milestones: [],
      businesses: [],
      songs_heard: [],
      videos_watched: [],
      emotional_triggers_high: [],
      emotional_triggers_medium: [],
      emotional_triggers_deep: [],
      recent_location_history: [],
      family_locked_members: [],
      additional_occupation_locations: [],
      additional_education_locations: [],
      completed_education: [],
      completed_job_training: [],
      frequented_places: [],
      transient_encounters: [],
      future_life_goals: [],
      current_job_training_activity: 'none',
      current_education_activity: 'none',
      emotional_state: 'calm',
      belief_level: 'moderate',
      religion: 'None',
      schedule_override_active: false,
      needs_initialized: false,
      alias_count: 0,
      relationship_count: 0,
      family_list_locked: false,
      is_finalized: false,
      is_photogenic: false,
      is_sitter: false,
      exclude_from_default_scene_queries: false,
    });

    // Add to VGC Towers resident list
    const vgc = await base44.entities.LocationReference.filter({ owner_email: 'murqart@gmail.com', name: 'VGC Towers' }).then(r => r[0]);
    if (vgc) {
      const residentIds = Array.from(new Set([...(vgc.resident_character_ids || []), vanessa.id]));
      const residentNames = Array.from(new Set([...(vgc.resident_character_names || []), 'Vanessa']));
      await base44.entities.LocationReference.update(VGC_ID, {
        resident_character_ids: residentIds,
        resident_character_names: residentNames,
      });
    }

    return Response.json({ success: true, id: vanessa.id, name: vanessa.name, character_type: vanessa.character_type });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});