import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, AlertTriangle } from 'lucide-react';

/**
 * CharacterFinancialSummary
 *
 * SINGLE CANONICAL PATH:
 * - Receives `financial` prop from CharacterProfile's React Query cache.
 * - CharacterProfile uses queryKey=['characterFinancial', characterId] with
 *   refetchOnMount=true (default) so it always fetches on cold profile loads.
 * - This component does NOT maintain its own financial resolver.
 *   It is a display component. The canonical financial source is CharacterProfile's query.
 *
 * IF `financial` PROP IS NULL AFTER `isLoading` CLEARS:
 * - This is a system error. Every character should have a CharacterFinancial record.
 * - The record is created by onCharacterCreated at character creation time.
 * - If null after a genuine fetch: the record is missing from the DB (system failure)
 *   or the query failed silently. Display a visible system error — do NOT invent data.
 *
 * `isLoading` is passed from CharacterProfile to distinguish "still fetching"
 * from "fetched and found nothing".
 */
export default function CharacterFinancialSummary({ characterId, financial, isLoading }) {
  const [rentIncomeSources, setRentIncomeSources] = useState([]);

  // Secondary: rent income from FinancialTransaction — only after real financial data is present.
  useEffect(() => {
    if (!characterId || !financial) return;
    let cancelled = false;

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
      } catch (_) {}
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(rentTimer);
    };
  }, [characterId, financial]);

  // ── LOADING: profile financial query still in flight ────────────────────────
  if (isLoading) {
    return (
      <div className="bg-muted/30 border border-border rounded-xl p-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
        Loading financial data…
      </div>
    );
  }

  // ── SYSTEM ERROR: record missing after genuine fetch ─────────────────────────
  // If financial is null and we are not loading, the CharacterFinancial record is absent.
  // This is a system error — every character should have one from onCharacterCreated.
  // Fail visibly. Do not show $0. Do not hide the failure.
  if (!financial) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center gap-2 text-xs text-amber-400">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
        Financial record pending initialization — this character has not yet received their starting balance. It will be created automatically during the next maintenance cycle.
      </div>
    );
  }

  // ── REAL DATA PATH ──────────────────────────────────────────────────────────
  const fin = financial;
  const monthlyExpenses = (fin.recurring_expenses || []).reduce((sum, e) => sum + (e.monthly_cost || 0), 0);
  const jobMonthlyIncome = (fin.income_sources || []).reduce((sum, s) => {
    if (s.pay_type === 'hourly') {
      if (s.monthly_estimate) return sum + s.monthly_estimate;
      if (s.weekly_hours) return sum + (s.pay_amount || 0) * s.weekly_hours * 4.33;
      return sum;
    }
    if (s.pay_type === 'annual') return sum + (s.pay_amount || 0) / 12;
    return sum;
  }, 0);
  const rentMonthlyIncome = rentIncomeSources.reduce((sum, s) => sum + (s.monthly_amount || 0), 0);
  const monthlyIncome = jobMonthlyIncome + rentMonthlyIncome;

  return (
    <div className="space-y-2">
      {/* Current Balance — real value from canonical CharacterFinancial record */}
      <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
        <p className="text-[10px] text-green-400 uppercase font-semibold tracking-wider">Current Balance</p>
        <p className="text-2xl font-bold text-green-300 mt-0.5">
          ${(fin.current_balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        {monthlyIncome > 0 && monthlyExpenses > 0 && (
          <p className={`text-xs mt-0.5 font-medium ${monthlyIncome >= monthlyExpenses ? 'text-green-400' : 'text-red-400'}`}>
            ${Math.round(monthlyIncome - monthlyExpenses)}/mo net {monthlyIncome >= monthlyExpenses ? '▲' : '▼'}
          </p>
        )}
      </div>
      {/* Total Earned / Total Spent */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-2.5">
          <p className="text-[10px] text-blue-400 uppercase font-semibold tracking-wider">Total Earned</p>
          <p className="text-base font-bold text-blue-300 mt-0.5">
            ${(fin.total_income ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-2.5">
          <p className="text-[10px] text-red-400 uppercase font-semibold tracking-wider">Total Spent</p>
          <p className="text-base font-bold text-red-300 mt-0.5">
            ${(fin.total_expenses ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>
    </div>
  );
}