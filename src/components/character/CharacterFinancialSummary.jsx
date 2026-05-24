import { DollarSign, TrendingDown, Home, Briefcase, ShoppingCart, Dumbbell, Phone, Tv, Building2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export default function CharacterFinancialSummary({ characterId }) {
  const [financial, setFinancial] = useState(null);
  const [rentIncomeSources, setRentIncomeSources] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        // Load CharacterFinancial record
        const results = await base44.entities.CharacterFinancial.filter({ character_id: characterId });
        if (results.length > 0) setFinancial(results[0]);

        // Load recent rent income transactions for this character
        // These are written by processHousingCosts / processLandlordRentIncome when owner receives rent
        const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
        const rentTxns = await base44.entities.FinancialTransaction.filter({
          character_id: characterId,
          transaction_type: 'rent',
          direction: 'income',
        }, '-timestamp', 50).catch(() => []);

        const recentRent = rentTxns.filter(t => t.timestamp && t.timestamp >= fortyFiveDaysAgo);

        // Group by location to produce one row per owned property
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
        setRentIncomeSources(rentSources);
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [characterId]);

  if (loading) return <div className="h-32 bg-secondary/30 rounded-xl animate-pulse" />;
  if (!financial) return null;

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
    <div className="space-y-4">
      {/* Money Display */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 col-span-2">
          <p className="text-xs text-green-400 uppercase font-semibold">Current Balance</p>
          <p className="text-3xl font-bold text-green-300 mt-1">${(financial.current_balance ?? 6000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          {monthlyIncome > 0 && monthlyExpenses > 0 && (
            <p className={`text-xs mt-1 font-medium ${monthlyIncome >= monthlyExpenses ? 'text-green-400' : 'text-red-400'}`}>
              ${Math.round(monthlyIncome - monthlyExpenses)}/mo net {monthlyIncome >= monthlyExpenses ? '▲' : '▼'}
            </p>
          )}
        </div>
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3">
          <p className="text-xs text-blue-400 uppercase font-semibold">Total Earned</p>
          <p className="text-lg font-bold text-blue-300 mt-1">${(financial.total_income ?? 0).toFixed(0)}</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <p className="text-xs text-red-400 uppercase font-semibold">Total Spent</p>
          <p className="text-lg font-bold text-red-300 mt-1">${(financial.total_expenses ?? 0).toFixed(0)}</p>
        </div>
      </div>

      {/* Monthly Expenses Breakdown */}
      {financial.recurring_expenses && financial.recurring_expenses.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-2">
          <h4 className="text-sm font-semibold text-foreground mb-3">Monthly Expenses</h4>
          {financial.recurring_expenses.map((exp, idx) => {
            const Icon = expenseIcons[exp.expense_type] || DollarSign;
            return (
              <div key={idx} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground capitalize">
                    {exp.expense_type === 'custom' ? exp.description : exp.expense_type}
                    {exp.location_name && <span className="text-muted-foreground/60 ml-1">({exp.location_name})</span>}
                  </span>
                </div>
                <span className="font-semibold text-foreground">${exp.monthly_cost?.toFixed(2) || '0.00'}</span>
              </div>
            );
          })}
          <div className="border-t border-border pt-2 mt-2 flex items-center justify-between text-sm font-semibold">
            <span className="text-foreground">Monthly Expenses</span>
            <span className="text-red-400">${monthlyExpenses.toFixed(2)}</span>
          </div>
          {monthlyIncome > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Monthly Net</span>
              <span className={monthlyRemaining >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                {monthlyRemaining >= 0 ? '+' : ''}${Math.round(monthlyRemaining)}/mo
              </span>
            </div>
          )}
        </div>
      )}

      {/* Income Sources (job/salary) */}
      {financial.income_sources && financial.income_sources.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-2">
          <h4 className="text-sm font-semibold text-foreground mb-3">Income Sources</h4>
          {financial.income_sources.map((src, idx) => {
            const estMonthly = src.monthly_estimate
              || (src.weekly_hours ? (src.pay_amount || 0) * src.weekly_hours * 4.33 : null)
              || (src.pay_type === 'annual' ? (src.pay_amount || 0) / 12 : null);
            return (
              <div key={idx} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Briefcase className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-muted-foreground truncate">
                      {src.location_name}
                      <span className="text-muted-foreground/60 ml-1">({src.pay_type})</span>
                    </span>
                    {src.weekly_hours != null && (
                      <span className="text-[10px] text-muted-foreground/50">
                        {src.weekly_hours}h/wk · {src.days_per_week}d/wk
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <div className="font-semibold text-green-300">
                    ${src.pay_amount?.toFixed(2) || '0.00'} {src.pay_type === 'hourly' ? '/hr' : '/yr'}
                  </div>
                  {estMonthly > 0 && (
                    <div className="text-[10px] text-green-400/60">~${Math.round(estMonthly)}/mo est.</div>
                  )}
                </div>
              </div>
            );
          })}
          {jobMonthlyIncome > 0 && (
            <div className="border-t border-border pt-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Est. Monthly Job Income</span>
              <span className="font-semibold text-green-300">~${Math.round(jobMonthlyIncome)}/mo</span>
            </div>
          )}
        </div>
      )}

      {/* Rent / Ownership Income — separate from job income */}
      {rentIncomeSources.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-2">
          <h4 className="text-sm font-semibold text-foreground mb-3">Rental Income</h4>
          {rentIncomeSources.map((src, idx) => (
            <div key={idx} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Building2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span className="text-muted-foreground truncate">{src.location_name}</span>
              </div>
              <span className="font-semibold text-emerald-300 flex-shrink-0 ml-2">
                ~${src.monthly_amount.toFixed(2)}/mo
              </span>
            </div>
          ))}
          <div className="border-t border-border pt-2 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Est. Monthly Rental Income</span>
            <span className="font-semibold text-emerald-300">~${Math.round(rentMonthlyIncome)}/mo</span>
          </div>
        </div>
      )}
    </div>
  );
}