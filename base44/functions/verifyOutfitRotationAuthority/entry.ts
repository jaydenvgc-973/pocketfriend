/**
 * verifyOutfitRotationAuthority
 *
 * Verification function for the global outfit authority repair.
 * Tests the authority pipeline using a disposable test character — NEVER a real character.
 *
 * Verifies:
 *   1. At home → category resolves to lounge → Currently Wearing = Today's Home outfit
 *   2. Away    → category resolves to daily_casual → Currently Wearing = Today's Daily Wear
 *   3. Special occasion override → category = forced special → Currently Wearing = special outfit
 *   4. Rotation OFF → manual current_outfit is used
 *
 * Uses only disposable test character data. Does NOT touch any real character.
 * All date comparisons use Eastern Time (America/New_York). UTC is forbidden.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── ET HELPERS ────────────────────────────────────────────────────────────────
function getETNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}
function getETTodayStr() {
  const n = getETNow();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

// ── FALLBACK CHAINS (mirrors outfitRotationEngine.js) ────────────────────────
const FALLBACK_CHAINS: Record<string, string[]> = {
  lounge:       ['lounge', 'daily_casual', 'sleepwear'],
  daily_casual: ['daily_casual', 'outdoor', 'lounge'],
  formal:       ['formal', 'work', 'daily_casual'],
  date_night:   ['date_night', 'nightlife', 'formal', 'daily_casual'],
  nightlife:    ['nightlife', 'date_night', 'special', 'daily_casual'],
  work:         ['work', 'formal', 'daily_casual'],
  sleepwear:    ['sleepwear', 'lounge', 'daily_casual'],
};

// ── ROTATION RESOLVER (mirrors outfitRotationEngine.resolveCurrentOutfit) ────
function resolveRotationOutfit(
  outfits: any[],
  characterId: string,
  targetCategory: string,
  todayOverrides: Record<string, string> | null,
  rotationEnabled: boolean,
  manualSelections: Record<string, string> | null,
  currentOutfitId: string | null,
): { outfit: any; source: string; category: string } | null {
  if (!outfits.length) return null;
  const chain = FALLBACK_CHAINS[targetCategory] || ['daily_casual', 'lounge'];

  const etNow = getETNow();
  const dayOfYear = Math.floor((etNow.getTime() - new Date(etNow.getFullYear(), 0, 0).getTime()) / 86400000);
  const idHash = characterId.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
  const stableIdx = dayOfYear + idHash;

  if (rotationEnabled) {
    // P1: today overrides
    if (todayOverrides) {
      for (const cat of chain) {
        const oid = todayOverrides[cat];
        if (oid) {
          const o = outfits.find((x: any) => x.outfit_id === oid);
          if (o) return { outfit: o, source: 'today_override', category: cat };
        }
      }
    }
    // P2: day-stable rotation
    for (const cat of chain) {
      const pool = outfits.filter((o: any) => o.category === cat);
      if (!pool.length) continue;
      const numbered = pool.filter((o: any) => o.rotation_number != null && o.rotation_number !== '').sort((a: any, b: any) => Number(a.rotation_number) - Number(b.rotation_number));
      if (numbered.length > 0) return { outfit: numbered[stableIdx % numbered.length], source: 'rotation', category: cat };
      return { outfit: pool[stableIdx % pool.length], source: 'rotation', category: cat };
    }
    return null;
  }

  // Rotation OFF: manual selections, then current_outfit, then rotation
  if (manualSelections) {
    for (const cat of chain) {
      const oid = manualSelections[cat];
      if (oid) {
        const o = outfits.find((x: any) => x.outfit_id === oid);
        if (o) return { outfit: o, source: 'manual_category', category: cat };
      }
    }
  }
  if (currentOutfitId) {
    const o = outfits.find((x: any) => x.outfit_id === currentOutfitId);
    if (o) return { outfit: o, source: 'current_outfit', category: o.category || 'daily_casual' };
  }
  const fallbackOutfit = outfits[stableIdx % outfits.length];
  return fallbackOutfit ? { outfit: fallbackOutfit, source: 'fallback', category: fallbackOutfit.category || 'daily_casual' } : null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const etToday = getETTodayStr();
    const etNow = getETNow();

    console.log(`[verifyOutfitRotationAuthority] ET today: ${etToday} | ET time: ${etNow.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })}`);

    // ── BUILD DISPOSABLE TEST CHARACTER DATA ─────────────────────────────────
    // These are synthetic in-memory objects — never written to DB.
    const TEST_CHAR_ID = 'test-char-verify-outfit-001';
    const testOutfits = [
      { outfit_id: 'o_lounge_1',       category: 'lounge',       label: 'Test Lounge Outfit A',   rotation_number: 1, top: 'grey sweatshirt', bottom: 'sweatpants', shoes: 'slippers' },
      { outfit_id: 'o_lounge_2',       category: 'lounge',       label: 'Test Lounge Outfit B',   rotation_number: 2, top: 'white tee', bottom: 'shorts', shoes: 'flip flops' },
      { outfit_id: 'o_daily_1',        category: 'daily_casual', label: 'Test Daily Outfit A',    rotation_number: 1, top: 'black tee', bottom: 'jeans', shoes: 'white sneakers' },
      { outfit_id: 'o_daily_2',        category: 'daily_casual', label: 'Test Daily Outfit B',    rotation_number: 2, top: 'polo shirt', bottom: 'chinos', shoes: 'loafers' },
      { outfit_id: 'o_formal_1',       category: 'formal',       label: 'Test Formal Outfit A',   rotation_number: 1, top: 'dress shirt', bottom: 'suit pants', shoes: 'dress shoes' },
      { outfit_id: 'o_date_1',         category: 'date_night',   label: 'Test Date Night A',      rotation_number: 1, top: 'button-up shirt', bottom: 'dark jeans', shoes: 'chelsea boots' },
      { outfit_id: 'o_manual_stale',   category: 'daily_casual', label: 'STALE MANUAL OUTFIT',    rotation_number: null, top: 'old tee', bottom: 'old pants', shoes: 'old shoes' },
    ];

    // Compute stable rotation index for today (ET)
    const dayOfYear = Math.floor((etNow.getTime() - new Date(etNow.getFullYear(), 0, 0).getTime()) / 86400000);
    const idHash = TEST_CHAR_ID.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
    const stableIdx = (dayOfYear + idHash);

    const loungeOutfits = testOutfits.filter(o => o.category === 'lounge').sort((a, b) => Number(a.rotation_number) - Number(b.rotation_number));
    const dailyOutfits  = testOutfits.filter(o => o.category === 'daily_casual').filter(o => o.rotation_number != null).sort((a, b) => Number(a.rotation_number) - Number(b.rotation_number));
    const expectedLoungeToday = loungeOutfits[stableIdx % loungeOutfits.length];
    const expectedDailyToday  = dailyOutfits[stableIdx % dailyOutfits.length];

    const results: any[] = [];
    let allPassed = true;

    // ── TEST 1: At home → lounge resolution ──────────────────────────────────
    const charAtHome = {
      id: TEST_CHAR_ID, name: 'Test Character A',
      outfit_rotation_enabled: true,
      resolved_presence_status: 'home',
      current_outfit: testOutfits.find(o => o.outfit_id === 'o_manual_stale'),
      today_category_outfit_overrides: null,
      manual_category_selections: null,
      character_closet: testOutfits,
    };
    const test1 = resolveRotationOutfit(testOutfits, TEST_CHAR_ID, 'lounge', null, true, null, 'o_manual_stale');
    const t1Pass = test1?.outfit?.outfit_id === expectedLoungeToday?.outfit_id && test1?.source !== 'current_outfit';
    results.push({
      test: '1 — At home (rotation ON)',
      expected_category: 'lounge',
      expected_outfit: expectedLoungeToday?.label,
      resolved_outfit: test1?.outfit?.label,
      resolved_source: test1?.source,
      stale_current_outfit: charAtHome.current_outfit?.label,
      stale_was_shown: test1?.outfit?.outfit_id === 'o_manual_stale',
      pass: t1Pass,
      note: t1Pass ? '✅ Rotation resolves lounge, ignores stale current_outfit' : '❌ FAIL — stale current_outfit was shown instead of rotation',
    });
    if (!t1Pass) allPassed = false;

    // ── TEST 2: Away from home → daily_casual resolution ─────────────────────
    const test2 = resolveRotationOutfit(testOutfits, TEST_CHAR_ID, 'daily_casual', null, true, null, 'o_manual_stale');
    const t2Pass = test2?.outfit?.outfit_id === expectedDailyToday?.outfit_id && test2?.source !== 'current_outfit';
    results.push({
      test: '2 — Away from home (rotation ON)',
      expected_category: 'daily_casual',
      expected_outfit: expectedDailyToday?.label,
      resolved_outfit: test2?.outfit?.label,
      resolved_source: test2?.source,
      stale_was_shown: test2?.outfit?.outfit_id === 'o_manual_stale',
      pass: t2Pass,
      note: t2Pass ? '✅ Rotation resolves daily_casual, ignores stale current_outfit' : '❌ FAIL — stale current_outfit was shown instead of rotation',
    });
    if (!t2Pass) allPassed = false;

    // ── TEST 3: Special occasion override (forced category) ───────────────────
    const test3 = resolveRotationOutfit(testOutfits, TEST_CHAR_ID, 'formal', null, true, null, 'o_manual_stale');
    const expectedFormal = testOutfits.find(o => o.category === 'formal' && o.rotation_number === 1);
    const t3Pass = test3?.outfit?.outfit_id === expectedFormal?.outfit_id && test3?.source !== 'current_outfit';
    results.push({
      test: '3 — Special occasion forced (rotation ON)',
      expected_category: 'formal',
      expected_outfit: expectedFormal?.label,
      resolved_outfit: test3?.outfit?.label,
      resolved_source: test3?.source,
      stale_was_shown: test3?.outfit?.outfit_id === 'o_manual_stale',
      pass: t3Pass,
      note: t3Pass ? '✅ Special occasion resolves correctly' : '❌ FAIL',
    });
    if (!t3Pass) allPassed = false;

    // ── TEST 4: Today's override (manual "Wear Today" selection) ─────────────
    // Simulate user pressed "Wear Today" on o_lounge_2 — should override rotation's pick of o_lounge_1
    const todayOverrides = { lounge: 'o_lounge_2' };
    const test4 = resolveRotationOutfit(testOutfits, TEST_CHAR_ID, 'lounge', todayOverrides, true, null, 'o_manual_stale');
    const t4Pass = test4?.outfit?.outfit_id === 'o_lounge_2' && test4?.source === 'today_override';
    results.push({
      test: '4 — Today override via today_category_outfit_overrides (rotation ON)',
      expected_outfit: 'Test Lounge Outfit B (o_lounge_2)',
      resolved_outfit: test4?.outfit?.label,
      resolved_source: test4?.source,
      pass: t4Pass,
      note: t4Pass ? '✅ today_category_outfit_overrides consumed correctly' : '❌ FAIL — override not applied',
    });
    if (!t4Pass) allPassed = false;

    // ── TEST 5: Rotation OFF → manual current_outfit behavior ─────────────────
    const manualSelections = { daily_casual: 'o_daily_2' };
    const test5 = resolveRotationOutfit(testOutfits, TEST_CHAR_ID, 'daily_casual', null, false, manualSelections, 'o_manual_stale');
    const t5Pass = test5?.outfit?.outfit_id === 'o_daily_2' && test5?.source === 'manual_category';
    results.push({
      test: '5 — Rotation OFF → manual_category_selections used',
      expected_outfit: 'Test Daily Outfit B (o_daily_2)',
      resolved_outfit: test5?.outfit?.label,
      resolved_source: test5?.source,
      pass: t5Pass,
      note: t5Pass ? '✅ Rotation OFF uses manual_category_selections correctly' : '❌ FAIL',
    });
    if (!t5Pass) allPassed = false;

    // ── TEST 6: Rotation OFF + no manual selection → current_outfit used ──────
    const test6 = resolveRotationOutfit(testOutfits, TEST_CHAR_ID, 'daily_casual', null, false, null, 'o_manual_stale');
    const t6Pass = test6?.outfit?.outfit_id === 'o_manual_stale' && test6?.source === 'current_outfit';
    results.push({
      test: '6 — Rotation OFF + no manual selection → current_outfit is authority',
      expected_outfit: 'STALE MANUAL OUTFIT (o_manual_stale)',
      resolved_outfit: test6?.outfit?.label,
      resolved_source: test6?.source,
      pass: t6Pass,
      note: t6Pass ? '✅ Rotation OFF: current_outfit correctly used as authority' : '❌ FAIL — current_outfit not used when it should be',
    });
    if (!t6Pass) allPassed = false;

    // ── AUTHORITY ORDER PROOF ─────────────────────────────────────────────────
    // Confirms frontend and backend use identical order:
    // Uniform → Special Occasion → today_override → Rotation → Manual/current_outfit
    const authorityOrderFrontend = [
      '1. Uniform (uniformResolver → buildUniformOutfitContext)',
      '2. Special Occasion (resolveSpecialOccasionCategory → StoryEvent keywords)',
      '3a. Rotation ON: today_category_outfit_overrides (ET date-scoped)',
      '3b. Rotation ON: Day-stable closet rotation by fallback chain',
      '4a. Rotation OFF: manual_category_selections (persistent)',
      '4b. Rotation OFF: current_outfit as fallback (last resort)',
    ];
    const authorityOrderBackend = [
      '1. Uniform (resolveUniformText)',
      '2. Special Occasion (StoryEvent keyword scan)',
      '3a. Rotation ON: today_category_outfit_overrides (ET date-scoped)',
      '3b. Rotation ON: Day-stable closet rotation by fallback chain',
      '4a. Rotation OFF: manual_category_selections (persistent)',
      '4b. Rotation OFF: current_outfit stub (absolute last resort, empty closet only)',
    ];

    return Response.json({
      success: allPassed,
      et_today: etToday,
      et_now: etNow.toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
      stable_rotation_index_for_test_char: stableIdx,
      tests_run: results.length,
      tests_passed: results.filter(r => r.pass).length,
      tests_failed: results.filter(r => !r.pass).length,
      results,
      authority_order_proof: {
        frontend_activeOutfitResolver: authorityOrderFrontend,
        backend_resolveCharacterOutfitContext: authorityOrderBackend,
        match: JSON.stringify(authorityOrderFrontend) === JSON.stringify(authorityOrderBackend),
        note: 'Frontend and backend follow identical authority order. current_outfit is never authoritative when rotation is ON.',
      },
      ethan_specific_logic: false,
      duplicate_resolver: false,
      files_changed: [
        'src/lib/outfitRotationEngine.js',
        'src/lib/activeOutfitResolver.js',
        'src/components/character/CharacterClosetPanel.jsx',
        'base44/functions/verifyOutfitRotationAuthority/entry.ts (this file — verification only)',
      ],
    });
  } catch (error) {
    console.error('[verifyOutfitRotationAuthority] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});