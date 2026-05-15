/**
 * recordVenueSpending
 *
 * Records a real spending transaction when a character visits a restaurant, bar, or grocery store.
 *
 * IDEMPOTENCY: keyed on character_id + location_id + spending_date + category.
 * If a transaction already exists for that key today, it is a no-op.
 *
 * WORKING EXCEPTION: Does NOT charge if character is actively on shift at this location.
 * Being physically present at a workplace is NOT enough — shift must be active.
 *
 * Only updates CharacterFinancial.current_balance — never Character.current_balance.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Location category → spending bucket
const CATEGORY_MAP = {
  restaurant: 'restaurant',
  food: 'restaurant',
  cafe: 'restaurant',
  coffee: 'restaurant',
  bar: 'bar',
  lounge: 'bar',
  club: 'bar',
  nightclub: 'bar',
  grocery: 'grocery',
  market: 'grocery',
  supermarket: 'grocery',
};

// Spending ranges (min inclusive, max inclusive) in USD
const SPEND_RANGES = {
  restaurant: { min: 25, max: 50 },
  bar: { min: 0, max: 100 },
  grocery: { min: 50, max: 200 },
};

function randomInRange(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

// Detect if character is actively on a shift at this location.
// Uses worker_shifts map on the location record if available, falls back to
// character.work_start_time / work_end_time / work_days.
function isActivelyWorking(character, location, nowET) {
  const hour = nowET.getHours();
  const minute = nowET.getMinutes();
  const currentMinutes = hour * 60 + minute;
  const currentDay = nowET.getDay();

  function toMins(str) {
    if (!str) return null;
    const [h, m] = str.split(':').map(Number);
    return h * 60 + (m || 0);
  }

  function inWindow(cur, start, end) {
    if (start == null || end == null) return false;
    if (start <= end) return cur >= start && cur < end;
    return cur >= start || cur < end; // crosses midnight
  }

  // Layer 1: Location worker_shifts (most authoritative)
  if (location?.worker_shifts && character?.id) {
    const shift = location.worker_shifts[character.id];
    if (shift?.start && shift?.end) {
      if (shift.days?.length > 0 && !shift.days.includes(currentDay)) return false;
      return inWindow(currentMinutes, toMins(shift.start), toMins(shift.end));
    }
  }

  // Layer 2: Character's own stored schedule
  const { work_start_time, work_end_time, work_days } = character;
  if (!work_start_time || !work_end_time) return false;
  if (work_days?.length > 0 && !work_days.includes(currentDay)) return false;
  return inWindow(currentMinutes, toMins(work_start_time), toMins(work_end_time));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { character_id, location_id, location_name, location_category } = await req.json();

    if (!character_id || !location_id) {
      return Response.json({ error: 'character_id and location_id are required' }, { status: 400 });
    }

    // Normalize category to spending bucket
    const catKey = (location_category || '').toLowerCase().replace(/[^a-z]/g, '');
    const spendingBucket = CATEGORY_MAP[catKey] || null;

    if (!spendingBucket) {
      return Response.json({
        skipped: true,
        reason: `Location category "${location_category}" does not trigger venue spending`,
      });
    }

    const range = SPEND_RANGES[spendingBucket];

    // ── IDEMPOTENCY CHECK ────────────────────────────────────────────────────
    // Key: character_id + location_id + UTC date + bucket
    const nowUtc = new Date();
    const nowET = new Date(nowUtc.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dateStr = `${nowET.getFullYear()}-${String(nowET.getMonth() + 1).padStart(2, '0')}-${String(nowET.getDate()).padStart(2, '0')}`;
    const idempotencyKey = `venue_${spendingBucket}_${character_id}_${location_id}_${dateStr}`;

    // Check for existing transaction with this key today
    const existing = await base44.asServiceRole.entities.FinancialTransaction.filter(
      { character_id, description: idempotencyKey },
      null,
      1
    );
    if (existing.length > 0) {
      return Response.json({
        skipped: true,
        reason: 'Already charged for this venue visit today',
        idempotency_key: idempotencyKey,
        existing_transaction_id: existing[0].id,
      });
    }

    // ── LOAD CHARACTER & LOCATION ───────────────────────────────────────────
    let chars = [], locations = [];
    try {
      [chars, locations] = await Promise.all([
        base44.asServiceRole.entities.Character.filter({ id: character_id }, null, 1),
        location_id ? base44.asServiceRole.entities.LocationReference.filter({ id: location_id }, null, 1) : Promise.resolve([]),
      ]);
    } catch (loadErr) {
      return Response.json({ skipped: true, reason: `Character/location load failed: ${loadErr.message}` });
    }
    const character = chars[0];
    if (!character) return Response.json({ skipped: true, reason: 'Character not found' });

    // ── ACTIVE CREATED CHARACTER GUARD ──────────────────────────────────────
    const isActiveCreated =
      character.character_type === 'active_created_character' ||
      character.is_active_created_character === true ||
      character.is_active_character === true;
    if (!isActiveCreated) {
      return Response.json({
        skipped: true,
        reason: 'SIMULATED_ONLY_CHARACTER_TYPE',
        real_finance_enabled: false,
        character_name: character.name,
        character_type: character.character_type || 'unknown',
      });
    }

    const location = locations[0] || null;

    // ── ACTIVE WORKING CHECK ────────────────────────────────────────────────
    // Do NOT charge if character is actively on shift at this location.
    // Being present at a workplace location alone is NOT sufficient — shift must be active.
    const isWorkLocation =
      character.occupation_location_id === location_id ||
      (character.additional_occupation_locations || []).some(l => l.location_id === location_id);

    if (isWorkLocation) {
      const working = isActivelyWorking(character, location, nowET);
      if (working) {
        return Response.json({
          skipped: true,
          reason: 'Character is actively working at this location — no spending charged',
          character_name: character.name,
          location_name: location_name || location?.name,
          is_work_location: true,
          active_working: true,
        });
      }
    }

    // ── DETERMINE AMOUNT ───────────────────────────────────────────────────
    const amount = randomInRange(range.min, range.max);

    // Bar: skip if $0 rolled
    if (spendingBucket === 'bar' && amount === 0) {
      return Response.json({
        skipped: true,
        reason: 'Bar visit resulted in $0 spend (valid outcome)',
      });
    }

    // ── LOAD FINANCIAL RECORD ──────────────────────────────────────────────
    const finRecords = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { character_id }, null, 1
    );
    const financial = finRecords[0];

    if (!financial) {
      console.warn(`[recordVenueSpending] No CharacterFinancial record for ${character.name} (${character_id}) — skipping spend. Diagnostic: character should be initialized.`);
      return Response.json({
        skipped: true,
        reason: 'No CharacterFinancial record found — cannot deduct. Run initializeCharacterFinancials first.',
        character_id,
        character_name: character.name,
      });
    }

    const balanceBefore = typeof financial.current_balance === 'number' ? financial.current_balance : 0;
    const balanceAfter = Math.max(0, balanceBefore - amount);

    // ── WRITE TRANSACTION ──────────────────────────────────────────────────
    const txnTypeMap = {
      restaurant: 'bar_restaurant',
      bar: 'bar_restaurant',
      grocery: 'groceries',
    };
    const displayTitleMap = {
      restaurant: location_name || location?.name || 'Restaurant',
      bar: location_name || location?.name || 'Bar',
      grocery: location_name || location?.name || 'Grocery Store',
    };

    const humanTitle = displayTitleMap[spendingBucket];
    const txn = await base44.asServiceRole.entities.FinancialTransaction.create({
      character_id,
      character_name: character.name,
      sender_id: character_id,
      sender_type: 'character',
      sender_name: character.name,
      receiver_id: location_id,
      receiver_type: 'system',
      receiver_name: humanTitle,
      amount,
      direction: 'expense',
      transaction_type: txnTypeMap[spendingBucket],
      description: idempotencyKey,     // ← kept for dedup lookup (never shown to character)
      location_id,
      location_name: location_name || location?.name || humanTitle,  // ← shown to character
      balance_after: balanceAfter,
      timestamp: nowUtc.toISOString(),
    });

    // ── UPDATE CANONICAL BALANCE ───────────────────────────────────────────
    // ONLY updates CharacterFinancial.current_balance — never Character.current_balance
    await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
      current_balance: balanceAfter,
      total_expenses: (financial.total_expenses || 0) + amount,
      last_updated: nowUtc.toISOString(),
    });

    console.log(`[recordVenueSpending] ✓ ${character.name} spent $${amount} at ${displayTitleMap[spendingBucket]} (${spendingBucket}) | balance $${balanceBefore.toFixed(2)} → $${balanceAfter.toFixed(2)} | txn=${txn.id} | key=${idempotencyKey}`);

    return Response.json({
      success: true,
      character_id,
      character_name: character.name,
      spending_bucket: spendingBucket,
      amount,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      transaction_id: txn.id,
      location_name: displayTitleMap[spendingBucket],
      idempotency_key: idempotencyKey,
      is_work_location: isWorkLocation,
      active_working: false,
    });
  } catch (err) {
    console.error('[recordVenueSpending]', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});