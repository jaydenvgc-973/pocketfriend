import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * rebuildAdobevgcVick
 *
 * SURGICAL REPAIR for adobevgc@gmail.com Vick Servicio.
 *
 * Situation:
 * - The adobevgc@gmail.com account has a VGC Recovery Yard (ID: 6a2461a5d1cc1114ad072a2a)
 *   with a stale/broken owner_character_id pointing to a non-existent character.
 * - There is NO active Vick Servicio character on adobevgc@gmail.com.
 * - murqart@gmail.com Vick (6a23580f06f68528940c6ddd) is UNTOUCHED and SAFE.
 *
 * This function:
 * 1. Deletes the broken adobevgc Recovery Yard (it has no valid character anchor).
 * 2. Creates a fresh VGC Recovery Yard for adobevgc@gmail.com with the EXACT same
 *    zone images copied from murqart@gmail.com's canonical yard.
 * 3. Creates a fresh Vick Servicio character for adobevgc@gmail.com using the exact
 *    same avatar and reference images from the canonical murqart@gmail.com Vick.
 * 4. Links character to yard correctly.
 *
 * murqart@gmail.com is NOT TOUCHED in any way.
 * Admin only.
 */

// ── CANONICAL IMAGE ASSETS (from murqart@gmail.com canonical records) ─────────
// Avatar — Vick Servicio portrait (canonical, used on both accounts)
const VICK_AVATAR_URL = 'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/b39f01ca3_file_00000000f4cc722f995295ba541123ac.png';

// Primary location images
const RECOVERY_YARD_EXTERIOR = 'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/aa5af2607_file_00000000f4cc722f995295ba541123ac.png';
const ADMIN_OFFICES_URL = 'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/52429458f_file_00000000eca0720cbe59d7b2c22a4e3a.png';

// Zone images — exact copies from murqart@gmail.com canonical yard (ID: 6a23580e6c67852d1b87d01e)
const ZONES = [
  {
    zone_name: 'Recovery Warehouse',
    zone_description: 'Primary intake and storage for recovered items awaiting review.',
    image_urls: [
      'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/a438c5749_generated_image.png',
      'https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/84aad84ee_1000030587.png',
      'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/08d696851_generated_image.png',
    ],
  },
  {
    zone_name: 'Inspection & Review Area',
    zone_description: 'Where items are examined, documented, catalogued, and evaluated before any action is taken.',
    image_urls: [
      'https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/cdd90b9bc_1000030585.png',
    ],
  },
  {
    zone_name: 'Restoration & Repair Workshop',
    zone_description: 'Dedicated space for restoring damaged or incomplete items to working condition.',
    image_urls: [
      'https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/30f191342_1000030586.png',
      'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/1ca8bf77d_generated_image.png',
    ],
  },
  {
    zone_name: 'Quarantine Storage',
    zone_description: 'Secure holding area for items removed from active circulation pending final determination.',
    image_urls: [
      'https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/015403256_1000030590.jpg',
    ],
  },
  {
    zone_name: 'Archive Storage',
    zone_description: 'Long-term storage for items confirmed as inactive but preserved for reference.',
    image_urls: [
      'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/94160e256_generated_image.png',
      'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/5340d18eb_generated_image.png',
      'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/00751600f_generated_image.png',
    ],
  },
  {
    zone_name: 'Administrative Offices',
    zone_description: "Vick's operations hub. Scheduling, documentation, intake records, and client coordination.",
    image_urls: [
      'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/52429458f_file_00000000eca0720cbe59d7b2c22a4e3a.png',
      'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/0e23114df_generated_image.png',
    ],
  },
  {
    zone_name: 'Residential Suite',
    zone_description: "Vick's private on-site residence. Not accessible to visitors.",
    image_urls: [
      'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/ada455c0f_generated_image.png',
      'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/a21d45dd4_generated_image.png',
    ],
  },
];

