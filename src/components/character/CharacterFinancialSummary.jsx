import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2 } from 'lucide-react';

/**
 * CharacterFinancialSummary
 *
 * DATA CONTRACT:
 * - `financial` prop: the CharacterFinancial record from CharacterProfile's React Query cache.
 *   This is the REAL record — not a default. If null, the record does not exist yet.
 *
 * WHEN FINANCIAL IS NULL (record missing — legacy or new character):
 * - Do NOT display fake $0.00 values. $0 is NOT a valid default — it is false financial data.
 * - Instead: call initializeCharacterFinancials to create the canonical record via the
 *   financial system, then re-fetch and display the real result.
 * - While initializing: show a loading state. Never invent values.
 *
 * SECONDARY: rent income transactions fetched independently after primary data is visible.
 */
export default function CharacterFinancialSummary({ characterId, financial }) {
  const [rentIncomeSources, setRentIncomeSources] = useState([]);
  const [initializing, setInitializing] = useState(false);
  const [resolvedFinancial, setResolvedFinancial] = useState(null);

  // When financial prop arrives (real record), sync it into local state.
  // When financial prop is null after a creation cycle, keep resolvedFinancial.
  useEffect(() => {
    if (financial) {
      setResolvedFinancial(financial);
    }
  }, [financial]);

  // If no record exists in the prop: attempt a direct fetch by character_id.
  // This covers the case where the profile loads before CharacterCard has populated
  // the ['characterFinancial', characterId] React Query cache.
  // Do NOT call initializeCharacterFinancials from the UI — that creates duplicate records.
  useEffect(() => {
    if (!characterId || financial || resolvedFinancial || initializing) return;

    let cancelled = false;
    setInitializing(true);

    const fetch = async () => {
      try {
        await new Promise(r => setTimeout(r, 800)); // brief delay — let React Query cache warm first
        if (cancelled) return;
        const records = await base44.entities.CharacterFinancial.filter({ character_id: characterId });
        if (cancelled) return;
        if (records[0]) {
          setResolvedFinancial(records[0]);
        }
        // If still null after fetch: character genuinely has no financial record yet.
        // Display nothing — do not initialize, do not invent data.
      } catch (_) {
        // Fetch failed — leave resolvedFinancial null, show "not available" state below.
      } finally {
        if (!cancelled) setInitializing(false);
      }
    };

    fetch();
    return () => { cancelled = true; };
  }, [characterId, financial, resolvedFinancial, initializing]);

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

  // ── LOADING: initializing the canonical record ──────────────────────────────
  if (initializing) {
    return (
      <div className="bg-muted/30 border border-border rounded-xl p-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
        Setting up financial profile…
      </div>
    );
  }

  // ── NO RECORD AND NOT INITIALIZING: no financial data for this character yet ──
  // Do not show fake $0. Do not show a permanent loading state.
  // Show a clear diagnostic — the record either doesn't exist or fetch failed.
  if (!resolvedFinancial) {
    return (
      <div className="bg-muted/30 border border-border rounded-xl p-3 text-xs text-muted-foreground">
        No financial record found for this character.
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