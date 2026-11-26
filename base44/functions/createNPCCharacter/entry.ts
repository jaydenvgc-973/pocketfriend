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

    const body = await req.json();
    const {
      name,
      relationship_type,
      speaking_character_id,
      context,
      age,
      gender,
      occupation,
      personality_summary,
    } = body;

    // ── SCENE SPAWN ───────────────────────────────────────────────────────────
    // A person who walks into the scene the user is in. Created through this same
    // function and the same character record — the only difference is the lifecycle
    // designation: a 24-hour lifespan until the user makes them permanent in Contacts.
    if (body.spawn_mode === 'scene') {
      return await spawnSceneNpc(base44, user, body);
    }

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

// ── SCENE SPAWN: one recognizable person, present in the scene they walked into ──
// Identity (name, appearance, personality, background) comes from the app's existing
// LLM integration and the avatar from its existing image generation. The record is a
// normal npc_fictitious character: same profile, same conversations, same World Phone,
// same Contacts. is_temporary_npc only starts a 24-hour lifespan.
const SPAWN_IDENTITY_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'number' },
    gender: { type: 'string' },
    occupation: { type: 'string' },
    archetype: { type: 'string' },
    personality_summary: { type: 'string' },
    communication_style: { type: 'string' },
    appearance_description: { type: 'string' },
    background_story: { type: 'string' },
    current_situation: { type: 'string' },
  },
  required: ['name', 'age', 'gender', 'occupation', 'personality_summary', 'appearance_description'],
};

async function spawnSceneNpc(base44, user, body) {
  const { location_id, location_name, zone_name, scene_context, existing_names = [] } = body;
  if (!location_id) return Response.json({ error: 'location_id is required' }, { status: 400 });

  const location = await base44.asServiceRole.entities.LocationReference
    .filter({ id: location_id }).then((r) => r[0]).catch(() => null);
  const placeName = location?.name || location_name || 'this place';
  const where = zone_name ? `${placeName} — ${zone_name}` : placeName;
  const avoid = (existing_names || []).filter(Boolean).slice(0, 25).join(', ') || 'none';

  const identity = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `Create ONE ordinary person who is physically present at ${where} right now.
They are someone passing through — a customer, a worker off shift, a visitor, a neighbor — not a celebrity and not a stereotype.

${scene_context ? `What is happening around them: ${scene_context}\n` : ''}
Rules:
- Full name: a believable everyday American first and last name. Never reuse any of these names: ${avoid}.
- Age: an adult between 21 and 70 that fits the place.
- gender: "male", "female", or "non-binary".
- occupation: a specific real job (e.g. "line cook", "pharmacy technician"), not "worker".
- archetype: two or three words (e.g. "quietly observant local").
- personality_summary: 2-3 sentences about who this person actually is.
- communication_style: how they talk, one sentence.
- appearance_description: precise physical description for a photo — height/build, skin tone, hair, eyes, clothing they would be wearing at ${placeName} right now. Never mention camera, art style or lighting.
- background_story: 3-4 sentences of real life history.
- current_situation: one sentence about what brought them here today.
Do not base them on any existing named person.`,
    response_json_schema: SPAWN_IDENTITY_SCHEMA,
  });

  if (!identity?.name) throw new Error('NPC identity generation returned no name');

  // Avatar — the app's existing image generation, from the generated appearance.
  let avatarUrl = null;
  try {
    const imageRes = await base44.asServiceRole.integrations.Core.GenerateImage({
      prompt: `Photorealistic candid portrait photograph of a real person, head and shoulders: ${identity.appearance_description}. Natural available light, neutral background, sharp focus on the face, no text, no watermark, no illustration, no stylized filter.`,
    });
    avatarUrl = imageRes?.url || null;
  } catch (imgErr) {
    console.error('[createNPCCharacter] Avatar generation failed:', imgErr.message);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const genderValue = ['male', 'female', 'non-binary'].includes(String(identity.gender || '').toLowerCase())
    ? String(identity.gender).toLowerCase()
    : 'other';

  const npcData = {
    name: identity.name,
    primary_name: identity.name,
    display_name: identity.name,
    full_name: identity.name,

    owner_email: user.email.toLowerCase(),
    owner_user_id: user.id,
    data_scope: 'private_user',
    created_by_role: 'user',
    visibility_scope: 'shared_npc',

    character_type: 'npc_fictitious',
    status: 'active',
    life_status: 'alive',

    age: identity.age || null,
    gender: genderValue,
    occupation: identity.occupation || null,
    archetype: identity.archetype || null,
    personality_summary: identity.personality_summary || null,
    communication_style: identity.communication_style || null,
    background_story: identity.background_story || null,
    profile_summary: identity.personality_summary || null,
    current_situation: identity.current_situation || null,
    appearance_notes: identity.appearance_description || null,
    avatar_description_text: identity.appearance_description || null,
    avatar_generation_prompt: identity.appearance_description || null,
    avatar_url: avatarUrl,
    image_avatar_url: avatarUrl,
    reference_image_urls: avatarUrl ? [avatarUrl] : [],

    // Present where they were introduced — a visitor, not a resident of the property.
    resolved_current_location_id: location_id,
    resolved_current_location_name: placeName,
    resolved_location_type: 'visit',
    resolved_presence_status: 'visiting',
    resolved_source_reason: 'invited_to_scene',
    resolved_last_updated_at: now.toISOString(),
    current_home_location_id: location_id,
    location_status: 'at_location',
    location_visibility_state: 'in_scene',
    travel_status: 'not_traveling',
    presence_state: 'social_visit',
    last_location_update_time: now.toISOString(),

    // Lifecycle — 24 hours unless the user makes them permanent.
    is_temporary_npc: true,
    temporary_npc_spawned_at: now.toISOString(),
    temporary_npc_expires_at: expiresAt,

    is_test_character: false,
    diagnostic_only: false,
    exclude_from_homepage: true,
    exclude_from_roster: false,
    is_protected: false,
    is_active_character: false,
    created_by_user: true,
    needs_initialized: true,
    hunger_value: 70,
    energy_value: 75,
    social_value: 65,
    health_value: 80,
    mental_value: 70,
    financial_need_value: 60,
    hygiene_value: 75,
    comfort_value: 70,
  };

  const npc = await base44.asServiceRole.entities.Character.create(npcData);

  // Their own phone number/plan exists for every character through the existing
  // billing pipeline; nothing is created here beyond the character record itself.

  console.log(`[createNPCCharacter] Spawned temporary NPC "${npc.name}" (${npc.id}) at ${placeName} for ${user.email}, expires ${expiresAt}`);

  return Response.json({ success: true, npc, expires_at: expiresAt, already_existed: false });
}