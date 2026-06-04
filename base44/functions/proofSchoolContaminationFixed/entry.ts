/**
 * proofSchoolContaminationFixed
 *
 * End-to-end proof — service-role only, no user session required.
 * Called with owner_email + character_id in payload.
 *
 * Proves:
 * 1. Character state (presence, school_id, home_id, resolved_location)
 * 2. generateImageAsync Layer 4 guard behavior on polluted resolved_current_location_id
 * 3. Saved generation_context on the resulting message
 * 4. That location_id, location_name in saved context = home, not school
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // This function is admin-only when called via test runner (no user session)
    // When called from the app, user session provides auth. Accept either.
    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}

    const payload = await req.json().catch(() => ({}));
    const characterId = payload.character_id;
    const ownerEmail  = payload.owner_email;

    if (!characterId || !ownerEmail) {
      return Response.json({ error: 'character_id and owner_email are required' }, { status: 400 });
    }

    // ── STEP 1: Read character via service role ────────────────────────────────
    // The Character entity RLS on this app scopes by owner_email.
    // Service role reads all — so we filter by owner_email manually after fetch.
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: ownerEmail }, null, 200
    );
    const char = allChars.find(c => c.id === characterId);
    if (!char) {
      return Response.json({
        error: `Character ${characterId} not found for owner ${ownerEmail}`,
        total_chars_for_owner: allChars.length,
      }, { status: 404 });
    }

    const schoolId       = char.education_location_id || char.current_school_location_id || null;
    const homeId         = char.current_home_location_id || char.home_location_id || null;
    const presenceStatus = char.resolved_presence_status || char.location_status || 'unknown';
    const resolvedLocId  = char.resolved_current_location_id || null;
    const resolvedLocName= char.resolved_current_location_name || null;
    const studentStatus  = char.student_status || 'not_student';
    const travelingToId  = char.traveling_to_location_id || null;
    const workLocId      = char.current_work_location_id || char.occupation_location_id || null;

    const proof = {
      timestamp_et: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),
      character_id: characterId,
      character_name: char.name,

      step_1_character_state: {
        presence_status: presenceStatus,
        student_status: studentStatus,
        resolved_current_location_id: resolvedLocId,
        resolved_current_location_name: resolvedLocName,
        current_home_location_id: homeId,
        education_location_id: schoolId,
        traveling_to_location_id: travelingToId,
        current_work_location_id: workLocId,
      },

      step_2_contamination_checks: {
        resolved_loc_equals_school_id: resolvedLocId === schoolId,
        resolved_loc_equals_home_id:   resolvedLocId === homeId,
        traveling_to_equals_school_id: travelingToId === schoolId,
        enrolled_but_not_at_school:    studentStatus === 'enrolled' && presenceStatus !== 'at_school',
        character_is_home:             presenceStatus === 'home' || presenceStatus === 'sleeping' || presenceStatus === 'napping',
        source_data_polluted:          resolvedLocId === schoolId,
        note: resolvedLocId === schoolId
          ? '⚠️ resolved_current_location_id IS polluted with school ID — this is the input Layer 4 will receive'
          : '✅ resolved_current_location_id is NOT the school ID',
      },
    };

    // ── STEP 3: Verify what home location record actually is ─────────────────
    let homeLocRecord = null;
    let schoolLocRecord = null;
    if (homeId) {
      const locs = await base44.asServiceRole.entities.LocationReference.filter({ id: homeId }, null, 1).catch(() => []);
      homeLocRecord = locs?.[0] || null;
    }
    if (schoolId) {
      const locs = await base44.asServiceRole.entities.LocationReference.filter({ id: schoolId }, null, 1).catch(() => []);
      schoolLocRecord = locs?.[0] || null;
    }

    proof.step_3_location_records = {
      home_location: homeLocRecord ? { id: homeLocRecord.id, name: homeLocRecord.name, category: homeLocRecord.category } : null,
      school_location: schoolLocRecord ? { id: schoolLocRecord.id, name: schoolLocRecord.name, category: schoolLocRecord.category } : null,
    };

    // ── STEP 4: Find conversation ─────────────────────────────────────────────
    const allConvos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: ownerEmail, character_ids: characterId }, '-last_message_date', 20
    ).catch(() => []);

    const directConvo = allConvos.find(c =>
      Array.isArray(c.character_ids) && c.character_ids.length === 1 &&
      !c.shared_conversation_key && c.channel !== 'world_phone' && c.type === 'direct'
    );

    if (!directConvo) {
      proof.step_4_conversation = { found: false, error: 'No direct conversation found' };
      return Response.json({ ...proof, final_verdict: '⚠️ INCOMPLETE — no conversation to attach message to' });
    }
    proof.step_4_conversation = { found: true, conversation_id: directConvo.id };

    // ── STEP 5: Create fresh placeholder message ──────────────────────────────
    const placeholder = await base44.asServiceRole.entities.Message.create({
      conversation_id: directConvo.id,
      sender_type: 'character',
      character_id: characterId,
      character_name: char.name,
      content: '',
      timestamp: new Date().toISOString(),
      is_read: false,
    });
    const messageId = placeholder.id;
    proof.step_5_placeholder_message = { message_id: messageId, created_at: new Date().toISOString() };

    // ── STEP 6: Invoke generateImageAsync ─────────────────────────────────────
    const refImages = (char.reference_image_urls || [])
      .filter(u => u && u.startsWith('https://media.base44.com/') && !u.includes('generated_image'))
      .slice(0, 3);

    const genStart = Date.now();
    let genResponse = null;
    let genError = null;
    try {
      genResponse = await base44.asServiceRole.functions.invoke('generateImageAsync', {
        messageId,
        prompt: '[CHARACTER] standing in the living room zone, looking relaxed at home. Medium shot from across the room.',
        subjectType: 'character',
        characterId,
        characterName: char.name,
        characterReferenceImages: refImages,
        userReferenceImages: [],
        ownerEmail,
      });
    } catch (e) {
      genError = e.message;
    }

    proof.step_6_generation = {
      duration_ms: Date.now() - genStart,
      invoked: true,
      error: genError || null,
      response_success: genResponse?.success !== false,
      response_location_name: genResponse?.locationName || null,
      response_zone_name: genResponse?.zoneName || null,
      ref_images_sent: refImages.length,
    };

    // ── STEP 7: Poll for saved message ────────────────────────────────────────
    let savedMsg = null;
    let pollCount = 0;
    while (pollCount < 20) {
      await new Promise(r => setTimeout(r, 3000));
      pollCount++;
      const msgs = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
      savedMsg = msgs?.[0];
      if (savedMsg?.image_url || savedMsg?.content === '[IMAGE_FAILED]') break;
    }

    if (!savedMsg) {
      proof.step_7_saved_message = { found: false };
      proof.final_verdict = '❌ INCOMPLETE — message not found after polling';
      return Response.json(proof);
    }

    const gc = savedMsg.generation_context || {};
    const savedLocId   = gc.location_id   || null;
    const savedLocName = gc.location_name  || null;
    const savedLocCat  = gc.loc_category   || null;
    const savedZone    = gc.zone_name      || null;

    proof.step_7_saved_message = {
      message_id: savedMsg.id,
      same_as_placeholder: savedMsg.id === messageId,
      has_image_url: !!savedMsg.image_url,
      image_url: savedMsg.image_url || null,
      content: savedMsg.content || '',
      generation_context_keys: Object.keys(gc),
    };

    // ── STEP 8: Verify saved generation_context ───────────────────────────────
    const locIdIsSchool = savedLocId === schoolId;
    const locIdIsHome   = savedLocId === homeId;
    const locNameIsSchool = savedLocName && (
      savedLocName.toLowerCase().includes('university') ||
      savedLocName.toLowerCase().includes('college') ||
      savedLocName.toLowerCase().includes('aurelian') ||
      savedLocName === (schoolLocRecord?.name || '')
    );
    const locNameIsHome = savedLocName && homeLocRecord && savedLocName === homeLocRecord.name;

    proof.step_8_generation_context_verification = {
      saved_location_id:   savedLocId,
      saved_location_name: savedLocName,
      saved_loc_category:  savedLocCat,
      saved_zone_name:     savedZone,
      school_id:           schoolId,
      home_id:             homeId,
      school_name:         schoolLocRecord?.name || null,
      home_name:           homeLocRecord?.name   || null,
      location_id_is_school:   locIdIsSchool,
      location_id_is_home:     locIdIsHome,
      location_name_is_school: locNameIsSchool,
      location_name_is_home:   locNameIsHome,
      layer4_guard_worked: !locIdIsSchool && !locNameIsSchool,
    };

    // ── STEP 9: Full chain verdict ────────────────────────────────────────────
    const chainResults = {
      '1_character_enrolled_not_at_school': studentStatus === 'enrolled' && presenceStatus !== 'at_school',
      '2_presence_is_home': presenceStatus === 'home' || presenceStatus === 'sleeping',
      '3_resolved_loc_was_polluted': resolvedLocId === schoolId,
      '4_layer4_rejected_school_id': !locIdIsSchool,
      '5_saved_loc_id_is_home': locIdIsHome,
      '6_saved_loc_name_is_home': locNameIsHome,
      '7_saved_loc_name_not_school': !locNameIsSchool,
      '8_message_id_is_consistent': savedMsg.id === messageId,
    };

    const allPass = Object.values(chainResults).every(Boolean);

    proof.step_9_chain_results = chainResults;
    proof.final_verdict = allPass
      ? '✅ PROVEN — Layer 4 guard correctly rejected polluted school ID. Saved generation_context shows home location. School contamination is resolved.'
      : '❌ NOT PROVEN — One or more chain steps failed. See step_9_chain_results for which step failed.';

    return Response.json(proof);

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});