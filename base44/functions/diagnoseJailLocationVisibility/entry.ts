import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const report = {
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_id: user.id,
    };

    // ── LAYER 1: Raw database — everything ──────────────────────────────────
    const allRaw = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);
    report.layer1_raw_total = allRaw.length;

    // Find jail-named or jail-category records
    const jailRaw = allRaw.filter(loc =>
      loc.name?.toLowerCase().includes('jail') ||
      loc.name?.toLowerCase().includes('prison') ||
      loc.name?.toLowerCase().includes('cgv') ||
      loc.name?.toLowerCase().includes('vgc jail') ||
      loc.name?.toLowerCase().includes('vgc prison') ||
      loc.category === 'jail_prison' ||
      loc.is_confinement_facility === true
    );

    report.layer1_jail_records = jailRaw.map(loc => ({
      id: loc.id,
      name: loc.name,
      category: loc.category,
      scope: loc.scope,
      location_type: loc.location_type,
      owner_email: loc.owner_email,
      owner_user_id: loc.owner_user_id,
      is_confinement_facility: loc.is_confinement_facility,
      confinement_type: loc.confinement_type,
      status: loc.status,
      is_deleted: loc.is_deleted,
      is_archived: loc.is_archived,
      is_user_created: loc.is_user_created,
      created_date: loc.created_date,
      updated_date: loc.updated_date,
      owner_email_matches_user: loc.owner_email === user.email,
    }));

    // ── LAYER 2: User-owned (mimic fetchAllLocationsForUser Query 1) ────────
    const userOwned = allRaw.filter(loc => loc.owner_email === user.email);
    report.layer2_user_owned_total = userOwned.length;

    const jailInUserOwned = userOwned.filter(loc =>
      loc.name?.toLowerCase().includes('jail') ||
      loc.name?.toLowerCase().includes('prison') ||
      loc.category === 'jail_prison' ||
      loc.is_confinement_facility === true
    );
    report.layer2_jail_in_user_owned = jailInUserOwned.length;
    report.layer2_jail_in_user_owned_records = jailInUserOwned.map(l => ({ id: l.id, name: l.name, category: l.category, owner_email: l.owner_email }));

    // Records in raw but NOT in user-owned (owner_email mismatch)
    const notOwned = allRaw.filter(loc => loc.owner_email !== user.email);
    const jailNotOwned = notOwned.filter(loc =>
      loc.name?.toLowerCase().includes('jail') ||
      loc.name?.toLowerCase().includes('prison') ||
      loc.category === 'jail_prison' ||
      loc.is_confinement_facility === true
    );
    report.layer2_jail_NOT_in_user_owned = jailNotOwned.map(l => ({
      id: l.id,
      name: l.name,
      category: l.category,
      owner_email: l.owner_email,
      owner_email_is_null: l.owner_email == null,
      owner_email_is_empty: l.owner_email === '',
      user_email: user.email
    }));

    // ── LAYER 3: Shared query (mimic Query 2) ───────────────────────────────
    const sharedLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { scope: 'shared', created_by_role: 'admin' },
      '-created_date',
      100
    );
    report.layer3_shared_total = sharedLocations.length;
    const jailInShared = sharedLocations.filter(loc =>
      loc.name?.toLowerCase().includes('jail') ||
      loc.category === 'jail_prison'
    );
    report.layer3_jail_in_shared = jailInShared.map(l => ({ id: l.id, name: l.name }));

    // ── LAYER 4: Character-specific filter (mimic Layer in fetch function) ──
    // Replicate the character-specific ownership filter
    const userCharacters = await base44.entities.Character.filter({ owner_email: user.email }, '-created_date', 200);
    const userCharacterIds = new Set(userCharacters.map(c => c.id));
    userCharacterIds.add(user.id);

    // Combine owned + shared (deduplicated)
    const seen = new Set();
    const combined = [];
    for (const loc of [...userOwned, ...sharedLocations]) {
      if (!seen.has(loc.id)) {
        seen.add(loc.id);
        combined.push(loc);
      }
    }
    report.layer4_combined_total = combined.length;

    // Apply character-specific filter
    const afterCharFilter = combined.filter(loc => {
      const isCharSpecific = loc.location_type === 'character_specific' || loc.scope === 'character_specific';
      if (!isCharSpecific) return true; // Account-global always kept
      if (loc.owner_character_id && userCharacterIds.has(loc.owner_character_id)) return true;
      if (loc.assigned_character_id && userCharacterIds.has(loc.assigned_character_id)) return true;
      if (loc.character_id && userCharacterIds.has(loc.character_id)) return true;
      if (loc.resident_character_ids?.some(id => userCharacterIds.has(id))) return true;
      return false;
    });
    report.layer4_after_char_filter_total = afterCharFilter.length;

    const jailAfterCharFilter = afterCharFilter.filter(loc =>
      loc.name?.toLowerCase().includes('jail') ||
      loc.category === 'jail_prison' ||
      loc.is_confinement_facility === true
    );
    report.layer4_jail_after_char_filter = jailAfterCharFilter.length;
    report.layer4_jail_after_char_filter_records = jailAfterCharFilter.map(l => ({ id: l.id, name: l.name, category: l.category }));

    // Which records were dropped by character filter?
    const droppedByCharFilter = combined.filter(loc => !afterCharFilter.includes(loc));
    const jailDroppedByCharFilter = droppedByCharFilter.filter(loc =>
      loc.name?.toLowerCase().includes('jail') ||
      loc.category === 'jail_prison'
    );
    report.layer4_jail_dropped_by_char_filter = jailDroppedByCharFilter.map(l => ({
      id: l.id,
      name: l.name,
      category: l.category,
      location_type: l.location_type,
      scope: l.scope,
      owner_character_id: l.owner_character_id,
      character_id: l.character_id,
      assigned_character_id: l.assigned_character_id,
      WHY_DROPPED: 'location_type=character_specific but character not in user character set'
    }));

    // ── LAYER 5: UI filter simulation — isCharacterHome function ─────────────
    // Simulates the Locations page isCharacterHome logic
    const characterIds = new Set(userCharacters.map(c => c.id));
    const isCharacterHome = (l) =>
      l.location_type === 'character_specific' ||
      characterIds.has(l.character_id) ||
      characterIds.has(l.owner_character_id) ||
      l.owner_character_id === user.id ||
      (l.resident_character_ids || []).some(id => characterIds.has(id) || id === user.id);

    const uiGlobal = afterCharFilter.filter(l => !isCharacterHome(l));
    const uiCharSpecific = afterCharFilter.filter(isCharacterHome);

    const jailInUIGlobal = uiGlobal.filter(loc => loc.category === 'jail_prison' || loc.is_confinement_facility);
    const jailInUICharSpecific = uiCharSpecific.filter(loc => loc.category === 'jail_prison' || loc.is_confinement_facility);

    report.layer5_ui_global = { total: uiGlobal.length, jail_in_here: jailInUIGlobal.length };
    report.layer5_ui_char_specific = { total: uiCharSpecific.length, jail_in_here: jailInUICharSpecific.length };

    // ── LAYER 6: Normal location side-by-side comparison ───────────────────
    const normalLocation = afterCharFilter.find(l => l.category !== 'jail_prison' && l.owner_email === user.email);
    const jailLocation = jailRaw[0];

    if (normalLocation && jailLocation) {
      report.side_by_side_comparison = {
        field: 'normal vs jail',
        fields_compared: {
          category: { normal: normalLocation.category, jail: jailLocation.category },
          scope: { normal: normalLocation.scope, jail: jailLocation.scope },
          location_type: { normal: normalLocation.location_type, jail: jailLocation.location_type },
          owner_email: {
            normal: normalLocation.owner_email,
            jail: jailLocation.owner_email,
            jail_matches_user: jailLocation.owner_email === user.email,
            normal_matches_user: normalLocation.owner_email === user.email,
          },
          owner_user_id: { normal: normalLocation.owner_user_id, jail: jailLocation.owner_user_id },
          is_user_created: { normal: normalLocation.is_user_created, jail: jailLocation.is_user_created },
          is_confinement_facility: { normal: normalLocation.is_confinement_facility, jail: jailLocation.is_confinement_facility },
          created_date: { normal: normalLocation.created_date, jail: jailLocation.created_date },
          updated_date: { normal: normalLocation.updated_date, jail: jailLocation.updated_date },
        }
      };
    }

    // ── CONCLUSIONS ─────────────────────────────────────────────────────────
    report.conclusions = [];

    if (jailRaw.length === 0) {
      report.conclusions.push('NO_JAIL_IN_DATABASE: Jail records do not exist at all in raw database');
    } else {
      report.conclusions.push(`JAIL_EXISTS_IN_DATABASE: ${jailRaw.length} jail record(s) found in raw database`);
    }

    if (jailInUserOwned.length === 0 && jailRaw.length > 0) {
      report.conclusions.push('CRITICAL: Jail exists in database but DROPS at user-owned filter — owner_email does not match user email');
    }

    if (jailDroppedByCharFilter.length > 0) {
      report.conclusions.push('CRITICAL: Jail is dropped by character-specific filter — location_type=character_specific but no matching character in user roster');
    }

    if (jailAfterCharFilter.length === 0 && jailRaw.length > 0) {
      report.conclusions.push('SUMMARY: Jail exists in raw database but DOES NOT reach the frontend query result');
    } else if (jailAfterCharFilter.length > 0) {
      report.conclusions.push('IMPORTANT: Jail DOES reach the frontend query result — problem is in UI filtering/rendering');
    }

    return Response.json(report, { status: 200 });
  } catch (error) {
    console.error('[DIAGNOSTIC]', error);
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});