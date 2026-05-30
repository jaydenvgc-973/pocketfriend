import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditNPCFinancialCoverage
 * 
 * Enumerates all NPC characters on the murqart account and cross-references
 * each against CharacterFinancial records to produce a complete coverage table.
 * 
 * Returns:
 *   - npc_roster: [{id, name, type, has_financial, financial_count, record_ids, status}]
 *   - financial_records: all CharacterFinancial records with owner_email=murqart@gmail.com
 *   - orphaned_financials: financial records whose character_id matches no NPC
 *   - summary: counts by type, coverage gaps, duplicates
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch Characters using the authenticated user's scope (RLS-safe)
    // This works when called from the app with a real user session
    const allCharsRaw = await base44.entities.Character.filter(
      { owner_email: user.email },
      'created_date',
      500
    );

    // Filter to NPC types only, exclude deleted/merged
    const npcTypes = ['npc_regular', 'npc_family_member', 'npc_fictitious'];
    const npcs = allCharsRaw.filter(c =>
      npcTypes.includes(c.character_type) &&
      c.status !== 'deleted' &&
      c.status !== 'soft_deleted' &&
      c.status !== 'merged'
    );

    // Also check for legacy NPCs (no character_type but not active_created_character)
    // Skip — we only audit explicitly typed NPCs per workstream B scope

    // Fetch all CharacterFinancial records for this account
    const financials = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { owner_email: 'murqart@gmail.com' },
      'created_date',
      500
    );

    // Build map: character_id -> [financial records]
    const finByCharId = {};
    for (const f of financials) {
      const cid = f.character_id;
      if (!cid) continue;
      if (!finByCharId[cid]) finByCharId[cid] = [];
      finByCharId[cid].push({
        id: f.id,
        created_date: f.created_date,
        current_balance: f.current_balance,
        income_sources_count: (f.income_sources || []).length,
        recurring_expenses_count: (f.recurring_expenses || []).length,
        work_location_ids_count: (f.work_location_ids || []).length,
        home_location_id: f.home_location_id || null,
        total_income: f.total_income,
        total_expenses: f.total_expenses,
        is_npc: f.is_npc,
        has_income: (f.income_sources || []).length > 0,
        has_expenses: (f.recurring_expenses || []).length > 0,
        is_degraded: (f.income_sources || []).length === 0 && (f.recurring_expenses || []).length === 0 && !f.home_location_id
      });
    }

    // Build NPC roster with financial coverage
    const npcRoster = npcs.map(c => {
      const recs = finByCharId[c.id] || [];
      const hasFinancial = recs.length > 0;
      const hasDuplicate = recs.length > 1;
      const canonical = recs.find(r => !r.is_degraded) || recs[0] || null;
      const degraded = recs.filter(r => r.is_degraded);

      return {
        id: c.id,
        name: c.name,
        type: c.character_type,
        has_financial: hasFinancial,
        financial_count: recs.length,
        has_duplicate: hasDuplicate,
        record_ids: recs.map(r => r.id),
        canonical_record_id: canonical?.id || null,
        canonical_has_income: canonical?.has_income || false,
        canonical_has_expenses: canonical?.has_expenses || false,
        canonical_balance: canonical?.current_balance || null,
        degraded_record_ids: degraded.map(r => r.id),
        status: !hasFinancial ? 'MISSING_FINANCIAL'
          : hasDuplicate ? 'HAS_DUPLICATE'
          : !canonical?.has_income ? 'NO_INCOME'
          : 'OK'
      };
    });

    // Known active_created_character IDs to skip when checking orphans
    const activeCreatedIds = new Set(
      allCharsRaw
        .filter(c => c.character_type === 'active_created_character')
        .map(c => c.id)
    );
    const npcIdSet = new Set(npcs.map(c => c.id));

    // Find financial records not matched to any NPC (exclude active_created and test probes)
    const orphanedFinancials = financials.filter(f => {
      if (!f.character_id) return false;
      if (activeCreatedIds.has(f.character_id)) return false;
      if (f.character_id === 'test_probe_only') return false;
      return !npcIdSet.has(f.character_id);
    }).map(f => ({
      id: f.id,
      character_id: f.character_id,
      character_name: f.character_name,
      current_balance: f.current_balance,
      created_date: f.created_date
    }));

    // Summary
    const missing = npcRoster.filter(n => n.status === 'MISSING_FINANCIAL');
    const duplicates = npcRoster.filter(n => n.status === 'HAS_DUPLICATE');
    const noIncome = npcRoster.filter(n => n.status === 'NO_INCOME');
    const ok = npcRoster.filter(n => n.status === 'OK');

    const summary = {
      total_npcs: npcs.length,
      by_type: {
        npc_fictitious: npcs.filter(c => c.character_type === 'npc_fictitious').length,
        npc_family_member: npcs.filter(c => c.character_type === 'npc_family_member').length,
        npc_regular: npcs.filter(c => c.character_type === 'npc_regular').length
      },
      total_financial_records_on_account: financials.length,
      coverage: {
        ok: ok.length,
        missing_financial: missing.length,
        has_duplicate: duplicates.length,
        no_income: noIncome.length
      },
      orphaned_financial_records: orphanedFinancials.length,
      missing_names: missing.map(n => n.name),
      duplicate_names: duplicates.map(n => `${n.name} (${n.financial_count} records)`),
      no_income_names: noIncome.map(n => n.name)
    };

    return Response.json({
      summary,
      npc_roster: npcRoster,
      orphaned_financials: orphanedFinancials
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});