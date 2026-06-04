import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Repairs existing chat messages where generation_context.location_name shows a school
 * but the character is currently home (not at_school).
 *
 * FIX: Updates location_id, location_name, loc_category in generation_context
 * to match the character's actual home location.
 * Does NOT regenerate the image — only fixes the marker metadata.
 *
 * Safe to run multiple times (idempotent).
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let payload = {};
    try { payload = await req.json(); } catch { /* no body */ }

    // Optional: target a specific character ID, or run for all characters
    const targetCharacterId = payload.character_id || null;

    // Step 1: Load characters for this user
    const characters = await base44.entities.Character.filter({ status: 'active' }, null, 200);
    const targetChars = targetCharacterId
      ? characters.filter(c => c.id === targetCharacterId)
      : characters;

    // Build a map of characterId → { homeLocationId, homeLocationName, schoolLocationId }
    const charMap = {};
    for (const c of targetChars) {
      const schoolLocId = c.current_school_location_id || c.education_location_id || null;
      const homeLocId = c.current_home_location_id || c.home_location_id || null;
      const presenceStatus = c.resolved_presence_status || c.location_status || '';
      charMap[c.id] = {
        name: c.name,
        homeLocId,
        homeLocName: c.resolved_current_location_name || null,
        schoolLocId,
        presenceStatus,
        isAtSchool: presenceStatus === 'at_school',
      };
    }

    // Resolve home location names for characters who need it
    const homeLocIdsNeeded = [...new Set(
      Object.values(charMap)
        .filter(c => !c.isAtSchool && c.homeLocId && !c.homeLocName)
        .map(c => c.homeLocId)
    )];

    const homeLocMap = {};
    for (const locId of homeLocIdsNeeded) {
      const locs = await base44.asServiceRole.entities.LocationReference.filter({ id: locId }, null, 1).catch(() => []);
      if (locs?.[0]) {
        homeLocMap[locId] = { name: locs[0].name, category: locs[0].category || 'home' };
      }
    }

    // Fill in home location names
    for (const charId of Object.keys(charMap)) {
      const c = charMap[charId];
      if (!c.isAtSchool && c.homeLocId && homeLocMap[c.homeLocId]) {
        c.homeLocName = homeLocMap[c.homeLocId].name;
        c.homeLocCategory = homeLocMap[c.homeLocId].category;
      }
    }

    const repaired = [];
    const skipped = [];
    const errors = [];

    // Step 2: For each non-at-school character with a school location,
    // find messages where generation_context.location_id === schoolLocId
    for (const [charId, charInfo] of Object.entries(charMap)) {
      if (charInfo.isAtSchool) {
        skipped.push({ charId, name: charInfo.name, reason: 'currently_at_school' });
        continue;
      }
      if (!charInfo.schoolLocId) {
        skipped.push({ charId, name: charInfo.name, reason: 'no_school_location' });
        continue;
      }
      if (!charInfo.homeLocId || !charInfo.homeLocName) {
        skipped.push({ charId, name: charInfo.name, reason: 'home_location_unknown' });
        continue;
      }

      // Load recent messages for this character that have an image
      // Filter by character_id and look for wrong school marker
      const msgs = await base44.entities.Message.filter(
        { character_id: charId },
        '-created_date',
        200
      ).catch(() => []);

      // Fetch school location name for name-based matching
      let schoolLocName = null;
      const schoolLocRec = await base44.asServiceRole.entities.LocationReference.filter({ id: charInfo.schoolLocId }, null, 1).catch(() => []);
      if (schoolLocRec?.[0]) schoolLocName = schoolLocRec[0].name;

      // Find messages where generation_context.location_id OR location_name matches school
      const badMsgs = msgs.filter(m => {
        const gc = m.generation_context;
        if (!gc) return false;
        if (!m.image_url && m.content !== '' && m.content !== '[IMAGE_FAILED]') return false;
        const idMatch = gc.location_id === charInfo.schoolLocId;
        const nameMatch = schoolLocName && gc.location_name === schoolLocName;
        return idMatch || nameMatch;
      });

      if (badMsgs.length === 0) {
        skipped.push({ charId, name: charInfo.name, reason: 'no_bad_messages_found', schoolLocId: charInfo.schoolLocId });
        continue;
      }

      // Repair each bad message
      for (const msg of badMsgs) {
        try {
          const gc = msg.generation_context || {};
          const correctedGc = {
            ...gc,
            location_id: charInfo.homeLocId,
            location_name: charInfo.homeLocName,
            loc_category: charInfo.homeLocCategory || 'home',
            marker_repair_applied: true,
            marker_repair_at: new Date().toISOString(),
            marker_repair_reason: `school_id_rejected_presence=${charInfo.presenceStatus}`,
            original_wrong_location_id: gc.location_id,
            original_wrong_location_name: gc.location_name,
          };

          await base44.asServiceRole.entities.Message.update(msg.id, {
            generation_context: correctedGc,
          });

          repaired.push({
            messageId: msg.id,
            charName: charInfo.name,
            wrong_location: gc.location_name,
            corrected_to: charInfo.homeLocName,
            created_date: msg.created_date,
          });

          console.log(`[repairWrongSchoolMarkerOnMessages] ✓ Repaired msg=${msg.id} char="${charInfo.name}" wrong="${gc.location_name}" → correct="${charInfo.homeLocName}"`);
        } catch (err) {
          errors.push({ messageId: msg.id, error: err.message });
          console.error(`[repairWrongSchoolMarkerOnMessages] ✗ Failed msg=${msg.id}: ${err.message}`);
        }
      }
    }

    return Response.json({
      success: true,
      summary: {
        repaired: repaired.length,
        skipped: skipped.length,
        errors: errors.length,
      },
      repaired,
      skipped,
      errors,
    });

  } catch (error) {
    console.error('[repairWrongSchoolMarkerOnMessages] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});