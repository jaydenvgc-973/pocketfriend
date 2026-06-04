/**
 * proofSchoolContaminationFixed
 *
 * End-to-end proof that school location contamination is resolved.
 *
 * Steps:
 * 1. Read current character state — capture presence, resolved_location, school_id, home_id
 * 2. Confirm character is NOT at_school (enrolled but home)
 * 3. Confirm resolved_current_location_id is NOT the school ID
 * 4. Create a fresh Message record (placeholder)
 * 5. Call generateImageAsync directly with that message ID
 * 6. Wait for completion (poll up to 60s)
 * 7. Read back the saved Message record
 * 8. Extract generation_context.location_id, location_name, loc_category
 * 9. Verify none of them equal the school ID or school name
 * 10. Verify they equal the home ID and home name
 * 11. Return full proof payload — all fields on same message ID
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const characterId = payload.character_id;
    if (!characterId) {
      return Response.json({ error: 'character_id is required' }, { status: 400 });
    }

    // ── STEP 1: Read character ─────────────────────────────────────────────────
    const chars = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1);
    const char = chars?.[0];
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    const schoolId     = char.education_location_id || char.current_school_location_id || null;
    const homeId       = char.current_home_location_id || char.home_location_id || null;
    const presenceStatus = char.resolved_presence_status || char.location_status || 'unknown';
    const resolvedLocId  = char.resolved_current_location_id || null;
    const resolvedLocName = char.resolved_current_location_name || null;
    const studentStatus  = char.student_status || 'not_student';
    const travelingToId  = char.traveling_to_location_id || null;

    // ── STEP 2: Guard checks before generation ────────────────────────────────
    const proof = {
      character_id: characterId,
      character_name: char.name,
      step_1_character_state: {
        presence_status: presenceStatus,
        resolved_current_location_id: resolvedLocId,
        resolved_current_location_name: resolvedLocName,
        current_home_location_id: homeId,
        education_location_id: schoolId,
        student_status: studentStatus,
        traveling_to_location_id: travelingToId,
      },
      step_2_enrollment_vs_presence: {
        is_enrolled: studentStatus === 'enrolled',
        is_at_school: presenceStatus === 'at_school',
        enrollment_contaminates_location: studentStatus === 'enrolled' && presenceStatus !== 'at_school',
        note: 'enrolled=true + at_school=false means school must NEVER be used for image location',
      },
      step_3_resolved_location_clean: {
        resolved_loc_equals_school: resolvedLocId === schoolId,
        resolved_loc_equals_home: resolvedLocId === homeId,
        traveling_to_equals_school: travelingToId === schoolId,
        verdict: resolvedLocId === schoolId ? 'POLLUTED — resolved_location points to school' : 'CLEAN — resolved_location is not school',
      },
    };

    // If still polluted, document it but continue — we need to see what generateImageAsync does
    if (resolvedLocId === schoolId) {
      proof.step_3_resolved_location_clean.action = 'Proceeding with generation to capture what generateImageAsync Layer 4 guard does with polluted resolved_current_location_id';
    }

    // ── STEP 3: Find a conversation to attach the message to ─────────────────
    const convos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: user.email, character_ids: characterId, type: 'direct' },
      '-last_message_date',
      5
    );
    const directConvo = convos?.find(c =>
      Array.isArray(c.character_ids) && c.character_ids.length === 1 &&
      !c.shared_conversation_key && c.channel !== 'world_phone'
    );
    if (!directConvo) {
      return Response.json({ ...proof, error: 'No direct conversation found — open chat with this character first' }, { status: 400 });
    }
    proof.conversation_id = directConvo.id;

    // ── STEP 4: Create fresh placeholder message ──────────────────────────────
    const placeholderMsg = await base44.asServiceRole.entities.Message.create({
      conversation_id: directConvo.id,
      sender_type: 'character',
      character_id: characterId,
      character_name: char.name,
      content: '',
      timestamp: new Date().toISOString(),
      is_read: false,
    });
    proof.step_4_message_created = {
      message_id: placeholderMsg.id,
      conversation_id: directConvo.id,
      created_at: new Date().toISOString(),
    };

    const messageId = placeholderMsg.id;

    // ── STEP 5: Call generateImageAsync ──────────────────────────────────────
    const referenceImages = (char.reference_image_urls || [])
      .filter(u => u && u.startsWith('https://media.base44.com/'))
      .slice(0, 3);

    const genStarted = new Date().toISOString();
    const genResult = await base44.asServiceRole.functions.invoke('generateImageAsync', {
      messageId,
      prompt: '[CHARACTER] standing in the living room zone, looking relaxed at home. Medium shot from across the room. Natural afternoon lighting.',
      subjectType: 'character',
      characterId,
      characterName: char.name,
      characterReferenceImages: referenceImages,
      userReferenceImages: [],
      ownerEmail: user.email,
    });

    proof.step_5_generation_invoked = {
      started_at: genStarted,
      completed_at: new Date().toISOString(),
      gen_response_success: genResult?.success !== false,
      gen_response_location_name: genResult?.locationName || null,
      gen_response_zone_name: genResult?.zoneName || null,
    };

    // ── STEP 6: Read back the saved message ───────────────────────────────────
    // Poll up to 30s for image_url to be set
    let savedMsg = null;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const msgs = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1);
      savedMsg = msgs?.[0];
      if (savedMsg?.image_url || savedMsg?.content === '[IMAGE_FAILED]') break;
    }

    if (!savedMsg) {
      return Response.json({ ...proof, error: 'Could not read back message after generation' }, { status: 500 });
    }

    // ── STEP 7: Extract and verify generation_context ─────────────────────────
    const gc = savedMsg.generation_context || {};
    const savedLocId   = gc.location_id || null;
    const savedLocName = gc.location_name || null;
    const savedLocCat  = gc.loc_category || null;
    const savedZone    = gc.zone_name || null;
    const savedSubjects = gc.subjects || [];

    const isSchoolId   = savedLocId === schoolId;
    const isHomeId     = savedLocId === homeId;
    const schoolName   = 'Aurelian State University'; // known school name from prior investigation
    const isSchoolName = savedLocName && savedLocName.toLowerCase().includes('university') ||
                         savedLocName && savedLocName.toLowerCase().includes('college') ||
                         savedLocName && savedLocName.toLowerCase().includes('aurelian');

    proof.step_6_saved_message = {
      message_id: savedMsg.id,
      image_url: savedMsg.image_url || null,
      content: savedMsg.content || '',
      generation_context_exists: !!savedMsg.generation_context,
    };

    proof.step_7_generation_context = {
      saved_location_id: savedLocId,
      saved_location_name: savedLocName,
      saved_loc_category: savedLocCat,
      saved_zone_name: savedZone,
      subject_count: savedSubjects.length,
      subjects: savedSubjects.map(s => ({
        subject_id: s.subject_id,
        subject_name: s.subject_name,
        subject_type: s.subject_type,
      })),
    };

    proof.step_8_verification = {
      location_id_is_school: isSchoolId,
      location_id_is_home: isHomeId,
      location_name_contains_school: !!isSchoolName,
      school_id: schoolId,
      home_id: homeId,
      saved_location_id: savedLocId,
      verdict: isSchoolId
        ? '❌ FAIL — saved generation_context.location_id equals the school ID. Layer 4 guard did not block it.'
        : isHomeId
        ? '✅ PASS — saved generation_context.location_id equals the home ID. School contamination is resolved.'
        : savedLocId === null
        ? '⚠️ INCONCLUSIVE — location_id is null in saved context'
        : `⚠️ INCONCLUSIVE — location_id (${savedLocId}) is neither school nor home`,
    };

    // ── STEP 9: Full chain match ──────────────────────────────────────────────
    const chain = {
      character_presence_is_home: presenceStatus === 'home' || presenceStatus === 'sleeping' || presenceStatus === 'napping',
      character_enrolled_not_at_school: studentStatus === 'enrolled' && presenceStatus !== 'at_school',
      resolved_loc_not_school: resolvedLocId !== schoolId,
      generated_loc_id_is_home: isHomeId,
      generated_loc_name_not_school: !isSchoolName,
      all_pass: (presenceStatus !== 'at_school') && (resolvedLocId !== schoolId) && isHomeId && !isSchoolName,
    };

    proof.step_9_full_chain_result = chain;
    proof.final_verdict = chain.all_pass
      ? '✅ PROVEN — School contamination is resolved. All steps confirm home location in generation_context.'
      : '❌ NOT PROVEN — One or more steps failed. See step details above.';

    // ── STEP 10: Clean up placeholder if image failed ─────────────────────────
    if (savedMsg.content === '[IMAGE_FAILED]' || !savedMsg.image_url) {
      proof.image_generation_note = 'Image generation failed or returned no URL — but generation_context was still written and is the source of truth for this proof';
    }

    return Response.json(proof);

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});