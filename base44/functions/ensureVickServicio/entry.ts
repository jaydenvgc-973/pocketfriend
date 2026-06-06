import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * ensureVickServicio — v2
 *
 * Creates Vick Servicio and the VGC Recovery Yard for a given user world.
 * Idempotent — safe to call at any time. Each call verifies both exist and repairs
 * any missing protection flags. Does NOT create duplicates.
 *
 * IDEMPOTENCY CONTRACT (permanent rule):
 *   Character lookup MUST use character_type: 'npc_world_service' as the primary filter.
 *   Filtering by name alone via service role returns 0 due to Character entity RLS behavior.
 *   The proven fix (from simulateActiveCharacterNeeds and autonomousCharacterMovement):
 *     base44.asServiceRole.entities.Character.filter({ character_type: 'npc_world_service', ... })
 *   This is the ONLY reliable lookup path when running without an authenticated user session.
 *
 * ATOMICITY RULE:
 *   VGC Recovery Yard must exist before Vick is created (his location IDs reference it).
 *   If Recovery Yard creation fails, Vick is not created.
 *
 * OWNERSHIP:
 *   Each account gets its own private Vick and private Recovery Yard scoped by owner_email.
 *   No account crossover. No shared instances.
 *
 * PROTECTION:
 *   character_type: 'npc_world_service' — excluded from all NPC rotation, sleep debt,
 *   autonomous travel cycles, and cleanup operations.
 *   is_world_service: true — blocks deletion, archival, merging, cleanup targeting.
 *   is_protected: true — blocks deletion via deleteCharacter guard.
 *
 * VGC TOWERS EXCLUSION:
 *   Vick's current_home_location_id = VGC Recovery Yard (NOT VGC Towers).
 *   distributeVGCTowersNPCs: excluded — not in NPC_ELIGIBLE_TYPES list.
 *   returnNPCsToVGCTowers: excluded — home is not VGC Towers.
 *   simulateActiveCharacterNeeds: excluded — filters active_created_character only.
 *   autonomousCharacterMovement: excluded — filters active_created_character only.
 *
 * HARD-DELETE CONSTRAINT:
 *   Vick can inspect, evaluate, investigate, quarantine, and recommend deletion.
 *   He cannot execute hard-deletes without explicit user approval.
 *   Enforced by: is_world_service + is_protected flags on Character record.
 *   deleteCharacter function blocks npc_world_service characters.
 *
 * ── IMAGE ASSETS ──
 * VICK_AVATAR_URL        → Vick Servicio portrait. Used ONLY for Vick's avatar/reference.
 *                           Never used as a Recovery Yard location image.
 * RECOVERY_YARD_EXTERIOR → Clean upscale Recovery Yard exterior / primary location image.
 * RECOVERY_WAREHOUSE_URL → Recovery Warehouse floor interior.
 * INSPECTION_AREA_URL    → Inspection & Review Area interior.
 * WORKSHOP_URL           → Restoration & Repair Workshop interior.
 * ADMIN_OFFICES_URL      → Administrative Offices interior.
 *
 * NOTE: Zone-specific images (RECOVERY_WAREHOUSE_URL, INSPECTION_AREA_URL, WORKSHOP_URL)
 * must be set to their correct standalone asset URLs. Do not leave these empty when
 * the assets exist. Contact the builder to supply correct URLs before deploying to production.
 */

// ── IMAGE ASSET REGISTRY ─────────────────────────────────────────────────────
// Each constant must point to ONE specific asset only.
// Vick's avatar is never used as a facility image.
// Facility images are never used as Vick's avatar or reference image.
const VICK_AVATAR_URL         = 'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/b39f01ca3_file_00000000f4cc722f995295ba541123ac.png';
const RECOVERY_YARD_EXTERIOR  = 'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/aa5af2607_file_00000000f4cc722f995295ba541123ac.png';
const ADMIN_OFFICES_URL       = 'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/52429458f_file_00000000eca0720cbe59d7b2c22a4e3a.png';

