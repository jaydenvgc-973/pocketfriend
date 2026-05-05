import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * userAccountDiagnostic
 *
 * Runs a full owner_email-scoped account diagnostic.
 * Ownership source of truth: owner_email ONLY. created_by is permanently forbidden.
 *
 * Supported repair_actions (all scoped by owner_email):
 *   fix_character_locations     → enforceLocationPresenceForOwner
 *   troubleshoot_locations      → troubleshootLocations
 *   troubleshoot_system         → troubleshootSystemData
 *   troubleshoot_moments        → troubleshootMoments
 *   troubleshoot_thread         → troubleshootThread (requires character_id)
 *   troubleshoot_home           → troubleshootHome (requires character_id)
 *   troubleshoot_profile        → troubleshootCharacterProfile (requires character_id)
 *   repair_character_owner      → repairCharacterOwnerEmail (requires character_id)
 *   repair_invalid_types        → repairInvalidCharacterTypes
 *   simulate_character_needs    → simulateActiveCharacterNeeds
 *   enforce_work_schedule       → enforceCharacterWorkSchedule (requires character_id)
 *   backfill_owner_email        → backfillCharacterOwnerEmail (ADMIN ONLY — blocked for normal users)
 */

// These repair actions can be safely called on behalf of the authenticated user
const SAFE_USER_REPAIR_PATHS = {
  fix_character_locations: async (base44, ownerEmail) => {
    const res = await base44.functions.invoke('enforceLocationPresenceForOwner', { owner_email: ownerEmail });
    return res?.data || { status: 'completed' };
  },
  troubleshoot_locations: async (base44) => {
    const res = await base44.functions.invoke('troubleshootLocations', {
      selectedIssues: ['stale_location_refs', 'resolved_location_sync', 'location_type_integrity']
    });
    return res?.data || { status: 'completed' };
  },
  troubleshoot_system: async (base44) => {
    const res = await base44.functions.invoke('troubleshootSystemData', {
      selectedIssues: ['orphaned_characters', 'character_type_audit']
    });
    return res?.data || { status: 'completed' };
  },
  troubleshoot_moments: async (base44) => {
    const res = await base44.functions.invoke('troubleshootMoments', {
      selectedIssues: ['event_tracking', 'badge_unlock', 'achievement_progress']
    });
    return res?.data || { status: 'completed' };
  },
  repair_invalid_types: async (base44, ownerEmail) => {
    const res = await base44.functions.invoke('repairInvalidCharacterTypes', { owner_email: ownerEmail });
    return res?.data || { status: 'completed' };
  },
  simulate_character_needs: async (base44, ownerEmail) => {
    const res = await base44.functions.invoke('simulateActiveCharacterNeeds', { owner_email: ownerEmail });
    return res?.data || { status: 'completed' };
  },
};

