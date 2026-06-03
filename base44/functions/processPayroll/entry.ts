import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * processPayroll
 *
 * SOURCE OF TRUTH: LocationReference.worker_pay_type[charId] and worker_pay_rates[charId]
 * These fields are PROTECTED. This function reads them. It never writes them.
 *
 * Pay type routing:
 *   'annual'  → biweeklyPay = annualSalary / 26   (NEVER multiply by hours)
 *   'hourly'  → biweeklyPay = hourlyRate * biweeklyHours (requires valid schedule)
 *   default   → treated as 'hourly'
 *
 * Pay is bi-weekly (automation calls every 2 weeks).
 */

/** Parse "HH:MM" → total minutes from midnight */
function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Calculate weekly hours for a job.
 * Returns { weeklyHours, daysPerWeek } or null if no schedule found.
 */
function calcWeeklyHours(char, location) {
  const charId = char.id;

  // 1. Location-specific shift for this character
  const shift = location?.worker_shifts?.[charId];
  if (shift?.start && shift?.end && Array.isArray(shift.days) && shift.days.length > 0) {
    const start = timeToMinutes(shift.start);
    const end = timeToMinutes(shift.end);
    if (start !== null && end !== null) {
      let shiftMinutes = end - start;
      if (shiftMinutes <= 0) shiftMinutes += 24 * 60; // overnight shift
      const hoursPerShift = shiftMinutes / 60;
      const daysPerWeek = shift.days.length;
      return { weeklyHours: hoursPerShift * daysPerWeek, daysPerWeek };
    }
  }

  // 2. Character-level fallback
  if (char.work_start_time && char.work_end_time && Array.isArray(char.work_days) && char.work_days.length > 0) {
    const start = timeToMinutes(char.work_start_time);
    const end = timeToMinutes(char.work_end_time);
    if (start !== null && end !== null) {
      let shiftMinutes = end - start;
      if (shiftMinutes <= 0) shiftMinutes += 24 * 60;
      const hoursPerShift = shiftMinutes / 60;
      const daysPerWeek = char.work_days.length;
      return { weeklyHours: hoursPerShift * daysPerWeek, daysPerWeek };
    }
  }

  return null; // No schedule found
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // owner_email is the sole ownership source of truth
    const characters = await base44.entities.Character.filter({
      owner_email: user.email,
      status: 'active',
    });

    // Load all locations once — read-only, never written by this function
    const allLocations = await base44.asServiceRole.entities.LocationReference.list('-created_date', 500);
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    const results = [];
    const today = new Date();
    const WEEKS_PER_BIWEEKLY = 2;
    const AVG_WEEKS_PER_MONTH = 4.33;

    for (const char of characters) {
      // CANONICAL LOOKUP: filter by BOTH character_id AND owner_email
      const financials = await base44.entities.CharacterFinancial.filter(
        { character_id: char.id, owner_email: user.email },
        '-created_date',
        1
      );
      let financial = financials[0];
      if (!financial) {
        financial = await base44.entities.CharacterFinancial.create({
          character_id: char.id,
          character_name: char.name,
          owner_email: user.email,
          current_balance: 6000,
          total_income: 0,
          total_expenses: 0,
          income_sources: [],
        });
      }

      const existingSources = financial.income_sources || [];
      let totalBiweeklyPay = 0;
      const updatedSources = [];

      // ── Build list of all job locations for this character ──────────────
      const jobLocations = [];

      if (char.occupation_location_id) {
        const loc = locationMap[char.occupation_location_id];
        jobLocations.push({
          location_id: char.occupation_location_id,
          location_name: char.occupation_location_name || loc?.name || 'Primary Job',
          location: loc || null,
        });
      }

      for (const extra of (char.additional_occupation_locations || [])) {
        if (extra.location_id) {
          const loc = locationMap[extra.location_id];
          jobLocations.push({
            location_id: extra.location_id,
            location_name: extra.location_name || loc?.name || 'Job',
            location: loc || null,
          });
        }
      }

      // If no linked locations but has an annual salary in income_sources, honour it
      if (jobLocations.length === 0) {
        const annualSource = existingSources.find(s => s.pay_type === 'annual' && s.pay_amount);
        if (annualSource) {
          const biweeklyPay = Math.round((annualSource.pay_amount / 26) * 100) / 100;
          totalBiweeklyPay += biweeklyPay;
          updatedSources.push({
            ...annualSource,
            total_earned: (annualSource.total_earned || 0) + biweeklyPay,
            last_payment_date: today.toISOString(),
          });
        }
      }

      // ── Process each job ───────────────────────────────────────────────
      for (const job of jobLocations) {
        const loc = job.location;
        const charId = char.id;

        // Existing source is used ONLY to carry forward total_earned — never to determine pay type/rate
        const existingSource = existingSources.find(s => s.location_id === job.location_id);

        // SOURCE OF TRUTH: read pay_type and pay_rate from LocationReference
        // worker_pay_type[charId] = 'annual' | 'hourly'
        // worker_pay_rates[charId] = the rate value (annual amount OR hourly rate)
        const locPayType = loc?.worker_pay_type?.[charId] || 'hourly';
        const locPayRate = loc?.worker_pay_rates?.[charId] ?? null;

        if (!locPayRate) {
          // No rate on location — fall back to income_sources annual if present
          if (existingSource?.pay_type === 'annual' && existingSource.pay_amount) {
            const biweeklyPay = Math.round((existingSource.pay_amount / 26) * 100) / 100;
            totalBiweeklyPay += biweeklyPay;
            updatedSources.push({
              ...existingSource,
              total_earned: (existingSource.total_earned || 0) + biweeklyPay,
              last_payment_date: today.toISOString(),
            });
          }
          continue;
        }

        if (locPayType === 'annual') {
          // ANNUAL SALARY: divide by 26 pay periods. NEVER multiply by hours.
          // This is the fix that prevents a $60,000 annual salary being treated
          // as a $60,000/hour rate × scheduled hours.
          const biweeklyPay = Math.round((locPayRate / 26) * 100) / 100;
          const monthlyEstimate = Math.round((locPayRate / 12) * 100) / 100;
          totalBiweeklyPay += biweeklyPay;
          updatedSources.push({
            location_id: job.location_id,
            location_name: job.location_name,
            pay_type: 'annual',
            pay_amount: locPayRate,
            monthly_estimate: monthlyEstimate,
            total_earned: (existingSource?.total_earned || 0) + biweeklyPay,
            last_payment_date: today.toISOString(),
          });
          continue;
        }

        // HOURLY: locPayRate is a true hourly wage. Requires a valid schedule.
        const schedule = calcWeeklyHours(char, loc);
        if (!schedule) continue; // No schedule — cannot calculate hours

        const { weeklyHours, daysPerWeek } = schedule;
        const biweeklyHours = weeklyHours * WEEKS_PER_BIWEEKLY;
        const biweeklyPay = Math.round(locPayRate * biweeklyHours * 100) / 100;
        const monthlyEstimate = Math.round(locPayRate * weeklyHours * AVG_WEEKS_PER_MONTH * 100) / 100;

        totalBiweeklyPay += biweeklyPay;
        updatedSources.push({
          location_id: job.location_id,
          location_name: job.location_name,
          pay_type: 'hourly',
          pay_amount: locPayRate,
          weekly_hours: Math.round(weeklyHours * 100) / 100,
          days_per_week: daysPerWeek,
          monthly_estimate: monthlyEstimate,
          total_earned: (existingSource?.total_earned || 0) + biweeklyPay,
          last_payment_date: today.toISOString(),
        });
      }

      if (totalBiweeklyPay <= 0) continue; // Nothing to pay

      const newBalance = Math.round((financial.current_balance + totalBiweeklyPay) * 100) / 100;
      const newTotalIncome = Math.round((financial.total_income + totalBiweeklyPay) * 100) / 100;

      await base44.entities.CharacterFinancial.update(financial.id, {
        current_balance: newBalance,
        total_income: newTotalIncome,
        income_sources: updatedSources,
        last_updated: today.toISOString(),
      });

      // Write FinancialTransaction so payroll is visible in character awareness
      await base44.entities.FinancialTransaction.create({
        character_id: char.id,
        character_name: char.name,
        sender_id: 'system',
        sender_type: 'system',
        sender_name: 'Payroll',
        receiver_id: char.id,
        receiver_type: 'character',
        receiver_name: char.name,
        amount: totalBiweeklyPay,
        direction: 'income',
        transaction_type: 'payroll',
        description: updatedSources.map(s =>
          s.pay_type === 'annual'
            ? `Salary: ${s.location_name} (annual $${s.pay_amount.toLocaleString()})`
            : `Hourly: ${s.location_name} ($${s.pay_amount}/hr × ${s.weekly_hours * WEEKS_PER_BIWEEKLY}hrs)`
        ).join('; '),
        balance_after: newBalance,
        timestamp: today.toISOString(),
      }).catch(err => console.warn('[processPayroll] FinancialTransaction write failed:', err.message));

      results.push({
        character_id: char.id,
        name: char.name,
        biweekly_pay: totalBiweeklyPay,
        new_balance: newBalance,
        jobs: updatedSources.map(s => ({
          location: s.location_name,
          pay_type: s.pay_type,
          rate: s.pay_amount,
          weekly_hours: s.weekly_hours || null,
          days_per_week: s.days_per_week || null,
          biweekly_earned: totalBiweeklyPay,
        })),
        status: 'paid',
      });
    }

    return Response.json({ success: true, payroll: results, paid: results.length });
  } catch (error) {
    console.error('[processPayroll]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});