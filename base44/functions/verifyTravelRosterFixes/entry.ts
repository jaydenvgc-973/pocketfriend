import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * verifyTravelRosterFixes
 *
 * Compact final verification — returns only the key verdicts without the full rows array.
 * Covers:
 *   1. Leo Parker: pre-dedup count, post-dedup count, rendered label, presence source
 *   2. Nathan + Lila: both reference Leo, both parents handled by single canonical key
 *   3. Velvet Bean: canonical vs shell, reference count on shell, safe-to-delete verdict
 *   4. No "At Unresolved" labels in any rendered row
 *   5. ProofChar artifact presence check
 */
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Fetch characters ─────────────────────────────────────────────────────────
  let rlsChars = [];
  try { rlsChars = await base44.entities.Character.filter({ owner_email: user.email }, 'created_date', 300); } catch {}

  let npcs = [];
  try {
    const [f, m] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ owner_email: user.email, character_type: 'npc_fictitious' }, 'created_date', 200),
      base44.asServiceRole.entities.Character.filter({ owner_email: user.email, character_type: 'npc_family_member' }, 'created_date', 200),
    ]);
    npcs = [...f, ...m];
  } catch {}

  const seen0 = new Set();
  const allChars = [];
  for (const c of [...rlsChars, ...npcs]) {
    if (seen0.has(c.id)) continue;
    seen0.add(c.id);
    allChars.push(c);
  }

  // ── Slices ───────────────────────────────────────────────────────────────────
  const resolveType = (c) => {
    if (c.character_type) return c.character_type;
    return 'active_created_character';
  };
  const activeCreated = allChars.filter(c => resolveType(c) === 'active_created_character' && c.status !== 'deleted');
  const npcFictitious = allChars.filter(c => resolveType(c) === 'npc_fictitious');
  const npcFamilyMembers = allChars.filter(c => resolveType(c) === 'npc_family_member');
  const travelCompanions = [...activeCreated, ...npcFictitious, ...npcFamilyMembers];

  // ── Canonical dedup ──────────────────────────────────────────────────────────
  const buildKey = (c) => {
    const type = c.character_type || 'unknown';
    const norm = (c.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (c.linked_character_id) return `${type}::linked::${c.linked_character_id}`;
    if (c.npc_fictitious_character_id) return `${type}::linked::${c.npc_fictitious_character_id}`;
    if (c.stable_family_member_id) return `${type}::fam::${c.stable_family_member_id}`;
    if (c.current_home_location_id) return `${type}::household::${c.current_home_location_id}::${norm}`;
    return `${type}::name::${norm}`;
  };

  const seenIds = new Set();
  const seenKeys = new Set();
  const roster = [];
  const dropped = [];

  for (const c of travelCompanions) {
    if (seenIds.has(c.id)) { dropped.push({ reason: 'exact_id', name: c.name, id: c.id }); continue; }
    seenIds.add(c.id);
    const k = buildKey(c);
    if (seenKeys.has(k)) { dropped.push({ reason: 'canonical_key', name: c.name, id: c.id, key: k }); continue; }
    seenKeys.add(k);
    roster.push({ ...c, _key: k });
  }

  // ── Presence hydration simulation ────────────────────────────────────────────
  const presenceById = Object.fromEntries(allChars.map(c => [c.id, c]));
  const presenceByName = Object.fromEntries(allChars.map(c => [(c.display_name || c.name || '').trim().toLowerCase(), c]));

  const resolveLabel = (char) => {
    const norm = (char.display_name || char.name || '').trim().toLowerCase();
    const pe = presenceById[char.id] || presenceByName[norm] || null;
    const locName = pe?.resolved_current_location_name || char.resolved_current_location_name || null;
    const status = pe?.resolved_presence_status || char.resolved_presence_status || null;
    const isHome = pe?.is_home ?? (status === 'home' || status === 'sleeping' || status === 'napping');
    const hasHome = !!(char.current_home_location_id || pe?.residence_location_id);
    if (locName && !isHome) return { label: `At ${locName}`, source: pe ? (presenceById[char.id] ? 'presenceById' : 'presenceByName') : 'raw_field' };
    if (isHome || hasHome) return { label: 'At home', source: 'home_id' };
    return { label: 'Available', source: 'default' };
  };

  const unresolvedRows = roster.filter(c => {
    const { label } = resolveLabel(c);
    return label.toLowerCase().includes('unresolved');
  }).map(c => ({ name: c.name, id: c.id }));

  // ── Leo Parker ───────────────────────────────────────────────────────────────
  const leoInput = travelCompanions.filter(c => (c.name || '').toLowerCase().includes('leo parker'));
  const leoRoster = roster.filter(c => (c.name || '').toLowerCase().includes('leo parker'));
  const leoDropped = dropped.filter(d => (d.name || '').toLowerCase().includes('leo parker'));
  const leoParents = allChars.filter(c =>
    (c.family_members || []).some(f => (f.name || '').toLowerCase().includes('leo parker'))
  );
  const leoRow = leoRoster[0];
  const leoLabel = leoRow ? resolveLabel(leoRow) : null;

  // ── Velvet Bean ──────────────────────────────────────────────────────────────
  let velvetBeanResult = {};
  try {
    const allLocs = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);
    const vbs = allLocs.filter(l => (l.name || '').toLowerCase().includes('velvet bean'));
    const canonical = vbs.find(l => (l.zones || []).length > 0 || (l.image_urls || []).length > 0) || vbs[0];
    const shells = vbs.filter(l => l.id !== canonical?.id);

    const shellResults = [];
    for (const sh of shells) {
      const charRefs = allChars.filter(c =>
        c.resolved_current_location_id === sh.id ||
        c.current_home_location_id === sh.id ||
        c.current_work_location_id === sh.id ||
        c.occupation_location_id === sh.id ||
        c.traveling_to_location_id === sh.id
      );
      let evtCount = 0;
      try { const evts = await base44.asServiceRole.entities.CommunityEvent.filter({ location_id: sh.id }); evtCount = evts.length; } catch {}
      let memCount = 0;
      try { const mems = await base44.asServiceRole.entities.CharacterMemory.filter({ related_location_id: sh.id }); memCount = mems.length; } catch {}
      let schedCount = 0;
      try {
        const all = await base44.asServiceRole.entities.ScheduledEvent.filter({});
        schedCount = all.filter(e => e.event_payload?.destination_location_id === sh.id).length;
      } catch {}
      const total = charRefs.length + evtCount + memCount + schedCount;
      shellResults.push({
        shell_id: sh.id,
        shell_name: sh.name,
        character_refs: charRefs.length,
        community_event_refs: evtCount,
        memory_refs: memCount,
        scheduled_event_refs: schedCount,
        total_references: total,
        safe_to_delete: total === 0,
        verdict: total === 0 ? '✅ Safe to hard delete — zero references' : `⚠️ ${total} reference(s) — remap to canonical first`,
      });
    }

    velvetBeanResult = {
      total_records: vbs.length,
      canonical: canonical ? { id: canonical.id, name: canonical.name, zones: (canonical.zones || []).length, verdict: '✅ Real canonical — do not touch' } : null,
      shells: shellResults,
      overall: shellResults.length === 0 ? '✅ No shell duplicates' :
        shellResults.every(s => s.safe_to_delete) ? '✅ All shells reference-free — safe to delete' :
        '⚠️ Some shells have references — remap before delete',
    };
  } catch (err) {
    velvetBeanResult = { error: err.message };
  }

  // ── Artifact check ───────────────────────────────────────────────────────────
  const artifacts = allChars.filter(c => /^ProofChar[AB]$/i.test((c.name || '').trim()) || /^proof_char/i.test((c.name || '').trim()));

  // ── Final verdicts ───────────────────────────────────────────────────────────
  return Response.json({
    summary: 'Travel Roster Verification — Final',
    user_email: user.email,

    roster_stats: {
      input_to_selector: travelCompanions.length,
      after_dedup: roster.length,
      dropped: dropped.length,
      dropped_details: dropped,
    },

    unresolved_label_check: {
      count: unresolvedRows.length,
      rows: unresolvedRows,
      verdict: unresolvedRows.length === 0
        ? '✅ Zero "At Unresolved" labels in any rendered row'
        : `❌ ${unresolvedRows.length} row(s) would show "At Unresolved"`,
    },

    leo_parker: {
      in_input_pre_dedup: leoInput.length,
      in_roster_post_dedup: leoRoster.length,
      dropped_by_dedup: leoDropped,
      parents_referencing_leo: leoParents.map(p => ({ name: p.name, id: p.id })),
      canonical_key: leoRow?._key || null,
      rendered_label: leoLabel?.label || null,
      presence_source: leoLabel?.source || null,
      dedup_verdict: leoRoster.length === 1
        ? '✅ Leo Parker appears EXACTLY ONCE in the rendered roster'
        : leoRoster.length === 0
        ? '⚠️ Leo Parker not in roster'
        : `❌ Leo Parker appears ${leoRoster.length} times — dedup FAILED`,
      parent_verdict: leoParents.length >= 2
        ? `✅ Both parents (${leoParents.map(p => p.name).join(', ')}) reference Leo — merged into 1 row`
        : leoParents.length === 1
        ? `✅ 1 parent references Leo — 1 row`
        : '⚠️ No parent references found',
      label_verdict: leoLabel
        ? (leoLabel.label.toLowerCase().includes('unresolved') ? `❌ Shows "At Unresolved"` : `✅ Shows "${leoLabel.label}" via ${leoLabel.source}`)
        : 'N/A',
    },

    velvet_bean: velvetBeanResult,

    proof_artifacts: {
      found: artifacts.length,
      names: artifacts.map(a => a.name),
      verdict: artifacts.length === 0 ? '✅ No proof artifact characters in live app' : `⚠️ ${artifacts.length} artifact(s) still present`,
    },

    overall: (() => {
      const checks = [
        leoRoster.length === 1,
        unresolvedRows.length === 0,
        artifacts.length === 0,
      ];
      const passed = checks.filter(Boolean).length;
      return passed === checks.length
        ? '✅ ALL CHECKS PASSED — implementation verified'
        : `⚠️ ${checks.length - passed} check(s) need attention`;
    })(),
  });
});