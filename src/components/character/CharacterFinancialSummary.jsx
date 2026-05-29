import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * CharacterFinancialSummary
 *
 * PRIMARY: receives `financial` prop directly from CharacterProfile's React Query cache.
 * This means financial data is available immediately on profile open — no second fetch,
 * no delay, no silent failure path.
 *
 * SECONDARY: fetches rent income transactions independently (does not block rendering).
 *
 * If `financial` prop is null (CharacterFinancial record doesn't exist yet for this
 * character), the component renders a minimal balance display using safe defaults,
 * because CharacterFinancial records are created on-demand and may not exist for
 * legacy or newly-created characters.
 */
export default function CharacterFinancialSummary({ characterId, financial }) {
  const [rentIncomeSources, setRentIncomeSources] = useState([]);

  useEffect(() => {
    if (!characterId) return;
    let cancelled = false;

    // Secondary query: rent income — fires after financial data is already visible.
    // Never blocks or delays the primary financial display.
    const rentTimer = setTimeout(async () => {
      try {
        const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
        const rentTxns = await base44.entities.FinancialTransaction.filter({
          character_id: characterId,
          transaction_type: 'rent',
          direction: 'income',
        }, '-timestamp', 50);
        if (cancelled) return;
        const recentRent = rentTxns.filter(t => t.timestamp && t.timestamp >= fortyFiveDaysAgo);
        const byLoc = {};
        for (const txn of recentRent) {
          const key = txn.location_id || txn.location_name || 'unknown';
          const locName = txn.location_name ||
            txn.description?.match(/Rental income — ([^|]+)/)?.[1]?.trim() || 'Rental Property';
          if (!byLoc[key]) byLoc[key] = { location_name: locName, total: 0, count: 0 };
          byLoc[key].total += txn.amount || 0;
          byLoc[key].count += 1;
        }
        const rentSources = Object.values(byLoc).map(loc => ({
          location_name: loc.location_name,
          monthly_amount: Math.round((loc.total / Math.max(loc.count, 1)) * 100) / 100,
        }));
        if (!cancelled) setRentIncomeSources(rentSources);
      } catch (_) {
        // Non-blocking — rent income is supplemental, never blocks financial header
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(rentTimer);
    };
  }, [characterId]);

  // Safe defaults when CharacterFinancial record doesn't exist yet (legacy/new character)
  const fin = financial || { current_balance: 0, total_income: 0, total_expenses: 0, recurring_expenses: [], income_sources: [] };

  const monthlyExpenses = (fin.recurring_expenses || []).reduce((sum, e) => sum + (e.monthly_cost || 0), 0);
  // Estimate monthly job/salary income
  const jobMonthlyIncome = (fin.income_sources || []).reduce((sum, s) => {
    if (s.pay_type === 'hourly') {
      if (s.monthly_estimate) return sum + s.monthly_estimate;
      if (s.weekly_hours) return sum + (s.pay_amount || 0) * s.weekly_hours * 4.33;
      return sum;
    }
    if (s.pay_type === 'annual') return sum + (s.pay_amount || 0) / 12;
    return sum;
  }, 0);
  // Rent income from owned locations (separate from job income)
  const rentMonthlyIncome = rentIncomeSources.reduce((sum, s) => sum + (s.monthly_amount || 0), 0);
  const monthlyIncome = jobMonthlyIncome + rentMonthlyIncome;

  return (
    <div className="space-y-2">
      {/* Row 1: Current Balance full width */}
      <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
        <p className="text-[10px] text-green-400 uppercase font-semibold tracking-wider">Current Balance</p>
        <p className="text-2xl font-bold text-green-300 mt-0.5">${(fin.current_balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        {monthlyIncome > 0 && monthlyExpenses > 0 && (
          <p className={`text-xs mt-0.5 font-medium ${monthlyIncome >= monthlyExpenses ? 'text-green-400' : 'text-red-400'}`}>
            ${Math.round(monthlyIncome - monthlyExpenses)}/mo net {monthlyIncome >= monthlyExpenses ? '▲' : '▼'}
          </p>
        )}
      </div>
      {/* Row 2: Total Earned, Total Spent */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-2.5">
          <p className="text-[10px] text-blue-400 uppercase font-semibold tracking-wider">Total Earned</p>
          <p className="text-base font-bold text-blue-300 mt-0.5">${(fin.total_income ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-2.5">
          <p className="text-[10px] text-red-400 uppercase font-semibold tracking-wider">Total Spent</p>
          <p className="text-base font-bold text-red-300 mt-0.5">${(fin.total_expenses ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
        </div>
      </div>
    </div>
  );
}