import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * ensureVickServicio
 *
 * Creates Vick Servicio and the VGC Recovery Yard for a given user world.
 * Called during world initialization (first character creation) and can be
 * called idempotently at any time — safe to re-run if either is missing.
 *
 * ATOMICITY RULE: Both Vick and VGC Recovery Yard must be created together.
 * Creating one without the other is a failure condition.
 *
 * OWNERSHIP: Each account gets its own independent Vick + Recovery Yard.
 * No crossover, sync, or sharing between accounts.
 *
 * PROTECTION:
 *   - character_type: 'npc_world_service'
 *   - is_world_service: true
 *   - is_protected: true
 *   These flags prevent deletion, archival, merging, and cleanup targeting.
 *
 * RESIDENCE: Vick lives and works at VGC Recovery Yard.
 *   He is NOT a VGC Towers resident. Never assign him there.
 */

const VICK_AVATAR_URL = 'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/b39f01ca3_file_00000000f4cc722f995295ba541123ac.png';
const RECOVERY_YARD_IMAGE_URL = 'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/aa5af2607_file_00000000f4cc722f995295ba541123ac.png';
const RECOVERY_YARD_IMAGE_2_URL = 'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/52429458f_file_00000000eca0720cbe59d7b2c22a4e3a.png';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let payload = {};
    try { payload = await req.json(); } catch (_) {}
    const { ownerEmail: payloadEmail } = payload;

    // Resolve the target owner email — payload takes precedence, otherwise authenticated user
    let ownerEmail = payloadEmail || null;
    if (!ownerEmail) {
      try {
        const user = await base44.auth.me();
        ownerEmail = user?.email || null;
      } catch (_) {}
    }

    if (!ownerEmail) {
      return Response.json({ error: 'ownerEmail required — pass in payload or authenticate' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const results = { vick: null, recoveryYard: null, created: { vick: false, recoveryYard: false } };

    // ── STEP 1: Ensure VGC Recovery Yard exists ───────────────────────────────
    // Check by name + owner_email to prevent duplicates.
    let recoveryYard = null;
    try {
      const existing = await base44.asServiceRole.entities.LocationReference.filter({
        owner_email: ownerEmail,
        name: 'VGC Recovery Yard',
      });
      recoveryYard = existing[0] || null;
    } catch (_) {}

    if (!recoveryYard) {
      recoveryYard = await base44.asServiceRole.entities.LocationReference.create({
        name: 'VGC Recovery Yard',
        owner_email: ownerEmail,
        owner_is_npc: true,
        owner_npc_name: 'Vick Servicio',
        scope: 'account_global',
        location_type: 'global',
        category: 'business',
        is_user_created: false,
        is_system_managed: true,
        description: 'A modern, professionally operated recovery and restoration facility. The Recovery Yard handles recovered belongings, duplicate items, damaged property, lost inventory, and items under review. Operated by Vick Servicio. Recovery Warehouse, Inspection Area, Restoration Workshop, Quarantine Storage, Archive Storage, Administrative Offices, and Visitor Review Areas. Review. Restore. Recover.',
        subtype: ['recovery', 'restoration', 'quarantine', 'warehouse'],
        features: ['recovery_warehouse', 'inspection_area', 'restoration_workshop', 'quarantine_storage', 'archive_storage', 'administrative_offices', 'visitor_review'],
        image_urls: [RECOVERY_YARD_IMAGE_URL, RECOVERY_YARD_IMAGE_2_URL],
        zones: [
          { zone_name: 'Recovery Warehouse', zone_description: 'Primary intake and storage for recovered items awaiting review.', image_urls: [RECOVERY_YARD_IMAGE_URL] },
          { zone_name: 'Inspection & Review Area', zone_description: 'Where items are examined, documented, and evaluated.', image_urls: [] },
          { zone_name: 'Restoration & Repair Workshop', zone_description: 'Dedicated space for restoring damaged or incomplete items.', image_urls: [] },
          { zone_name: 'Quarantine Storage', zone_description: 'Secure holding area for items removed from active circulation pending final determination.', image_urls: [] },
          { zone_name: 'Archive Storage', zone_description: 'Long-term storage for items confirmed as inactive but preserved for reference.', image_urls: [] },
          { zone_name: 'Administrative Offices', zone_description: 'Vick\'s operations hub and management suite.', image_urls: [RECOVERY_YARD_IMAGE_2_URL] },
          { zone_name: 'Residential Suite', zone_description: 'Vick\'s private on-site residence. Not accessible to visitors.', image_urls: [] },
        ],
        worker_character_ids: [],
        worker_job_titles: {},
        resident_character_ids: [],
        resident_character_names: [],
        // Recovery Yard is open standard business hours for visitors
        operating_hours: [
          { day_of_week: 1, open_time: '08:00', close_time: '18:00' },
          { day_of_week: 2, open_time: '08:00', close_time: '18:00' },
          { day_of_week: 3, open_time: '08:00', close_time: '18:00' },
          { day_of_week: 4, open_time: '08:00', close_time: '18:00' },
          { day_of_week: 5, open_time: '08:00', close_time: '18:00' },
          { day_of_week: 6, open_time: '09:00', close_time: '14:00' },
        ],
      });
      results.created.recoveryYard = true;
      console.log(`[ensureVickServicio] Created VGC Recovery Yard (${recoveryYard.id}) for ${ownerEmail}`);
    } else {
      console.log(`[ensureVickServicio] VGC Recovery Yard already exists (${recoveryYard.id}) for ${ownerEmail}`);
    }
    results.recoveryYard = { id: recoveryYard.id, name: recoveryYard.name };

    // ── STEP 2: Ensure Vick Servicio character exists ─────────────────────────
    // Check by name + owner_email + character_type to prevent duplicates.
    let vick = null;
    try {
      const existingVick = await base44.asServiceRole.entities.Character.filter({
        owner_email: ownerEmail,
        name: 'Vick Servicio',
      });
      vick = existingVick.find(c => c.character_type === 'npc_world_service' || c.is_world_service === true) || existingVick[0] || null;
    } catch (_) {}

    if (!vick) {
      vick = await base44.asServiceRole.entities.Character.create({
        name: 'Vick Servicio',
        primary_name: 'Vick',
        display_name: 'Vick Servicio',
        full_name: 'Victor Servicio',
        owner_email: ownerEmail,
        character_type: 'npc_world_service',
        is_world_service: true,
        is_protected: true,
        protected_active: true,
        created_by_user: false,
        status: 'active',
        data_scope: 'private_user',
        visibility_scope: 'account_private',

        // Identity
        gender: 'male',
        age: 42,
        appearance_age: 42,
        age_range: '40s',
        ethnicities: ['Latino', 'Mixed'],
        zodiac_sign: 'Taurus',

        // Avatar — supplied reference image
        avatar_url: VICK_AVATAR_URL,
        image_avatar_url: VICK_AVATAR_URL,
        reference_image_urls: [VICK_AVATAR_URL],
        is_photogenic: true,
        appearance_notes: 'Medium-dark complexion, short curly hair with natural texture, light facial stubble. Athletic build, composed posture. Usually wears dark tactical-style clothing: black polo or work shirt, dark cargo jacket, dark cargo pants, black belt, black tactical watch. Functional and clean. No flash.',
        avatar_description_text: 'Latino male in his early 40s, medium-dark skin, short curly hair, light goatee stubble. Standing confidently in a warehouse environment wearing a dark olive zip jacket over a black polo, dark cargo pants, and a black watch.',

        // Occupation
        occupation: 'Recovery Yard Operator',
        occupation_location_id: recoveryYard.id,
        occupation_location_name: recoveryYard.name,
        work_start_time: '07:00',
        work_end_time: '19:00',
        work_days: [1, 2, 3, 4, 5, 6],
        current_work_location_id: recoveryYard.id,

        // Home = Recovery Yard (on-site residence)
        current_home_location_id: recoveryYard.id,
        lives_alone: true,
        housing_context: 'stable_home',
        is_homeless: false,

        // Presence — starts at Recovery Yard
        resolved_current_location_id: recoveryYard.id,
        resolved_current_location_name: recoveryYard.name,
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'world_service_initial_placement',
        resolved_last_updated_at: now,
        location_status: 'home',
        travel_status: 'not_traveling',
        location_visibility_state: 'visible',

        // Sleep — early riser, long days
        sleep_start_time: '22:00',
        wake_up_time: '05:30',

        // Profile
        profile_summary: 'Operator of the VGC Recovery Yard — a clean, professional recovery and restoration facility. Vick Servicio handles recovered belongings, lost property, duplicate items, damaged goods, and anything that seems out of place. He is known throughout the neighborhood as the man who notices things others overlook. His philosophy is simple: if he is not sure something is useless, he holds onto it. He would rather save something twice than throw it away once.',
        backstory: 'Vick grew up understanding the value of things people leave behind. Before running the Recovery Yard, he worked in logistics, salvage, and property recovery across several industries. He eventually founded VGC Recovery Yard as a professional operation — not a dump, but a campus. A place where lost things get a second chance to be found by the people who need them.',
        current_situation: 'Managing day-to-day operations at VGC Recovery Yard. Overseeing intake, inspection, quarantine, restoration, and archival. Known to personally investigate anything that seems unusual or out of place.',
        personality_summary: 'Calm, observant, methodical, and direct. Vick does not waste words or energy. He has a dry sense of humor and rarely shows surprise — he has seen too much to be easily caught off guard. He takes his work seriously because he knows that the wrong call in either direction costs someone something.',
        communication_style: 'Direct, measured, and unhurried. Speaks with the confidence of someone who has handled difficult situations before. Does not dramatize. Comfortable with silence. Will tell you exactly what he found and what he thinks about it.',
        archetype: 'The Specialist',
        social_energy: 'introvert',
        style_identity: 'Functional. Dark tactical-adjacent workwear. Clean and professional without being formal. No logos.',

        // Traits
        trait_blunt: true,
        trait_loyal: true,
        trait_conscientious: true,
        trait_law_abiding: true,
        trait_leader: true,
        trait_dry_humor: true,
        trait_hard_to_read: true,
        trait_morning_person: true,

        // Needs — well-maintained, grounded
        hunger_value: 75,
        energy_value: 80,
        social_value: 60,
        health_value: 85,
        mental_value: 78,
        hygiene_value: 85,
        comfort_value: 80,
        financial_need_value: 70,
        needs_initialized: true,

        // Exclusions — Vick does not participate in normal NPC systems
        exclude_from_homepage: true,
        exclude_from_default_scene_queries: false,
        exclude_from_roster: false,
        is_test_character: false,
        diagnostic_only: false,
      });
      results.created.vick = true;
      console.log(`[ensureVickServicio] Created Vick Servicio (${vick.id}) for ${ownerEmail}`);
    } else {
      // Vick exists — ensure is_world_service protection flags are set (repair if missing)
      if (!vick.is_world_service || !vick.is_protected) {
        await base44.asServiceRole.entities.Character.update(vick.id, {
          is_world_service: true,
          is_protected: true,
          protected_active: true,
          character_type: 'npc_world_service',
        }).catch(() => {});
        console.log(`[ensureVickServicio] Repaired protection flags on existing Vick (${vick.id}) for ${ownerEmail}`);
      }
      console.log(`[ensureVickServicio] Vick Servicio already exists (${vick.id}) for ${ownerEmail}`);
    }
    results.vick = { id: vick.id, name: vick.name };

    // ── STEP 3: Ensure Recovery Yard has Vick as worker + resident ───────────
    // Update ownership fields now that we have Vick's ID.
    const yardWorkerIds = Array.from(new Set([...(recoveryYard.worker_character_ids || []), vick.id]));
    const yardResidentIds = Array.from(new Set([...(recoveryYard.resident_character_ids || []), vick.id]));
    const yardResidentNames = Array.from(new Set([...(recoveryYard.resident_character_names || []), vick.name]));
    const jobTitles = { ...(recoveryYard.worker_job_titles || {}), [vick.id]: 'Recovery Yard Operator' };

    await base44.asServiceRole.entities.LocationReference.update(recoveryYard.id, {
      owner_character_id: vick.id,
      owner_character_name: vick.name,
      owner_is_npc: true,
      owner_npc_name: 'Vick Servicio',
      owner_role: 'operator',
      worker_character_ids: yardWorkerIds,
      worker_job_titles: jobTitles,
      resident_character_ids: yardResidentIds,
      resident_character_names: yardResidentNames,
    }).catch(e => console.warn(`[ensureVickServicio] Non-fatal: could not update yard ownership — ${e.message}`));

    // ── STEP 4: Ensure CharacterFinancial record with $20,000 starting balance ─
    try {
      const finRecs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: vick.id });
      if (!finRecs[0]) {
        await base44.asServiceRole.entities.CharacterFinancial.create({
          character_id: vick.id,
          character_name: vick.name,
          owner_email: ownerEmail,
          is_npc: true,
          home_location_id: recoveryYard.id,
          home_location_name: recoveryYard.name,
          work_location_ids: [recoveryYard.id],
          work_location_names: [recoveryYard.name],
          current_balance: 20000,
          total_income: 0,
          total_expenses: 0,
        });
        console.log(`[ensureVickServicio] Created CharacterFinancial for Vick ($20,000) for ${ownerEmail}`);
      }
    } catch (finErr) {
      console.warn(`[ensureVickServicio] Non-fatal: CharacterFinancial create failed — ${finErr.message}`);
    }

    return Response.json({
      success: true,
      ownerEmail,
      vick: results.vick,
      recoveryYard: results.recoveryYard,
      created: results.created,
      message: results.created.vick || results.created.recoveryYard
        ? `World service initialized: Vick=${results.created.vick ? 'created' : 'existed'}, RecoveryYard=${results.created.recoveryYard ? 'created' : 'existed'}`
        : 'World service already fully initialized — no changes made.',
    });

  } catch (error) {
    console.error('[ensureVickServicio]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});