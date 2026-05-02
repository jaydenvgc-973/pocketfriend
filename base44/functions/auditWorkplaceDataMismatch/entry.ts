/**
 * auditWorkplaceDataMismatch — READ-ONLY audit function.
 *
 * For every character owned by the requesting user that has a workplace or work schedule,
 * this function logs ALL workplace-related data fields from:
 *   1. Character file (occupation, work_start_time, work_end_time, work_days, etc.)
 *   2. LocationReference records linked as work locations
 *   3. Resolved presence fields (resolved_current_location_id, resolved_presence_status)
 *   4. Chat prompt payload fields (occupation_location_id, occupation_location_name)
 *   5. Narrative prompt context fields (work_state, resolved_location fields)
 *
 * NO WRITES. NO CHANGES. AUDIT ONLY.
 *
 * Output format per character:
 *   character_name, character_id, owner_email,
 *   profile_workplace, schedule_workplace, ui_displayed_workplace,
 *   home_card_location, presence_location,
 *   chat_payload_workplace, narrative_payload_workplace, image_payload_workplace,
 *   source_of_truth_match, mismatch_source, recommended_fix
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const ownerEmail = user.email;

    // ── 1. FETCH ALL CHARACTERS OWNED BY THIS USER ───────────────────────────
    const allChars = await base44.entities.Character.filter(
      { owner_email: ownerEmail, status: 'active' },
      'name',
      200
    ).catch(() => []);

    // Filter to only characters that have any workplace-related data
    const workChars = allChars.filter(c =>
      c.occupation ||
      c.occupation_location_id ||
      c.occupation_location_name ||
      c.current_work_location_id ||
      c.work_start_time ||
      c.work_end_time ||
      (c.work_days && c.work_days.length > 0)
    );

    console.log(`[auditWorkplace] Found ${workChars.length} characters with workplace data out of ${allChars.length} total`);

    if (workChars.length === 0) {
      return Response.json({
        success: true,
        owner_email: ownerEmail,
        total_characters_scanned: allChars.length,
        characters_with_workplace: 0,
        audit_results: [],
        summary: 'No characters with workplace data found for this account.',
      });
    }

    // ── 2. FETCH ALL LOCATIONS OWNED BY THIS USER ────────────────────────────
    const allLocs = await base44.asServiceRole.entities.LocationReference.filter(
      { owner_email: ownerEmail },
      'name',
      300
    ).catch(() => []);

    // Also fetch shared locations (scope=shared) since workers can be assigned to shared places
    const sharedLocs = await base44.asServiceRole.entities.LocationReference.filter(
      { scope: 'shared' },
      'name',
      100
    ).catch(() => []);

    const locMap = {};
    for (const loc of [...allLocs, ...sharedLocs]) {
      if (!locMap[loc.id]) locMap[loc.id] = loc;
    }

    console.log(`[auditWorkplace] Location map built: ${Object.keys(locMap).length} locations`);

    // ── 3. AUDIT EACH CHARACTER ──────────────────────────────────────────────
    const auditResults = [];
    const mismatches = [];

    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (const char of workChars) {
      // ── FIELD 1: Profile workplace (what the character file says their job/workplace is) ──
      const profileWorkplace = {
        occupation: char.occupation || null,
        occupation_location_id: char.occupation_location_id || null,
        occupation_location_name: char.occupation_location_name || null,
        current_work_location_id: char.current_work_location_id || null,
        additional_occupation_locations: char.additional_occupation_locations || [],
        work_details: char.work_details || null,
      };

      // Resolve the location record for primary occupation_location_id
      const primaryWorkLoc = char.occupation_location_id
        ? locMap[char.occupation_location_id] || null
        : null;

      const fallbackWorkLoc = char.current_work_location_id
        ? locMap[char.current_work_location_id] || null
        : null;

      const resolvedWorkLocRecord = primaryWorkLoc || fallbackWorkLoc;

      // ── FIELD 2: Work schedule stored on character file ──
      const scheduleWorkplace = {
        work_start_time: char.work_start_time || null,
        work_end_time: char.work_end_time || null,
        work_days: char.work_days?.length > 0
          ? char.work_days.map(d => DAY_NAMES[d] || d).join(', ')
          : null,
        schedule_location_match: resolvedWorkLocRecord
          ? resolvedWorkLocRecord.name
          : 'No location record found for occupation_location_id',
      };

      // ── FIELD 3: What the UI would display as workplace ──
      // This is what Profile UI shows: occupation_location_name OR name from location record
      const uiDisplayedWorkplace =
        char.occupation_location_name ||
        (resolvedWorkLocRecord ? resolvedWorkLocRecord.name : null) ||
        char.occupation ||
        'Not set';

      // ── FIELD 4: Home card location (resolved_current_location_name) ──
      const homeCardLocation = {
        resolved_current_location_id: char.resolved_current_location_id || null,
        resolved_current_location_name: char.resolved_current_location_name || null,
        resolved_location_type: char.resolved_location_type || null,
        resolved_presence_status: char.resolved_presence_status || null,
        resolved_source_reason: char.resolved_source_reason || null,
      };

      // ── FIELD 5: Presence/travel location ──
      const presenceLocation = {
        location_status: char.location_status || null,
        travel_status: char.travel_status || null,
        traveling_to_location_id: char.traveling_to_location_id || null,
        traveling_to_location_name: char.traveling_to_location_name || null,
        current_home_location_id: char.current_home_location_id || null,
        resolved_current_location_id: char.resolved_current_location_id || null,
        resolved_current_location_name: char.resolved_current_location_name || null,
      };

      // ── FIELD 6: Chat prompt payload workplace ──
      // The chat prompt (pages/Chat → sendMessage → buildSystemPrompt) injects:
      //   char.occupation, char.occupation_location_name, char.occupation_location_id
      //   char.work_start_time, char.work_end_time, char.work_days
      //   char.resolved_current_location_name (via livePresence / awarenessContext)
      const chatPayloadWorkplace = {
        occupation_in_system_prompt: char.occupation || null,
        occupation_location_name_in_prompt: char.occupation_location_name || null,
        work_schedule_in_prompt: char.work_start_time
          ? `${char.work_start_time}–${char.work_end_time} on ${scheduleWorkplace.work_days || 'unspecified days'}`
          : null,
        live_presence_injected: char.resolved_current_location_name || null,
        resolved_presence_status: char.resolved_presence_status || null,
      };

      // ── FIELD 7: Narrative prompt payload workplace ──
      // generateNarrative reads character fields directly + resolves location from locationMap
      // The narrative uses: char.resolved_current_location_id → locationMap lookup → locationName
      const narrativePayloadWorkplace = {
        resolved_location_id_used: char.resolved_current_location_id || null,
        resolved_location_name_from_db: homeCardLocation.resolved_current_location_name,
        location_record_from_id: char.resolved_current_location_id
          ? (locMap[char.resolved_current_location_id]?.name || 'LOCATION RECORD NOT FOUND')
          : null,
        work_state_derived: (() => {
          // Mirror the work state logic from generateNarrative / generateAutomaticNarrative
          if (!char.work_days || !char.work_start_time || !char.work_end_time) return 'off_work (no schedule)';
          const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
          const dayOfWeek = nowET.getDay();
          const currentMinutes = nowET.getHours() * 60 + nowET.getMinutes();
          const [wsh, wsm] = char.work_start_time.split(':').map(Number);
          const [weh, wem] = char.work_end_time.split(':').map(Number);
          const workStart = wsh * 60 + wsm;
          const workEnd = weh * 60 + wem;
          const isWorkDay = char.work_days.includes(dayOfWeek);
          const isWorkHours = currentMinutes >= workStart && currentMinutes < workEnd;
          if (isWorkDay && isWorkHours) return 'AT WORK (currently inside scheduled work window)';
          return `off_work (day=${DAY_NAMES[dayOfWeek]}, isWorkDay=${isWorkDay}, time=${nowET.getHours()}:${String(nowET.getMinutes()).padStart(2,'0')}, window=${char.work_start_time}–${char.work_end_time})`;
        })(),
      };

      // ── FIELD 8: Image prompt payload workplace ──
      // generateImageAsync resolves location from char.resolved_current_location_id
      //   → LocationReference DB lookup → zone images
      // The image uses the LOCATION RECORD, not occupation_location_name string
      const imagePayloadWorkplace = {
        location_id_used_for_image: char.resolved_current_location_id || char.current_home_location_id || null,
        location_name_for_image: char.resolved_current_location_name ||
          (char.resolved_current_location_id && locMap[char.resolved_current_location_id]?.name) ||
          null,
        occupation_location_id: char.occupation_location_id || null,
        occupation_location_name: char.occupation_location_name || null,
        note: char.resolved_current_location_id === char.occupation_location_id
          ? 'MATCH: resolved_current_location_id == occupation_location_id (character is at work)'
          : char.resolved_current_location_id
            ? `DIFFERS: resolved_current_location_id (${char.resolved_current_location_id}) ≠ occupation_location_id (${char.occupation_location_id || 'null'}) — character is NOT at their workplace right now`
            : 'resolved_current_location_id is null',
      };

      // ── MISMATCH DETECTION ────────────────────────────────────────────────
      const mismatches_found = [];

      // Check: occupation_location_name vs actual location record name
      if (char.occupation_location_id && primaryWorkLoc) {
        if (char.occupation_location_name && char.occupation_location_name !== primaryWorkLoc.name) {
          mismatches_found.push(
            `occupation_location_name "${char.occupation_location_name}" ≠ location record name "${primaryWorkLoc.name}" (ID: ${char.occupation_location_id})`
          );
        }
      } else if (char.occupation_location_id && !primaryWorkLoc) {
        mismatches_found.push(
          `occupation_location_id "${char.occupation_location_id}" has NO matching LocationReference record — location may have been deleted`
        );
      }

      // Check: current_work_location_id vs occupation_location_id
      if (char.current_work_location_id && char.occupation_location_id &&
          char.current_work_location_id !== char.occupation_location_id) {
        mismatches_found.push(
          `current_work_location_id (${char.current_work_location_id}) ≠ occupation_location_id (${char.occupation_location_id}) — two different work location IDs on character file`
        );
      }

      // Check: resolved_current_location_id vs home/work location during work hours
      if (narrativePayloadWorkplace.work_state_derived.startsWith('AT WORK')) {
        if (char.resolved_current_location_id !== char.occupation_location_id) {
          mismatches_found.push(
            `Character is AT WORK by schedule but resolved_current_location_id (${char.resolved_current_location_id || 'null'}) ≠ occupation_location_id (${char.occupation_location_id || 'null'}) — presence not synced with schedule`
          );
        }
      }

      // Check: resolved_current_location_name vs actual DB record name
      if (char.resolved_current_location_id) {
        const dbLocName = locMap[char.resolved_current_location_id]?.name;
        if (dbLocName && char.resolved_current_location_name && dbLocName !== char.resolved_current_location_name) {
          mismatches_found.push(
            `resolved_current_location_name on character "${char.resolved_current_location_name}" ≠ actual LocationReference name "${dbLocName}" — stale cached name on character file`
          );
        }
        if (!dbLocName && char.resolved_current_location_id) {
          mismatches_found.push(
            `resolved_current_location_id "${char.resolved_current_location_id}" — NO matching LocationReference record found`
          );
        }
      }

      const sourceOfTruthMatch = mismatches_found.length === 0;

      // ── RECOMMENDED FIX ───────────────────────────────────────────────────
      let recommendedFix = 'None — all workplace data sources match.';
      if (!sourceOfTruthMatch) {
        const fixes = [];
        if (mismatches_found.some(m => m.includes('occupation_location_name') && m.includes('≠ location record name'))) {
          fixes.push(`Update character.occupation_location_name to match the actual LocationReference record name`);
        }
        if (mismatches_found.some(m => m.includes('has NO matching LocationReference record'))) {
          fixes.push(`Assign a valid occupation_location_id to the character — current ID points to a deleted/missing location`);
        }
        if (mismatches_found.some(m => m.includes('two different work location IDs'))) {
          fixes.push(`Consolidate current_work_location_id and occupation_location_id to the same location`);
        }
        if (mismatches_found.some(m => m.includes('AT WORK by schedule but resolved_current_location_id'))) {
          fixes.push(`Run enforceCharacterWorkSchedule to sync resolved presence with active work schedule`);
        }
        if (mismatches_found.some(m => m.includes('stale cached name'))) {
          fixes.push(`Update resolved_current_location_name on character to match the LocationReference record`);
        }
        if (mismatches_found.some(m => m.includes('resolved_current_location_id') && m.includes('NO matching LocationReference'))) {
          fixes.push(`Clear resolved_current_location_id — it points to a missing location record`);
        }
        recommendedFix = fixes.join(' | ');
      }

      const auditEntry = {
        character_name: char.name,
        character_id: char.id,
        owner_email: char.owner_email,
        character_type: char.character_type,

        // === DATA LAYER AUDIT ===
        profile_workplace: {
          occupation: profileWorkplace.occupation,
          occupation_location_id: profileWorkplace.occupation_location_id,
          occupation_location_name: profileWorkplace.occupation_location_name,
          location_record_name: resolvedWorkLocRecord?.name || null,
          location_category: resolvedWorkLocRecord?.category || null,
        },

        schedule_workplace: scheduleWorkplace,

        ui_displayed_workplace: uiDisplayedWorkplace,

        home_card_location: homeCardLocation,

        presence_location: presenceLocation,

        chat_payload_workplace: chatPayloadWorkplace,

        narrative_payload_workplace: narrativePayloadWorkplace,

        image_payload_workplace: imagePayloadWorkplace,

        // === VERDICT ===
        source_of_truth_match: sourceOfTruthMatch,
        mismatch_source: sourceOfTruthMatch ? null : mismatches_found,
        recommended_fix: recommendedFix,
      };

      auditResults.push(auditEntry);

      if (!sourceOfTruthMatch) {
        mismatches.push({
          character_name: char.name,
          character_id: char.id,
          mismatches: mismatches_found,
          recommended_fix: recommendedFix,
        });
        console.warn(`[auditWorkplace] MISMATCH — ${char.name} (${char.id}):`);
        mismatches_found.forEach(m => console.warn(`  • ${m}`));
      } else {
        console.log(`[auditWorkplace] ✓ ${char.name} (${char.id}) — all workplace data sources match`);
      }
    }

    // ── SUMMARY ──────────────────────────────────────────────────────────────
    const totalClean = auditResults.filter(r => r.source_of_truth_match).length;
    const totalMismatch = auditResults.filter(r => !r.source_of_truth_match).length;

    console.log(`[auditWorkplace] COMPLETE — ${totalClean} clean, ${totalMismatch} with mismatches`);

    return Response.json({
      success: true,
      owner_email: ownerEmail,
      total_characters_scanned: allChars.length,
      characters_with_workplace: workChars.length,
      clean_count: totalClean,
      mismatch_count: totalMismatch,
      audit_results: auditResults,
      mismatch_summary: mismatches,
      instructions: 'This is a READ-ONLY audit. No data was changed. Review mismatch_summary for issues.',
    });

  } catch (error) {
    console.error('[auditWorkplaceDataMismatch] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});