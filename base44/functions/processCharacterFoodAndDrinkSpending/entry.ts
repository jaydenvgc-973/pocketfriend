/**
 * processCharacterFoodAndDrinkSpending
 *
 * CONSEQUENCE-ONLY function. Called fire-and-forget after a verified travel arrival.
 * NEVER affects travel routing, movement, needs simulation, or character visibility.
 *
 * Pipeline:
 *   1. Guards: active_created_character, owner_email+character_id scoped, CharacterFinancial must exist
 *   2. Home arrival + food-related reason → consume HouseholdResource.home_food_value, no charge
 *   3. Classify destination into spend category (bar_lounge | club_nightlife | restaurant | fast_food | grocery)
 *   4. Base cost randomized within category range
 *   5. Trait/quirk/emotional modifiers applied
 *   6. Clamp to per-visit cap and daily spend cap (10% balance, hard $150)
 *   7. Duplicate check: same owner+character+location+type within 15 minutes → skip
 *   8. Daily charge-count limit from FinancialTransaction → skip if exceeded
 *   9. Balance check → skip if insufficient
 *   10. Create FinancialTransaction (owner_email scoped), update CharacterFinancial
 *   11. Grocery → create/update HouseholdResource
 *
 * Daily cap note: uses current_balance at time of call (shrinks slightly through the day
 * as earlier charges reduce balance). This is intentional — spending power reduces as
 * the character spends. Hard cap of $150 prevents compounding.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── LOCATION CLASSIFICATION ───────────────────────────────────────────────────

const CLUB_NIGHTLIFE_KEYWORDS = [
  'nightclub', 'club', 'nightlife', 'speakeasy', 'hookah', 'bottle service',
  'dance club', 'after hours', 'rave', 'ultra', 'drais', 'liv ',
];

const BAR_LOUNGE_KEYWORDS = [
  'bar', 'lounge', 'tavern', 'pub', 'cocktail', 'rooftop bar', 'wine bar',
  'sports bar', 'dive bar', 'irish pub', 'brewery', 'taproom', 'beer garden',
];

const FAST_FOOD_KEYWORDS = [
  'fast food', 'food truck', 'bakery', 'deli', 'cafe', 'café', 'coffee',
  'boba', 'juice bar', 'smoothie', 'snack bar', 'diner', 'donut',
  'sandwich', 'sub shop', 'wing stop', 'chick-fil', 'mcdonald', 'wendy',
  'burger king', 'taco bell', 'chipotle', 'subway', 'panera', 'wingstop',
  'five guys', 'in-n-out', 'shake shack', 'starbucks', 'dunkin',
];

const FOOD_DRINK_KEYWORDS = [
  ...FAST_FOOD_KEYWORDS,
  'restaurant', 'bistro', 'grill', 'kitchen', 'eatery', 'steakhouse',
  'sushi', 'pizza', 'burger', 'taco', 'bbq', 'buffet', 'brunch',
  'breakfast spot', 'food hall', 'tea house', 'dining',
];

const GROCERY_KEYWORDS = [
  'grocery', 'supermarket', 'market', 'whole foods', 'trader joe',
  'aldi', 'kroger', 'costco', 'walmart', 'target grocery', 'convenience store',
  'bodega', 'food mart', 'mini mart', 'food market', 'fresh market',
  'safeway', 'publix', 'heb', 'meijer', 'stop & shop', 'shoprite',
];

/**
 * Returns one of: 'bar_lounge' | 'club_nightlife' | 'restaurant' | 'fast_food' | 'grocery' | null
 * null = not a chargeable food/drink location.
 *
 * Separation of bar_lounge vs club_nightlife is required for correct cap application.
 * gym is NOT eligible unless name contains a food/drink keyword.
 * broad 'social' category alone is NOT eligible.
 */
