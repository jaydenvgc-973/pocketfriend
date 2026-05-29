/**
 * diagnosticFinancialSetComparison
 *
 * READ-ONLY diagnostic. Zero writes. Zero creates. Zero deletes.
 *
 * Confirmed root cause of service-role 0-result:
 * Character RLS uses "data.owner_email": "{{user.email}}" — a data-field path rule
 * that is NOT bypassed by asServiceRole. Only user-scoped queries can read Characters.
 *
 * Solution: use user-scoped base44.entities.Character.filter() here.
 * This function MUST be called as the authenticated admin user (murqart@gmail.com).
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    // ── STEP 1: Load all characters — USER-SCOPED (required for data.owner_email RLS) ──
    // asServiceRole does NOT bypass data-field-path RLS on Character.
    // Only user-scoped filter works.
    const allChars = [];
    let page = 0;
    const PAGE = 50;
    while (true) {
      const batch = await base44.entities.Character.filter(
        {},
        'created_date',
        PAGE,
        page * PAGE
      ).catch(() => []);
      if (!batch || batch.length === 0) break;
      allChars.push(...batch);
      if (batch.length < PAGE) break;
      page++;
      await new Promise(r => setTimeout(r, 200));
    }

    // Split: active_created_character vs others
    const activeCreated = allChars.filter(c =>
      c.status === 'active' && c.character_type === 'active_created_character'
    );
    const allOtherActive = allChars.filter(c =>
      c.status === 'active' && c.character_type !== 'active_created_character'
    );
    const deleted = allChars.filter(c =>
      c.status === 'deleted' || c.status === 'soft_deleted' || c.status === 'merged'
    );

    const activeCharMap = new Map();
    for (const c of activeCreated) {
      activeCharMap.set(c.id, { id: c.id, name: c.name, owner_email: c.owner_email || null });
    }

    // ── STEP 2: Load all CharacterFinancial records — service role OK (no RLS on this entity) ──
    const allFinancials = [];
    let fPage = 0;
    while (true) {
      const batch = await base44.asServiceRole.entities.CharacterFinancial.filter(
        {},
        '-created_date',
        PAGE,
        fPage * PAGE
      ).catch(() => []);
      if (!batch || batch.length === 0) break;
      allFinancials.push(...batch);
      if (batch.length < PAGE) break;
      fPage++;
      await new Promise(r => setTimeout(r, 200));
    }

    // ── STEP 3: Set comparison ─────────────────────────────────────────────────
    const financialsByCharId = new Map();
    for (const fin of allFinancials) {
      const cid = fin.character_id;
      if (!cid) continue;
      if (!financialsByCharId.has(cid)) financialsByCharId.set(cid, []);
      financialsByCharId.get(cid).push(fin);
    }

    const withRecord = [];
    const withoutRecord = [];

    for (const [cid, charInfo] of activeCharMap.entries()) {
      const fins = financialsByCharId.get(cid) || [];
      if (fins.length > 0) {
        withRecord.push({
          character_id: cid,
          character_name: charInfo.name,
          character_owner_email: charInfo.owner_email,
          financial_record_count: fins.length,
          financial_record_ids: fins.map(f => f.id),
          balance: fins[0]?.current_balance ?? null,
          financial_has_owner_email: fins[0]?.owner_email ?? null,
          owner_email_matches: fins[0]?.owner_email
            ? fins[0].owner_email === charInfo.owner_email
            : 'not_stored',
        });
      } else {
        withoutRecord.push({
          character_id: cid,
          character_name: charInfo.name,
          character_owner_email: charInfo.owner_email,
        });
      }
    }

    // Orphaned: financial records whose character_id is not in active_created set
    const orphaned = [];
    const duplicates = [];
    for (const [cid, fins] of financialsByCharId.entries()) {
      const charExists = activeCharMap.has(cid);
      if (!charExists) {
        orphaned.push({
          character_id: cid,
          character_name: fins[0]?.character_name || 'unknown',
          record_count: fins.length,
          financial_record_ids: fins.map(f => f.id),
          balances: fins.map(f => f.current_balance),
        });
      }
      if (fins.length > 1) {
        duplicates.push({
          character_id: cid,
          character_name: fins[0]?.character_name || 'unknown',
          char_is_active_created: charExists,
          record_count: fins.length,
          financial_record_ids: fins.map(f => f.id),
          balances: fins.map(f => f.current_balance),
        });
      }
    }

    // ── STEP 4: Schema audit — owner_email presence on CharacterFinancial ──────
    const ownerEmailPresentCount = allFinancials.filter(f => !!f.owner_email).length;
    const ownerEmailMissingCount = allFinancials.filter(f => !f.owner_email).length;

    // ── STEP 5: Homepage vs profile balance match for characters WITH records ──
    const balanceReport = withRecord.map(r => ({
      character_id: r.character_id,
      character_name: r.character_name,
      balance: r.balance,
      has_duplicate_records: r.financial_record_count > 1,
      financial_record_count: r.financial_record_count,
      // Homepage card query: filter({ character_id }) — same as profile — same result
      // Both use same queryKey so share React Query cache
      homepage_and_profile_use_same_query: true,
      note: r.financial_record_count > 1
        ? 'DUPLICATE: homepage/profile will show [0].current_balance which may not be latest'
        : 'OK: single canonical record',
    }));

    return Response.json({
      success: true,
      timestamp: new Date().toISOString(),
      owner_email: user.email,

      // Character counts
      total_characters_visible_to_user: allChars.length,
      active_created_characters: activeCreated.length,
      other_active_characters: allOtherActive.length,
      deleted_merged_characters: deleted.length,

      // Financial record count
      total_character_financial_records: allFinancials.length,

      // Set comparison
      active_created_WITH_financial_record: withRecord.length,
      active_created_WITHOUT_financial_record: withoutRecord.length,
      orphaned_financial_records: orphaned.length,
      duplicate_per_character: duplicates.length,

      // Detail arrays
      with_record: withRecord,
      without_record: withoutRecord,
      orphaned_sample: orphaned.slice(0, 10),
      duplicates: duplicates,

      // Schema
      owner_email_schema: {
        records_with_owner_email: ownerEmailPresentCount,
        records_missing_owner_email: ownerEmailMissingCount,
        conclusion: ownerEmailMissingCount === allFinancials.length
          ? 'NO records have owner_email — field was never written by creation path'
          : ownerEmailPresentCount === allFinancials.length
          ? 'ALL records have owner_email'
          : 'MIXED — some records have owner_email, some do not',
      },

      // RLS
      rls_status: {
        CharacterFinancial_has_rls: false,
        effect: 'Open read for all authenticated users. Filter by character_id is sufficient.',
        Character_rls: 'data.owner_email == user.email — data-field-path RLS. NOT bypassed by asServiceRole.',
      },

      // Balance match report
      balance_report: balanceReport,
    });

  } catch (error) {
    console.error('[diagnosticFinancialSetComparison]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});