import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * processLocationOperatingCosts
 *
 * Charges business/commercial location OWNERS for their monthly operating costs:
 *   total = base operating_cost (rent/lease/overhead) + utilities + staff payroll estimate
 *
 * THIS FUNCTION:
 *   - Handles BUSINESS/COMMERCIAL locations only.
 *   - Does NOT handle residential rent (that is processHousingCosts).
 *   - Does NOT pay workers (that is processPayroll).
 *   - Does NOT touch user balance — business no-owner cases are skipped entirely.
 *
 * Owner rules:
 *   - owner_character_id exists and owner_is_npc=false → charge that character
 *   - owner_is_npc=true → skip + log (NPC finances not supported)
 *   - No owner → skip + log as "skipped_no_owner" — user account is NOT touched
 *
 * Idempotency:
 *   - billing_period = "YYYY-MM" (monthly)
 *   - Checks FinancialTransaction for existing location_operating_cost txn for this location+period
 *   - If already charged this period, skips without double-charging
 *
 * Trigger: admin-only, manual or scheduled automation. NEVER called on page load.
 * Security: admin-only endpoint.
 */

const WEEKS_PER_MONTH = 4.33;

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function calcWeeklyHoursForWorker(char, location) {
  const charId = char.id;
  const shift = location?.worker_shifts?.[charId];
  if (shift?.start && shift?.end && Array.isArray(shift.days) && shift.days.length > 0) {
    const start = timeToMinutes(shift.start);
    const end = timeToMinutes(shift.end);
    if (start !== null && end !== null) {
      let mins = end - start;
      if (mins <= 0) mins += 24 * 60;
      return (mins / 60) * shift.days.length;
    }
  }
  if (char.work_start_time && char.work_end_time && Array.isArray(char.work_days) && char.work_days.length > 0) {
    const start = timeToMinutes(char.work_start_time);
    const end = timeToMinutes(char.work_end_time);
    if (start !== null && end !== null) {
      let mins = end - start;
      if (mins <= 0) mins += 24 * 60;
      return (mins / 60) * char.work_days.length;
    }
  }
  return null;
}