function classifyLocation(category, name) {
  const cat = (category || '').toLowerCase();
  const nm  = (name    || '').toLowerCase();

  // Grocery first — specific enough to check before anything else
  if (cat === 'grocery' || GROCERY_KEYWORDS.some(k => nm.includes(k))) return 'grocery';

  // food_drink category — classify into sub-type by name
  if (cat === 'food_drink') {
    if (CLUB_NIGHTLIFE_KEYWORDS.some(k => nm.includes(k))) return 'club_nightlife';
    if (BAR_LOUNGE_KEYWORDS.some(k => nm.includes(k)))     return 'bar_lounge';
    if (FAST_FOOD_KEYWORDS.some(k => nm.includes(k)))      return 'fast_food';
    return 'restaurant';
  }

  // social: only eligible if name has a specific food/drink/nightlife indicator
  if (cat === 'social') {
    if (CLUB_NIGHTLIFE_KEYWORDS.some(k => nm.includes(k))) return 'club_nightlife';
    if (BAR_LOUNGE_KEYWORDS.some(k => nm.includes(k)))     return 'bar_lounge';
    if (FOOD_DRINK_KEYWORDS.some(k => nm.includes(k)))     return 'restaurant';
    return null; // generic social with no food indicator — NOT eligible
  }

  // gym: only if name has explicit food/drink word (smoothie bar, gym café, etc.)
  if (cat === 'gym') {
    if (FOOD_DRINK_KEYWORDS.some(k => nm.includes(k))) return 'fast_food';
    return null;
  }

  // Name-based fallback for any other category
  if (GROCERY_KEYWORDS.some(k => nm.includes(k)))          return 'grocery';
  if (CLUB_NIGHTLIFE_KEYWORDS.some(k => nm.includes(k)))   return 'club_nightlife';
  if (BAR_LOUNGE_KEYWORDS.some(k => nm.includes(k)))       return 'bar_lounge';
  if (FOOD_DRINK_KEYWORDS.some(k => nm.includes(k)))       return 'restaurant';

  return null;
}

// ── PER-VISIT HARD CAPS ───────────────────────────────────────────────────────
const PER_VISIT_CAP = {
  fast_food:      30,
  restaurant:     60,
  bar_lounge:     75,
  club_nightlife: 100,
  grocery:        140,
};

// ── DAILY CHARGE COUNT LIMITS ─────────────────────────────────────────────────
const DAILY_CHARGE_LIMIT = {
  fast_food:      2,
  restaurant:     1,
  bar_lounge:     1,
  club_nightlife: 1,
  grocery:        1,
};

// ── TRANSACTION TYPE (maps to FinancialTransaction.transaction_type enum) ─────
const TX_TYPE = {
  fast_food:      'bar_restaurant',
  restaurant:     'bar_restaurant',
  bar_lounge:     'bar_restaurant',
  club_nightlife: 'bar_restaurant',
  grocery:        'groceries',
};

// ── BASE COST RANGES (before trait modifiers) ─────────────────────────────────
const COST_RANGE = {
  fast_food:      { min: 8,  max: 18  },
  restaurant:     { min: 18, max: 55  },
  bar_lounge:     { min: 20, max: 70  },
  club_nightlife: { min: 30, max: 95  },
  grocery:        { min: 40, max: 130 },
};

function baseCost(category) {
  const { min, max } = COST_RANGE[category] || { min: 5, max: 20 };
  return min + Math.random() * (max - min);
}

// ── QUIRK TEXT EXTRACTOR ──────────────────────────────────────────────────────
// quirks[] items may be strings OR objects with various shapes.
// Safely extract text from all known shapes.
function extractQuirkText(q) {
  if (!q) return '';
  if (typeof q === 'string') return q.toLowerCase();
  // object: try every known label field
  const text = [q.name, q.label, q.title, q.description, q.value, q.type]
    .filter(Boolean)
    .join(' ');
  return text.toLowerCase();
}

// ── TRAIT / QUIRK / EMOTIONAL MODIFIER ───────────────────────────────────────
/**
 * Returns a multiplier (e.g. 1.0 = no change, 1.35 = 35% more, 0.65 = 35% less).
 *
 * Sources read (in order of priority):
 *   1. Boolean trait_* fields that actually exist on the Character schema
 *   2. personality_traits[] string array
 *   3. quirks[] — supports string or object with name/label/title/description/value/type
 *   4. emotional_state string
 *   5. financial_need_value number
 *
 * Fields that do NOT exist on Character schema and are NOT used:
 *   trait_frugal, trait_stress_eater, trait_impulsive_spender, trait_drinker,
 *   trait_financially_anxious, trait_disciplined, trait_workaholic (unless present)
 *
 * Modifiers stack multiplicatively. Final range: 0.4x – 2.0x.
 */
