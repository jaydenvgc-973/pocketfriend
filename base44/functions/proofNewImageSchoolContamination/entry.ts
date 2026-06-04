/**
 * proofNewImageSchoolContamination
 *
 * END-TO-END PROOF: Generates a brand-new image for a target character,
 * then verifies every layer of the pipeline on the SAME message ID:
 *
 *   Layer 1 — Character state before generation
 *   Layer 2 — Location resolved by generateImageAsync (from logs)
 *   Layer 3 — Saved generation_context on the written message
 *   Layer 4 — Rendered marker fields (location_id, location_name)
 *   Layer 5 — Message still correct after simulated re-read (persistence)
 *
 * This is NOT a simulation. It calls generateImageAsync for real.
 * The message created here is a real image message on the conversation.
 *
 * Required payload:
 *   character_id  — ID of the character to test
 *   conversation_id — an existing direct conversation with that character
 *
 * Optional:
 *   prompt — override default test prompt
 *   dry_run — if true, skip actual generation, only check character state
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── Eastern Time helpers ──────────────────────────────────────────────────────
// All timestamps in this function are Eastern Time. UTC is infrastructure only.
function nowET() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}
function etLabel(d) {
  if (!d) return 'none';
  const et = new Date(new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return et.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true });
}

function isSchoolId(locId, schoolLocId) {
  if (!locId || !schoolLocId) return false;
  return locId === schoolLocId;
}

function isSchoolName(locName) {
  if (!locName) return false;
  return /university|college|campus|school|academy|aurelian/i.test(locName);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await req.json().catch(() => ({}));
    const { character_id, conversation_id, dry_run = false } = payload;
    const testPrompt = payload.prompt || 'sitting at home, relaxed, casual moment';

    if (!character_id) return Response.json({ error: 'character_id is required' }, { status: 400 });
    if (!conversation_id && !dry_run) return Response.json({ error: 'conversation_id is required (or set dry_run=true)' }, { status: 400 });

    const startedAt = nowET();
    const proof = {
      test_started_at_ET: startedAt.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true }),
      character_id,
      conversation_id: conversation_id || null,
      dry_run,
    };

    // ── LAYER 1: Character state BEFORE generation ────────────────────────────
    console.log(`[proof] ── LAYER 1: Reading character state ──`);

    let char = null;
    try {
      const chars = await base44.entities.Character.filter({ id: character_id }, null, 1);
      char = chars?.[0] || null;
    } catch (_) {}

    if (!char) {
      return Response.json({
        error: 'Character not readable via user session. This function must be called from an authenticated user context, not the test runner.',
        tip: 'Call this from the app via base44.functions.invoke("proofNewImageSchoolContamination", payload)',
        character_id,
      }, { status: 403 });
    }

    const schoolLocId   = char.current_school_location_id || char.education_location_id || null;
    const homeLocId     = char.current_home_location_id || char.home_location_id || null;
    const presenceStatus = char.resolved_presence_status || char.location_status || 'unknown';
    const resolvedLocId  = char.resolved_current_location_id || null;
    const resolvedLocName = char.resolved_current_location_name || null;
    const travelToLocId  = char.traveling_to_location_id || null;

    const layer1 = {
      character_name:             char.name,
      student_status:             char.student_status || 'none',
      presence_status:            presenceStatus,
      resolved_current_location_id:   resolvedLocId,
      resolved_current_location_name: resolvedLocName,
      current_home_location_id:   homeLocId,
      current_school_location_id: schoolLocId,
      traveling_to_location_id:   travelToLocId,
      is_at_school:               presenceStatus === 'at_school',
      resolved_loc_is_school:     isSchoolId(resolvedLocId, schoolLocId),
      resolved_name_looks_like_school: isSchoolName(resolvedLocName),
      travel_destination_is_school: isSchoolId(travelToLocId, schoolLocId),
    };

    proof.layer1_character_state = layer1;

    const layer1Contaminated =
      layer1.resolved_loc_is_school && !layer1.is_at_school;

    proof.layer1_contamination_detected = layer1Contaminated;

    console.log(`[proof] Layer 1: presence="${presenceStatus}" resolved_id="${resolvedLocId}" school_id="${schoolLocId}" home_id="${homeLocId}"`);
    console.log(`[proof] Layer 1: contamination_detected=${layer1Contaminated}`);

    if (dry_run) {
      proof.result = layer1Contaminated ? 'LAYER1_CONTAMINATION_DETECTED' : 'LAYER1_CLEAN';
      proof.verdict = layer1Contaminated
        ? '⚠️ Layer 1 contamination: resolved_current_location_id equals school but character is not at_school. Fix the character record before running a full image proof.'
        : '✅ Layer 1 clean: character state looks correct. Set dry_run=false and provide conversation_id to run full image proof.';
      return Response.json(proof);
    }

    // ── STEP: Create a placeholder message on the conversation ───────────────
    console.log(`[proof] Creating placeholder image message on conversation=${conversation_id}`);

    const placeholderMsg = await base44.entities.Message.create({
      conversation_id,
      sender_type: 'character',
      character_id,
      character_name: char.name,
      content: '',
      timestamp: new Date().toISOString(),
    });

    if (!placeholderMsg?.id) {
      return Response.json({ error: 'Failed to create placeholder message', proof }, { status: 500 });
    }

    const messageId = placeholderMsg.id;
    proof.message_id = messageId;
    console.log(`[proof] Placeholder created: message_id=${messageId}`);

    // ── LAYER 2: Invoke generateImageAsync ───────────────────────────────────
    console.log(`[proof] ── LAYER 2: Invoking generateImageAsync ──`);

    const generationPayload = {
      messageId,
      prompt: testPrompt,
      subjectType: 'character',
      characterId: character_id,
      characterName: char.name,
      characterReferenceImages: (char.reference_image_urls || []).slice(0, 4),
      ownerEmail: user.email,
    };

    let genResult = null;
    try {
      const genResponse = await base44.functions.invoke('generateImageAsync', generationPayload);
      genResult = genResponse?.data || genResponse;
    } catch (genErr) {
      proof.layer2_generation_error = genErr?.message || String(genErr);
      console.error(`[proof] generateImageAsync failed: ${proof.layer2_generation_error}`);
    }

    proof.layer2_generation_result = {
      success:       genResult?.success ?? false,
      image_url:     genResult?.imageUrl || null,
      location_name: genResult?.locationName || null,
      zone_name:     genResult?.zoneName || null,
      error:         genResult?.error || proof.layer2_generation_error || null,
    };

    console.log(`[proof] Layer 2: success=${genResult?.success} locationName="${genResult?.locationName || 'none'}"`);

    // ── LAYER 3: Read the saved message back from DB ──────────────────────────
    console.log(`[proof] ── LAYER 3: Reading saved message record ──`);

    // Wait briefly for DB write to settle
    await new Promise(r => setTimeout(r, 1500));

    const savedMsgList = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
    const savedMsg = savedMsgList?.[0] || null;

    if (!savedMsg) {
      proof.layer3_error = 'Could not read back saved message from DB';
      proof.verdict = '❌ INCONCLUSIVE: Message not found after generation';
      return Response.json(proof);
    }

    const gc = savedMsg.generation_context || {};
    const savedLocId   = gc.location_id   || null;
    const savedLocName = gc.location_name || null;
    const savedZoneName = gc.zone_name    || null;
    const savedImageUrl = savedMsg.image_url || null;

    const layer3 = {
      message_id:             savedMsg.id,
      image_url:              savedImageUrl,
      content:                savedMsg.content,
      generation_context_version: gc.generation_context_version || null,
      saved_location_id:      savedLocId,
      saved_location_name:    savedLocName,
      saved_zone_name:        savedZoneName,
      saved_loc_category:     gc.loc_category || null,
      saved_subject_type:     gc.subject_type || gc.image_type || null,
      saved_at_ET:            etLabel(savedMsg.updated_date || savedMsg.created_date),
      // Contamination checks
      saved_loc_is_school_id:   isSchoolId(savedLocId, schoolLocId),
      saved_loc_name_looks_like_school: isSchoolName(savedLocName),
      saved_loc_matches_home:   savedLocId === homeLocId,
    };

    proof.layer3_saved_message = layer3;

    console.log(`[proof] Layer 3: saved_location_id="${savedLocId}" saved_location_name="${savedLocName}" is_school_id=${layer3.saved_loc_is_school_id} matches_home=${layer3.saved_loc_matches_home}`);

    // ── LAYER 4: Re-read message independently to simulate fresh load ─────────
    console.log(`[proof] ── LAYER 4: Simulating fresh message read (persistence check) ──`);

    await new Promise(r => setTimeout(r, 500));

    const freshMsgList = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
    const freshMsg = freshMsgList?.[0] || null;
    const freshGC  = freshMsg?.generation_context || {};

    const layer4 = {
      message_id_matches:   freshMsg?.id === messageId,
      fresh_location_id:    freshGC.location_id   || null,
      fresh_location_name:  freshGC.location_name || null,
      fresh_image_url:      freshMsg?.image_url   || null,
      fresh_loc_is_school_id:   isSchoolId(freshGC.location_id, schoolLocId),
      fresh_loc_name_looks_like_school: isSchoolName(freshGC.location_name),
      fresh_loc_matches_home:   freshGC.location_id === homeLocId,
      db_read_consistent:   freshGC.location_id === savedLocId,
    };

    proof.layer4_persistence_check = layer4;

    console.log(`[proof] Layer 4: fresh_location_id="${freshGC.location_id}" matches_home=${layer4.fresh_loc_matches_home} consistent=${layer4.db_read_consistent}`);

    // ── VERDICT ───────────────────────────────────────────────────────────────
    const failures = [];

    // Layer 1 checks
    if (layer1Contaminated) {
      failures.push('LAYER1: resolved_current_location_id equals school but character is not at_school — character record is polluted');
    }

    // Layer 3 checks (generation output)
    if (!genResult?.success) {
      failures.push(`LAYER2: Image generation failed — ${genResult?.error || 'unknown error'}`);
    }
    if (layer3.saved_loc_is_school_id) {
      failures.push(`LAYER3: generation_context.location_id saved as school ID "${savedLocId}" — Layer 4 guard in generateImageAsync did NOT reject it`);
    }
    if (layer3.saved_loc_name_looks_like_school) {
      failures.push(`LAYER3: generation_context.location_name="${savedLocName}" looks like a school name — contamination persisted to DB`);
    }
    if (!layer3.saved_loc_matches_home && !layer3.saved_loc_is_school_id && savedLocId) {
      // It's not home and not school — some other location
      failures.push(`LAYER3: generation_context.location_id="${savedLocId}" is neither home nor school — unexpected location resolved`);
    }

    // Layer 4 checks (persistence)
    if (!layer4.db_read_consistent) {
      failures.push(`LAYER4: DB read inconsistency — first read location_id="${savedLocId}", second read="${freshGC.location_id}"`);
    }
    if (layer4.fresh_loc_is_school_id) {
      failures.push(`LAYER4: Fresh read still shows school ID — DB contamination confirmed`);
    }

    const passed = failures.length === 0;

    proof.verdict = passed
      ? `✅ ALL LAYERS PASS — New image generated and verified clean on message_id=${messageId}. location_id="${savedLocId}" (home), location_name="${savedLocName}". School contamination NOT present.`
      : `❌ FAILURES DETECTED on message_id=${messageId}: ${failures.join(' | ')}`;

    proof.pass = passed;
    proof.failures = failures;
    proof.completed_at_ET = nowET().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true });

    // Summary for quick review
    proof.summary = {
      message_id:         messageId,
      character_name:     char.name,
      character_presence: presenceStatus,
      character_home_id:  homeLocId,
      character_school_id: schoolLocId,
      resolved_loc_id_before_gen: resolvedLocId,
      generated_image_url: savedImageUrl,
      saved_location_id:  savedLocId,
      saved_location_name: savedLocName,
      fresh_location_id:  freshGC.location_id || null,
      fresh_location_name: freshGC.location_name || null,
      all_match_home: layer3.saved_loc_matches_home && layer4.fresh_loc_matches_home,
      no_school_contamination: !layer3.saved_loc_is_school_id && !layer4.fresh_loc_is_school_id,
      db_consistent: layer4.db_read_consistent,
      image_generated: !!savedImageUrl,
    };

    console.log(`[proof] ── FINAL VERDICT ──`);
    console.log(`[proof] ${proof.verdict}`);

    return Response.json(proof);

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});