// Residential + confinement categories — excluded from this function entirely
const SKIP_CATEGORIES = new Set([
  'home', 'hotel', 'shelter', 'jail', 'prison',
  'detention_center', 'correctional_facility', 'juvenile_detention',
  'halfway_house', 'holding_cell',
]);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Admin-only — prevents accidental charges during testing or page loads
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { dry_run = false } = await req.json().catch(() => ({}));

    const now = new Date();
    // billing_period = "YYYY-MM" — idempotency key
    const billingPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const results = [];

    // Load all locations (service role — covers all accounts)
    const allLocations = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);

    // Load all characters for staff payroll calculation
    const allCharacters = await base44.asServiceRole.entities.Character.filter({ status: 'active' });
    const charMap = Object.fromEntries(allCharacters.map(c => [c.id, c]));

    // Load all character financials
    const allFinancials = await base44.asServiceRole.entities.CharacterFinancial.list('-created_date', 1000);
    const financialsByChar = {};
    for (const f of allFinancials) {
      if (f.character_id) financialsByChar[f.character_id] = f;
    }

    // Load recent operating cost transactions for idempotency checks
    // transaction_type = 'location_operating_cost' is the distinct label for this function
    const recentOpTxns = await base44.asServiceRole.entities.FinancialTransaction.filter(
      { transaction_type: 'location_operating_cost' },
      '-timestamp',
      2000
    ).catch(() => []);

    // Index by "location_id|billing_period" for O(1) lookup
    const chargedThisPeriod = new Set();
    for (const txn of recentOpTxns) {
      if (txn.location_id && txn.timestamp) {
        const period = txn.timestamp.substring(0, 7);
        chargedThisPeriod.add(`${txn.location_id}|${period}`);
      }
    }

    for (const loc of allLocations) {
      const cat = loc.category || 'generic';

      // Skip residential/confinement — those are handled by processHousingCosts
      if (SKIP_CATEGORIES.has(cat) || loc.is_confinement_facility) continue;

      // ── NO OWNER: log and skip — do NOT touch user account ──────────────
      if (!loc.owner_character_id && !loc.owner_is_npc) {
        results.push({
          location_id: loc.id,
          location_name: loc.name,
          category: cat,
          status: 'skipped_no_owner',
          reason: 'No owner_character_id assigned. Operating costs not charged. User account not touched.',
          total_cost: 0,
        });
        continue;
      }

      // ── NPC OWNER: log and skip ──────────────────────────────────────────
      if (loc.owner_is_npc) {
        results.push({
          location_id: loc.id,
          location_name: loc.name,
          category: cat,
          status: 'skipped_npc_owner',
          owner_npc_name: loc.owner_npc_name || 'Unknown NPC',
          reason: 'NPC-owned location. NPC financial accounts not supported. Not charged.',
          total_cost: 0,
        });
        continue;
      }

      const ownerCharId = loc.owner_character_id;
      const ownerCharName = loc.owner_character_name || ownerCharId;

      // ── IDEMPOTENCY CHECK: skip if already charged this billing period ───
      const idempotencyKey = `${loc.id}|${billingPeriod}`;
      if (chargedThisPeriod.has(idempotencyKey)) {
        results.push({
          location_id: loc.id,
          location_name: loc.name,
          category: cat,
          status: 'skipped_already_charged',
          billing_period: billingPeriod,
          owner_character_id: ownerCharId,
          owner_character_name: ownerCharName,
          reason: `Operating costs already charged for ${billingPeriod}`,
          total_cost: 0,
        });
        continue;
      }

      // ── Compute operating cost components ──────────────────────────────
      const baseCost = loc.operating_cost || 0;

      const utilities = loc.utility_costs
        ? Object.values(loc.utility_costs).reduce((s, v) => s + (v || 0), 0)
        : 0;

      // Staff payroll component: estimated monthly cost of all assigned workers
      // NOTE: processPayroll pays the workers. This charges the owner the equivalent cost.
      // They are separate, correctly labeled transactions — not duplicates.
      let staffPayroll = 0;
      const staffBreakdown = [];
      for (const workerId of (loc.worker_character_ids || [])) {
        const char = charMap[workerId];
        if (!char) continue;
        const hourlyRate = loc.worker_pay_rates?.[workerId] ?? null;
        if (!hourlyRate) continue;
        const weeklyHours = calcWeeklyHoursForWorker(char, loc);
        if (!weeklyHours) continue;
        const monthlyPay = Math.round(hourlyRate * weeklyHours * WEEKS_PER_MONTH * 100) / 100;
        staffPayroll += monthlyPay;
        staffBreakdown.push({
          character_id: workerId,
          character_name: char.name,
          hourly_rate: hourlyRate,
          weekly_hours: Math.round(weeklyHours * 100) / 100,
          monthly_pay: monthlyPay,
        });
      }

      const totalCost = Math.round((baseCost + utilities + staffPayroll) * 100) / 100;
      if (totalCost <= 0) {
        results.push({
          location_id: loc.id,
          location_name: loc.name,
          category: cat,
          status: 'skipped_zero_cost',
          reason: 'Total operating cost is zero — nothing to charge.',
          owner_character_id: ownerCharId,
          owner_character_name: ownerCharName,
          components: { base_operating_cost: baseCost, utilities, staff_payroll: staffPayroll },
          total_cost: 0,
        });
        continue;
      }

      if (dry_run) {
        results.push({
          location_id: loc.id,
          location_name: loc.name,
          category: cat,
          status: 'dry_run',
          owner_character_id: ownerCharId,
          owner_character_name: ownerCharName,
          components: { base_operating_cost: baseCost, utilities, staff_payroll: staffPayroll, staff_breakdown: staffBreakdown },
          total_cost: totalCost,
          billing_period: billingPeriod,
        });
        continue;
      }

      // ── Charge the owner's financial account ───────────────────────────
      const ownerFinancial = financialsByChar[ownerCharId];
      if (!ownerFinancial) {
        results.push({
          location_id: loc.id,
          location_name: loc.name,
          category: cat,
          status: 'skipped_no_financial_record',
          reason: `Owner (${ownerCharName}) has no CharacterFinancial record. Cannot charge.`,
          owner_character_id: ownerCharId,
          owner_character_name: ownerCharName,
          total_cost: totalCost,
        });
        continue;
      }

      const newBalance = Math.round((ownerFinancial.current_balance - totalCost) * 100) / 100;

      await base44.asServiceRole.entities.CharacterFinancial.update(ownerFinancial.id, {
        current_balance: newBalance,
        total_expenses: Math.round((ownerFinancial.total_expenses + totalCost) * 100) / 100,
      });

      // Write labeled transaction — type 'location_operating_cost' is the idempotency anchor
      await base44.asServiceRole.entities.FinancialTransaction.create({
        character_id: ownerCharId,
        character_name: ownerCharName,
        sender_type: 'system',
        sender_name: 'Location Operating Costs',
        receiver_type: 'character',
        receiver_name: ownerCharName,
        amount: totalCost,
        direction: 'expense',
        transaction_type: 'location_operating_cost',
        description: `Business operating costs — ${loc.name} | base: $${baseCost} | utilities: $${utilities.toFixed(2)} | staff payroll: $${staffPayroll.toFixed(2)} | period: ${billingPeriod}`,
        location_id: loc.id,
        location_name: loc.name,
        balance_after: newBalance,
        timestamp: now.toISOString(),
      }).catch(err => console.warn(`[processLocationOperatingCosts] txn write failed for ${loc.name}:`, err.message));

      results.push({
        location_id: loc.id,
        location_name: loc.name,
        category: cat,
        status: 'charged',
        owner_character_id: ownerCharId,
        owner_character_name: ownerCharName,
        billing_period: billingPeriod,
        components: {
          base_operating_cost: baseCost,
          utilities,
          staff_payroll: staffPayroll,
          staff_breakdown: staffBreakdown,
        },
        total_cost: totalCost,
        owner_new_balance: newBalance,
      });
    }

    const summary = {
      billing_period: billingPeriod,
      dry_run,
      total_locations_scanned: allLocations.length,
      charged: results.filter(r => r.status === 'charged').length,
      skipped_no_owner: results.filter(r => r.status === 'skipped_no_owner').length,
      skipped_npc_owner: results.filter(r => r.status === 'skipped_npc_owner').length,
      skipped_zero_cost: results.filter(r => r.status === 'skipped_zero_cost').length,
      skipped_already_charged: results.filter(r => r.status === 'skipped_already_charged').length,
      skipped_no_financial_record: results.filter(r => r.status === 'skipped_no_financial_record').length,
      dry_run_preview: results.filter(r => r.status === 'dry_run').length,
    };

    return Response.json({ success: true, summary, results });
  } catch (error) {
    console.error('[processLocationOperatingCosts]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});