import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const characterData = body.characterData || body || {};
    const characterRelationships = body.characterRelationships || [];

    // ── BACKWARD-COMPATIBLE SCHEMA NORMALIZATION ─────────────────────────────
    // Older clients may omit newer fields. We never reject based on missing new fields.
    // Only fail if core identity is missing (name is the absolute minimum).
    if (!characterData.name || !characterData.name.trim()) {
      return Response.json({ error: 'Character name is required.' }, { status: 400 });
    }

    // Safe defaults for all fields that may be absent in older payloads
    const SAFE_DEFAULTS = {
      character_type: 'active',
      status: 'active',
      visibility_scope: 'account_private',
      aliases: [],
      quirks: [],
      character_closet: [],
      fictional_relationships: [],
      family_members: [],
      personality_traits: [],
      emotional_triggers_high: [],
      emotional_triggers_medium: [],
      emotional_triggers_deep: [],
      businesses: [],
      future_life_goals: [],
      songs_heard: [],
      videos_watched: [],
      triggered_milestones: [],
      education_enrollments: [],
      completed_education: [],
      completed_job_training: [],
      additional_occupation_locations: [],
      additional_education_locations: [],
      recent_location_history: [],
      ethnicities: [],
      needs_initialized: false,
      hunger_value: 70,
      energy_value: 75,
      social_value: 65,
      health_value: 80,
      mental_value: 70,
      hygiene_value: 75,
      comfort_value: 70,
      financial_need_value: 60,
      is_active_character: false,
      is_protected: false,
      is_finalized: false,
      is_photogenic: false,
      is_sitter: false,
      family_list_locked: false,
      lives_alone: false,
      student_status: 'not_student',
      travel_status: 'not_traveling',
      sleep_debt_hours: 0,
      location_status: 'home',
      location_visibility_state: 'visible',
      schedule_override_active: false,
      voice_enabled: true,
      voice_name: 'alloy',
      emotional_state: 'calm',
      is_jailed: false,
      jail_sentence_days: 7,
      religion: 'None',
      belief_level: 'moderate',
    };

    // Merge: safe defaults → provided data (provided data wins)
    const normalizedData = { ...SAFE_DEFAULTS, ...characterData };

    // Track which expected new fields were absent (for completion prompt later)
    const COMPLETION_FIELDS = [
      'gender', 'age_range', 'ethnicities', 'occupation', 'appearance_notes',
      'personality_summary', 'backstory', 'current_outfit', 'avatar_url',
      'sleep_start_time', 'wake_up_time', 'work_start_time', 'work_end_time',
    ];
    const missingFields = COMPLETION_FIELDS.filter(f => !normalizedData[f] || (Array.isArray(normalizedData[f]) && normalizedData[f].length === 0));
    const needsCompletion = missingFields.length > 0;

    const { system_prompt_url, ...charDataWithoutPrompt } = normalizedData;

    const newChar = await base44.entities.Character.create({
      ...charDataWithoutPrompt,
      system_prompt_url: system_prompt_url || undefined,
      owner_user_id: user.id,
      owner_email: user.email,
      created_by_role: user.role || 'user',
      visibility_scope: charDataWithoutPrompt.visibility_scope || 'account_private',
    });

    // Handle bidirectional relationships
    if (characterRelationships && characterRelationships.length > 0) {
      for (const rel of characterRelationships) {
        const relatedChar = await base44.entities.Character.filter({ id: rel.related_character_id });
        if (relatedChar[0]) {
          const existingRels = relatedChar[0].fictional_relationships || [];
          const filtered = existingRels.filter(r => r.person_name !== rel.person_name);
          const reciprocal = {
            ...rel,
            person_name: newChar.name,
            related_character_id: newChar.id,
            description: `${newChar.name} is a ${rel.relationship_type} of ${relatedChar[0].name}.`,
          };
          filtered.push(reciprocal);
          await base44.entities.Character.update(relatedChar[0].id, {
            fictional_relationships: filtered,
          });
        }
      }
    }

    return Response.json({
      success: true,
      character: newChar,
      needs_completion: needsCompletion,
      missing_fields: missingFields,
      message: needsCompletion
        ? `Character created successfully. Some profile sections can be filled in later: ${missingFields.slice(0, 3).join(', ')}${missingFields.length > 3 ? ` and ${missingFields.length - 3} more` : ''}.`
        : 'Character created successfully.',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});