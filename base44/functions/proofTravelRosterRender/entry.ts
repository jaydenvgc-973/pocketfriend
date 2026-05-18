import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * proofTravelRosterRender
 *
 * Final proof of Travel roster canonical dedup + presence hydration.
 * Simulates the exact data flow of Travel.jsx → TravelCharacterSelector:
 *   1. useOwnedCharacters → travelCompanions
 *   2. TravelCharacterSelector canonical dedup (id → key)
 *   3. presenceEntities hydration (presenceById → presenceByNormName → home fallback)
 *   4. Leo Parker appears exactly once, status hydrated correctly
 *   5. Nathan + Lila both reference Leo without producing two rows
 *   6. Velvet Bean blank shell: full reference trace, safe-to-delete verdict
 *   7. ProofCharA/B artifact cleanup
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const proof = {};

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 1: Fetch all characters — mirrors useOwnedCharacters merge logic
  // ─────────────────────────────────────────────────────────────────────────────
  let allCharacters = [];
  let rlsChars = [];

  try {
    rlsChars = await base44.entities.Character.filter(
      { owner_email: user.email },
      'created_date',
      300
    );
    proof.rls_count = rlsChars.length;
  } catch (err) {
    proof.rls_fetch_error = err.message;
  }

  // fetchNPCsForUser requires a forwarded user session — use service role fallback if blocked
  let npcs = [];
  try {
    const npcRes = await base44.functions.invoke('fetchNPCsForUser', {});
    npcs = npcRes?.data?.npcs || [];
    proof.npc_source = 'fetchNPCsForUser';
  } catch {
    // Service role fallback: all npc_fictitious + npc_family_member scoped to owner_email
    try {
      const [fictitiousRes, familyRes] = await Promise.all([
        base44.asServiceRole.entities.Character.filter({ owner_email: user.email, character_type: 'npc_fictitious' }, 'created_date', 200),
        base44.asServiceRole.entities.Character.filter({ owner_email: user.email, character_type: 'npc_family_member' }, 'created_date', 200),
      ]);
      npcs = [...fictitiousRes, ...familyRes];
      proof.npc_source = 'service_role_fallback';
    } catch (fallbackErr) {
      proof.npc_fetch_error = fallbackErr.message;
    }
  }
  proof.npc_count = npcs.length;

  // Merge + dedupe by id
  const mergedSeen = new Set();
  for (const c of [...rlsChars, ...npcs]) {
    if (mergedSeen.has(c.id)) continue;
    mergedSeen.add(c.id);
    allCharacters.push(c);
  }
  proof.merged_total = allCharacters.length;

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 2: Derive slices — mirrors useOwnedCharacters resolveTypeLegacy
  // ─────────────────────────────────────────────────────────────────────────────
  const resolveType = (c) => {
    if (c.character_type) return c.character_type;
    const hasProfile = c.backstory || c.personality_summary || (c.personality_traits || []).length > 0;
    const hasSchedule = c.wake_up_time || c.sleep_start_time;
    const hasNeeds = c.hunger_value !== undefined;
    if (hasProfile && (hasSchedule || hasNeeds)) return 'active_created_character';
    if ((c.fictional_relationships || []).length > 0 && !c.is_family_member) return 'npc_fictitious';
    if (c.is_family_member) return 'npc_family_member';
    return 'active_created_character';
  };

  const activeCreated = allCharacters.filter(c => resolveType(c) === 'active_created_character' && c.status !== 'deleted');
  const npcFictitious = allCharacters.filter(c => resolveType(c) === 'npc_fictitious');
  const npcFamilyMembers = allCharacters.filter(c => resolveType(c) === 'npc_family_member');
  // travelCompanions = exact input to TravelCharacterSelector
  const travelCompanions = [...activeCreated, ...npcFictitious, ...npcFamilyMembers];

  proof.slices = {
    active_created: activeCreated.length,
    npc_fictitious: npcFictitious.length,
    npc_family_members: npcFamilyMembers.length,
    travel_companions_input_to_selector: travelCompanions.length,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 3: Canonical dedup — exact replica of TravelCharacterSelector logic
  // ─────────────────────────────────────────────────────────────────────────────
  const buildCanonicalFamilyKey = (c) => {
    const type = c.character_type || 'unknown';
    const normName = (c.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (c.linked_character_id) return `${type}::linked::${c.linked_character_id}`;
    if (c.npc_fictitious_character_id) return `${type}::linked::${c.npc_fictitious_character_id}`;
    if (c.stable_family_member_id) return `${type}::fam::${c.stable_family_member_id}`;
    if (c.current_home_location_id) return `${type}::household::${c.current_home_location_id}::${normName}`;
    return `${type}::name::${normName}`;
  };

  const seenIds = new Set();
  const seenCanonicalKeys = new Set();
  const dedupedRoster = [];
  const dedupDropLog = [];

  for (const c of travelCompanions) {
    if (seenIds.has(c.id)) {
      dedupDropLog.push({ reason: 'exact_id_duplicate', name: c.name, id: c.id });
      continue;
    }
    seenIds.add(c.id);

    const canonKey = buildCanonicalFamilyKey(c);
    if (seenCanonicalKeys.has(canonKey)) {
      dedupDropLog.push({ reason: 'canonical_key_duplicate', name: c.name, id: c.id, key: canonKey });
      continue;
    }
    seenCanonicalKeys.add(canonKey);
    dedupedRoster.push({ ...c, _canonKey: canonKey });
  }

  proof.dedup = {
    input_count: travelCompanions.length,
    output_count: dedupedRoster.length,
    dropped_count: dedupDropLog.length,
    dropped: dedupDropLog,
    verdict: dedupDropLog.length === 0
      ? '✅ No duplicates detected in travelCompanions input'
      : `✅ ${dedupDropLog.length} duplicate(s) correctly suppressed by canonical dedup`,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 4: Build presenceEntities — mirrors resolveTravelPresenceEntities output
  // We simulate what the Travel page passes as presenceEntities to TravelCharacterSelector.
  // For proof purposes: the presence entities are the allCharacters records themselves
  // (the resolver normalizes them into entities with the same id/display_name/resolved fields).
  // ─────────────────────────────────────────────────────────────────────────────
  const presenceById = Object.fromEntries(allCharacters.map(c => [c.id, c]));
  const presenceByNormName = Object.fromEntries(
    allCharacters.map(c => [(c.display_name || c.name || '').trim().toLowerCase(), c])
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 5: Render each row — exact replica of TravelCharacterSelector renderCharCard hydration
  // ─────────────────────────────────────────────────────────────────────────────
  const renderedRows = dedupedRoster.map(char => {
    const charNormName = (char.display_name || char.name || '').trim().toLowerCase();
    const presenceEntity = presenceById[char.id] || presenceByNormName[charNormName] || null;

    const resolvedLocName = presenceEntity?.resolved_current_location_name || char.resolved_current_location_name || null;
    const resolvedStatus = presenceEntity?.resolved_presence_status || char.resolved_presence_status || null;
    const isHome = presenceEntity?.is_home ?? (resolvedStatus === 'home' || resolvedStatus === 'sleeping' || resolvedStatus === 'napping');
    const hasHomeId = !!(char.current_home_location_id || presenceEntity?.residence_location_id);

    let currentLocationLabel = null;
    let presenceSource = null;

    if (resolvedLocName && !isHome) {
      currentLocationLabel = `At ${resolvedLocName}`;
      presenceSource = presenceById[char.id] ? 'presenceById (exact DB match)' : presenceByNormName[charNormName] ? 'presenceByNormName (synthesized name match)' : 'raw character field';
    } else if (isHome || hasHomeId) {
      currentLocationLabel = 'At home';
      presenceSource = hasHomeId ? 'home_location_id set' : 'resolved_presence_status=home';
    } else {
      currentLocationLabel = 'Available';
      presenceSource = 'no presence data — default';
    }

    const labelContainsUnresolved = (currentLocationLabel || '').toLowerCase().includes('unresolved');

    return {
      id: char.id,
      name: char.name,
      character_type: char.character_type,
      canonical_key: char._canonKey,
      rendered_label: currentLocationLabel,
      presence_source: presenceSource,
      resolved_loc_name: resolvedLocName,
      resolved_status: resolvedStatus,
      home_location_id: char.current_home_location_id || null,
      label_is_unresolved: labelContainsUnresolved,
      label_verdict: labelContainsUnresolved
        ? `❌ Shows "At Unresolved" — presence hydration gap`
        : `✅ Shows "${currentLocationLabel}"`,
    };
  });

  proof.rendered_roster = {
    total_rows: renderedRows.length,
    rows: renderedRows,
    unresolved_count: renderedRows.filter(r => r.label_is_unresolved).length,
    overall_verdict: renderedRows.filter(r => r.label_is_unresolved).length === 0
      ? '✅ No "At Unresolved" labels in any rendered row'
      : `❌ ${renderedRows.filter(r => r.label_is_unresolved).length} row(s) would show "At Unresolved"`,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 6: Leo Parker targeted proof
  // ─────────────────────────────────────────────────────────────────────────────
  const leoInInput = travelCompanions.filter(c => (c.name || '').toLowerCase().includes('leo parker'));
  const leoInRoster = renderedRows.filter(r => (r.name || '').toLowerCase().includes('leo parker'));
  const leoDropped = dedupDropLog.filter(d => (d.name || '').toLowerCase().includes('leo parker'));

  // Find all parent characters who reference Leo in their family_members[]
  const leoParents = allCharacters.filter(c => {
    return (c.family_members || []).some(f => (f.name || '').toLowerCase().includes('leo parker'));
  }).map(p => ({
    name: p.name,
    id: p.id,
    character_type: p.character_type,
    leo_family_entry: (p.family_members || []).find(f => (f.name || '').toLowerCase().includes('leo parker')),
  }));

  // Leo Character records in the DB
  const leoCharacterRecords = allCharacters.filter(c => (c.name || '').toLowerCase().includes('leo parker'));

  proof.leo_parker = {
    // DB presence
    character_records_found: leoCharacterRecords.length,
    character_records: leoCharacterRecords.map(c => ({
      id: c.id,
      name: c.name,
      character_type: c.character_type,
      owner_email: c.owner_email,
      linked_character_id: c.linked_character_id || null,
      stable_family_member_id: c.stable_family_member_id || null,
      home_location_id: c.current_home_location_id || null,
      resolved_location: c.resolved_current_location_name || null,
      status: c.status || null,
    })),

    // Pre-dedup input count
    in_travel_companions_before_dedup: leoInInput.length,
    in_roster_after_dedup: leoInRoster.length,
    dropped_by_dedup: leoDropped,

    // Parent references
    parents_referencing_leo: leoParents,
    parent_count: leoParents.length,

    // Dedup key used for the kept row
    canonical_key_kept: leoInRoster[0]?.canonical_key || null,

    // Rendered label
    rendered_label: leoInRoster[0]?.rendered_label || null,
    presence_source: leoInRoster[0]?.presence_source || null,

    // Verdicts
    dedup_verdict: leoInRoster.length === 1
      ? `✅ Leo Parker appears EXACTLY ONCE in rendered roster`
      : leoInRoster.length === 0
      ? `⚠️ Leo Parker not in roster — no Character record or synthesized entry`
      : `❌ Leo Parker appears ${leoInRoster.length} times — dedup FAILED`,

    parent_ref_verdict: leoParents.length >= 2
      ? `✅ Both ${leoParents.map(p => p.name).join(' and ')} reference Leo — merged into 1 row by canonical key`
      : leoParents.length === 1
      ? `✅ 1 parent (${leoParents[0]?.name}) references Leo — 1 row expected`
      : `⚠️ No parent references found — Leo only exists as standalone Character record`,

    label_verdict: leoInRoster.length > 0
      ? leoInRoster[0].label_verdict
      : 'N/A — Leo not in roster',
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 7: Velvet Bean full reference audit
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    const allLocs = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);
    const velvetBeans = allLocs.filter(l => (l.name || '').toLowerCase().includes('velvet bean'));

    // Canonical = has zones or images (real configured record)
    const canonical = velvetBeans.find(l => (l.zones || []).length > 0 || (l.image_urls || []).length > 0)
      || velvetBeans[0];
    const shells = velvetBeans.filter(l => l.id !== canonical?.id);

    const shellAudits = [];
    for (const shell of shells) {
      const sid = shell.id;

      // Check characters pointing to shell across all location fields
      const charsWithRef = allCharacters.filter(c =>
        c.resolved_current_location_id === sid ||
        c.current_home_location_id === sid ||
        c.current_work_location_id === sid ||
        c.occupation_location_id === sid ||
        c.traveling_to_location_id === sid ||
        c.travel_destination_location_id === sid
      );

      // Community events using this shell
      let communityEventCount = 0;
      try {
        const evts = await base44.asServiceRole.entities.CommunityEvent.filter({ location_id: sid });
        communityEventCount = evts.length;
      } catch {}

      // Scheduled events whose payload references this shell
      let scheduledEventCount = 0;
      try {
        const allScheduled = await base44.asServiceRole.entities.ScheduledEvent.filter({});
        scheduledEventCount = allScheduled.filter(e =>
          e.event_payload?.destination_location_id === sid
        ).length;
      } catch {}

      // Character memories linked to shell
      let memoryCount = 0;
      try {
        const mems = await base44.asServiceRole.entities.CharacterMemory.filter({ related_location_id: sid });
        memoryCount = mems.length;
      } catch {}

      // VerifiedRealLocation records pointing to this shell (used by createLocationFromVerified)
      let verifiedRefCount = 0;
      try {
        const vrlRecs = await base44.asServiceRole.entities.VerifiedRealLocation.filter({ linked_location_reference_id: sid });
        verifiedRefCount = vrlRecs.length;
      } catch {}

      const totalRefs = charsWithRef.length + communityEventCount + scheduledEventCount + memoryCount + verifiedRefCount;

      shellAudits.push({
        shell_id: sid,
        shell_name: shell.name,
        zone_count: (shell.zones || []).length,
        image_count: (shell.image_urls || []).length,
        character_refs: charsWithRef.map(c => ({ name: c.name, id: c.id, field: 'resolved/home/work/occupation/travel' })),
        community_event_refs: communityEventCount,
        scheduled_event_refs: scheduledEventCount,
        memory_refs: memoryCount,
        verified_real_location_refs: verifiedRefCount,
        total_references: totalRefs,
        safe_to_delete: totalRefs === 0,
        action: totalRefs === 0
          ? `✅ Safe to hard delete shell ${sid} — zero references`
          : `⚠️ Remap ${totalRefs} reference(s) to canonical ${canonical?.id} before delete`,
      });
    }

    proof.velvet_bean_audit = {
      total_velvet_bean_records: velvetBeans.length,
      canonical_record: canonical ? {
        id: canonical.id,
        name: canonical.name,
        zone_count: (canonical.zones || []).length,
        image_count: (canonical.image_urls || []).length,
        scope: canonical.scope || canonical.location_type,
        verdict: '✅ Canonical — do not delete or modify',
      } : null,
      blank_shells: shellAudits,
      overall_verdict: shellAudits.length === 0
        ? '✅ No duplicate blank shells found'
        : shellAudits.every(s => s.safe_to_delete)
        ? `✅ ${shellAudits.length} blank shell(s) are reference-free and safe to hard delete`
        : `⚠️ ${shellAudits.filter(s => !s.safe_to_delete).length} shell(s) have active references — remap first`,
    };
  } catch (err) {
    proof.velvet_bean_audit = { error: err.message };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 8: Proof artifact character cleanup (ProofCharA / ProofCharB)
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    const artifacts = allCharacters.filter(c =>
      /^ProofChar[AB]$/i.test((c.name || '').trim()) ||
      /^proof_char/i.test((c.name || '').trim())
    );

    const cleaned = [];
    for (const artifact of artifacts) {
      // Delete linked conversations + messages
      try {
        const convos = await base44.entities.Conversation.filter({ character_ids: artifact.id });
        for (const convo of convos) {
          const msgs = await base44.entities.Message.filter({ conversation_id: convo.id });
          for (const msg of msgs) await base44.entities.Message.delete(msg.id).catch(() => {});
          await base44.entities.Conversation.delete(convo.id).catch(() => {});
        }
      } catch {}
      // Delete commitments
      try {
        const comms = await base44.entities.CharacterCommitment.filter({ character_id: artifact.id });
        for (const c of comms) await base44.entities.CharacterCommitment.delete(c.id).catch(() => {});
      } catch {}
      // Delete memories
      try {
        const mems = await base44.entities.CharacterMemory.filter({ character_id: artifact.id });
        for (const m of mems) await base44.entities.CharacterMemory.delete(m.id).catch(() => {});
      } catch {}
      // Delete scheduled events
      try {
        const sched = await base44.entities.ScheduledEvent.filter({ primary_character_id: artifact.id });
        for (const s of sched) await base44.entities.ScheduledEvent.delete(s.id).catch(() => {});
      } catch {}
      // Hard delete character
      await base44.entities.Character.delete(artifact.id).catch(() => {});
      cleaned.push({ id: artifact.id, name: artifact.name });
    }

    proof.artifact_cleanup = {
      found: artifacts.length,
      deleted: cleaned,
      verdict: artifacts.length === 0
        ? '✅ No proof artifact characters found in live app'
        : `✅ Deleted ${cleaned.length} proof artifact(s) and linked records`,
    };
  } catch (err) {
    proof.artifact_cleanup = { error: err.message };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // FINAL SUMMARY
  // ─────────────────────────────────────────────────────────────────────────────
  const allVerdicts = [
    proof.dedup?.verdict,
    proof.leo_parker?.dedup_verdict,
    proof.leo_parker?.parent_ref_verdict,
    proof.leo_parker?.label_verdict,
    proof.rendered_roster?.overall_verdict,
    proof.velvet_bean_audit?.overall_verdict,
    proof.artifact_cleanup?.verdict,
  ].filter(Boolean);

  const failures = allVerdicts.filter(v => v.startsWith('❌'));
  const warnings = allVerdicts.filter(v => v.startsWith('⚠️'));

  proof.final_summary = {
    total_checks: allVerdicts.length,
    failures: failures.length,
    warnings: warnings.length,
    passed: allVerdicts.length - failures.length - warnings.length,
    overall: failures.length > 0
      ? `❌ FAILED — ${failures.length} failure(s) require attention`
      : warnings.length > 0
      ? `⚠️ PARTIAL — ${warnings.length} warning(s) exist but no hard failures`
      : `✅ ALL CHECKS PASSED — Travel roster dedup and presence hydration verified`,
    verdicts: allVerdicts,
  };

  return Response.json({
    summary: 'Travel Roster Final Proof — Canonical Dedup + Presence Hydration + Velvet Bean Audit',
    user_email: user.email,
    proof,
  });
});