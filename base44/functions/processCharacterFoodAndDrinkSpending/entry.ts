/**
 * processCharacterFoodAndDrinkSpending
 *
 * CONSEQUENCE-ONLY function. Called fire-and-forget after a verified travel arrival.
 * This function NEVER affects travel routing, movement, needs simulation, or character visibility.
 *
 * What it does:
 *   1. Guards: active_created_character only, must have CharacterFinancial record
 *   2. If arriving at home and home_food_value > 0 → consume inventory, no charge, return
 *   3. Classifies destination into a spending category based on location category + name
 *   4. Determines a realistic cost within per-visit cap
 *   5. Checks duplicate protection: same character + location + type within 15 minutes → skip
 *   6. Checks daily cap from FinancialTransaction records → skip if exceeded
 *   7. Checks balance → skip if insufficient
 *   8. Creates FinancialTransaction, updates CharacterFinancial.current_balance
 *   9. If grocery purchase → create or update HouseholdResource
 *
 * Rules:
 *   - NEVER modifies Character schema
 *   - NEVER modifies LocationReference schema
 *   - NEVER blocks or alters travel (called only after route_status="arrived" is already stamped)
 *   - All failures are non-fatal — logged but never thrown back to caller
 *   - Uses asServiceRole throughout (no user session in arrival pipeline)
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── SPENDING CATEGORY CLASSIFICATION ─────────────────────────────────────────

const FOOD_DRINK_KEYWORDS = [
  'restaurant', 'cafe', 'café', 'diner', 'bar', 'lounge', 'club', 'nightclub',
  'fast food', 'food truck', 'bakery', 'deli', 'bistro', 'tavern', 'pub',
  'grill', 'kitchen', 'eatery', 'steakhouse', 'sushi', 'pizza', 'burger',
  'taco', 'bbq', 'buffet', 'brunch', 'breakfast spot', 'food hall',
  'juice bar', 'smoothie', 'coffee', 'boba', 'tea house', 'snack',
];

const NIGHTLIFE_KEYWORDS = [
  'club', 'nightclub', 'lounge', 'bar', 'tavern', 'pub', 'cocktail',
  'nightlife', 'speakeasy', 'rooftop bar', 'wine bar', 'hookah',
];

const FAST_FOOD_KEYWORDS = [
  'fast food', 'food truck', 'bakery', 'deli', 'cafe', 'café',
  'coffee', 'boba', 'juice bar', 'smoothie', 'snack', 'diner',
];

const GROCERY_KEYWORDS = [
  'grocery', 'supermarket', 'market', 'whole foods', 'trader joe',
  'aldi', 'kroger', 'costco', 'walmart', 'target', 'convenience store',
  'bodega', 'food mart', 'mini mart', 'food market', 'fresh market',
];

/**
 * Returns spending category or null (null = not a chargeable food/drink location).
 *
 * gym is NOT eligible unless name/context includes food/drink keyword.
 * broad 'social' category alone is NOT eligible — must match name keywords.
 */
function classifyLocation(category, name) {
  const cat = (category || '').toLowerCase();
  const nm  = (name    || '').toLowerCase();

  // Grocery — check name first since category may be generic
  if (cat === 'grocery' || GROCERY_KEYWORDS.some(k => nm.includes(k))) {
    return 'grocery';
  }

  // food_drink category is always eligible — further classify by name
  if (cat === 'food_drink') {
    if (NIGHTLIFE_KEYWORDS.some(k => nm.includes(k))) return 'bar_nightlife';
    if (FAST_FOOD_KEYWORDS.some(k => nm.includes(k))) return 'fast_food';
    return 'restaurant';
  }

  // social category: only if name has explicit food/drink/nightlife keyword
  if (cat === 'social') {
    if (NIGHTLIFE_KEYWORDS.some(k => nm.includes(k))) return 'bar_nightlife';
    if (FOOD_DRINK_KEYWORDS.some(k => nm.includes(k))) return 'restaurant';
    return null; // broad social without food indicator — NOT eligible
  }

  // gym: only if name has food/drink keyword (smoothie bar, gym café, etc.)
  if (cat === 'gym') {
    if (FOOD_DRINK_KEYWORDS.some(k => nm.includes(k))) return 'fast_food';
    return null; // plain gym arrival — NOT eligible
  }

  // Name-based fallback for any other category
  if (GROCERY_KEYWORDS.some(k => nm.includes(k))) return 'grocery';
  if (NIGHTLIFE_KEYWORDS.some(k => nm.includes(k))) return 'bar_nightlife';
  if (FOOD_DRINK_KEYWORDS.some(k => nm.includes(k))) return 'restaurant';

  return null; // not a food/drink location
}

