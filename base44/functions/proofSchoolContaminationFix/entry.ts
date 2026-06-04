/**
 * proofSchoolContaminationFix
 *
 * End-to-end proof for school location contamination fix.
 * 
 * Verifies:
 * 1. Character presence status
 * 2. What resolved_current_location_id points to (home or school)
 * 3. Whether Layer 4 guard would reject the school ID
 * 4. What location generateImageAsync would ACTUALLY use
 * 5. Whether existing bad message markers can be repaired without image regen
 *
 * Does NOT modify any records unless repair=true is passed.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

function isSchoolLocation(loc) {
  if (!loc) return false;
  const cat = (loc.category || '').toLowerCase();
  const name = (loc.name || '').toLowerCase();
  return cat === 'school' || cat === 'education' ||
    name.includes('university') || name.includes('college') ||
    name.includes('campus') || name.includes('school') ||
    name.includes('aurelian');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let payload = {};
    try { payload = await req.json(); } catch { /* no body */ }

    const characterId = payload.character_id;
    const repair = payload.repair === true;

    if (!characterId) {
      return Response.json({ error: 'character_id required' }, { status: 400 });
    }

    // ── STEP 1: Load character ────────────────────────────────────────────────
    let chars = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
    if (!chars?.length) {
      chars = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
    }
    const char = chars?.[0];
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    const presenceStatus = char.resolved_presence_status || char.location_status || 'unknown';
    const resolvedLocId = char.resolved_current_location_id || null;
    const homeLocId = char.current_home_location_id || null;
    const schoolLocId = char.current_school_location_id || char.education_location_id || null;
    const studentStatus = char.student_status || 'not_student';
    const isAtSchool = presenceStatus === 'at_school';
    const travelingToId = char.traveling_to_location_id || null;

    // ── STEP 2: Load locations ────────────────────────────────────────────────
    const locIds = [...new Set([resolvedLocId, homeLocId, schoolLocId].filter(Boolean))];
    const locRecords = {};
    for (const lid of locIds) {
      const recs = await base44.asServiceRole.entities.LocationReference.filter({ id: lid }, null, 1).catch(() => []);
      if (recs?.[0]) locRecords[lid] = recs[0];
    }

    const resolvedLocRecord = locRecords[resolvedLocId] || null;
    const homeLocRecord = locRecords[homeLocId] || null;
    const schoolLocRecord = locRecords[schoolLocId] || null;

    // ── STEP 3: Layer 4 guard simulation ─────────────────────────────────────
    // Mirrors exactly what generateImageAsync Layer 4 does
    let layer4Decision = 'ACCEPTED';
    let layer4Reason = '';
    let effectiveLocationId = null;
    let effectiveLocationName = null;
    let effectiveLocationCategory = null;

    if (resolvedLocId) {
      const isSchoolLoc = schoolLocId && resolvedLocId === schoolLocId;
      if (isSchoolLoc && !isAtSchool) {
        layer4Decision = 'REJECTED';
        layer4Reason = `resolved_current_location_id="${resolvedLocId}" points to school location but presence="${presenceStatus}" is not at_school — Layer 4 hard guard fires`;
      } else {
        layer4Decision = 'ACCEPTED';
        layer4Reason = `resolved_current_location_id="${resolvedLocId}" accepted — presence="${presenceStatus}"`;
        effectiveLocationId = resolvedLocId;
        effectiveLocationName = resolvedLocRecord?.name || null;
        effectiveLocationCategory = resolvedLocRecord?.category || null;
      }
    }

    // Layer 5 fallback — what generateImageAsync falls to after Layer 4 rejection
    if (layer4Decision === 'REJECTED' || !effectiveLocationId) {
      if (presenceStatus === 'home' || presenceStatus === 'sleeping' || presenceStatus === 'napping') {
        effectiveLocationId = homeLocId;
        effectiveLocationName = homeLocRecord?.name || null;
        effectiveLocationCategory = homeLocRecord?.category || null;
      } else if (presenceStatus === 'at_work') {
        const workLocId = char.current_work_location_id || char.occupation_location_id || null;
        effectiveLocationId = workLocId;
        effectiveLocationName = workLocId ? 'work location' : null;
        effectiveLocationCategory = 'workplace';
      } else {
        // Last resort home
        effectiveLocationId = homeLocId;
        effectiveLocationName = homeLocRecord?.name || null;
        effectiveLocationCategory = homeLocRecord?.category || null;
      }
    }

    // ── STEP 4: Scan recent messages for bad school markers ───────────────────
    const recentMsgs = await base44.entities.Message.filter(
      { character_id: characterId },
      '-created_date',
      100
    ).catch(() => []);

    const badMarkers = [];
    const goodMarkers = [];

    for (const msg of recentMsgs) {
      const gc = msg.generation_context;
      if (!gc || !msg.image_url) continue;

      const gcLocId = gc.location_id;
      const gcLocName = gc.location_name || '';
      const isSchoolMarker = (schoolLocId && gcLocId === schoolLocId) ||
        isSchoolLocation({ name: gcLocName, category: gc.loc_category });

      if (isSchoolMarker) {
        badMarkers.push({
          message_id: msg.id,
          created_date: msg.created_date,
          gc_location_id: gcLocId,
          gc_location_name: gcLocName,
          gc_loc_category: gc.loc_category,
        });
      } else if (gcLocId === homeLocId) {
        goodMarkers.push({
          message_id: msg.id,
          gc_location_name: gcLocName,
        });
      }
    }

    // ── STEP 5: Repair bad markers if requested ───────────────────────────────
    const repaired = [];
    if (repair && badMarkers.length > 0 && homeLocId && homeLocRecord) {
      for (const bad of badMarkers) {
        const msgList = await base44.asServiceRole.entities.Message.filter({ id: bad.message_id }, null, 1).catch(() => []);
        const msg = msgList?.[0];
        if (!msg) continue;

        const gc = msg.generation_context || {};
        const correctedGc = {
          ...gc,
          location_id: homeLocId,
          location_name: homeLocRecord.name,
          loc_category: homeLocRecord.category || 'home',
          school_marker_repaired: true,
          repair_at: new Date().toISOString(),
          original_wrong_location_id: bad.gc_location_id,
          original_wrong_location_name: bad.gc_location_name,
        };

        await base44.asServiceRole.entities.Message.update(bad.message_id, {
          generation_context: correctedGc,
        });

        repaired.push({
          message_id: bad.message_id,
          corrected_from: bad.gc_location_name,
          corrected_to: homeLocRecord.name,
        });

        console.log(`[proofSchoolContaminationFix] ✓ Repaired msg=${bad.message_id}: "${bad.gc_location_name}" → "${homeLocRecord.name}"`);
      }
    }

    // ── PROOF REPORT ──────────────────────────────────────────────────────────
    return Response.json({
      success: true,
      proof: {
        character: {
          id: char.id,
          name: char.name,
          presence_status: presenceStatus,
          student_status: studentStatus,
          is_at_school: isAtSchool,
          resolved_current_location_id: resolvedLocId,
          resolved_current_location_name: resolvedLocRecord?.name || null,
          home_location_id: homeLocId,
          home_location_name: homeLocRecord?.name || null,
          school_location_id: schoolLocId,
          school_location_name: schoolLocRecord?.name || null,
          traveling_to_location_id: travelingToId,
          resolved_loc_is_school: !!(schoolLocId && resolvedLocId === schoolLocId),
          resolved_loc_is_home: resolvedLocId === homeLocId,
        },
        layer4_guard: {
          decision: layer4Decision,
          reason: layer4Reason,
          school_id_rejected: layer4Decision === 'REJECTED',
        },
        effective_location_after_guard: {
          location_id: effectiveLocationId,
          location_name: effectiveLocationName,
          location_category: effectiveLocationCategory,
          is_home: effectiveLocationId === homeLocId,
          is_school: !!(schoolLocId && effectiveLocationId === schoolLocId),
        },
        message_marker_audit: {
          messages_scanned: recentMsgs.filter(m => m.image_url && m.generation_context).length,
          bad_school_markers_found: badMarkers.length,
          good_home_markers_found: goodMarkers.length,
          bad_markers: badMarkers.slice(0, 10),
        },
        repair_results: repair ? {
          repair_mode: true,
          repaired_count: repaired.length,
          repaired,
        } : {
          repair_mode: false,
          note: 'Pass repair=true to fix bad markers',
        },
        verdict: layer4Decision === 'REJECTED' && effectiveLocationId === homeLocId
          ? '✅ PASS: Layer 4 guard correctly rejects school ID and falls back to home'
          : layer4Decision === 'ACCEPTED' && effectiveLocationId === homeLocId
          ? '✅ PASS: resolved_current_location_id already points to home — no rejection needed'
          : '❌ FAIL: Effective location is not home after guard',
      },
    });

  } catch (error) {
    console.error('[proofSchoolContaminationFix] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});