function computeTraitModifier(char, spendCategory) {
  let multiplier = 1.0;
  const logs = [];

  // Build unified lower-case text blob from personality_traits[] and quirks[]
  const traits   = (char.personality_traits || []).map(t => (t || '').toLowerCase());
  const quirkTxt = (char.quirks || []).map(extractQuirkText);
  const allText  = [...traits, ...quirkTxt].join(' ');
  const emotional = (char.emotional_state || '').toLowerCase();
  const isNightlifeSpend = spendCategory === 'bar_lounge' || spendCategory === 'club_nightlife';
  const isFoodSpend      = spendCategory === 'restaurant' || spendCategory === 'fast_food';

  // ── HIGHER SPENDING — boolean fields (confirmed schema fields) ────────────
  if (char.trait_bougie) {
    multiplier *= 1.35;
    logs.push('trait_bougie +35%');
  }
  if (char.trait_risk_taker) {
    multiplier *= 1.15;
    logs.push('trait_risk_taker +15%');
  }
  if (char.trait_uninhibited) {
    multiplier *= 1.20;
    logs.push('trait_uninhibited +20%');
  }
  if (char.trait_insatiable) {
    multiplier *= 1.20;
    logs.push('trait_insatiable +20%');
  }
  if (char.trait_volatile && (isNightlifeSpend || isFoodSpend)) {
    multiplier *= 1.15;
    logs.push('trait_volatile at food/nightlife +15%');
  }
  if (char.trait_wishy_washy) {
    // Wishy-washy: more likely to spend impulsively
    multiplier *= 1.10;
    logs.push('trait_wishy_washy +10%');
  }
  if (char.trait_hot_and_cold) {
    multiplier *= 1.10;
    logs.push('trait_hot_and_cold +10%');
  }
  if (char.trait_ruffian && isNightlifeSpend) {
    multiplier *= 1.20;
    logs.push('trait_ruffian at nightlife +20%');
  }
  if (char.trait_philanderer && isNightlifeSpend) {
    multiplier *= 1.25;
    logs.push('trait_philanderer at nightlife +25%');
  }
  if (char.trait_goon && isNightlifeSpend) {
    multiplier *= 1.15;
    logs.push('trait_goon at nightlife +15%');
  }

  // Night owl — boolean field confirmed in schema
  if (char.trait_night_owl && isNightlifeSpend) {
    multiplier *= 1.15;
    logs.push('trait_night_owl at nightlife +15%');
  }

  // ── HIGHER SPENDING — from text (personality_traits / quirks) ────────────
  if (allText.includes('impulsive') || allText.includes('impulsive spender')) {
    multiplier *= 1.25;
    logs.push('text:impulsive_spender +25%');
  }
  if (allText.includes('retail therapy') || allText.includes('shopaholic')) {
    multiplier *= 1.20;
    logs.push('text:retail_therapy/shopaholic +20%');
  }
  if (allText.includes('luxury') || allText.includes('bougie') || allText.includes('high-end')) {
    multiplier *= 1.20;
    logs.push('text:luxury_oriented +20%');
  }
  if (allText.includes('splurge') || allText.includes('thrill seeker') || allText.includes('always outside')) {
    multiplier *= 1.15;
    logs.push('text:splurge/thrill_seeker +15%');
  }
  if (allText.includes('drinker') || allText.includes('heavy drinker') || allText.includes('social smoker')) {
    if (isNightlifeSpend) {
      multiplier *= 1.30;
      logs.push('text:drinker at bar/club +30%');
    }
  }
  if (allText.includes('stress eater') || allText.includes('emotional eater') || allText.includes('comfort eating')) {
    if (emotional.includes('stress') || emotional.includes('anxi') || emotional.includes('depress') || emotional.includes('sad') || emotional.includes('overwhelm')) {
      multiplier *= 1.20;
      logs.push('text:stress_eater + stressed_state +20%');
    }
  }
  if (allText.includes('foodie') || allText.includes('food lover') || allText.includes('food enthusiast')) {
    if (isFoodSpend) {
      multiplier *= 1.15;
      logs.push('text:foodie at food +15%');
    }
  }
  if (allText.includes('night owl') && isNightlifeSpend) {
    multiplier *= 1.10;
    logs.push('text:night_owl at nightlife +10%');
  }
  if (allText.includes('people pleaser') || allText.includes('jealous')) {
    multiplier *= 1.10;
    logs.push('text:people_pleaser/jealous +10%');
  }

  // ── RESTRAINED SPENDING — boolean fields (confirmed schema fields) ─────────
  if (char.trait_conscientious) {
    multiplier *= 0.75;
    logs.push('trait_conscientious -25%');
  }
  if (char.trait_goody_two_shoes) {
    multiplier *= 0.80;
    logs.push('trait_goody_two_shoes -20%');
  }
  if (char.trait_law_abiding) {
    multiplier *= 0.85;
    logs.push('trait_law_abiding -15%');
  }
  if (char.trait_loyal && !isNightlifeSpend) {
    // Loyal + non-nightlife → steady, un-flashy spending
    multiplier *= 0.90;
    logs.push('trait_loyal (non-nightlife) -10%');
  }
  if (char.trait_parental) {
    multiplier *= 0.80;
    logs.push('trait_parental -20%');
  }

  // ── RESTRAINED SPENDING — from text ──────────────────────────────────────
  if (allText.includes('frugal') || allText.includes('financially anxious') || allText.includes('budget conscious')) {
    multiplier *= 0.65;
    logs.push('text:frugal/financially_anxious -35%');
  }
  if (allText.includes('disciplined') || allText.includes('financially disciplined')) {
    multiplier *= 0.75;
    logs.push('text:disciplined -25%');
  }
  if (allText.includes('homebody') && spendCategory !== 'grocery') {
    multiplier *= 0.80;
    logs.push('text:homebody (non-grocery) -20%');
  }
  if (allText.includes('health obsessed') || allText.includes('health conscious')) {
    multiplier *= 0.80;
    logs.push('text:health_obsessed -20%');
  }
  if (allText.includes('workaholic')) {
    multiplier *= 0.85;
    logs.push('text:workaholic -15%');
  }

  // ── FINANCIAL NEED VALUE — depresses spending when low ───────────────────
  if (char.financial_need_value !== undefined && char.financial_need_value < 20) {
    multiplier *= 0.55;
    logs.push(`financial_need critical (${char.financial_need_value}) -45%`);
  } else if (char.financial_need_value !== undefined && char.financial_need_value < 40) {
    multiplier *= 0.75;
    logs.push(`financial_need low (${char.financial_need_value}) -25%`);
  }

  // ── EMOTIONAL STATE modifiers ─────────────────────────────────────────────
  if (emotional.includes('grief') || emotional.includes('heartbroken') || emotional.includes('devastated') || emotional.includes('loss')) {
    multiplier *= 1.20;
    logs.push('emotional:grief/heartbroken +20%');
  }
  if (emotional.includes('celebrat') || emotional.includes('ecstat') || emotional.includes('euphoric') || emotional.includes('excit')) {
    multiplier *= 1.25;
    logs.push('emotional:celebratory +25%');
  }
  if (emotional.includes('angry') || emotional.includes('furious') || emotional.includes('rage')) {
    multiplier *= 1.15;
    logs.push('emotional:angry +15%');
  }
  if (emotional.includes('bored') || allText.includes('overthinks') || allText.includes('romanticize')) {
    multiplier *= 1.10;
    logs.push('emotional:bored/overthinks +10%');
  }

  // Clamp final multiplier: min 0.4x, max 2.0x
  multiplier = Math.max(0.4, Math.min(2.0, multiplier));

  return { multiplier, modifierLogs: logs };
}

