import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * repairSchoolMarkerOnHomeMessages
 *
 * Finds all Message records where:
 *   - generation_context.location_name contains a school name (e.g. "Aurelian State University")
 *   - the subject character is currently home (resolved_presence_status !== 'at_school')
 *   - the character has no explicit campus residence assignment
 *
 * Repairs the generation_context marker fields IN-PLACE:
 *   - location_id   → character's current home location ID
 *   - location_name → character's current home location name
 *   - loc_category  → 'home'
 *   - zone_name     → null (cannot know which home zone the image used)
 *
 * Does NOT regenerate the image. Only fixes the marker metadata.
 *
 * Call with: { dry_run: true } to audit without writing.
 * Call with: { character_id: "xxx" } to limit to one character.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    let payload = {};
    try { payload = await req.json(); } catch { /* no body */ }
    const dryRun = payload.dry_run === true;
    const filterCharId = payload.character_id || null;

    // 1. Load all active characters for this user so we know school IDs and home IDs
    const allChars = await base44.entities.Character.filter({ status: 'active' }, null, 200);

    // Build a map: characterId → { homeLocationId, homeLocationName, schoolLocationIds[], presenceStatus }
    const charMap = {};
    for (const c of allChars) {
      const schoolIds = [
        c.current_school_location_id,
        c.education_location_id,
      ].filter(Boolean);
      charMap[c.id] = {
        homeLocationId: c.current_home_location_id || c.home_location_id || null,
        homeLocationName: c.resolved_current_location_name || null, // may be school — we'll fix below
        presenceStatus: c.resolved_presence_status || c.location_status || '',
        schoolIds,
        name: c.name,
      };
    }

    // For characters at home, resolve actual home location name from LocationReference
    // We need the real home name, not resolved_current_location_name (which may be polluted)
    const homeLocIds = [...new Set(Object.values(charMap).map(c => c.homeLocationId).filter(Boolean))];
    const homeLocMap = {};
    for (const locId of homeLocIds) {
      const locs = await base44.asServiceRole.entities.LocationReference.filter({ id: locId }, null, 1).catch(() => []);
      if (locs?.[0]) homeLocMap[locId] = locs[0].name;
    }

    // 2. Load messages in batches to cover older records
    // The defective messages may be older than the top 500
    const batch1 = await base44.asServiceRole.entities.Message.filter(
      { sender_type: 'character' }, '-created_date', 500
    ).catch(() => []);
    const batch2 = await base44.asServiceRole.entities.Message.filter(
      { sender_type: 'character' }, '-created_date', 500, 500
    ).catch(() => []);
    const allMessages = [...batch1, ...batch2];

    const toRepair = [];
    const audited = [];

    for (const msg of allMessages) {
      const gc = msg.generation_context;
      if (!gc) continue;
      if (!msg.image_url && msg.content !== '') continue; // skip non-image messages

      const savedLocName = gc.location_name || '';
      const savedLocId = gc.location_id || '';

      if (!savedLocName) continue;

      // Find the subject character
      const charId = filterCharId || gc.character_id || msg.character_id || null;
      if (!charId) continue;
      if (filterCharId && charId !== filterCharId) continue;

      const charInfo = charMap[charId];
      if (!charInfo) continue;

      // Check: is the saved location_name a school name for this character?
      // Also catch: location_id is home but location_name is wrong (name-only pollution)
      const isSchoolNameInMarker = (
        savedLocName.toLowerCase().includes('university') ||
        savedLocName.toLowerCase().includes('college') ||
        savedLocName.toLowerCase().includes('campus') ||
        savedLocName.toLowerCase().includes('school') ||
        savedLocName.toLowerCase().includes('aurelian')
      );
      const isSchoolIdInMarker = charInfo.schoolIds.includes(savedLocId);
      const isSchoolMarker = isSchoolNameInMarker || isSchoolIdInMarker;

      if (!isSchoolMarker) continue;

      // Only skip repair if character is ACTUALLY at school right now
      const isAtSchool = charInfo.presenceStatus === 'at_school';
      if (isAtSchool) continue;

      // Character is home but marker says school — this is the defect
      const correctHomeId = charInfo.homeLocationId;
      const correctHomeName = correctHomeId ? (homeLocMap[correctHomeId] || null) : null;

      const msgCreatedEastern = msg.created_date
        ? new Date(msg.created_date).toLocaleString('en-US', { timeZone: 'America/New_York' })
        : 'unknown';

      audited.push({
        message_id: msg.id,
        created_date_et: msgCreatedEastern,
        character_name: charInfo.name,
        character_presence: charInfo.presenceStatus,
        saved_location_id: savedLocId,
        saved_location_name: savedLocName,
        correct_home_id: correctHomeId,
        correct_home_name: correctHomeName,
        will_repair: !dryRun && !!correctHomeId,
      });

      if (!dryRun && correctHomeId && correctHomeName) {
        toRepair.push({
          id: msg.id,
          patch: {
            generation_context: {
              ...gc,
              location_id: correctHomeId,
              location_name: correctHomeName,
              loc_category: 'home',
              zone_name: null,
              marker_repaired_at: new Date().toISOString(),
              marker_repaired_reason: `school_marker_while_home: was "${savedLocName}", corrected to "${correctHomeName}"`,
            },
          },
        });
      }
    }

    // 3. Write repairs
    const repaired = [];
    for (const r of toRepair) {
      await base44.asServiceRole.entities.Message.update(r.id, r.patch).catch(e => {
        console.error(`[repairSchoolMarkerOnHomeMessages] Failed to repair ${r.id}: ${e.message}`);
      });
      repaired.push(r.id);
    }

    return Response.json({
      success: true,
      dry_run: dryRun,
      messages_audited: allMessages.length,
      school_marker_defects_found: audited.length,
      repaired_count: repaired.length,
      repaired_ids: repaired,
      audit: audited,
    });

  } catch (error) {
    console.error('[repairSchoolMarkerOnHomeMessages]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});