// ── PER-VISIT CAPS ────────────────────────────────────────────────────────────
const PER_VISIT_CAP = {
  fast_food:    30,
  restaurant:   60,
  bar_nightlife: 100, // covers bar ($75) through club/nightlife ($100) — randomized within
  grocery:      140,
};

// ── DAILY CHARGE LIMITS (max paid charges per day) ───────────────────────────
const DAILY_CHARGE_LIMIT = {
  fast_food:    2,
  restaurant:   1,
  bar_nightlife: 1,
  grocery:      1,
};

// ── TRANSACTION TYPE MAPPING ──────────────────────────────────────────────────
const TX_TYPE = {
  fast_food:    'bar_restaurant',
  restaurant:   'bar_restaurant',
  bar_nightlife: 'bar_restaurant',
  grocery:      'groceries',
};

// ── COST RANGES ───────────────────────────────────────────────────────────────
const COST_RANGE = {
  fast_food:    { min: 8,  max: 28 },
  restaurant:   { min: 18, max: 58 },
  bar_nightlife: { min: 20, max: 95 },
  grocery:      { min: 40, max: 135 },
};

function randomCost(category) {
  const { min, max } = COST_RANGE[category] || { min: 5, max: 20 };
  const cap = PER_VISIT_CAP[category] || max;
  const raw = min + Math.random() * (max - min);
  return Math.round(Math.min(raw, cap) * 100) / 100;
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const log = [];
  try {
    const base44 = createClientFromRequest(req);
    // No user session — runs in arrival pipeline via asServiceRole

    const body = await req.json().catch(() => ({}));
    const {
      character_id,
      owner_email,
      destination_location_id,
      destination_location_name,
      destination_category,
      home_location_id,
    } = body;

    if (!character_id || !owner_email || !destination_location_id) {
      return Response.json({ skipped: true, reason: 'missing_required_params', log });
    }

    const now    = new Date();
    const nowISO = now.toISOString();

    // ── GUARD 1: active_created_character only ────────────────────────────────
    const charArr = await base44.asServiceRole.entities.Character.filter(
      { id: character_id }, null, 1
    ).catch(() => []);
    const char = charArr[0];

    if (!char) {
      return Response.json({ skipped: true, reason: 'character_not_found', character_id, log });
    }
    if (char.character_type !== 'active_created_character') {
      return Response.json({ skipped: true, reason: 'not_active_created_character', character_type: char.character_type, log });
    }
    log.push(`char=${char.name} type=${char.character_type}`);

    // ── GUARD 2: CharacterFinancial must exist ────────────────────────────────
    const finArr = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { character_id }, null, 1
    ).catch(() => []);
    const financial = finArr[0];

    if (!financial) {
      log.push('no_financial_record — skipped');
      return Response.json({ skipped: true, reason: 'no_financial_record', log });
    }
    log.push(`balance=${financial.current_balance}`);

    // ── HOME FOOD CONSUMPTION ─────────────────────────────────────────────────
    // If arriving at home and household has food inventory → consume, no charge
    const isArrivingHome = home_location_id && destination_location_id === home_location_id;

    if (isArrivingHome) {
      const hrArr = await base44.asServiceRole.entities.HouseholdResource.filter(
        { owner_email, home_location_id, resource_type: 'food' }, null, 1
      ).catch(() => []);
      const hr = hrArr[0];

      if (hr && (hr.home_food_value || 0) > 0) {
        const consumed = Math.min(hr.home_food_value, 15); // consume up to $15 equivalent per meal
        const newFoodValue = Math.max(0, (hr.home_food_value || 0) - consumed);
        await base44.asServiceRole.entities.HouseholdResource.update(hr.id, {
          home_food_value: Math.round(newFoodValue * 100) / 100,
          last_consumed_at: nowISO,
        }).catch(e => log.push(`hr_consume_err: ${e.message}`));

        log.push(`home_food_consumed=$${consumed} remaining=$${newFoodValue}`);
        return Response.json({
          success: true,
          outcome: 'home_food_consumed',
          consumed,
          remaining_food_value: newFoodValue,
          character_name: char.name,
          log,
        });
      }

      // At home but no inventory — no charge for eating at home without food stocked
      log.push('at_home_no_inventory — no_charge');
      return Response.json({ skipped: true, reason: 'at_home_no_food_inventory', log });
    }

    // ── CLASSIFY LOCATION ─────────────────────────────────────────────────────
    const spendCategory = classifyLocation(destination_category, destination_location_name);

    if (!spendCategory) {
      log.push(`location_not_chargeable category=${destination_category} name=${destination_location_name}`);
      return Response.json({ skipped: true, reason: 'not_chargeable_location', log });
    }
    log.push(`spend_category=${spendCategory}`);

    // ── DUPLICATE PROTECTION: 15-minute window ────────────────────────────────
    const windowStart = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
    const recentTxArr = await base44.asServiceRole.entities.FinancialTransaction.filter(
      { character_id, location_id: destination_location_id, transaction_type: TX_TYPE[spendCategory] },
      '-timestamp',
      10
    ).catch(() => []);

    const isDuplicate = recentTxArr.some(t => t.timestamp && t.timestamp > windowStart);
    if (isDuplicate) {
      log.push(`duplicate_blocked — same location+type within 15min`);
      return Response.json({ skipped: true, reason: 'duplicate_within_15min', log });
    }

    // ── DAILY CAP CHECK: count today's charges for this category ─────────────
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayStartISO = todayStart.toISOString();

    const todayAllTxArr = await base44.asServiceRole.entities.FinancialTransaction.filter(
      { character_id, direction: 'expense', transaction_type: TX_TYPE[spendCategory] },
      '-timestamp',
      50
    ).catch(() => []);

    const todayTxs = todayAllTxArr.filter(t => t.timestamp && t.timestamp >= todayStartISO);
    const todayChargeCount = todayTxs.length;
    const todaySpend       = todayTxs.reduce((s, t) => s + (t.amount || 0), 0);

    const dailyChargeLimit = DAILY_CHARGE_LIMIT[spendCategory];
    if (todayChargeCount >= dailyChargeLimit) {
      log.push(`daily_charge_limit_blocked — ${todayChargeCount}/${dailyChargeLimit} charges today for ${spendCategory}`);
      return Response.json({ skipped: true, reason: 'daily_charge_limit_reached', todayChargeCount, dailyChargeLimit, log });
    }

    // ── DAILY SPEND CAP: 10% of balance, hard max $150 ───────────────────────
    const allTodayExpenseArr = await base44.asServiceRole.entities.FinancialTransaction.filter(
      { character_id, direction: 'expense' },
      '-timestamp',
      100
    ).catch(() => []);

    const foodDrinkTxTypes = new Set(['bar_restaurant', 'groceries']);
    const totalFoodDrinkToday = allTodayExpenseArr
      .filter(t => t.timestamp && t.timestamp >= todayStartISO && foodDrinkTxTypes.has(t.transaction_type))
      .reduce((s, t) => s + (t.amount || 0), 0);

    const balance       = financial.current_balance || 0;
    const dailySpendCap = Math.min(balance * 0.10, 150);

    if (totalFoodDrinkToday >= dailySpendCap) {
      log.push(`daily_spend_cap_blocked — spent=$${totalFoodDrinkToday} cap=$${dailySpendCap.toFixed(2)}`);
      return Response.json({ skipped: true, reason: 'daily_spend_cap_reached', totalFoodDrinkToday, dailySpendCap, log });
    }

    // ── DETERMINE AMOUNT ──────────────────────────────────────────────────────
    let amount = randomCost(spendCategory);

    // Clamp so daily spend cap is not exceeded
    const remaining = dailySpendCap - totalFoodDrinkToday;
    amount = Math.min(amount, remaining);
    amount = Math.round(amount * 100) / 100;

    if (amount <= 0) {
      log.push('amount_zero_after_clamp — skipped');
      return Response.json({ skipped: true, reason: 'amount_zero_after_cap_clamp', log });
    }

    // ── BALANCE CHECK ─────────────────────────────────────────────────────────
    if (balance < amount) {
      log.push(`insufficient_balance balance=$${balance} amount=$${amount}`);
      return Response.json({ skipped: true, reason: 'insufficient_balance', balance, amount, log });
    }

    // ── CREATE FinancialTransaction ───────────────────────────────────────────
    const newBalance = Math.round((balance - amount) * 100) / 100;

    const txDescription = {
      fast_food:    `Food/drink purchase at ${destination_location_name}`,
      restaurant:   `Meal at ${destination_location_name}`,
      bar_nightlife: `Bar/nightlife at ${destination_location_name}`,
      grocery:      `Grocery purchase at ${destination_location_name}`,
    }[spendCategory] || `Spending at ${destination_location_name}`;

    const tx = await base44.asServiceRole.entities.FinancialTransaction.create({
      character_id,
      character_name:   char.name,
      sender_id:        character_id,
      sender_type:      'character',
      sender_name:      char.name,
      receiver_type:    'system',
      receiver_name:    destination_location_name,
      amount,
      direction:        'expense',
      transaction_type: TX_TYPE[spendCategory],
      description:      txDescription,
      location_id:      destination_location_id,
      location_name:    destination_location_name,
      balance_after:    newBalance,
      timestamp:        nowISO,
    });

    log.push(`tx_created id=${tx.id} amount=$${amount}`);

    // ── UPDATE CharacterFinancial.current_balance ─────────────────────────────
    await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
      current_balance: newBalance,
      total_expenses:  Math.round(((financial.total_expenses || 0) + amount) * 100) / 100,
      last_updated:    nowISO,
    });

    log.push(`balance updated $${balance} → $${newBalance}`);

    // ── UPDATE HouseholdResource for grocery purchases ────────────────────────
    if (spendCategory === 'grocery' && home_location_id) {
      const hrArr2 = await base44.asServiceRole.entities.HouseholdResource.filter(
        { owner_email, home_location_id, resource_type: 'food' }, null, 1
      ).catch(() => []);
      const hr = hrArr2[0];

      const addedFoodValue = Math.round(amount * 2 * 100) / 100; // $1 spent ≈ $2 food value
      const groceryMeta = {
        last_grocery_purchase_at:              nowISO,
        last_grocery_purchase_character_id:    character_id,
        last_grocery_purchase_character_name:  char.name,
        last_grocery_purchase_transaction_id:  tx.id,
        grocery_source_location_id:            destination_location_id,
        grocery_source_location_name:          destination_location_name,
      };

      if (hr) {
        const newFoodValue = Math.round(((hr.home_food_value || 0) + addedFoodValue) * 100) / 100;
        await base44.asServiceRole.entities.HouseholdResource.update(hr.id, {
          home_food_value: newFoodValue,
          ...groceryMeta,
        }).catch(e => log.push(`hr_update_err: ${e.message}`));
        log.push(`HouseholdResource updated food_value=$${newFoodValue}`);
      } else {
        await base44.asServiceRole.entities.HouseholdResource.create({
          owner_email,
          home_location_id,
          resource_type:   'food',
          home_food_value: addedFoodValue,
          ...groceryMeta,
        }).catch(e => log.push(`hr_create_err: ${e.message}`));
        log.push(`HouseholdResource created food_value=$${addedFoodValue}`);
      }
    }

    console.log(
      `[processCharacterFoodAndDrinkSpending] ✓ char=${char.name}` +
      ` category=${spendCategory} amount=$${amount}` +
      ` location=${destination_location_name}` +
      ` balance=$${balance}→$${newBalance}`
    );

    return Response.json({
      success:        true,
      character_name: char.name,
      spend_category: spendCategory,
      amount,
      new_balance:    newBalance,
      transaction_id: tx.id,
      log,
    });

  } catch (error) {
    // NEVER throw — this is fire-and-forget
    console.error('[processCharacterFoodAndDrinkSpending] non-fatal error:', error.message);
    return Response.json({ skipped: true, reason: 'internal_error', error: error.message, log }, { status: 200 });
  }
});