// ── CONTEXT FIELD BUILDER ─────────────────────────────────────────────────────
// Combines all arrival context fields into one lower-case string for keyword matching.
function buildContextText(body) {
  return [
    body.arrival_reason       || '',
    body.travel_reason        || '',
    body.presence_reason      || '',
    body.source_of_move       || '',
    body.current_activity     || '',
    body.resolved_source_reason || '',
    body.need_type            || '',
    body.destination_location_name || '',
  ].map(v => (v || '').toLowerCase()).join(' ');
}

// ── HOME FOOD ARRIVAL GUARD ───────────────────────────────────────────────────
// Home food is only consumed when context signals actual eating/food need.
// Arriving home from work does NOT auto-consume inventory.
const HOME_FOOD_KEYWORDS = [
  'hunger', 'hungry', 'eat', 'eating', 'food', 'meal', 'snack', 'lunch',
  'dinner', 'breakfast', 'fridge', 'cook', 'cooking', 'groceries', 'need',
  'fulfillment', 'starving', 'comfort food',
];

function isHomeFoodRelatedArrival(body) {
  const ctx = buildContextText(body);
  return HOME_FOOD_KEYWORDS.some(k => ctx.includes(k));
}

// ── OUTSIDE PURCHASE CONTEXT GUARD ───────────────────────────────────────────
/**
 * A character can arrive at a café, bar, restaurant, or grocery store for
 * non-food reasons (meeting someone, working there, passing through, social visit).
 *
 * Before charging, BOTH conditions must be true:
 *   1. eligible location type (already checked via classifyLocation)
 *   2. context indicates food/drink/nightlife/grocery intent
 *
 * If context is absent or not food-related → skip charge, return false.
 * Does NOT stop travel, movement, location history, or route status.
 */

