import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const OWNER_EMAIL = 'murqart@gmail.com';
    const TERMS = ['jayden', 'jackson'];
    const matches = [];
    const not_found_sections = [];

    function containsTerm(val) {
      if (!val) return false;
      const s = JSON.stringify(val).toLowerCase();
      return TERMS.some(t => s.includes(t));
    }

    // ── 1. Character table: npc_family_member only ──────────────────────────
    const npcFamilyChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: OWNER_EMAIL, character_type: 'npc_family_member' }, '-created_date', 200
    );

    // Collect all known live character IDs for dead-reference check
    const allCharIds = new Set(
      (await base44.asServiceRole.entities.Character.filter({ owner_email: OWNER_EMAIL }, '-created_date', 500))
        .map(c => c.id)
    );

    for (const char of npcFamilyChars) {
      // A. Does the character itself match by name?
      const nameFields = { name: char.name, display_name: char.display_name, full_name: char.full_name };
      if (containsTerm(nameFields)) {
        matches.push({
          source_entity: 'Character',
          source_id: char.id,
          source_name: char.name,
          source_character_type: char.character_type,
          source_status: char.status,
          owner_email: char.owner_email,
          match_reason: 'Character name fields contain Jayden/Jackson',
          matched_field: JSON.stringify(nameFields),
          relationship_index: null,
          relationship_object: null,
          related_character_id: null,
          related_character_exists: null,
          related_character_status: null,
          renders_as_selectable_character: true,
          picker_path_evidence: 'ManageCharacterList / CharacterSelector — npc_family_member with status=active is included'
        });
      }

      // B. Search fictional_relationships, family_members arrays
      const arrFields = ['fictional_relationships', 'family_members', 'relationships', 'known_people', 'people', 'contacts'];
      for (const field of arrFields) {
        const arr = char[field];
        if (!Array.isArray(arr)) continue;
        arr.forEach((rel, idx) => {
          const relText = JSON.stringify(rel).toLowerCase();
          const termHit = TERMS.some(t => relText.includes(t));
          const deadRef = rel.related_character_id && !allCharIds.has(rel.related_character_id);
          if (termHit || deadRef) {
            matches.push({
              source_entity: 'Character',
              source_id: char.id,
              source_name: char.name,
              source_character_type: char.character_type,
              source_status: char.status,
              owner_email: char.owner_email,
              match_reason: termHit ? `Embedded ${field}[${idx}] contains Jayden/Jackson` : `Dead related_character_id in ${field}[${idx}]`,
              matched_field: field,
              relationship_index: idx,
              relationship_object: rel,
              related_character_id: rel.related_character_id || null,
              related_character_exists: rel.related_character_id ? allCharIds.has(rel.related_character_id) : null,
              related_character_status: null,
              renders_as_selectable_character: false,
              picker_path_evidence: `Embedded in ${char.name} (${char.id}) ${field}`
            });
          }
        });
      }
    }
    if (npcFamilyChars.length === 0) not_found_sections.push('Character:npc_family_member — zero records found');

    // ── 2. ALL characters: search fictional_relationships/family_members for Jayden/Jackson ──
    const allChars = await base44.asServiceRole.entities.Character.filter({ owner_email: OWNER_EMAIL }, '-created_date', 500);
    for (const char of allChars) {
      if (char.character_type === 'npc_family_member') continue; // already covered above
      for (const field of ['fictional_relationships', 'family_members']) {
        const arr = char[field];
        if (!Array.isArray(arr)) continue;
        arr.forEach((rel, idx) => {
          if (containsTerm(rel)) {
            matches.push({
              source_entity: 'Character',
              source_id: char.id,
              source_name: char.name,
              source_character_type: char.character_type,
              source_status: char.status,
              owner_email: char.owner_email,
              match_reason: `Non-family char ${field}[${idx}] references Jayden/Jackson`,
              matched_field: field,
              relationship_index: idx,
              relationship_object: rel,
              related_character_id: rel.related_character_id || null,
              related_character_exists: rel.related_character_id ? allCharIds.has(rel.related_character_id) : null,
              related_character_status: null,
              renders_as_selectable_character: false,
              picker_path_evidence: `Embedded in ${char.name} (${char.id}) ${field}`
            });
          }
        });
      }
    }

    // ── 3. UserSettings ─────────────────────────────────────────────────────
    const userSettings = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: OWNER_EMAIL });
    for (const us of userSettings) {
      if (containsTerm(us)) {
        const fields = ['home_anchor_character_ids', 'user_relatives', 'default_character_id'];
        for (const f of fields) {
          if (containsTerm(us[f])) {
            matches.push({
              source_entity: 'UserSettings',
              source_id: us.id,
              source_name: 'UserSettings',
              source_character_type: null,
              source_status: null,
              owner_email: us.owner_email,
              match_reason: `UserSettings.${f} contains Jayden/Jackson`,
              matched_field: f,
              relationship_index: null,
              relationship_object: us[f],
              related_character_id: null,
              related_character_exists: null,
              related_character_status: null,
              renders_as_selectable_character: false,
              picker_path_evidence: `UserSettings.${f}`
            });
          }
        }
      }
    }
    if (userSettings.length === 0) not_found_sections.push('UserSettings — zero records found');

    // ── 4. CharacterRelationship ─────────────────────────────────────────────
    try {
      const rels = await base44.asServiceRole.entities.CharacterRelationship.filter({});
      const relMatches = rels.filter(r => containsTerm(r));
      for (const r of relMatches) {
        matches.push({
          source_entity: 'CharacterRelationship',
          source_id: r.id,
          source_name: `${r.source_character_id} → ${r.target_character_id}`,
          source_character_type: null,
          source_status: null,
          owner_email: null,
          match_reason: 'CharacterRelationship contains Jayden/Jackson',
          matched_field: JSON.stringify(r),
          relationship_index: null,
          relationship_object: r,
          related_character_id: r.target_character_id || null,
          related_character_exists: r.target_character_id ? allCharIds.has(r.target_character_id) : null,
          related_character_status: null,
          renders_as_selectable_character: false,
          picker_path_evidence: 'CharacterRelationship entity'
        });
      }
      if (relMatches.length === 0) not_found_sections.push('CharacterRelationship — no Jayden/Jackson matches');
    } catch(e) { not_found_sections.push('CharacterRelationship — query failed: ' + e.message); }

    // ── 5. LocationReference: resident arrays ────────────────────────────────
    try {
      const locs = await base44.asServiceRole.entities.LocationReference.filter({ owner_email: OWNER_EMAIL });
      for (const loc of locs) {
        for (const field of ['residents', 'resident_family_members', 'worker_character_ids']) {
          const val = loc[field];
          if (containsTerm(val)) {
            matches.push({
              source_entity: 'LocationReference',
              source_id: loc.id,
              source_name: loc.name,
              source_character_type: null,
              source_status: null,
              owner_email: loc.owner_email,
              match_reason: `LocationReference.${field} contains Jayden/Jackson`,
              matched_field: field,
              relationship_index: null,
              relationship_object: val,
              related_character_id: null,
              related_character_exists: null,
              related_character_status: null,
              renders_as_selectable_character: false,
              picker_path_evidence: `LocationReference(${loc.id}).${field}`
            });
          }
        }
      }
      if (locs.length === 0) not_found_sections.push('LocationReference — zero records found');
    } catch(e) { not_found_sections.push('LocationReference — query failed: ' + e.message); }

    // ── Final output: only what's needed, no truncation ──────────────────────
    // List all 19 npc_family_member names/ids (tiny output)
    const npcFamilyIndex = npcFamilyChars.map(c => ({
      id: c.id, name: c.name, display_name: c.display_name, full_name: c.full_name, status: c.status
    }));

    // Only keep matches where person_name strictly contains jayden or jackson (not broad surname hits)
    const exactMatches = matches.filter(m => {
      const pn = (m.relationship_object?.person_name || '').toLowerCase();
      return pn.includes('jayden') || pn === 'jackson' || pn.startsWith('jayden ') || pn.endsWith(' jackson');
    }).map(m => ({
      source_id: m.source_id,
      source_name: m.source_name,
      source_character_type: m.source_character_type,
      source_status: m.source_status,
      matched_field: m.matched_field,
      relationship_index: m.relationship_index,
      person_name: m.relationship_object?.person_name || null,
      related_character_id: m.related_character_id,
      related_character_exists: m.related_character_exists
    }));

    return Response.json({
      exact_visible_row: 'Jayden Jackson npc_family_member',
      total_npc_family_members_scanned: npcFamilyChars.length,
      total_all_characters_scanned: allChars.length,
      npc_family_member_full_name_index: npcFamilyIndex,
      jayden_jackson_exact_matches: exactMatches,
      not_found_sections,
    }, { status: 200 });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});