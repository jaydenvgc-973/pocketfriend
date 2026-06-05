import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * createFamilyNPCCharacter
 *
 * Creates a real npc_family_member Character record and links it to the active character.
 * Called whenever a family member is saved from FamilyEditor.
 *
 * Required body fields:
 *   - name: string
 *   - relationship_type: string (e.g. "mother", "brother")
 *   - active_character_id: string (the character this family member belongs to)
 *   - photo_url: string | null
 *   - age_at_creation: number | null
 *
 * Returns: { success, npc_id, already_existed }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { name, relationship_type, active_character_id, photo_url, age_at_creation } = await req.json();

    // ── Derive gender from relationship type ──────────────────────────────────
    const FEMALE_ROLES = new Set(['mother', 'mom', 'mommy', 'grandmother', 'grandma', 'great-grandmother',
      'aunt', 'niece', 'sister', 'half-sister', 'step-mother', 'stepmother', 'stepsister', 'step-sister',
      'daughter', 'mother-in-law', 'sister-in-law', 'birth mother', 'biological mother',
      'adoptive mother', 'foster mother', 'maternal grandmother', 'paternal grandmother']);
    const MALE_ROLES = new Set(['father', 'dad', 'daddy', 'grandfather', 'grandpa', 'great-grandfather',
      'uncle', 'nephew', 'brother', 'half-brother', 'step-father', 'stepfather', 'stepbrother', 'step-brother',
      'son', 'father-in-law', 'brother-in-law', 'birth father', 'biological father',
      'adoptive father', 'foster father', 'maternal grandfather', 'paternal grandfather']);

    function inferGender(relType) {
      const r = (relType || '').toLowerCase();
      if (FEMALE_ROLES.has(r)) return 'female';
      if (MALE_ROLES.has(r)) return 'male';
      return null;
    }

    function inferAgeRange(age) {
      if (age == null) return null;
      if (age <= 3) return 'toddler';
      if (age <= 12) return 'child';
      if (age <= 17) return 'teenager';
      if (age <= 25) return 'young adult';
      if (age <= 40) return 'adult';
      if (age <= 60) return 'middle aged';
      return 'senior';
    }

    const inferredGender = inferGender(relationship_type);
    const inferredAgeRange = inferAgeRange(age_at_creation);

    if (!name?.trim() || !relationship_type || !active_character_id) {
      return Response.json({ error: 'name, relationship_type, and active_character_id are required' }, { status: 400 });
    }

    // ── STEP 1: Check if a Character record already exists for this family member ──
    // CRITICAL: owner_email is the sole ownership source of truth. created_by is FORBIDDEN.
    const byOwner = await base44.asServiceRole.entities.Character.filter({ owner_email: user.email, name: name.trim() });
    const existing = byOwner.filter(c =>
      c.status !== 'deleted' && c.status !== 'soft_deleted'
    );

    let npc;

    if (existing.length > 0) {
      // Use existing record — update photo/age/gender/age_range if we have better data
      npc = existing[0];
      const updates = {};
      if (photo_url && !npc.avatar_url) updates.avatar_url = photo_url;
      if (age_at_creation != null && !npc.age) updates.age = age_at_creation;
      if (inferredGender && (!npc.gender || npc.gender === 'other')) updates.gender = inferredGender;
      if (inferredAgeRange && (!npc.age_range || npc.age_range === 'adult')) updates.age_range = inferredAgeRange;

      // CRITICAL: character_type is IMMUTABLE from this function.
      // npc_fictitious records must NEVER be silently converted to npc_family_member
      // by finding a same-name match. The user's existing npc_fictitious record
      // is a separate classification. Only update non-type fields here.
      // If the record already IS npc_family_member, no change needed.
      // If it is npc_fictitious, npc_regular, or active_created_character:
      //   → Do NOT mutate its type. Log the conflict for diagnostics.
      if (npc.character_type !== 'npc_family_member') {
        console.warn(`[createFamilyNPCCharacter] CONFLICT: Existing record "${npc.name}" (${npc.id}) has character_type="${npc.character_type}". NOT converting to npc_family_member — character_type is immutable. Linking relationship only.`);
      }

      if (Object.keys(updates).length > 0) {
        await base44.asServiceRole.entities.Character.update(npc.id, updates);
      }

      console.log(`[createFamilyNPCCharacter] Linked existing Character "${npc.name}" (${npc.id}) as family member`);

      return Response.json({
        success: true,
        npc_id: npc.id,
        already_existed: true,
      });
    }

    // ── STEP 2: Get user's VGC Towers for home assignment ─────────────────────
    let vgcTowersId = null;
    try {
      const vgcRes = await base44.functions.invoke('ensureUserVGCTowers', {});
      vgcTowersId = vgcRes?.data?.vgc_towers_id || null;
    } catch {
      // Non-fatal — continue without home assignment
    }

    const now = new Date().toISOString();

    // ── STEP 3: Create the real npc_family_member Character record ─────────────
    npc = await base44.entities.Character.create({
      name: name.trim(),
      primary_name: name.trim(),
      display_name: name.trim(),

      // Ownership
      owner_email: user.email,
      owner_user_id: user.id,
      created_by_role: user.role || 'user',
      data_scope: 'private_user',
      visibility_scope: 'account_private',

      // Classification
      character_type: 'npc_family_member',
      status: 'active',
      is_active_character: false,

      // Profile
      avatar_url: photo_url || null,
      age: age_at_creation || null,
      gender: inferredGender || null,
      age_range: inferredAgeRange || null,
      personality_summary: `${name.trim()} — ${relationship_type || 'family member'}.`,
      profile_summary: `${name.trim()} — ${relationship_type || 'family member'}.`,

      // Flags
      exclude_from_homepage: true,
      exclude_from_roster: true,
      exclude_from_default_scene_queries: true,
      is_test_character: false,
      diagnostic_only: false,

      // Home
      ...(vgcTowersId ? {
        current_home_location_id: vgcTowersId,
        resolved_current_location_id: vgcTowersId,
        resolved_current_location_name: 'VGC Towers',
        resolved_location_type: 'home',
        resolved_presence_status: 'home',
      } : {}),

      travel_status: 'not_traveling',
      location_status: 'home',
      last_location_update_time: now,
    });

    // ── STEP 4: Add NPC to VGC Towers resident list ───────────────────────────
    if (vgcTowersId) {
      try {
        const vgcLoc = await base44.entities.LocationReference.filter({ id: vgcTowersId }).then(r => r[0]);
        if (vgcLoc) {
          const residentIds = Array.from(new Set([...(vgcLoc.resident_character_ids || []), npc.id]));
          const residentNames = Array.from(new Set([...(vgcLoc.resident_character_names || []), npc.name]));
          await base44.entities.LocationReference.update(vgcTowersId, {
            resident_character_ids: residentIds,
            resident_character_names: residentNames,
          });
        }
      } catch (err) {
        console.error('[createFamilyNPCCharacter] VGC resident update failed:', err.message);
      }
    }

    console.log(`[createFamilyNPCCharacter] Created npc_family_member "${npc.name}" (${npc.id}) for user ${user.email}, linked to character ${active_character_id}`);

    return Response.json({
      success: true,
      npc_id: npc.id,
      already_existed: false,
    });
  } catch (error) {
    console.error('[createFamilyNPCCharacter]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});