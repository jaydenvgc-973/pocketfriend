import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * processLocationOperatingCosts
 *
 * Computes and charges the TOTAL operating cost for each business/commercial location:
 *   operating cost = rent/lease + utilities + maintenance (operating_cost field) + staff payroll
 *
 * Payment rules:
 *   - If the location has an owner_character_id, that character's financial account is charged.
 *   - If owner_is_npc is true, NPC finances are not supported — log and skip payment.
 *   - If there is no owner, log as "unassigned-owner" — do NOT transfer to the user, do NOT error.
 *   - Residential rent paid by tenants → credit goes to the owner if one exists, else to user as rental income.
 *
 * Staff payroll component:
 *   - worker_character_ids + worker_pay_rates + worker_shifts are read from LocationReference.
 *   - Total staff cost = sum of (hourly_rate * weekly_hours * (WEEKS_PER_MONTH)) for each worker.
 *
 * This function charges OWNER accounts for operating a location.
 * It does NOT charge tenants — that is processHousingCosts's job.
 * It does NOT pay workers — that is processPayroll's job.
 *
 * Security: admin-only endpoint.
 */

const WEEKS_PER_MONTH = 4.33;
const BIWEEKLY_WEEKS = 2;

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
  // Character-level fallback
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

// Residential categories — these are not business locations, skip from this function
const RESIDENTIAL_CATEGORIES = new Set([
  'home', 'hotel', 'shelter', 'jail', 'prison',
  'detention_center', 'correctional_facility', 'juvenile_detention',
  'halfway_house', 'holding_cell',
]);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Admin-only
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const now = new Date();
    const results = [];

    // Load all locations (service role — covers all accounts)
    const allLocations = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);

    // Load all characters (for staff payroll calculation)
    const allCharacters = await base44.asServiceRole.entities.Character.filter({ status: 'active' });
    const charMap = Object.fromEntries(allCharacters.map(c => [c.id, c]));

    // Load all character financials
    const allFinancials = await base44.asServiceRole.entities.CharacterFinancial.list('-created_date', 1000);
    const financialsByChar = {};
    for (const f of allFinancials) {
      if (f.character_id) financialsByChar[f.character_id] = f;
    }

    for (const loc of allLocations) {
      // Skip residential locations — housing costs are handled by processHousingCosts
      const cat = loc.category || 'generic';
      if (RESIDENTIAL_CATEGORIES.has(cat) || loc.is_confinement_facility) continue;
      if (!loc.owner_character_id && !loc.owner_is_npc) {
        // No owner assigned — log as unassigned and skip
        results.push({
          location_id: loc.id,
          location_name: loc.name,
          category: cat,
          status: 'skipped_no_owner',
          reason: 'No owner_character_id assigned to this business location. Operating costs not charged.',
          total_cost: 0,
        });
        continue;
      }

      // NPC-owned locations — NPC financial system not supported
      if (loc.owner_is_npc) {
        results.push({
          location_id: loc.id,
          location_name: loc.name,
          category: cat,
          status: 'skipped_npc_owner',
          owner_npc_name: loc.owner_npc_name || 'Unknown NPC',
          reason: 'NPC-owned location. NPC financial accounts not supported. Operating costs not charged.',
          total_cost: 0,
        });
        continue;
      }

      // ── Compute operating cost components ──────────────────────────────
      const ownerCharId = loc.owner_character_id;
      const ownerCharName = loc.owner_character_name || ownerCharId;

      // 1. Base operating cost (rent/lease/general overhead)
      const baseCost = (loc.operating_cost || 0);

      // 2. Utilities
      const utilities = loc.utility_costs
        ? Object.values(loc.utility_costs).reduce((s, v) => s + (v || 0), 0)
        : 0;

      // 3. Staff payroll (monthly estimate for workers assigned to this location)
      let staffPayroll = 0;
      const staffBreakdown = [];
      const workerIds = loc.worker_character_ids || [];

      for (const workerId of workerIds) {
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

      // ── Charge the owner's financial account ───────────────────────────
      const ownerFinancial = financialsByChar[ownerCharId];
      if (!ownerFinancial) {
        results.push({
          location_id: loc.id,
          location_name: loc.name,
          category: cat,
          status: 'skipped_no_financial_record',
          reason: `Owner character (${ownerCharName}) has no CharacterFinancial record. Cannot charge.`,
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

      // Write labeled FinancialTransaction for full auditability
      await base44.asServiceRole.entities.FinancialTransaction.create({
        character_id: ownerCharId,
        character_name: ownerCharName,
        sender_type: 'system',
        sender_name: 'Location Operating Costs',
        receiver_type: 'character',
        receiver_name: ownerCharName,
        amount: totalCost,
        direction: 'expense',
        transaction_type: 'other',
        description: `Operating costs — ${loc.name} (base: $${baseCost}, utilities: $${utilities.toFixed(2)}, staff payroll: $${staffPayroll.toFixed(2)})`,
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
      total_locations: allLocations.length,
      charged: results.filter(r => r.status === 'charged').length,
      skipped_no_owner: results.filter(r => r.status === 'skipped_no_owner').length,
      skipped_npc_owner: results.filter(r => r.status === 'skipped_npc_owner').length,
      skipped_zero_cost: results.filter(r => r.status === 'skipped_zero_cost').length,
      skipped_no_financial_record: results.filter(r => r.status === 'skipped_no_financial_record').length,
    };

    return Response.json({ success: true, summary, results });
  } catch (error) {
    console.error('[processLocationOperatingCosts]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});