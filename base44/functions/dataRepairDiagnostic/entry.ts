import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── FETCH ALL DATA ─────────────────────────────────────────────────────
    const [allCharacters, allLocations] = await Promise.all([
      base44.asServiceRole.entities.Character.list(null, 1000),
      base44.asServiceRole.entities.LocationReference.list(null, 1000)
    ]);

    // ── CHARACTER ANALYSIS ─────────────────────────────────────────────────
    const charsByType = {};
    const activeCreatedChars = [];
    const activeCreatedMissingFlag = [];
    let activeCharFlagCount = 0;

    for (const char of allCharacters) {
      const type = char.character_type || 'unknown';
      charsByType[type] = (charsByType[type] || 0) + 1;

      if (type === 'active_created_character') {
        activeCreatedChars.push({
          name: char.name,
          id: char.id,
          is_active_character: char.is_active_character,
          owner_email: char.owner_email,
          owner_user_id: char.owner_user_id,
          created_by: char.created_by
        });

        if (!char.is_active_character) {
          activeCreatedMissingFlag.push(char.name);
        } else {
          activeCharFlagCount++;
        }
      }
    }

    // ── LOCATION ANALYSIS ──────────────────────────────────────────────────
    let locsMissingOwnerUserId = 0;
    const duplicateNames = {};
    const vgcTowers = [];

    for (const loc of allLocations) {
      if (!loc.owner_user_id) locsMissingOwnerUserId++;

      const key = `${loc.owner_email || 'NO_EMAIL'}::${loc.name || 'NO_NAME'}`;
      duplicateNames[key] = (duplicateNames[key] || 0) + 1;

      if (loc.name === 'VGC Towers') {
        vgcTowers.push({
          id: loc.id,
          owner_email: loc.owner_email,
          owner_user_id: loc.owner_user_id,
          location_type: loc.location_type,
          visibility: loc.visibility,
          is_shared: loc.is_shared,
          scope: loc.scope
        });
      }
    }

    // ── CHARACTER OWNER ANALYSIS ───────────────────────────────────────────
    let charsMissingOwnerUserId = 0;
    for (const char of allCharacters) {
      if (!char.owner_user_id) charsMissingOwnerUserId++;
    }

    // ── BUILD REPORT ───────────────────────────────────────────────────────
    const duplicateListing = {};
    for (const [key, count] of Object.entries(duplicateNames)) {
      if (count > 1) {
        const [email, name] = key.split('::');
        if (!duplicateListing[email]) duplicateListing[email] = [];
        duplicateListing[email].push({ name, count });
      }
    }

    return Response.json({
      timestamp: new Date().toISOString(),
      BEFORE_REPAIR: true,
      characters: {
        total: allCharacters.length,
        by_type: charsByType,
        active_created_total: activeCreatedChars.length,
        active_created_with_flag: activeCharFlagCount,
        active_created_missing_flag: activeCreatedMissingFlag.length,
        missing_owner_user_id: charsMissingOwnerUserId,
        active_created_records: activeCreatedChars
      },
      locations: {
        total: allLocations.length,
        missing_owner_user_id: locsMissingOwnerUserId,
        duplicate_names: duplicateListing,
        vgc_towers_records: vgcTowers
      }
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});