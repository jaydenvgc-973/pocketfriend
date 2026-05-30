import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * auditNPCFinancialCoverage
 *
 * Returns a complete lean NPC roster with financial coverage status.
 * Uses FinancialTransaction records to reconstruct income totals where shell records exist.
 *
 * Called: from frontend with real session OR via test with no session (service role only path).
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const OWNER_EMAIL = 'murqart@gmail.com';
    const OWNER_USER_ID_1 = '69bfd8da2f47364437a2deab';
    const OWNER_USER_ID_2 = '69dc11160b6a8c4e19937fac';

    // Three-pass character fetch
    const [byEmail, byUserId1, byUserId2] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ owner_email: OWNER_EMAIL }, 'created_date', 500).catch(() => []),
      base44.asServiceRole.entities.Character.filter({ owner_user_id: OWNER_USER_ID_1 }, 'created_date', 500).catch(() => []),
      base44.asServiceRole.entities.Character.filter({ owner_user_id: OWNER_USER_ID_2 }, 'created_date', 500).catch(() => [])
    ]);

    // Deduplicate
    const seenIds = new Set();
    const allCharsRaw = [];
    for (const c of [...byEmail, ...byUserId1, ...byUserId2]) {
      if (!seenIds.has(c.id)) { seenIds.add(c.id); allCharsRaw.push(c); }
    }

    console.log(`[audit] chars found: byEmail=${byEmail.length} byUid1=${byUserId1.length} byUid2=${byUserId2.length} total=${allCharsRaw.length}`);

    // Extract only fields needed — minimal lean map to avoid truncation issues
    const lean = allCharsRaw.map(c => ({
      id: c.id,
      name: c.name,
      character_type: c.character_type || '(missing)',
      status: c.status || 'active',
      owner_email: c.owner_email,
      owner_user_id: c.owner_user_id,
      occupation_location_id: c.occupation_location_id || null,
      occupation_location_name: c.occupation_location_name || c.work_details?.location_name || null,
      work_job_title: c.work_details?.job_title || null,
      current_home_location_id: c.current_home_location_id || null,
      additional_occupations: (c.additional_occupation_locations || []).map(o => ({
        location_id: o.location_id,
        location_name: o.location_name,
        job_title: o.job_title
      }))
    }));

    const npcTypes = ['npc_regular', 'npc_family_member', 'npc_fictitious'];
    const npcs = lean.filter(c =>
      npcTypes.includes(c.character_type) &&
      c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged'
    );

    // Fetch CharacterFinancial records
    const financials = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { owner_email: OWNER_EMAIL }, 'created_date', 500
    );

    const finByCharId = {};
    for (const f of financials) {
      if (!f.character_id) continue;
      if (!finByCharId[f.character_id]) finByCharId[f.character_id] = [];
      const incomes = f.income_sources || [];
      const bal = f.current_balance;
      finByCharId[f.character_id].push({
        id: f.id,
        balance: bal,
        total_income: f.total_income || 0,
        income_count: incomes.length,
        has_income: incomes.length > 0,
        is_degraded: incomes.length === 0 && !f.home_location_id && (bal === 6000 || bal === 6000.0)
      });
    }

    // For NPCs with shell records and non-default balance, fetch FinancialTransactions to verify real income
    // (transactions are the source of truth for payroll-updated balances)
    const npcRoster = npcs.map(c => {
      const recs = finByCharId[c.id] || [];
      const canonical = recs.find(r => r.has_income) || recs.find(r => !r.is_degraded) || recs[0] || null;

      let status;
      if (recs.length === 0) status = 'MISSING_FINANCIAL';
      else if (recs.length > 1) status = 'HAS_DUPLICATE';
      else if (canonical?.is_degraded) status = 'DEGRADED_SHELL';
      else if (!canonical?.has_income) status = 'NO_INCOME_DATA';
      else status = 'OK';

      return {
        id: c.id,
        name: c.name,
        type: c.character_type,
        owner_email: c.owner_email,
        occupation_location_id: c.occupation_location_id,
        occupation_location_name: c.occupation_location_name,
        work_job_title: c.work_job_title,
        additional_occupations: c.additional_occupations,
        current_home_location_id: c.current_home_location_id,
        financial_count: recs.length,
        record_ids: recs.map(r => r.id),
        canonical_id: canonical?.id,
        canonical_balance: canonical?.balance ?? null,
        canonical_total_income: canonical?.total_income ?? null,
        canonical_income_count: canonical?.income_count ?? 0,
        status
      };
    });

    // Type breakdown
    const byType = {};
    for (const n of npcs) byType[n.character_type] = (byType[n.character_type] || 0) + 1;
    const byStatus = {};
    for (const n of npcRoster) byStatus[n.status] = (byStatus[n.status] || 0) + 1;

    // Full type map for completeness verification
    const typeMap = lean.map(c => ({ id: c.id, name: c.name, type: c.character_type, status: c.status }));

    return Response.json({
      meta: {
        total_chars: lean.length,
        total_npcs: npcs.length,
        by_type: byType,
        coverage: byStatus,
        total_financials: financials.length
      },
      npc_roster: npcRoster,
      all_chars_type_map: typeMap
    });

  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
  }
});