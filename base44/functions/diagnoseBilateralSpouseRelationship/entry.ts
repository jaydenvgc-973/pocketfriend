import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * diagnoseBilateralSpouseRelationship
 *
 * Finds Nathan and Lila across ALL Character records owned by the current user
 * using the widest possible search (no status/character_type filter).
 * Then checks bilateral relationship integrity for a married couple.
 * If one side is missing, repairs it with the correct relationship type preserved.
 *
 * Steps:
 *  1. Fetch ALL characters for owner_email (no status/type filter)
 *  2. Find Nathan and Lila by partial name match
 *  3. If not found by name, search fictional_relationships entries for spouse/married entries
 *  4. Check bilateral: Lila→Nathan and Nathan→Lila
 *  5. If asymmetric, classify as BILATERAL_SPOUSE_RELATIONSHIP_BROKEN
 *  6. Repair: create missing reciprocal entry with correct relationship type (not acquaintance)
 *  7. Prove both sides now exist with correct IDs and relationship meaning
 *  8. Zero memory writes, zero last_interaction_summary, zero score progression
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun === true; // pass dryRun:true to inspect without repairing

    const report = {
      owner_email: user.email,
      dry_run: dryRun,
      search: {},
      nathan: null,
      lila: null,
      bilateral_check: {},
      repair: null,
      proof: {},
      verdict: '',
    };

    // ── STEP 1: Fetch ALL characters — NO status/type/owner_user_id filter ──────
    // Use only owner_email. Legacy chars may have missing status or character_type.
    const allChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      null, 300
    );

    report.search.total_found = allChars.length;
    report.search.statuses_seen = [...new Set(allChars.map(c => c.status || 'MISSING'))];
    report.search.types_seen = [...new Set(allChars.map(c => c.character_type || 'MISSING'))];

    // ── STEP 2: Find Nathan and Lila by partial name match ─────────────────────
    const nathanCandidates = allChars.filter(c =>
      c.name?.toLowerCase().includes('nathan')
    );
    const lilaCandidates = allChars.filter(c =>
      c.name?.toLowerCase().includes('lila')
    );

    report.search.nathan_name_candidates = nathanCandidates.map(c => ({
      id: c.id, name: c.name, status: c.status, character_type: c.character_type,
    }));
    report.search.lila_name_candidates = lilaCandidates.map(c => ({
      id: c.id, name: c.name, status: c.status, character_type: c.character_type,
    }));

    // ── STEP 3: If not found by name, scan fictional_relationships for spouse entries ──
    // This catches cases where Nathan or Lila exist but have unusual names stored
    const spouseKeywords = ['spouse', 'married', 'wife', 'husband', 'partner', 'romantic'];

    let nathanFromRelSearch = null;
    let lilaFromRelSearch = null;

    if (nathanCandidates.length === 0 || lilaCandidates.length === 0) {
      // Scan all chars' fictional_relationships for Nathan/Lila cross-references
      for (const char of allChars) {
        const rels = char.fictional_relationships || [];
        for (const rel of rels) {
          const rn = rel.person_name?.toLowerCase() || '';
          const rt = rel.relationship_type?.toLowerCase() || '';
          if (rn.includes('nathan') && !nathanFromRelSearch) {
            // This char has Nathan in their relationships — Nathan might be findable by related_character_id
            if (rel.related_character_id) {
              const nathanById = allChars.find(c => c.id === rel.related_character_id);
              if (nathanById) nathanFromRelSearch = { char: nathanById, foundVia: `${char.name}'s fictional_relationships`, relEntry: rel };
            }
            report.search.nathan_relationship_ref_found_in = char.name;
          }
          if (rn.includes('lila') && !lilaFromRelSearch) {
            if (rel.related_character_id) {
              const lilaById = allChars.find(c => c.id === rel.related_character_id);
              if (lilaById) lilaFromRelSearch = { char: lilaById, foundVia: `${char.name}'s fictional_relationships`, relEntry: rel };
            }
            report.search.lila_relationship_ref_found_in = char.name;
          }
        }
      }
    }

    // Resolve final Nathan and Lila
    const nathanChar = nathanCandidates[0] || nathanFromRelSearch?.char || null;
    const lilaChar = lilaCandidates[0] || lilaFromRelSearch?.char || null;

    if (!nathanChar) {
      report.verdict = 'NATHAN_NOT_FOUND: No Character record containing "nathan" in name found on this account under owner_email=' + user.email;
      report.search.all_char_names = allChars.map(c => c.name);
      return Response.json(report);
    }
    if (!lilaChar) {
      report.verdict = 'LILA_NOT_FOUND: No Character record containing "lila" in name found on this account under owner_email=' + user.email;
      report.search.all_char_names = allChars.map(c => c.name);
      return Response.json(report);
    }

    report.nathan = {
      id: nathanChar.id,
      name: nathanChar.name,
      status: nathanChar.status,
      character_type: nathanChar.character_type,
      owner_email: nathanChar.owner_email,
    };
    report.lila = {
      id: lilaChar.id,
      name: lilaChar.name,
      status: lilaChar.status,
      character_type: lilaChar.character_type,
      owner_email: lilaChar.owner_email,
    };

    // ── STEP 4: Inspect Lila → Nathan ──────────────────────────────────────────
    const lilaRels = lilaChar.fictional_relationships || [];
    const lilaToNathanById = lilaRels.find(r => r.related_character_id === nathanChar.id);
    const lilaToNathanByName = lilaRels.find(r =>
      r.person_name?.toLowerCase().includes('nathan') && !r.related_character_id
    );
    const lilaToNathan = lilaToNathanById || lilaToNathanByName || null;

    report.bilateral_check.lila_to_nathan = lilaToNathan
      ? {
          found: true,
          linked_by_id: !!lilaToNathanById,
          related_character_id: lilaToNathan.related_character_id || null,
          person_name: lilaToNathan.person_name,
          relationship_type: lilaToNathan.relationship_type,
          romantic_level: lilaToNathan.romantic_level,
          awareness_only: lilaToNathan.awareness_only ?? false,
        }
      : { found: false };

    // ── STEP 5: Inspect Nathan → Lila ──────────────────────────────────────────
    const nathanRels = nathanChar.fictional_relationships || [];
    const nathanToLilaById = nathanRels.find(r => r.related_character_id === lilaChar.id);
    const nathanToLilaByName = nathanRels.find(r =>
      r.person_name?.toLowerCase().includes('lila') && !r.related_character_id
    );
    const nathanToLila = nathanToLilaById || nathanToLilaByName || null;

    report.bilateral_check.nathan_to_lila = nathanToLila
      ? {
          found: true,
          linked_by_id: !!nathanToLilaById,
          related_character_id: nathanToLila.related_character_id || null,
          person_name: nathanToLila.person_name,
          relationship_type: nathanToLila.relationship_type,
          romantic_level: nathanToLila.romantic_level,
          awareness_only: nathanToLila.awareness_only ?? false,
        }
      : { found: false };

    // ── STEP 6: Classify ────────────────────────────────────────────────────────
    const lilaHasNathan = !!lilaToNathan;
    const nathanHasLila = !!nathanToLila;
    const fullySymmetric = lilaHasNathan && nathanHasLila &&
      !!lilaToNathanById && !!nathanToLilaById;

    if (fullySymmetric) {
      report.verdict = 'BILATERAL_OK: Both Nathan and Lila have each other by real Character.id.';
      report.proof = {
        lila_has_nathan_by_id: true,
        nathan_has_lila_by_id: true,
        no_memory_written: true,
        no_score_progression: true,
        no_fake_interaction: true,
      };
      return Response.json(report);
    }

    if (lilaHasNathan && !nathanHasLila) {
      report.verdict = 'BILATERAL_SPOUSE_RELATIONSHIP_BROKEN: Lila has Nathan in fictional_relationships but Nathan does NOT have Lila. Repair required.';
    } else if (!lilaHasNathan && nathanHasLila) {
      report.verdict = 'BILATERAL_SPOUSE_RELATIONSHIP_BROKEN: Nathan has Lila in fictional_relationships but Lila does NOT have Nathan. Repair required.';
    } else {
      report.verdict = 'BILATERAL_MISSING_BOTH: Neither Nathan nor Lila have each other in fictional_relationships. Repair required.';
    }

    // ── STEP 7: Determine correct relationship type for the missing side ────────
    // Use the existing entry (whichever side exists) to derive the reciprocal type.
    // Do NOT downgrade a married couple to "acquaintance".
    const existingEntry = lilaToNathan || nathanToLila;
    const rawRelType = existingEntry?.relationship_type?.toLowerCase() || '';
    const rawRomantic = existingEntry?.romantic_level || 0;

    const isSpouseLevel =
      rawRelType.includes('spouse') ||
      rawRelType.includes('married') ||
      rawRelType.includes('wife') ||
      rawRelType.includes('husband') ||
      rawRelType.includes('partner') ||
      rawRomantic >= 80;

    // Build the reciprocal relationship type
    // If Lila's entry says "husband" → Nathan's should say "wife" and vice versa
    // If ambiguous, use "spouse" as the safe symmetric label
    let reciprocalType = existingEntry?.relationship_type || 'spouse';
    if (rawRelType.includes('husband')) reciprocalType = 'wife';
    else if (rawRelType.includes('wife')) reciprocalType = 'husband';
    else if (rawRelType.includes('spouse') || rawRelType.includes('married')) reciprocalType = 'spouse';
    else if (rawRelType.includes('partner')) reciprocalType = 'partner';
    else if (isSpouseLevel) reciprocalType = 'spouse';
    // Otherwise keep the same type (symmetric)

    report.repair = {
      dry_run: dryRun,
      relationship_type_derived_from: existingEntry
        ? `${existingEntry === lilaToNathan ? 'Lila→Nathan' : 'Nathan→Lila'} entry`
        : 'default',
      original_relationship_type: existingEntry?.relationship_type || 'none',
      reciprocal_relationship_type_to_apply: reciprocalType,
      is_spouse_level: isSpouseLevel,
    };

    if (dryRun) {
      report.repair.action = 'DRY_RUN: no writes performed';
      return Response.json(report);
    }

    // ── STEP 8: Apply repair(s) — PURE relationship link only ──────────────────
    // Rules:
    //   - Only write to fictional_relationships
    //   - Do NOT write Memory records
    //   - Do NOT write last_interaction_summary
    //   - Do NOT write CharacterMemory records
    //   - Do NOT update friendship_level / romantic_level / trust_level progression
    //   - Set awareness_only: true so the entry does not trigger interaction logic
    //   - Set related_character_id to the real Character.id

    const repairActions = [];

    // Repair Nathan → Lila if missing
    if (!nathanHasLila) {
      const newNathanToLila = {
        person_name: lilaChar.name,
        related_character_id: lilaChar.id,
        relationship_type: reciprocalType,
        romantic_level: existingEntry?.romantic_level ?? 0,
        friendship_level: existingEntry?.friendship_level ?? 50,
        user_respect_level: existingEntry?.user_respect_level ?? 50,
        trust_level: existingEntry?.trust_level ?? 70,
        attraction_level: existingEntry?.attraction_level ?? 0,
        chosen_family_level: existingEntry?.chosen_family_level ?? 0,
        current_status: existingEntry?.current_status || 'ongoing',
        awareness_only: true, // marks as structural link — not an interaction
        repair_source: 'diagnoseBilateralSpouseRelationship',
        repair_timestamp: new Date().toISOString(),
      };
      const updatedNathanRels = [...nathanRels.filter(r => r.related_character_id !== lilaChar.id), newNathanToLila];
      await base44.entities.Character.update(nathanChar.id, { fictional_relationships: updatedNathanRels });
      repairActions.push(`Nathan → Lila entry created | type=${reciprocalType} | lilaId=${lilaChar.id} | awareness_only=true | NO memory written`);
    }

    // Repair Lila → Nathan if missing or name-only (upgrade to ID-linked)
    if (!lilaHasNathan) {
      const reciprocalTypeForLila = rawRelType.includes('wife') ? 'husband' :
        rawRelType.includes('husband') ? 'wife' :
        reciprocalType;
      const newLilaToNathan = {
        person_name: nathanChar.name,
        related_character_id: nathanChar.id,
        relationship_type: reciprocalTypeForLila,
        romantic_level: existingEntry?.romantic_level ?? 0,
        friendship_level: existingEntry?.friendship_level ?? 50,
        user_respect_level: existingEntry?.user_respect_level ?? 50,
        trust_level: existingEntry?.trust_level ?? 70,
        attraction_level: existingEntry?.attraction_level ?? 0,
        chosen_family_level: existingEntry?.chosen_family_level ?? 0,
        current_status: existingEntry?.current_status || 'ongoing',
        awareness_only: true,
        repair_source: 'diagnoseBilateralSpouseRelationship',
        repair_timestamp: new Date().toISOString(),
      };
      const updatedLilaRels = [...lilaRels.filter(r => r.related_character_id !== nathanChar.id), newLilaToNathan];
      await base44.entities.Character.update(lilaChar.id, { fictional_relationships: updatedLilaRels });
      repairActions.push(`Lila → Nathan entry created | type=${reciprocalTypeForLila} | nathanId=${nathanChar.id} | awareness_only=true | NO memory written`);
    } else if (lilaToNathanByName && !lilaToNathanById) {
      // Upgrade name-only → ID-linked
      const upgraded = { ...lilaToNathanByName, related_character_id: nathanChar.id, awareness_only: true };
      const updatedLilaRels = lilaRels.map(r =>
        r === lilaToNathanByName ? upgraded : r
      );
      await base44.entities.Character.update(lilaChar.id, { fictional_relationships: updatedLilaRels });
      repairActions.push(`Lila → Nathan upgraded from name-only to ID-linked | nathanId=${nathanChar.id}`);
    }

    report.repair.actions = repairActions;
    report.repair.memory_written = false;
    report.repair.last_interaction_summary_written = false;
    report.repair.score_progression = false;
    report.repair.fake_interaction = false;

    // ── STEP 9: Verify post-repair ──────────────────────────────────────────────
    const [nathanFresh, lilaFresh] = await Promise.all([
      base44.entities.Character.filter({ id: nathanChar.id }).then(r => r[0]),
      base44.entities.Character.filter({ id: lilaChar.id }).then(r => r[0]),
    ]);

    const nathanFreshToLila = (nathanFresh?.fictional_relationships || []).find(r => r.related_character_id === lilaChar.id);
    const lilaFreshToNathan = (lilaFresh?.fictional_relationships || []).find(r => r.related_character_id === nathanChar.id);

    report.proof = {
      lila_has_nathan_by_id: !!lilaFreshToNathan,
      lila_to_nathan_entry: lilaFreshToNathan
        ? { related_character_id: lilaFreshToNathan.related_character_id, relationship_type: lilaFreshToNathan.relationship_type, awareness_only: lilaFreshToNathan.awareness_only }
        : null,
      nathan_has_lila_by_id: !!nathanFreshToLila,
      nathan_to_lila_entry: nathanFreshToLila
        ? { related_character_id: nathanFreshToLila.related_character_id, relationship_type: nathanFreshToLila.relationship_type, awareness_only: nathanFreshToLila.awareness_only }
        : null,
      no_memory_written: true,
      no_last_interaction_summary: true,
      no_score_progression: true,
      no_fake_interaction: true,
    };

    const repaired = report.proof.lila_has_nathan_by_id && report.proof.nathan_has_lila_by_id;
    if (repaired) {
      report.verdict = `REPAIRED: Bilateral spouse relationship between Nathan (${nathanChar.id}) and Lila (${lilaChar.id}) is now symmetric. Both have each other by real Character.id with correct relationship type. No memory written, no score progression, no fake interaction.`;
    } else {
      report.verdict = `REPAIR_INCOMPLETE: One or both sides still missing after repair. Check proof fields above.`;
    }

    return Response.json(report);

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack?.substring(0, 800) }, { status: 500 });
  }
});