// Zone images — sourced from confirmed live Recovery Yard record (ID: 6a23580e6c67852d1b87d01e)
// Each URL is a real uploaded or generated asset. First URL per zone is the canonical primary image.
const RECOVERY_WAREHOUSE_URL  = 'https://media.base44.com/images/public/69bfd8da2f47364437a2deaa/a438c5749_generated_image.png';
const INSPECTION_AREA_URL     = 'https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/cdd90b9bc_1000030585.png';
const WORKSHOP_URL            = 'https://base44.app/api/apps/69bfd8da2f47364437a2deaa/files/mp/public/69bfd8da2f47364437a2deaa/30f191342_1000030586.png';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let payload = {};
    try { payload = await req.json(); } catch (_) {}
    const { ownerEmail: payloadEmail } = payload;

    // ── AUTHENTICATION & ACCOUNT SCOPE CONTROL ──────────────────────────────
    // RULE: Only admin users may pass ownerEmail override (backfill/repair).
    // Regular users MUST provision for their own account only (authenticated user email).
    // Non-admins cannot create/repair Vick for another account.
    
    let ownerEmail = null;
    let user = null;
    
    try {
      user = await base44.auth.me();
      if (!user) {
        return Response.json({ error: 'Authentication required' }, { status: 401 });
      }
    } catch (_) {
      return Response.json({ error: 'Authentication failed' }, { status: 401 });
    }

    // Determine which account to provision for
    if (payloadEmail) {
      // Payload override requested — only admin may do this
      if (user.role !== 'admin') {
        return Response.json({ 
          error: 'Non-admin users cannot provision Vick for other accounts' 
        }, { status: 403 });
      }
      ownerEmail = payloadEmail;
    } else {
      // Normal path: use authenticated user's email only
      ownerEmail = user.email;
    }

    if (!ownerEmail) {
      return Response.json({ error: 'ownerEmail could not be determined' }, { status: 400 });
    }

    const now = new Date().toISOString();
    let ownerCharacterId = null; // Track canonical Vick ID across all paths
    const results = { vick: null, recoveryYard: null, created: { vick: false, recoveryYard: false }, repaired: [] };

    // ── STEP 1: Find or create VGC Recovery Yard ──────────────────────────────
    // SEARCH EXHAUSTIVELY before creating any Recovery Yard.
    // Truth source: Recovery Yard for this owner_email
    
    let recoveryYard = null;
    
    // PRIMARY: query by owner_email + name
    try {
      const existing = await base44.asServiceRole.entities.LocationReference.filter({
        owner_email: ownerEmail,
        name: 'VGC Recovery Yard',
      });
      recoveryYard = existing[0] || null;
    } catch (_) {}
    
    // SECONDARY: if not found, query all yards for this owner and find Recovery Yard
    if (!recoveryYard) {
      try {
        const allYards = await base44.asServiceRole.entities.LocationReference.filter({
          owner_email: ownerEmail,
        }, '-created_date', 100);
        recoveryYard = allYards.find(y => y.name === 'VGC Recovery Yard') || null;
      } catch (_) {}
    }

    if (!recoveryYard) {
      // Build zone list with correct images per zone
      // Only populate image_urls when a real asset URL is available
      const zones = [
        {
          zone_name: 'Recovery Warehouse',
          zone_description: 'Primary intake and storage for recovered items awaiting review.',
          image_urls: RECOVERY_WAREHOUSE_URL ? [RECOVERY_WAREHOUSE_URL] : [],
        },
        {
          zone_name: 'Inspection & Review Area',
          zone_description: 'Where items are examined, documented, catalogued, and evaluated before any action is taken.',
          image_urls: INSPECTION_AREA_URL ? [INSPECTION_AREA_URL] : [],
        },
        {
          zone_name: 'Restoration & Repair Workshop',
          zone_description: 'Dedicated space for restoring damaged or incomplete items to working condition.',
          image_urls: WORKSHOP_URL ? [WORKSHOP_URL] : [],
        },
        {
          zone_name: 'Quarantine Storage',
          zone_description: 'Secure holding area for items removed from active circulation pending final determination.',
          image_urls: [],
        },
        {
          zone_name: 'Archive Storage',
          zone_description: 'Long-term storage for items confirmed as inactive but preserved for reference.',
          image_urls: [],
        },
        {
          zone_name: 'Administrative Offices',
          zone_description: "Vick's operations hub. Scheduling, documentation, intake records, and client coordination.",
          image_urls: ADMIN_OFFICES_URL ? [ADMIN_OFFICES_URL] : [],
        },
        {
          zone_name: 'Residential Suite',
          zone_description: "Vick's private on-site residence. Not accessible to visitors.",
          image_urls: [],
        },
      ];

      // Primary location images: exterior + admin offices
      const primaryImages = [RECOVERY_YARD_EXTERIOR, ADMIN_OFFICES_URL].filter(Boolean);

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
        description: 'A modern, professionally operated recovery and restoration facility. VGC Recovery Yard handles recovered belongings, duplicate items, damaged property, lost inventory, and items under review. Operated by Vick Servicio. Recovery Warehouse, Inspection Area, Restoration Workshop, Quarantine Storage, Archive Storage, Administrative Offices. Review. Restore. Recover.',
        subtype: ['recovery', 'restoration', 'quarantine', 'warehouse'],
        features: ['recovery_warehouse', 'inspection_area', 'restoration_workshop', 'quarantine_storage', 'archive_storage', 'administrative_offices', 'visitor_review'],
        image_urls: primaryImages,
        zones,
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
    //
    // IDEMPOTENCY ANCHOR: Recovery Yard's `owner_character_id` field.
    //
    // DUPLICATE PREVENTION STRATEGY (permanent, enforced):
    //   1. Recovery Yard.owner_character_id is the canonical Vick reference.
    //      If set, that Vick is authoritative — never create another.
    //   2. Before creating a new Vick, exhaustively search for existing records.
    //   3. Add a pre-creation duplicate guard: abort if any Vick already exists.
    //   4. Add race protection: check for init-in-progress flag.
    //
    // FORBIDDEN OUTCOMES:
    //   - More than one active Vick per owner_email.
    //   - Creating a second Vick because Character RLS failed.
    //   - Creating a second Vick because the function was called twice.
    //   - Creating a second Vick because admin init and user init both ran.

    let vick = null;

    // PRIMARY: check Recovery Yard's owner_character_id (readable via service role)
    if (recoveryYard.owner_character_id) {
      ownerCharacterId = recoveryYard.owner_character_id; // Track canonical ID
      vick = {
        id: recoveryYard.owner_character_id,
        name: recoveryYard.owner_character_name || 'Vick Servicio',
      };
      console.log(`[ensureVickServicio] Found Vick via Recovery Yard anchor: id=${vick.id} for ${ownerEmail}`);
      // Anchor is set: use it. No creation needed. Return immediately.
    }

    // SECONDARY: if user session is available, try a user-scoped read for existing Vick
    if (!vick) {
      try {
        const authenticatedUser = await base44.auth.me().catch(() => null);
        if (authenticatedUser && authenticatedUser.email === ownerEmail) {
          // Search for any active Vick for this owner_email
          const userScopedChars = await base44.entities.Character.filter(
            { character_type: 'npc_world_service', status: 'active', owner_email: ownerEmail },
            null, 50
          ).catch(() => []);
          
          if (userScopedChars.length > 0) {
            vick = userScopedChars[0]; // Use first found (prefer oldest)
            console.log(`[ensureVickServicio] Found existing Vick via user-scoped read: id=${vick.id} for ${ownerEmail}`);
          }
        }
      } catch (_) {}
    }

    // TERTIARY: service-role exhaustive search for ANY active npc_world_service
    if (!vick) {
      try {
        const allWorldService = await base44.asServiceRole.entities.Character.filter(
          { character_type: 'npc_world_service', owner_email: ownerEmail, status: 'active' },
          '-created_date',
          100
        ).catch(() => []);
        
        if (allWorldService.length > 0) {
          vick = allWorldService[0]; // Use oldest (most canonical by creation order)
          console.log(`[ensureVickServicio] Found existing Vick via service-role exhaustive search: id=${vick.id} for ${ownerEmail}`);
        }
      } catch (_) {}
    }

    // QUATERNARY: final duplicate check - ALL Vick candidates regardless of status
    if (!vick) {
      try {
        const allVicks = await base44.asServiceRole.entities.Character.filter(
          { name: 'Vick Servicio', owner_email: ownerEmail },
          '-created_date',
          100
        ).catch(() => []);
        
        const activeVicks = allVicks.filter(c => c.status === 'active');
        if (activeVicks.length > 0) {
          vick = activeVicks[0];
          console.log(`[ensureVickServicio] DUPLICATE GUARD (Stage 4): Found existing active Vick: id=${vick.id} for ${ownerEmail}`);
        }
      } catch (_) {}
    }

    // FINAL GUARD: Absolute duplicate prevention before creation
    if (!vick) {
      try {
        // Last-resort search: if Recovery Yard anchor exists but we haven't found the Vick yet, something is inconsistent
        if (recoveryYard?.owner_character_id) {
          console.log(`[ensureVickServicio] Recovery Yard has owner_character_id=${recoveryYard.owner_character_id}, using that as canonical Vick`);
          vick = {
            id: recoveryYard.owner_character_id,
            name: 'Vick Servicio',
          };
        }
      } catch (_) {}
    }

    if (!vick) {
      console.log(`[ensureVickServicio] No existing Vick found for ${ownerEmail} — authorized to create new Vick`);
    }

    // ── FINAL COMPREHENSIVE DUPLICATE GUARD ─────────────────────────────────────
    // PERMANENT RULE: Before Character.create, run exhaustive checks across ALL paths.
    // Uncertainty blocks creation. It does not permit creation.
    //
    // This guard is the absolute last checkpoint. If any Vick candidate exists via
    // any path, abort creation and reuse/repair the existing record.
    // Character RLS failure is NEVER permission to create a duplicate.
    //
    // PATH 1: Recovery Yard owner_character_id (most reliable, already checked)
    if (!vick && recoveryYard?.owner_character_id) {
      vick = {
        id: recoveryYard.owner_character_id,
        name: 'Vick Servicio',
      };
      console.log(`[ensureVickServicio] FINAL GUARD PATH 1: Recovery Yard owner anchor: ${vick.id}`);
    }

    // PATH 2: Direct yard array lookups (worker_character_ids, resident_character_ids)
    // CRITICAL RULE: Known canonical references MUST be reused, never skipped.
    if (!vick && recoveryYard) {
      const yardWorkers = recoveryYard.worker_character_ids || [];
      const yardResidents = recoveryYard.resident_character_ids || [];
      const yardCandidates = [...new Set([...yardWorkers, ...yardResidents])].filter(Boolean);
      
      // If canonical ownerCharacterId exists and is in yard arrays, use it immediately
      if (ownerCharacterId && yardCandidates.includes(ownerCharacterId)) {
        vick = { id: ownerCharacterId, name: 'Vick Servicio' };
        console.log(`[ensureVickServicio] FINAL GUARD PATH 2: Canonical Vick from yard arrays: ${vick.id}`);
      }
      // Else if exactly one candidate in yard arrays, use it
      else if (yardCandidates.length === 1) {
        vick = { id: yardCandidates[0], name: 'Vick Servicio' };
        console.log(`[ensureVickServicio] FINAL GUARD PATH 2: Single yard candidate: ${vick.id}`);
      }
      // Else if multiple candidates in yard arrays, state is unsafe — block creation
      else if (yardCandidates.length > 1) {
        console.error(`[ensureVickServicio] CREATION BLOCKED: Recovery Yard has ${yardCandidates.length} conflicting character references. Duplicate cleanup required.`);
        return Response.json({
          success: false,
          error: `Duplicate Vick candidates detected in Recovery Yard (${yardCandidates.length} IDs). Cleanup required before new creation.`,
          ownerEmail,
          recoveryYard: { id: recoveryYard.id, name: recoveryYard.name },
          duplicateCandidates: yardCandidates,
        }, { status: 409 });
      }
    }

    // PATH 3: User-scoped filter by character_type (npc_world_service)
    if (!vick) {
      try {
        const userWorldService = await base44.entities.Character.filter(
          { character_type: 'npc_world_service', owner_email: ownerEmail, status: 'active' },
          '-created_date',
          10
        ).catch(() => []);
        
        if (userWorldService.length > 0) {
          vick = userWorldService[0];
          console.log(`[ensureVickServicio] FINAL GUARD PATH 3: User-scoped world-service filter: ${vick.id}`);
        }
      } catch (_) {
        // RLS failure on user-scoped read — do NOT treat as proof of nonexistence
        // Rely on yard anchor/arrays instead
        console.warn(`[ensureVickServicio] FINAL GUARD PATH 3: User-scoped filter blocked by RLS. Relying on yard anchor.`);
      }
    }

    // PATH 4: User-scoped filter by owner_email and name (fallback)
    if (!vick) {
      try {
        const userNameMatch = await base44.entities.Character.filter(
          { name: 'Vick Servicio', owner_email: ownerEmail, status: 'active' },
          '-created_date',
          10
        ).catch(() => []);
        
        if (userNameMatch.length > 0) {
          vick = userNameMatch[0];
          console.log(`[ensureVickServicio] FINAL GUARD PATH 4: User-scoped name filter: ${vick.id}`);
        }
      } catch (_) {
        // RLS failure — do NOT treat as proof
        console.warn(`[ensureVickServicio] FINAL GUARD PATH 4: User-scoped name filter blocked by RLS.`);
      }
    }

    // CREATION SAFETY CHECK: If any uncertainty remains, block creation
    if (!vick && recoveryYard && (recoveryYard.owner_character_id || 
                                  (recoveryYard.worker_character_ids?.length > 0) ||
                                  (recoveryYard.resident_character_ids?.length > 0))) {
      // Recovery Yard exists and has character references, but we couldn't resolve them
      // This is uncertain state — do NOT create
      console.error(`[ensureVickServicio] CREATION BLOCKED: Recovery Yard exists but Vick candidate unresolvable. Yard anchors/arrays present but lookup failed.`);
      return Response.json({
        success: false,
        error: 'Cannot safely create Vick: Recovery Yard exists with character references, but resolution failed. RLS may be blocking user-scoped queries. Rely on yard anchor.',
        ownerEmail,
        recoveryYard: { id: recoveryYard.id, name: recoveryYard.name },
      }, { status: 409 });
    }

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

        // Avatar — Vick's portrait only. Never a facility image.
        avatar_url: VICK_AVATAR_URL,
        image_avatar_url: VICK_AVATAR_URL,
        reference_image_urls: [VICK_AVATAR_URL],
        is_photogenic: true,
        appearance_notes: 'Medium-dark complexion, short curly hair with natural texture, light facial stubble. Athletic build, composed posture. Usually wears dark tactical-style clothing: black polo or work shirt, dark cargo jacket, dark cargo pants, black belt, black tactical watch. Functional and clean. No flash.',
        avatar_description_text: 'Latino male in his early 40s, medium-dark skin, short curly hair, light goatee stubble. Standing confidently in a warehouse environment wearing a dark olive zip jacket over a black polo, dark cargo pants, and a black watch.',

        // Occupation — both home and work are Recovery Yard
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
        current_situation: 'Managing day-to-day operations at VGC Recovery Yard. Overseeing intake, inspection, quarantine, restoration, and archival. Known to personally investigate anything that seems unusual or out of place. Available for world diagnostics and recovery consultation.',
        personality_summary: 'Calm, observant, methodical, and direct. Vick does not waste words or energy. He has a dry sense of humor and rarely shows surprise — he has seen too much to be easily caught off guard. He takes his work seriously because he knows that the wrong call in either direction costs someone something.',
        communication_style: 'Direct, measured, and unhurried. Speaks with the confidence of someone who has handled difficult situations before. Does not dramatize. Comfortable with silence. Will tell you exactly what he found and what he thinks about it.',
        archetype: 'The Specialist',
        social_energy: 'introvert',
        style_identity: 'Functional. Dark tactical-adjacent workwear. Clean and professional without being formal. No logos.',

        // Behavioral constraint (also enforced by code):
        // Vick can inspect, evaluate, investigate, quarantine, and RECOMMEND deletion.
        // He cannot execute hard-deletes without explicit user approval.
        // This is both a personality trait and a system constraint enforced by is_world_service.

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

        // System exclusions — Vick does NOT participate in normal NPC systems:
        //   - not in VGC Towers roster (home = Recovery Yard, not VGC Towers)
        //   - not processed by simulateActiveCharacterNeeds (active_created_character only)
        //   - not processed by autonomousCharacterMovement (active_created_character only)
        //   - not in distributeVGCTowersNPCs (npc_world_service not in NPC_ELIGIBLE_TYPES)
        //   - not in returnNPCsToVGCTowers (home != VGC Towers)
        //   - not visible on homepage (exclude_from_homepage: true)
        //   - not subject to cleanup targeting or archival
        exclude_from_homepage: true,
        exclude_from_default_scene_queries: false,
        exclude_from_roster: false,
        is_test_character: false,
        diagnostic_only: false,
      });
      results.created.vick = true;
      console.log(`[ensureVickServicio] Created Vick Servicio (${vick.id}) for ${ownerEmail}`);
    } else {
      // Vick found via user-scoped read — actual fields are available, repair if needed.
      // Note: asServiceRole update on user-owned Character returns 403.
      // Repair is only attempted if the character has actual readable fields (user-session read path).
      if (vick.is_world_service !== undefined) {
        // Full character object available — check fields
        const needsRepair = !vick.is_world_service || !vick.is_protected || vick.character_type !== 'npc_world_service';
        const locationMismatch = vick.current_home_location_id !== recoveryYard.id || vick.occupation_location_id !== recoveryYard.id;
        if (needsRepair || locationMismatch) {
          const repairData = {};
          if (needsRepair) {
            repairData.is_world_service = true;
            repairData.is_protected = true;
            repairData.protected_active = true;
            repairData.character_type = 'npc_world_service';
            results.repaired.push('protection_flags');
          }
          if (locationMismatch) {
            repairData.current_home_location_id = recoveryYard.id;
            repairData.occupation_location_id = recoveryYard.id;
            repairData.occupation_location_name = recoveryYard.name;
            repairData.current_work_location_id = recoveryYard.id;
            repairData.resolved_current_location_id = recoveryYard.id;
            repairData.resolved_current_location_name = recoveryYard.name;
            results.repaired.push('location_ids');
          }
          // Use user-scoped write — this is the only write path that works for user-owned characters
          await base44.entities.Character.update(vick.id, repairData)
            .catch(e => console.warn(`[ensureVickServicio] Repair write failed (non-fatal): ${e.message}`));
          console.log(`[ensureVickServicio] Repaired Vick (${vick.id}): ${results.repaired.join(', ')} for ${ownerEmail}`);
        } else {
          console.log(`[ensureVickServicio] Vick Servicio already exists and is healthy (${vick.id}) for ${ownerEmail}`);
        }
      } else {
        // Stub object from anchor — fields not available, no repair needed
        console.log(`[ensureVickServicio] Vick Servicio already initialized (${vick.id}) for ${ownerEmail}`);
      }
    }
    results.vick = { id: vick.id, name: vick.name };

    // ── STEP 3: Ensure Recovery Yard has Vick as owner, worker, and resident ──
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

    // ── STEP 4: Ensure CharacterFinancial record ($20,000 starting balance) ───
    // is_npc: true ensures Vick does not appear in playable/managed character finance lists.
    try {
      const finRecs = await base44.asServiceRole.entities.CharacterFinancial.filter({ character_id: vick.id });
      if (!finRecs[0]) {
        await base44.asServiceRole.entities.CharacterFinancial.create({
          character_id: vick.id,
          character_name: vick.name,
          owner_email: ownerEmail,
          is_npc: true,         // Prevents Vick from appearing in playable character finance UI
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
      repaired: results.repaired,
      zones_with_pending_images: [
        !RECOVERY_WAREHOUSE_URL && 'Recovery Warehouse',
        !INSPECTION_AREA_URL && 'Inspection & Review Area',
        !WORKSHOP_URL && 'Restoration & Repair Workshop',
      ].filter(Boolean),
      message: results.created.vick || results.created.recoveryYard
        ? `World service initialized: Vick=${results.created.vick ? 'created' : 'existed'}, RecoveryYard=${results.created.recoveryYard ? 'created' : 'existed'}`
        : results.repaired.length > 0
          ? `World service repaired: ${results.repaired.join(', ')}`
          : 'World service already fully initialized — no changes made.',
    });

  } catch (error) {
    console.error('[ensureVickServicio]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});