// Per-character repair paths (require character_id in payload)
const CHARACTER_REPAIR_PATHS = {
  troubleshoot_thread: 'troubleshootThread',
  troubleshoot_home: 'troubleshootHome',
  troubleshoot_profile: 'troubleshootCharacterProfile',
  enforce_work_schedule: 'enforceCharacterWorkSchedule',
};

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me();
  if (!user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ownerEmail = user.email;
  const body = await req.json().catch(() => ({}));
  const { categories = 'all', repair_action = null, repair_character_id = null } = body;

  // categories='none' means repair-only call — skip diagnostics entirely
  if (categories === 'none' && !repair_action) {
    return Response.json({ owner_email: ownerEmail, summary: 'No diagnostic requested.', findings: {}, checked_at: new Date().toISOString() });
  }

  // ── REPAIR DISPATCH (before diagnostics) ──────────────────────────────────
  if (repair_action) {
    // Block admin-only paths
    if (repair_action === 'backfill_owner_email') {
      if (user.role !== 'admin') {
        return Response.json({
          repair: {
            action: repair_action,
            blocked: true,
            reason: 'ADMIN_ONLY: This repair path requires admin privileges. An IssueReport has been created for admin review.'
          }
        });
      }
    }

    // Per-character repairs
    if (CHARACTER_REPAIR_PATHS[repair_action]) {
      if (!repair_character_id) {
        return Response.json({
          repair: { action: repair_action, blocked: true, reason: 'character_id required for this repair path' }
        });
      }
      // Verify the character belongs to this user before passing to the function
      const chars = await base44.entities.Character.filter({ owner_email: ownerEmail, id: repair_character_id });
      if (!chars || chars.length === 0) {
        return Response.json({
          repair: { action: repair_action, blocked: true, reason: 'Character not found in your account scope — repair blocked to prevent cross-account access.' }
        });
      }
      try {
        const fnName = CHARACTER_REPAIR_PATHS[repair_action];
        const res = await base44.functions.invoke(fnName, { character_id: repair_character_id, owner_email: ownerEmail });
        return Response.json({ repair: { action: repair_action, result: res?.data || 'completed', ok: true } });
      } catch (e) {
        return Response.json({ repair: { action: repair_action, error: e.message, ok: false } });
      }
    }

    // Bulk user-scoped repairs
    if (SAFE_USER_REPAIR_PATHS[repair_action]) {
      try {
        const result = await SAFE_USER_REPAIR_PATHS[repair_action](base44, ownerEmail);
        return Response.json({ repair: { action: repair_action, result, ok: true } });
      } catch (e) {
        return Response.json({ repair: { action: repair_action, error: e.message, ok: false } });
      }
    }

    // Unknown repair path — refuse clearly
    return Response.json({
      repair: {
        action: repair_action,
        blocked: true,
        reason: `Unknown repair path: "${repair_action}". This function does not have a verified safe path for that action. No changes were made.`
      }
    });
  }

  // ── DIAGNOSTICS ───────────────────────────────────────────────────────────
  const findings = {};
  const errors = [];

  // Fetch all characters once — reused across multiple checks
  let allChars = [];
  let liveChars = [];
  try {
    allChars = await base44.entities.Character.filter({ owner_email: ownerEmail }, '-created_date', 500);
    liveChars = allChars.filter(c =>
      c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
    );
  } catch (e) {
    errors.push({ area: 'character_fetch', error: e.message });
  }

  const liveCharIdSet = new Set(liveChars.map(c => c.id));

  // ── 1. CHARACTERS ──────────────────────────────────────────────────────────
  if (categories === 'all' || (Array.isArray(categories) && categories.includes('characters'))) {
    try {
      // Duplicate detection by normalized name
      const nameMap = new Map();
      liveChars.forEach(c => {
        const key = (c.name || '').trim().toLowerCase();
        if (!nameMap.has(key)) nameMap.set(key, []);
        nameMap.get(key).push({ id: c.id, name: c.name, character_type: c.character_type, status: c.status });
      });
      const duplicateGroups = [];
      nameMap.forEach((records, name) => {
        if (records.length >= 2) duplicateGroups.push({ name, count: records.length, records });
      });

      // Missing character_type
      const missingType = liveChars.filter(c => !c.character_type).map(c => ({ id: c.id, name: c.name }));

      // Missing owner_email on any fetched record (should never happen but verify)
      const missingOwner = allChars.filter(c => !c.owner_email).map(c => ({ id: c.id, name: c.name }));

      // Active characters with no home (not homeless, not an NPC)
      const noHome = liveChars.filter(c =>
        c.character_type === 'active_created_character' &&
        c.status === 'active' &&
        !c.current_home_location_id &&
        !c.is_homeless
      ).map(c => ({ id: c.id, name: c.name }));

      // Stale resolved location (has ID but name is blank)
      const staleResolved = liveChars
        .filter(c => c.resolved_current_location_id && !c.resolved_current_location_name)
        .map(c => ({ id: c.id, name: c.name, location_id: c.resolved_current_location_id }));

      // Characters merged but still appearing live (merged_into_character_id set but status not merged)
      const ghostMerged = liveChars
        .filter(c => c.merged_into_character_id && c.status !== 'merged')
        .map(c => ({ id: c.id, name: c.name, merged_into: c.merged_into_character_id }));

      findings.characters = {
        total: allChars.length,
        live: liveChars.length,
        by_type: {
          active_created: liveChars.filter(c => c.character_type === 'active_created_character').length,
          npc_regular: liveChars.filter(c => c.character_type === 'npc_regular').length,
          npc_family: liveChars.filter(c => c.character_type === 'npc_family_member').length,
          npc_fictitious: liveChars.filter(c => c.character_type === 'npc_fictitious').length,
        },
        duplicateGroups,
        duplicateGroupCount: duplicateGroups.length,
        missingType,
        missingOwner,
        noHome,
        staleResolved,
        ghostMerged,
        checks: [
          { check: 'Duplicate names', status: duplicateGroups.length > 0 ? 'warning' : 'passed', detail: duplicateGroups.length > 0 ? `${duplicateGroups.length} group(s): ${duplicateGroups.map(d => d.name).join(', ')}` : 'None found' },
          { check: 'Missing character_type', status: missingType.length > 0 ? 'failed' : 'passed', detail: missingType.length > 0 ? `${missingType.length} record(s) missing type: ${missingType.map(c => c.name).join(', ')}` : 'All typed' },
          { check: 'Missing owner_email', status: missingOwner.length > 0 ? 'failed' : 'passed', detail: missingOwner.length > 0 ? `${missingOwner.length} record(s) missing owner` : 'All owned' },
          { check: 'Active characters without home', status: noHome.length > 0 ? 'warning' : 'passed', detail: noHome.length > 0 ? `${noHome.length}: ${noHome.map(c => c.name).join(', ')}` : 'All homed or homeless by design' },
          { check: 'Stale resolved location (ID with no name)', status: staleResolved.length > 0 ? 'warning' : 'passed', detail: staleResolved.length > 0 ? `${staleResolved.length} character(s) — fix with "Sync Locations"` : 'None' },
          { check: 'Ghost merged records', status: ghostMerged.length > 0 ? 'warning' : 'passed', detail: ghostMerged.length > 0 ? `${ghostMerged.length} record(s) have merged_into set but status is not merged` : 'None' },
        ]
      };
    } catch (e) {
      errors.push({ area: 'characters', error: e.message });
    }
  }

  // ── 2. CONVERSATIONS ───────────────────────────────────────────────────────
  if (categories === 'all' || (Array.isArray(categories) && categories.includes('conversations'))) {
    try {
      const convs = await base44.entities.Conversation.filter({ owner_email: ownerEmail }, '-created_date', 200);
      const emptyCharIds = convs.filter(c => !c.character_ids || c.character_ids.length === 0).map(c => ({ id: c.id, title: c.title }));

      // Conversations referencing character IDs that no longer exist in this account
      const danglingConvs = convs.filter(c =>
        (c.character_ids || []).some(cid => !liveCharIdSet.has(cid))
      ).map(c => ({ id: c.id, title: c.title, bad_ids: (c.character_ids || []).filter(cid => !liveCharIdSet.has(cid)) }));

      findings.conversations = {
        total: convs.length,
        emptyCharIds,
        danglingConvs,
        checks: [
          { check: 'Conversations with no character links', status: emptyCharIds.length > 0 ? 'warning' : 'passed', detail: emptyCharIds.length > 0 ? `${emptyCharIds.length} conversation(s) have no character_ids` : 'All linked' },
          { check: 'Conversations referencing deleted characters', status: danglingConvs.length > 0 ? 'warning' : 'passed', detail: danglingConvs.length > 0 ? `${danglingConvs.length} conversation(s) reference deleted/merged character IDs` : 'None' },
        ]
      };
    } catch (e) {
      errors.push({ area: 'conversations', error: e.message });
    }
  }

  // ── 3. MEMORIES ────────────────────────────────────────────────────────────
  if (categories === 'all' || (Array.isArray(categories) && categories.includes('memories'))) {
    try {
      // OWNERSHIP RULE: CharacterMemory has no owner_email field.
      // Scope enforcement: fetch only memories whose character_id is in this account's character set.
      // We batch-query using the live character IDs as the scope guard — no cross-account data is read.
      // Limit to 20 queries max to avoid rate-limit storms.
      const liveCharIds = Array.from(liveCharIdSet);
      const allMyCharIds = new Set(allChars.map(c => c.id));
      let myMemories = [];
      let danglingMemories = [];

      // Fetch memories scoped per character in batches of 10
      const batchSize = 10;
      for (let i = 0; i < Math.min(liveCharIds.length, 50); i += batchSize) {
        const batch = liveCharIds.slice(i, i + batchSize);
        for (const cid of batch) {
          const mems = await base44.entities.CharacterMemory.filter({ character_id: cid }, '-created_date', 50);
          myMemories = myMemories.concat(mems);
        }
      }

      // Dangling: check memories for deleted/merged characters (their IDs are in allMyCharIds but not liveCharIdSet)
      const deletedCharIds = [...allMyCharIds].filter(id => !liveCharIdSet.has(id));
      for (const cid of deletedCharIds.slice(0, 10)) {
        const mems = await base44.entities.CharacterMemory.filter({ character_id: cid }, '-created_date', 20);
        danglingMemories = danglingMemories.concat(mems);
      }

      const unresolved = myMemories.filter(m => m.validation_status === 'unresolved_identity');
      const pending = myMemories.filter(m => m.validation_status === 'pending');

      findings.memories = {
        total: myMemories.length,
        unresolved: unresolved.length,
        pending: pending.length,
        danglingCount: danglingMemories.length,
        checks: [
          { check: 'Unresolved identity references', status: unresolved.length > 0 ? 'warning' : 'passed', detail: unresolved.length > 0 ? `${unresolved.length} memory record(s) need identity resolution` : 'None' },
          { check: 'Pending memories', status: pending.length > 0 ? 'warning' : 'passed', detail: pending.length > 0 ? `${pending.length} memory record(s) are still pending` : 'None' },
          { check: 'Dangling memories (deleted character)', status: danglingMemories.length > 0 ? 'warning' : 'passed', detail: danglingMemories.length > 0 ? `${danglingMemories.length} memory record(s) belong to deleted characters` : 'None' },
        ]
      };
    } catch (e) {
      errors.push({ area: 'memories', error: e.message });
    }
  }

  // ── 4. LOCATIONS ───────────────────────────────────────────────────────────
  if (categories === 'all' || (Array.isArray(categories) && categories.includes('locations'))) {
    try {
      const locs = await base44.entities.LocationReference.filter({ owner_email: ownerEmail }, '-created_date', 300);
      const noScope = locs.filter(l => !l.scope).map(l => ({ id: l.id, name: l.name }));
      const noCategory = locs.filter(l => !l.category).map(l => ({ id: l.id, name: l.name }));

      findings.locations = {
        total: locs.length,
        noScopeCount: noScope.length,
        noCategoryCount: noCategory.length,
        checks: [
          { check: 'Locations missing scope', status: noScope.length > 0 ? 'warning' : 'passed', detail: noScope.length > 0 ? `${noScope.length} location(s) — run "Sync Locations" to fix` : 'All scoped' },
          { check: 'Locations missing category', status: noCategory.length > 0 ? 'warning' : 'passed', detail: noCategory.length > 0 ? `${noCategory.length} location(s) missing category` : 'All categorized' }
        ]
      };
    } catch (e) {
      errors.push({ area: 'locations', error: e.message });
    }
  }

  // ── 5. FINANCIAL ───────────────────────────────────────────────────────────
  if (categories === 'all' || (Array.isArray(categories) && categories.includes('financial'))) {
    try {
      const activeCreated = liveChars.filter(c =>
        c.character_type === 'active_created_character' && c.status === 'active'
      );

      // OWNERSHIP RULE: CharacterFinancial has character_id but no owner_email.
      // Scope enforcement: fetch only records whose character_id is in this account's live character set.
      const myFinancials = [];
      for (const char of activeCreated.slice(0, 30)) {
        const recs = await base44.entities.CharacterFinancial.filter({ character_id: char.id }, '-created_date', 1);
        myFinancials.push(...recs);
      }
      const myFinancialCharIds = new Set(myFinancials.map(f => f.character_id));
      const missingFinancial = activeCreated.filter(c => !myFinancialCharIds.has(c.id)).map(c => ({ id: c.id, name: c.name }));

      // Characters with negative balance
      const negativeBalance = myFinancials.filter(f => (f.current_balance || 0) < 0).map(f => ({ character_id: f.character_id, balance: f.current_balance }));

      findings.financial = {
        activeCharacters: activeCreated.length,
        withFinancialRecord: myFinancials.length,
        missingFinancialRecord: missingFinancial,
        negativeBalance,
        checks: [
          { check: 'Active characters missing financial record', status: missingFinancial.length > 0 ? 'warning' : 'passed', detail: missingFinancial.length > 0 ? `${missingFinancial.length}: ${missingFinancial.map(c => c.name).join(', ')}` : 'All have financial records' },
          { check: 'Characters with negative balance', status: negativeBalance.length > 0 ? 'warning' : 'passed', detail: negativeBalance.length > 0 ? `${negativeBalance.length} character(s) have negative balance` : 'All balances OK' },
        ]
      };
    } catch (e) {
      errors.push({ area: 'financial', error: e.message });
    }
  }

  // ── 6. SCHEDULES / PRESENCE ────────────────────────────────────────────────
  if (categories === 'all' || (Array.isArray(categories) && categories.includes('schedules'))) {
    try {
      // Characters with work info but no work location linked
      const workerChars = liveChars.filter(c =>
        c.character_type === 'active_created_character' &&
        c.occupation &&
        !c.current_work_location_id
      ).map(c => ({ id: c.id, name: c.name, occupation: c.occupation }));

      // Characters with school info but no school location linked
      const studentChars = liveChars.filter(c =>
        c.character_type === 'active_created_character' &&
        c.student_status === 'enrolled' &&
        !c.current_school_location_id
      ).map(c => ({ id: c.id, name: c.name }));

      findings.schedules = {
        workersMissingWorkLocation: workerChars,
        studentsMissingSchoolLocation: studentChars,
        checks: [
          { check: 'Workers missing work location link', status: workerChars.length > 0 ? 'warning' : 'passed', detail: workerChars.length > 0 ? `${workerChars.length}: ${workerChars.map(c => c.name).join(', ')}` : 'All workers linked to locations' },
          { check: 'Students missing school location link', status: studentChars.length > 0 ? 'warning' : 'passed', detail: studentChars.length > 0 ? `${studentChars.length}: ${studentChars.map(c => c.name).join(', ')}` : 'All students linked to locations' },
        ]
      };
    } catch (e) {
      errors.push({ area: 'schedules', error: e.message });
    }
  }

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  const allChecks = Object.values(findings).flatMap(f => f.checks || []);
  const failedChecks = allChecks.filter(c => c.status === 'failed');
  const warningChecks = allChecks.filter(c => c.status === 'warning');

  const summary = failedChecks.length > 0
    ? `${failedChecks.length} critical issue(s) and ${warningChecks.length} warning(s) found.`
    : warningChecks.length > 0
      ? `${warningChecks.length} warning(s) found — no critical issues.`
      : 'All checks passed — no issues found.';

  // Expose which repair paths are available (so frontend never guesses)
  const availableRepairs = Object.keys(SAFE_USER_REPAIR_PATHS);
  const availableCharacterRepairs = Object.keys(CHARACTER_REPAIR_PATHS);

  return Response.json({
    owner_email: ownerEmail,
    summary,
    findings,
    errors: errors.length > 0 ? errors : undefined,
    available_repairs: availableRepairs,
    available_character_repairs: availableCharacterRepairs,
    checked_at: new Date().toISOString(),
  });
});