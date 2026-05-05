import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * createNPCCharacter
 *
 * Creates a fully-hydrated NPC fictitious character owned by the calling user.
 * ALL required fields are populated — no orphan or incomplete records.
 *
 * Required fields in body:
 *   - name: string
 *   - relationship_type: string (e.g. "Friend", "Coworker")
 *   - speaking_character_id: string (the character who mentioned this person)
 *
 * Optional:
 *   - context: string (dialogue context)
 *   - age: number
 *   - gender: string
 *   - occupation: string
 *   - personality_summary: string
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      name,
      relationship_type,
      speaking_character_id,
      context,
      age,
      gender,
      occupation,
      personality_summary,
    } = await req.json();

    if (!name || !relationship_type || !speaking_character_id) {
      return Response.json({ error: 'name, relationship_type, and speaking_character_id are required' }, { status: 400 });
    }

    // ── STEP 1: Ensure user has their own VGC Towers ──────────────────────────
    const vgcRes = await base44.functions.invoke('ensureUserVGCTowers', {});
    const vgcTowersId = vgcRes?.data?.vgc_towers_id;
    if (!vgcTowersId) {
      return Response.json({ error: 'Could not find or create VGC Towers for this user' }, { status: 500 });
    }

    // ── STEP 2: Check if NPC with this name already exists for this user ─────
    // owner_email is the sole ownership source of truth — created_by is permanently forbidden
    const existingByOwner = await base44.asServiceRole.entities.Character.filter({ owner_email: user.email, name });
    const existing = existingByOwner.filter(c => c.status !== 'deleted');

    if (existing.length > 0) {
      const existingNPC = existing[0];
      // Link the relationship to the speaking character
      await _linkRelationship(base44, speaking_character_id, existingNPC, relationship_type, context);
      return Response.json({
        success: true,
        npc_id: existingNPC.id,
        already_existed: true,
        message: `Linked existing NPC "${name}" to character`,
      });
    }

    // ── STEP 3: Create the fully-hydrated NPC ────────────────────────────────
    const now = new Date().toISOString();

    const npcData = {
      // Identity
      name,
      primary_name: name,
      display_name: name,

      // Ownership — CRITICAL: must be user-scoped, never orphaned
      owner_email: user.email.toLowerCase(),
      owner_user_id: user.id,
      data_scope: 'private_user',
      created_by_role: 'user',
      visibility_scope: 'shared_npc',

      // Classification
      character_type: 'npc_fictitious',
      status: 'active',

      // Residence — always VGC Towers for NPCs
      current_home_location_id: vgcTowersId,
      resolved_current_location_id: vgcTowersId,
      resolved_current_location_name: 'VGC Towers',
      resolved_location_type: 'home',
      resolved_presence_status: 'home',
      resolved_source_reason: 'npc_created',
      resolved_last_updated_at: now,
      location_status: 'home',

      // Travel eligibility fields — fully populated
      travel_status: 'not_traveling',
      travel_destination_location_id: null,
      location_visibility_state: 'visible',
      presence_state: 'home',

      // Optional profile
      age: age || null,
      gender: gender || null,
      occupation: occupation || null,
      personality_summary: personality_summary || null,

      // Flags
      is_test_character: false,
      diagnostic_only: false,
      exclude_from_homepage: true,  // NPCs don't appear on the home character cards
      exclude_from_roster: false,   // But they DO appear in NPC lists
      is_protected: false,
      needs_initialized: false,

      // Timestamps
      last_location_update_time: now,
    };

    const newNPC = await base44.entities.Character.create(npcData);

    // ── STEP 4: Add NPC to VGC Towers resident lists ─────────────────────────
    try {
      const vgcLoc = await base44.entities.LocationReference.filter({ id: vgcTowersId }).then(r => r[0]);
      if (vgcLoc) {
        const residentIds = Array.from(new Set([...(vgcLoc.resident_character_ids || []), newNPC.id]));
        const residentNames = Array.from(new Set([...(vgcLoc.resident_character_names || []), name]));
        await base44.entities.LocationReference.update(vgcTowersId, {
          resident_character_ids: residentIds,
          resident_character_names: residentNames,
        });
      }
    } catch (residentErr) {
      console.error('[createNPCCharacter] Failed to add to VGC residents:', residentErr.message);
    }

    // ── STEP 5: Link relationship to the speaking character ───────────────────
    await _linkRelationship(base44, speaking_character_id, newNPC, relationship_type, context);

    console.log(`[createNPCCharacter] Created NPC "${name}" (${newNPC.id}) homed at VGC Towers (${vgcTowersId}) for user ${user.email}`);

    return Response.json({
      success: true,
      npc_id: newNPC.id,
      vgc_towers_id: vgcTowersId,
      already_existed: false,
    });
  } catch (error) {
    console.error('[createNPCCharacter]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ── HELPER: Link relationship to the speaking character ──────────────────────
async function _linkRelationship(base44, speakingCharId, npc, relationshipType, context) {
  try {
    const speakingChar = await base44.asServiceRole.entities.Character.filter({ id: speakingCharId }).then(r => r[0]);
    if (!speakingChar) return;

    const existing = (speakingChar.fictional_relationships || []).find(
      r => r.person_name?.toLowerCase() === npc.name.toLowerCase() || r.related_character_id === npc.id
    );
    if (existing) return;

    const newRel = {
      person_name: npc.name,
      related_character_id: npc.id,
      relationship_type: relationshipType,
      description: context || '',
      history_summary: context || '',
      current_status: 'active',
      emotional_impact: 'neutral',
      last_interaction_summary: '',
      avatar_url: null,
      current_location_id: npc.current_home_location_id || null,
      user_respect_level: 50,
      friendship_level: 50,
      romantic_level: 0,
      attraction_level: 0,
      chosen_family_level: 0,
    };

    await base44.asServiceRole.entities.Character.update(speakingCharId, {
      fictional_relationships: [...(speakingChar.fictional_relationships || []), newRel],
    });
  } catch (err) {
    console.error('[createNPCCharacter] Failed to link relationship:', err.message);
  }
}