const FOOD_CONTEXT_KEYWORDS = [
  'hunger', 'hungry', 'food', 'meal', 'snack', 'drink', 'drinks', 'thirst',
  'coffee', 'breakfast', 'lunch', 'dinner', 'eating', 'eat', 'bite',
  'comfort food', 'food run', 'social eating', 'emotional eating', 'stress eating',
  'need fulfillment', 'starving',
];

const NIGHTLIFE_CONTEXT_KEYWORDS = [
  'bar', 'nightlife', 'drinks', 'lounge', 'club', 'social drinking', 'partying',
  'party', 'night out', 'going out', 'after hours', 'nightclub',
];

const GROCERY_CONTEXT_KEYWORDS = [
  'grocery', 'groceries', 'food', 'household', 'pantry', 'errand',
  'food run', 'restock', 'shopping', 'supplies',
];

function isChargeableFoodDrinkContext(body, spendCategory) {
  const ctx = buildContextText(body);

  if (spendCategory === 'grocery') {
    return GROCERY_CONTEXT_KEYWORDS.some(k => ctx.includes(k));
  }
  if (spendCategory === 'bar_lounge' || spendCategory === 'club_nightlife') {
    return (
      NIGHTLIFE_CONTEXT_KEYWORDS.some(k => ctx.includes(k)) ||
      FOOD_CONTEXT_KEYWORDS.some(k => ctx.includes(k))
    );
  }
  // restaurant / fast_food
  return FOOD_CONTEXT_KEYWORDS.some(k => ctx.includes(k));
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const log = [];
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const {
      character_id,
      owner_email,
      destination_location_id,
      destination_location_name,
      destination_category,
      home_location_id,
      // context fields for food-reason detection
      arrival_reason,
      presence_reason,
      source_of_move,
      current_activity,
      resolved_source_reason,
      travel_reason,
      need_type,
    } = body;

    if (!character_id || !owner_email || !destination_location_id) {
      return Response.json({ skipped: true, reason: 'missing_required_params', log });
    }

    const now    = new Date();
    const nowISO = now.toISOString();

    // ── GUARD 1: active_created_character — owner_email + id scoped ───────────
    const charArr = await base44.asServiceRole.entities.Character.filter(
      { owner_email, id: character_id }, null, 1
    ).catch(() => []);
    const char = charArr[0];

    if (!char) {
      return Response.json({ skipped: true, reason: 'character_not_found', character_id, owner_email, log });
    }
    if (char.character_type !== 'active_created_character') {
      return Response.json({ skipped: true, reason: 'not_active_created_character', character_type: char.character_type, log });
    }
    log.push(`char=${char.name} type=${char.character_type}`);

    // ── GUARD 2: CharacterFinancial — owner_email + character_id scoped ───────
    const finArr = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { owner_email, character_id }, null, 1
    ).catch(() => []);
    const financial = finArr[0];

    if (!financial) {
      log.push('no_financial_record — skipped');
      return Response.json({ skipped: true, reason: 'no_financial_record', log });
    }
    const balance = financial.current_balance || 0;
    log.push(`balance=$${balance}`);

    // ── HOME FOOD CONSUMPTION ─────────────────────────────────────────────────
    // Only consume if: arriving home AND the arrival reason is food-related.
    // A character returning from work does NOT auto-consume food every arrival.
    const isArrivingHome = home_location_id && destination_location_id === home_location_id;

    if (isArrivingHome) {
      const isFoodRelated = isHomeFoodRelatedArrival(body);
      if (!isFoodRelated) {
        log.push('at_home_non_food_arrival — no_consumption_no_charge');
        return Response.json({ skipped: true, reason: 'home_arrival_not_food_related', log });
      }

      const hrArr = await base44.asServiceRole.entities.HouseholdResource.filter(
        { owner_email, home_location_id, resource_type: 'food' }, null, 1
      ).catch(() => []);
      const hr = hrArr[0];

      if (hr && (hr.home_food_value || 0) > 0) {
        const consumed    = Math.min(hr.home_food_value, 15);
        const newFoodVal  = Math.max(0, Math.round(((hr.home_food_value || 0) - consumed) * 100) / 100);
        await base44.asServiceRole.entities.HouseholdResource.update(hr.id, {
          home_food_value:  newFoodVal,
          last_consumed_at: nowISO,
        }).catch(e => log.push(`hr_consume_err: ${e.message}`));
        log.push(`home_food_consumed=$${consumed} remaining=$${newFoodVal}`);
        return Response.json({ success: true, outcome: 'home_food_consumed', consumed, remaining_food_value: newFoodVal, log });
      }

      log.push('at_home_food_related_but_no_inventory — no_charge');
      return Response.json({ skipped: true, reason: 'home_no_food_inventory', log });
    }

    // ── CLASSIFY DESTINATION ──────────────────────────────────────────────────
    const spendCategory = classifyLocation(destination_category, destination_location_name);
    if (!spendCategory) {
      log.push(`not_chargeable cat=${destination_category} name=${destination_location_name}`);
      return Response.json({ skipped: true, reason: 'not_chargeable_location', log });
    }
    log.push(`spend_category=${spendCategory}`);

    // ── OUTSIDE PURCHASE CONTEXT GUARD ───────────────────────────────────────
    // Location is eligible, but context must also be food/drink/nightlife/grocery related.
    // A character meeting someone at a café, working at a bar, or passing through a
    // restaurant for non-food reasons does NOT get charged.
    // This guard does NOT affect movement, travel, route_status, or location history.
    if (!isChargeableFoodDrinkContext(body, spendCategory)) {
      log.push(`context_not_food_related — location eligible but arrival context is not food/drink/nightlife. No charge.`);
      return Response.json({ skipped: true, reason: 'location_eligible_but_context_not_food_related', spend_category: spendCategory, log });
    }
    log.push('context_confirmed_food_drink_related');

    // ── DUPLICATE PROTECTION: 15-minute window (owner_email scoped) ──────────
    const windowStart = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
    const recentTxArr = await base44.asServiceRole.entities.FinancialTransaction.filter(
      { owner_email, character_id, location_id: destination_location_id, transaction_type: TX_TYPE[spendCategory] },
      '-timestamp', 10
    ).catch(() => []);

    const isDuplicate = recentTxArr.some(t => t.timestamp && t.timestamp > windowStart);
    if (isDuplicate) {
      log.push('duplicate_blocked — same owner+char+location+type within 15min');
      return Response.json({ skipped: true, reason: 'duplicate_within_15min', log });
    }

    // ── DAILY CHARGE-COUNT CHECK (owner_email scoped) ─────────────────────────
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayStartISO = todayStart.toISOString();

    const todayCategoryTxArr = await base44.asServiceRole.entities.FinancialTransaction.filter(
      { owner_email, character_id, direction: 'expense', transaction_type: TX_TYPE[spendCategory] },
      '-timestamp', 50
    ).catch(() => []);

    const todayCategoryTxs     = todayCategoryTxArr.filter(t => t.timestamp && t.timestamp >= todayStartISO);
    const todayChargeCount     = todayCategoryTxs.length;
    const dailyChargeLimit     = DAILY_CHARGE_LIMIT[spendCategory];

    if (todayChargeCount >= dailyChargeLimit) {
      log.push(`daily_charge_limit_blocked — ${todayChargeCount}/${dailyChargeLimit} for ${spendCategory}`);
      return Response.json({ skipped: true, reason: 'daily_charge_limit_reached', todayChargeCount, dailyChargeLimit, log });
    }

    // ── DAILY SPEND CAP: 10% of current balance, hard max $150 (owner_email scoped) ──
    const allTodayExpArr = await base44.asServiceRole.entities.FinancialTransaction.filter(
      { owner_email, character_id, direction: 'expense' },
      '-timestamp', 100
    ).catch(() => []);

    const foodDrinkTypes = new Set(['bar_restaurant', 'groceries']);
    const totalFoodDrinkToday = allTodayExpArr
      .filter(t => t.timestamp && t.timestamp >= todayStartISO && foodDrinkTypes.has(t.transaction_type))
      .reduce((s, t) => s + (t.amount || 0), 0);

    // Note: dailySpendCap uses current balance (post any earlier charges today).
    // This is intentional — spending power shrinks through the day.
    // Hard cap of $150 prevents compounding on large balances.
    const dailySpendCap = Math.min(balance * 0.10, 150);

    if (totalFoodDrinkToday >= dailySpendCap) {
      log.push(`daily_spend_cap_blocked — spent=$${totalFoodDrinkToday.toFixed(2)} cap=$${dailySpendCap.toFixed(2)}`);
      return Response.json({ skipped: true, reason: 'daily_spend_cap_reached', totalFoodDrinkToday, dailySpendCap, log });
    }

    // ── COMPUTE AMOUNT: base cost + trait modifiers + caps ────────────────────
    const raw = baseCost(spendCategory);
    const { multiplier, modifierLogs } = computeTraitModifier(char, spendCategory);
    const modified = raw * multiplier;
    log.push(...modifierLogs.map(m => `modifier: ${m}`));
    log.push(`base=$${raw.toFixed(2)} multiplier=${multiplier.toFixed(2)} modified=$${modified.toFixed(2)}`);

    // Apply per-visit cap
    const visitCapped = Math.min(modified, PER_VISIT_CAP[spendCategory]);
    // Clamp so daily spend cap is not exceeded
    const remaining = dailySpendCap - totalFoodDrinkToday;
    let amount = Math.min(visitCapped, remaining);
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

    // ── CREATE FinancialTransaction (owner_email scoped) ──────────────────────
    const newBalance = Math.round((balance - amount) * 100) / 100;

    const txDescription = {
      fast_food:      `Food/drink at ${destination_location_name}`,
      restaurant:     `Meal at ${destination_location_name}`,
      bar_lounge:     `Bar/drinks at ${destination_location_name}`,
      club_nightlife: `Nightlife at ${destination_location_name}`,
      grocery:        `Grocery purchase at ${destination_location_name}`,
    }[spendCategory] || `Spending at ${destination_location_name}`;

    const tx = await base44.asServiceRole.entities.FinancialTransaction.create({
      owner_email,
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

    log.push(`balance $${balance} → $${newBalance}`);

    // ── GROCERY: create or update HouseholdResource ───────────────────────────
    if (spendCategory === 'grocery' && home_location_id) {
      const hrArr2 = await base44.asServiceRole.entities.HouseholdResource.filter(
        { owner_email, home_location_id, resource_type: 'food' }, null, 1
      ).catch(() => []);
      const hr = hrArr2[0];

      const addedFoodValue = Math.round(amount * 2 * 100) / 100; // $1 spent ≈ $2 food value
      const groceryMeta = {
        last_grocery_purchase_at:             nowISO,
        last_grocery_purchase_character_id:   character_id,
        last_grocery_purchase_character_name: char.name,
        last_grocery_purchase_transaction_id: tx.id,
        grocery_source_location_id:           destination_location_id,
        grocery_source_location_name:         destination_location_name,
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
      `[processCharacterFoodAndDrinkSpending] ✓` +
      ` char=${char.name} owner=${owner_email}` +
      ` category=${spendCategory} amount=$${amount}` +
      ` multiplier=${multiplier.toFixed(2)}` +
      ` location=${destination_location_name}` +
      ` balance=$${balance}→$${newBalance}`
    );

    return Response.json({
      success:        true,
      character_name: char.name,
      spend_category: spendCategory,
      amount,
      multiplier,
      modifier_logs:  modifierLogs,
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