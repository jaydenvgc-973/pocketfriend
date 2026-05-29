import { DollarSign, TrendingDown, Home, Briefcase, ShoppingCart, Dumbbell, Phone, Tv, Building2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export default function CharacterFinancialSummary({ characterId }) {
  const [financial, setFinancial] = useState(null);
  const [rentIncomeSources, setRentIncomeSources] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Primary query: load CharacterFinancial — fires first, sets loading=false immediately on completion
    // so the UI is always stable regardless of what happens to the secondary rent query.
    const primaryTimer = setTimeout(async () => {
      try {
        const results = await base44.entities.CharacterFinancial.filter({ character_id: characterId });
        if (!cancelled && results.length > 0) setFinancial(results[0]);
      } catch (_) {
        // Silently handle — financial display stays as null (hidden), not flickering
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 600);

    // Secondary query: rent income — fires later, fully independent, never affects loading state
    // Wrapped in its own try/catch so a rate limit here never disrupts the primary display
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
        // Rate limit or error on secondary query — silently skip, never affect primary display
      }
    }, 4000);

    return () => {
      cancelled = true;
      clearTimeout(primaryTimer);
      clearTimeout(rentTimer);
    };
  }, [characterId]);

  // LAST-KNOWN-GOOD: never return null on load failure — show skeleton until data arrives,
  // then show data forever. Section never disappears once it has loaded.
  if (loading) return <div className="h-32 bg-secondary/30 rounded-xl animate-pulse" />;
  if (!financial) return <div className="h-20 bg-secondary/20 rounded-xl flex items-center justify-center text-xs text-muted-foreground">Financial data unavailable</div>;

  const monthlyExpenses = (financial.recurring_expenses || []).reduce((sum, e) => sum + (e.monthly_cost || 0), 0);
  // Estimate monthly job/salary income
  const jobMonthlyIncome = (financial.income_sources || []).reduce((sum, s) => {
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
  const monthlyRemaining = monthlyIncome > 0 ? monthlyIncome - monthlyExpenses : financial.current_balance - monthlyExpenses;

  const expenseIcons = {
    rent: Home,
    utilities: TrendingDown,
    groceries: ShoppingCart,
    gym: Dumbbell,
    phone: Phone,
    streaming: Tv,
    custom: DollarSign,
  };

  return (
    <div className="space-y-2">
      {/* Row 1: Current Balance full width */}
      <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
        <p className="text-[10px] text-green-400 uppercase font-semibold tracking-wider">Current Balance</p>
        <p className="text-2xl font-bold text-green-300 mt-0.5">${(financial.current_balance ?? 6000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        {monthlyIncome > 0 && monthlyExpenses > 0 && (
          <p className={`text-xs mt-0.5 font-medium ${monthlyIncome >= monthlyExpenses ? 'text-green-400' : 'text-red-400'}`}>
            ${Math.round(monthlyIncome - monthlyExpenses)}/mo net {monthlyIncome >= monthlyExpenses ? '▲' : '▼'}
          </p>
        )}
      </div>
      {/* Row 2: Monthly Net, Total Earned, Total Spent in one row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-2.5">
          <p className="text-[10px] text-blue-400 uppercase font-semibold tracking-wider">Total Earned</p>
          <p className="text-base font-bold text-blue-300 mt-0.5">${(financial.total_income ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-2.5">
          <p className="text-[10px] text-red-400 uppercase font-semibold tracking-wider">Total Spent</p>
          <p className="text-base font-bold text-red-300 mt-0.5">${(financial.total_expenses ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</p>
        </div>
      </div>
    </div>
  );
}