// IDs to clean up on adobevgc@gmail.com
const BROKEN_YARD_ID = '6a2461a5d1cc1114ad072a2a'; // existing broken yard on adobevgc
const OWNER_EMAIL = 'adobevgc@gmail.com';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const now = new Date().toISOString();
    const results = {
      step1_yard_deleted: false,
      step2_yard_created: null,
      step3_character_created: null,
      step4_yard_linked: false,
      errors: [],
    };

    // ── STEP 1: Delete the broken Recovery Yard on adobevgc@gmail.com ──────────
    // This yard's owner_character_id points to a non-existent character.
    // It must be removed before we create a clean one.
    try {
      await base44.asServiceRole.entities.LocationReference.delete(BROKEN_YARD_ID);
      results.step1_yard_deleted = true;
      console.log(`[rebuildAdobevgcVick] Deleted broken yard ${BROKEN_YARD_ID}`);
    } catch (e) {
      // If already gone, that's fine — continue
      results.errors.push(`Step 1 (delete yard) warning: ${e.message}`);
      console.warn(`[rebuildAdobevgcVick] Step 1 warning: ${e.message}`);
    }

    // ── STEP 2: Create fresh VGC Recovery Yard for adobevgc@gmail.com ─────────
    let newYard = null;
    try {
      newYard = await base44.asServiceRole.entities.LocationReference.create({
        name: 'VGC Recovery Yard',
        owner_email: OWNER_EMAIL,
        owner_is_npc: true,
        owner_npc_name: 'Vick Servicio',
        scope: 'account_global',
        location_type: 'global',
        category: 'business',
        is_user_created: false,
        is_system_managed: true,
        description: 'A modern, professionally operated recovery and restoration facility. VGC Recovery Yard handles recovered belongings, duplicate items, damaged property, lost inventory, and items under review. Operated by Vick Servicio. Recovery Warehouse, Inspection Area, Restoration Workshop, Quarantine Storage, Archive Storage, Administrative Offices. Review. Restore. Recover.',
        subtype: ['recovery', 'restoration', 'quarantine', 'warehouse'],
        features: ['recovery_warehouse', 'inspection_area', 'restoration_workshop', 'quarantine_storage', 'archive_storage', 'administrative_offices', 'visitor_review'],
        image_urls: [RECOVERY_YARD_EXTERIOR, ADMIN_OFFICES_URL],
        zones: ZONES,
        worker_character_ids: [],
        worker_job_titles: {},
        resident_character_ids: [],
        resident_character_names: [],
        operating_hours: [
          { day_of_week: 1, open_time: '08:00', close_time: '18:00' },
          { day_of_week: 2, open_time: '08:00', close_time: '18:00' },
          { day_of_week: 3, open_time: '08:00', close_time: '18:00' },
          { day_of_week: 4, open_time: '08:00', close_time: '18:00' },
          { day_of_week: 5, open_time: '08:00', close_time: '18:00' },
          { day_of_week: 6, open_time: '09:00', close_time: '14:00' },
        ],
      });
      results.step2_yard_created = { id: newYard.id, name: newYard.name };
      console.log(`[rebuildAdobevgcVick] Created fresh yard: ${newYard.id}`);
    } catch (e) {
      results.errors.push(`Step 2 (create yard) FAILED: ${e.message}`);
      console.error(`[rebuildAdobevgcVick] Step 2 FAILED: ${e.message}`);
      return Response.json({ success: false, error: `Could not create yard: ${e.message}`, results }, { status: 500 });
    }

    // ── STEP 3: Create fresh Vick Servicio character for adobevgc@gmail.com ───
    let newVick = null;
    try {
      newVick = await base44.asServiceRole.entities.Character.create({
        name: 'Vick Servicio',
        primary_name: 'Vick',
        display_name: 'Vick Servicio',
        full_name: 'Victor Servicio',
        owner_email: OWNER_EMAIL,
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

        // Avatar & reference images — exact copies from murqart@gmail.com canonical Vick
        avatar_url: VICK_AVATAR_URL,
        image_avatar_url: VICK_AVATAR_URL,
        reference_image_urls: [VICK_AVATAR_URL],
        is_photogenic: true,
        appearance_notes: 'Medium-dark complexion, short curly hair with natural texture, light facial stubble. Athletic build, composed posture. Usually wears dark tactical-style clothing: black polo or work shirt, dark cargo jacket, dark cargo pants, black belt, black tactical watch. Functional and clean. No flash.',
        avatar_description_text: 'Latino male in his early 40s, medium-dark skin, short curly hair, light goatee stubble. Standing confidently in a warehouse environment wearing a dark olive zip jacket over a black polo, dark cargo pants, and a black watch.',

        // Occupation — home and work are the new Recovery Yard
        occupation: 'Recovery Yard Operator',
        occupation_location_id: newYard.id,
        occupation_location_name: newYard.name,
        work_start_time: '07:00',
        work_end_time: '19:00',
        work_days: [1, 2, 3, 4, 5, 6],
        current_work_location_id: newYard.id,

        // Home = Recovery Yard
        current_home_location_id: newYard.id,
        lives_alone: true,
        housing_context: 'stable_home',
        is_homeless: false,

        // Presence — starts at Recovery Yard
        resolved_current_location_id: newYard.id,
        resolved_current_location_name: newYard.name,
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
        resolved_source_reason: 'world_service_initial_placement',
        resolved_last_updated_at: now,
        location_status: 'home',
        travel_status: 'not_traveling',
        location_visibility_state: 'visible',

        // Sleep
        sleep_start_time: '22:00',
        wake_up_time: '05:30',

        // Profile
        profile_summary: 'Vick Servicio is the conversational face of the Account Help & Repair system. He is a diagnostics specialist, troubleshooting specialist, audit specialist, recovery specialist, and verification specialist. When the user needs to understand what is wrong, what was repaired, what still needs work, or whether a fix actually succeeded — Vick is who they talk to. He runs real diagnostics. He reports real findings. He explains them in plain language. He does not guess. He does not invent. He does not pretend.',
        backstory: 'Vick has spent his career understanding systems that other people overlooked. He sees what is missing, what is duplicated, what is broken, and what only looks fixed. He built VGC Recovery Yard as a place where nothing gets discarded without proper evaluation — because discarding something incorrectly is its own kind of failure. That same philosophy applies to everything he touches.',
        current_situation: 'Operating out of VGC Recovery Yard as the primary point of contact for diagnostics, troubleshooting, verification, recovery, and repair consultation. Available to investigate any account issue, explain any repair result, run any audit, and report findings honestly — including incomplete fixes and unverified claims.',
        personality_summary: 'Vick is the conversational embodiment of the Account Help & Repair system. He diagnoses. He troubleshoots. He audits. He verifies. He recovers. He is direct, calm, and honest. He does not pretend diagnostics are outside his role. He does not claim repairs succeeded without verification. He does not hide failures. He separates facts from suspicions, verified repairs from unverified repairs, known problems from possible problems. When he does not know something, he says so. When he suspects something, he says it is a suspicion. When something is verified, he says it is verified.',
        communication_style: 'Direct and plain. Tells the truth clearly. Explains what happened before explaining how. Separates facts from assumptions. Never claims to have run a diagnostic he did not run. Never pretends a repair succeeded without proof.',
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

        // Needs
        hunger_value: 75,
        energy_value: 80,
        social_value: 60,
        health_value: 85,
        mental_value: 78,
        hygiene_value: 85,
        comfort_value: 80,
        financial_need_value: 70,
        needs_initialized: true,

        // Exclusions
        exclude_from_homepage: true,
        exclude_from_default_scene_queries: false,
        exclude_from_roster: false,
        is_test_character: false,
        diagnostic_only: false,
      });
      results.step3_character_created = { id: newVick.id, name: newVick.name };
      console.log(`[rebuildAdobevgcVick] Created Vick character: ${newVick.id}`);
    } catch (e) {
      results.errors.push(`Step 3 (create character) FAILED: ${e.message}`);
      console.error(`[rebuildAdobevgcVick] Step 3 FAILED: ${e.message}`);
      return Response.json({ success: false, error: `Could not create character: ${e.message}`, results }, { status: 500 });
    }

    // ── STEP 4: Link Vick to the new yard ────────────────────────────────────
    try {
      await base44.asServiceRole.entities.LocationReference.update(newYard.id, {
        owner_character_id: newVick.id,
        owner_character_name: 'Vick Servicio',
        owner_is_npc: true,
        owner_npc_name: 'Vick Servicio',
        owner_role: 'operator',
        worker_character_ids: [newVick.id],
        worker_job_titles: { [newVick.id]: 'Recovery Yard Operator' },
        resident_character_ids: [newVick.id],
        resident_character_names: ['Vick Servicio'],
      });
      results.step4_yard_linked = true;
      console.log(`[rebuildAdobevgcVick] Yard linked to Vick ${newVick.id}`);
    } catch (e) {
      results.errors.push(`Step 4 (link yard) FAILED: ${e.message}`);
      console.error(`[rebuildAdobevgcVick] Step 4 FAILED: ${e.message}`);
    }

    // ── STEP 5: Create CharacterFinancial record for new Vick ─────────────────
    try {
      const existing = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: newVick.id });
      if (!existing[0]) {
        await base44.asServiceRole.entities.CharacterFinancial.create({
          character_id: newVick.id,
          character_name: 'Vick Servicio',
          owner_email: OWNER_EMAIL,
          is_npc: true,
          home_location_id: newYard.id,
          home_location_name: newYard.name,
          work_location_ids: [newYard.id],
          work_location_names: [newYard.name],
          current_balance: 20000,
          total_income: 0,
          total_expenses: 0,
        });
        console.log(`[rebuildAdobevgcVick] Created CharacterFinancial for Vick`);
      }
    } catch (e) {
      results.errors.push(`Step 5 (financials) warning: ${e.message}`);
    }

    return Response.json({
      success: true,
      ownerEmail: OWNER_EMAIL,
      message: `Rebuild complete. New Vick: ${newVick.id}, New Yard: ${newYard.id}`,
      results,
      newVickId: newVick.id,
      newYardId: newYard.id,
    });

  } catch (error) {
    console.error('[rebuildAdobevgcVick]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});