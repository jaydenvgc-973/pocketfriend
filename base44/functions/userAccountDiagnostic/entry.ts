import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * userAccountDiagnostic
 *
 * Runs a full owner_email-scoped account diagnostic.
 * Ownership source of truth: owner_email ONLY. created_by is never used.
 * All checks are read-only unless repair=true is passed with a specific repair_action.
 *
 * Returns structured findings per category.
 */

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  const user = await base44.auth.me();
  if (!user?.email) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ownerEmail = user.email;
  const body = await req.json().catch(() => ({}));
  const { categories = 'all', repair_action = null } = body;

  const findings = {};
  const errors = [];

  // ── 1. CHARACTER HEALTH ─────────────────────────────────────────────────────
  if (categories === 'all' || categories.includes('characters')) {
    try {
      const chars = await base44.entities.Character.filter(
        { owner_email: ownerEmail },
        '-created_date',
        500
      );

      const live = chars.filter(c =>
        c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
      );

      // Duplicate detection by name
      const nameMap = new Map();
      live.forEach(c => {
        const key = (c.name || '').trim().toLowerCase();
        if (!nameMap.has(key)) nameMap.set(key, []);
        nameMap.get(key).push({ id: c.id, name: c.name, character_type: c.character_type, status: c.status, owner_email: c.owner_email });
      });
      const duplicateGroups = [];
      nameMap.forEach((records, name) => {
        if (records.length >= 2) duplicateGroups.push({ name, count: records.length, records });
      });

      // Missing character_type
      const missingType = live.filter(c => !c.character_type).map(c => ({ id: c.id, name: c.name }));

      // Missing owner_email (should never happen since we filtered by it, but check the raw list)
      const missingOwner = chars.filter(c => !c.owner_email).map(c => ({ id: c.id, name: c.name }));

      // No home location
      const noHome = live
        .filter(c => c.character_type === 'active_created_character' && !c.current_home_location_id && !c.is_homeless)
        .map(c => ({ id: c.id, name: c.name }));

      // Stale resolved location IDs (character references a location_id that we can spot-check)
      const staleResolved = live
        .filter(c => c.resolved_current_location_id && !c.resolved_current_location_name)
        .map(c => ({ id: c.id, name: c.name, resolved_current_location_id: c.resolved_current_location_id }));

      findings.characters = {
        total: chars.length,
        live: live.length,
        by_type: {
          active_created: live.filter(c => c.character_type === 'active_created_character').length,
          npc_regular: live.filter(c => c.character_type === 'npc_regular').length,
          npc_family: live.filter(c => c.character_type === 'npc_family_member').length,
          npc_fictitious: live.filter(c => c.character_type === 'npc_fictitious').length,
        },
        duplicateGroups,
        duplicateGroupCount: duplicateGroups.length,
        missingType,
        missingOwner,
        noHome,
        staleResolved,
        checks: [
          { check: 'Duplicate names', status: duplicateGroups.length > 0 ? 'warning' : 'passed', detail: duplicateGroups.length > 0 ? `${duplicateGroups.length} group(s): ${duplicateGroups.map(d => d.name).join(', ')}` : 'None found' },
          { check: 'Missing character_type', status: missingType.length > 0 ? 'failed' : 'passed', detail: missingType.length > 0 ? `${missingType.length} record(s) missing type` : 'All typed' },
          { check: 'Missing owner_email', status: missingOwner.length > 0 ? 'failed' : 'passed', detail: missingOwner.length > 0 ? `${missingOwner.length} record(s) missing owner` : 'All owned' },
          { check: 'Active characters without home', status: noHome.length > 0 ? 'warning' : 'passed', detail: noHome.length > 0 ? `${noHome.length} character(s): ${noHome.map(c => c.name).join(', ')}` : 'All homed' },
          { check: 'Stale resolved location (ID with no name)', status: staleResolved.length > 0 ? 'warning' : 'passed', detail: staleResolved.length > 0 ? `${staleResolved.length} character(s)` : 'None' },
        ]
      };
    } catch (e) {
      errors.push({ area: 'characters', error: e.message });
    }
  }

  // ── 2. CONVERSATION / CHAT LINKAGE ──────────────────────────────────────────
  if (categories === 'all' || categories.includes('conversations')) {
    try {
      const convs = await base44.entities.Conversation.filter(
        { owner_email: ownerEmail },
        '-created_date',
        200
      );

      // Conversations with no character_ids
      const emptyCharIds = convs.filter(c => !c.character_ids || c.character_ids.length === 0)
        .map(c => ({ id: c.id, title: c.title }));

      findings.conversations = {
        total: convs.length,
        emptyCharIds,
        checks: [
          { check: 'Conversations with no character links', status: emptyCharIds.length > 0 ? 'warning' : 'passed', detail: emptyCharIds.length > 0 ? `${emptyCharIds.length} conversation(s) unlinked` : 'All linked' }
        ]
      };
    } catch (e) {
      errors.push({ area: 'conversations', error: e.message });
    }
  }

  // ── 3. MEMORIES ─────────────────────────────────────────────────────────────
  if (categories === 'all' || categories.includes('memories')) {
    try {
      // Get this user's characters first
      const chars = await base44.entities.Character.filter({ owner_email: ownerEmail }, '-created_date', 500);
      const liveCharIds = new Set(
        chars.filter(c => c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged').map(c => c.id)
      );

      const memories = await base44.entities.CharacterMemory.filter({}, '-created_date', 500);
      // Filter to only memories for this user's characters
      const myMemories = memories.filter(m => liveCharIds.has(m.character_id));

      const unresolved = myMemories.filter(m => m.validation_status === 'unresolved_identity');
      const pending = myMemories.filter(m => m.validation_status === 'pending');
      const dangling = myMemories.filter(m => !liveCharIds.has(m.character_id) && m.character_id);

      findings.memories = {
        total: myMemories.length,
        unresolved: unresolved.length,
        pending: pending.length,
        danglingCount: dangling.length,
        checks: [
          { check: 'Unresolved identity references in memories', status: unresolved.length > 0 ? 'warning' : 'passed', detail: unresolved.length > 0 ? `${unresolved.length} memory/memories need identity resolution` : 'None' },
          { check: 'Dangling memories (character no longer exists)', status: dangling.length > 0 ? 'warning' : 'passed', detail: dangling.length > 0 ? `${dangling.length} memory/memories reference deleted characters` : 'None' }
        ]
      };
    } catch (e) {
      errors.push({ area: 'memories', error: e.message });
    }
  }

  // ── 4. LOCATIONS ────────────────────────────────────────────────────────────
  if (categories === 'all' || categories.includes('locations')) {
    try {
      const locs = await base44.entities.LocationReference.filter(
        { owner_email: ownerEmail },
        '-created_date',
        300
      );

      const noScope = locs.filter(l => !l.scope).map(l => ({ id: l.id, name: l.name }));
      const noCategory = locs.filter(l => !l.category).map(l => ({ id: l.id, name: l.name }));

      findings.locations = {
        total: locs.length,
        noScope: noScope.length,
        noCategory: noCategory.length,
        checks: [
          { check: 'Locations missing scope', status: noScope.length > 0 ? 'warning' : 'passed', detail: noScope.length > 0 ? `${noScope.length} location(s) missing scope field` : 'All scoped' },
          { check: 'Locations missing category', status: noCategory.length > 0 ? 'warning' : 'passed', detail: noCategory.length > 0 ? `${noCategory.length} location(s) missing category` : 'All categorized' }
        ]
      };
    } catch (e) {
      errors.push({ area: 'locations', error: e.message });
    }
  }

  // ── 5. FINANCIAL ────────────────────────────────────────────────────────────
  if (categories === 'all' || categories.includes('financial')) {
    try {
      const chars = await base44.entities.Character.filter({ owner_email: ownerEmail }, '-created_date', 300);
      const liveActive = chars.filter(c =>
        c.character_type === 'active_created_character' &&
        c.status === 'active'
      );

      // Fetch financial records for these characters
      const financialRecords = await base44.entities.CharacterFinancial.filter({}, '-created_date', 300);
      const myFinancialIds = new Set(liveActive.map(c => c.id));
      const myFinancials = financialRecords.filter(f => myFinancialIds.has(f.character_id));

      const noFinancial = liveActive.filter(c => !myFinancials.find(f => f.character_id === c.id))
        .map(c => ({ id: c.id, name: c.name }));

      findings.financial = {
        activeCharacters: liveActive.length,
        withFinancialRecord: myFinancials.length,
        missingFinancialRecord: noFinancial,
        checks: [
          { check: 'Active characters missing financial record', status: noFinancial.length > 0 ? 'warning' : 'passed', detail: noFinancial.length > 0 ? `${noFinancial.length}: ${noFinancial.map(c => c.name).join(', ')}` : 'All have financial records' }
        ]
      };
    } catch (e) {
      errors.push({ area: 'financial', error: e.message });
    }
  }

  // ── REPAIR ACTIONS (owner_email-scoped, explicit only) ──────────────────────
  let repairResult = null;
  if (repair_action) {
    try {
      if (repair_action === 'fix_character_locations') {
        // Calls the live enforceLocationPresenceForOwner function
        const res = await base44.asServiceRole.functions.invoke('enforceLocationPresenceForOwner', {
          owner_email: ownerEmail
        });
        repairResult = { action: repair_action, result: res?.data || 'completed' };
      } else if (repair_action === 'troubleshoot_locations') {
        const res = await base44.functions.invoke('troubleshootLocations', {
          selectedIssues: ['stale_location_refs', 'resolved_location_sync']
        });
        repairResult = { action: repair_action, result: res?.data || 'completed' };
      } else if (repair_action === 'troubleshoot_system') {
        const res = await base44.functions.invoke('troubleshootSystemData', {
          selectedIssues: ['orphaned_characters', 'character_type_audit']
        });
        repairResult = { action: repair_action, result: res?.data || 'completed' };
      } else {
        repairResult = { action: repair_action, result: 'unknown_action — this repair path does not exist in the current system' };
      }
    } catch (e) {
      repairResult = { action: repair_action, error: e.message };
    }
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────────
  const allChecks = Object.values(findings).flatMap(f => f.checks || []);
  const failedChecks = allChecks.filter(c => c.status === 'failed');
  const warningChecks = allChecks.filter(c => c.status === 'warning');

  const summary = failedChecks.length > 0
    ? `${failedChecks.length} critical issue(s) and ${warningChecks.length} warning(s) found across your account.`
    : warningChecks.length > 0
      ? `${warningChecks.length} warning(s) found — no critical issues.`
      : 'All checks passed — no issues found.';

  return Response.json({
    owner_email: ownerEmail,
    summary,
    findings,
    errors: errors.length > 0 ? errors : undefined,
    repair: repairResult || undefined,
    checked_at: new Date().toISOString(),
  });
});