import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, AlertTriangle } from 'lucide-react';

/**
 * CharacterFinancialSummary
 *
 * DATA CONTRACT:
 * - `financial` prop: the CharacterFinancial record passed from CharacterProfile's React Query cache.
 *   The profile query now always fetches on mount (refetchOnMount=true), so this prop resolves
 *   correctly on cold profile loads (direct URL) without requiring homepage or chat to load first.
 *
 * IF FINANCIAL PROP IS NULL AFTER PROFILE QUERY COMPLETES:
 * - This is a system error. Every character should have a CharacterFinancial record created
 *   by onCharacterCreated at creation time.
 * - Do NOT display fake $0 values.
 * - Do NOT show "No financial record found" as if it's a normal character state.
 * - Do NOT create a new record from the UI (causes duplicates).
 * - Show a system error indicator so the failure is visible, not hidden.
 * - The fallback fetch below retries the canonical query one more time after a brief delay
 *   to cover timing races (profile mounted before query resolved).
 */
export default function CharacterFinancialSummary({ characterId, financial }) {
  const [rentIncomeSources, setRentIncomeSources] = useState([]);
  const [resolvedFinancial, setResolvedFinancial] = useState(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);

  // Sync prop → local state. Once resolved, keep it (prop may go null on re-render).
  useEffect(() => {
    if (financial) {
      setResolvedFinancial(financial);
      setFallbackFailed(false);
    }
  }, [financial]);

  // FALLBACK: if prop is still null after prop settles, do one direct fetch.
  // This covers timing races where the profile query resolves after the first render
  // but the prop hasn't propagated yet. Uses the same canonical query as CharacterCard.
  useEffect(() => {
    if (!characterId || resolvedFinancial || fallbackLoading || fallbackFailed) return;
    // Only run if the prop is still null — wait briefly to let React Query propagate first.
    const timer = setTimeout(async () => {
      setFallbackLoading(true);
      try {
        const records = await base44.entities.CharacterFinancial.filter({ character_id: characterId });
        if (records[0]) {
          setResolvedFinancial(records[0]);
        } else {
          // Record truly missing — this is a system error, not a character state.
          // Log visibly so it can be diagnosed and repaired.
          console.error(`[CharacterFinancialSummary] SYSTEM ERROR: No CharacterFinancial record found for character_id=${characterId}. Every character should have a record created by onCharacterCreated. The financial system is broken for this character.`);
          setFallbackFailed(true);
        }
      } catch (err) {
        console.error(`[CharacterFinancialSummary] Fallback fetch failed for character_id=${characterId}:`, err?.message);
        setFallbackFailed(true);
      } finally {
        setFallbackLoading(false);
      }
    }, 1200); // brief delay — let React Query propagate prop first

    return () => clearTimeout(timer);
  }, [characterId, resolvedFinancial, fallbackLoading, fallbackFailed]);

  // Secondary: rent income — only after real financial data is present.
  useEffect(() => {
    if (!characterId || !resolvedFinancial) return;
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
  }, [characterId, resolvedFinancial]);

  // ── LOADING ─────────────────────────────────────────────────────────────────
  if (!resolvedFinancial && (fallbackLoading || (!fallbackFailed && !financial))) {
    return (
      <div className="bg-muted/30 border border-border rounded-xl p-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
        Loading financial data…
      </div>
    );
  }

  // ── SYSTEM ERROR: record missing — visible failure, not hidden ───────────────
  // If we reach here with no resolved record, the financial system is broken for this character.
  // Show a visible error — do not hide it, do not show $0, do not show empty space.
  if (!resolvedFinancial) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center gap-2 text-xs text-amber-400">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
        Financial data unavailable — system error. Balance could not be loaded.
      </div>
    );
  }

  // ── REAL DATA PATH ──────────────────────────────────────────────────────────
  const fin = resolvedFinancial;
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
      {/* Row 1: Current Balance — real value from canonical CharacterFinancial record */}
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
      {/* Row 2: Total Earned, Total Spent */}
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