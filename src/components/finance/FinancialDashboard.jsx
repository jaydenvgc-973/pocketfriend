import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { DollarSign, TrendingUp, TrendingDown, Wallet, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ExpenseBreakdownChart from './ExpenseBreakdownChart';

export default function FinancialDashboard({ characterId }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const res = await base44.functions.invoke('getCharacterFinancialSummary', {
          character_id: characterId
        });
        setSummary(res?.data);
      } catch (err) {
        console.error('Failed to fetch financial summary:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [characterId]);

  if (loading) return <div className="text-xs text-muted-foreground">Loading finances...</div>;
  if (!summary) return <div className="text-xs text-muted-foreground">No financial data</div>;

  const formatCurrency = (amount) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);

  const balanceColor = summary.current_balance >= 0 ? 'text-green-400' : 'text-red-500';

  return (
    <div className="space-y-4 bg-card border border-border rounded-xl p-4">
      <div className="grid grid-cols-2 gap-3">
        {/* Current Balance */}
        <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Balance</span>
          </div>
          <p className={`text-lg font-bold ${balanceColor}`}>
            {formatCurrency(summary.current_balance)}
          </p>
        </div>

        {/* Monthly Net */}
        <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-2">
            {summary.net_monthly >= 0 ? (
              <TrendingUp className="w-4 h-4 text-green-400" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-500" />
            )}
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Net Monthly</span>
          </div>
          <p className={`text-lg font-bold ${summary.net_monthly >= 0 ? 'text-green-400' : 'text-red-500'}`}>
            {formatCurrency(summary.net_monthly)}
          </p>
        </div>

        {/* Monthly Income */}
        <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Monthly In</span>
          </div>
          <p className="text-lg font-bold text-emerald-400">
            {formatCurrency(summary.monthly_income)}
          </p>
        </div>

        {/* Monthly Expenses */}
        <div className="bg-secondary/50 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-orange-400" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Monthly Out</span>
          </div>
          <p className="text-lg font-bold text-orange-400">
            {formatCurrency(summary.monthly_expenses)}
          </p>
        </div>
      </div>

      {/* Income Sources */}
      {summary.income_sources?.length > 0 && (
        <div className="pt-3 border-t border-border space-y-2">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Income Sources</p>
          {summary.income_sources.map((source, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm bg-secondary/30 rounded-lg p-2">
              <div>
                <p className="text-foreground font-medium">{source.location_name || 'Employment'}</p>
                <p className="text-xs text-muted-foreground">
                  {source.pay_type === 'annual'
                    ? `Annual salary: ${formatCurrency(source.pay_amount)} (${formatCurrency((source.pay_amount || 0) / 12)}/mo)`
                    : source.pay_type === 'hourly'
                      ? `$${source.pay_amount}/hr · ${source.weekly_hours || '?'} hrs/wk`
                      : `Bi-weekly: ${formatCurrency(source.pay_amount)}`}
                </p>
              </div>
              <p className="text-emerald-400 font-semibold">{formatCurrency(source.total_earned || 0)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Recurring Expenses */}
      {summary.recurring_expenses?.length > 0 && (
        <div className="pt-3 border-t border-border space-y-2">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Monthly Costs</p>
          {summary.recurring_expenses
            .filter(e => ['rent', 'utilities', 'groceries', 'gym', 'phone'].includes(e.expense_type))
            .map((expense, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm bg-secondary/30 rounded-lg p-2">
                <div>
                  <p className="text-foreground font-medium capitalize">{expense.expense_type}</p>
                  <p className="text-xs text-muted-foreground">{expense.location_name || 'Monthly'}</p>
                </div>
                <p className="text-orange-400 font-semibold">{formatCurrency(expense.monthly_cost || 0)}</p>
              </div>
            ))}
        </div>
      )}

      {/* Expense Breakdown Chart */}
      {summary.monthly_expenses > 0 && (
        <div className="pt-4 border-t border-border">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-3">Expense Breakdown</p>
          <ExpenseBreakdownChart transactions={summary.transactions || []} />
        </div>
      )}

      {/* Last Updated */}
      {summary.last_updated && (
        <div className="pt-3 border-t border-border text-xs text-muted-foreground text-center">
          Last updated: {new Date(summary.last_updated).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}