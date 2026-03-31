import { DollarSign, TrendingUp, TrendingDown, Home, Briefcase, ShoppingCart, Dumbbell, Phone, Tv } from 'lucide-react';
import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export default function CharacterFinancialSummary({ characterId }) {
  const [financial, setFinancial] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    base44.entities.CharacterFinancial.filter({ character_id: characterId })
      .then(results => {
        if (results.length > 0) setFinancial(results[0]);
      })
      .finally(() => setLoading(false));
  }, [characterId]);

  if (loading) return <div className="h-32 bg-secondary/30 rounded-xl animate-pulse" />;
  if (!financial) return null;

  const monthlyExpenses = (financial.recurring_expenses || []).reduce((sum, e) => sum + (e.monthly_cost || 0), 0);
  const monthlyRemaining = financial.current_balance - monthlyExpenses;

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
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3">
          <p className="text-xs text-green-400 uppercase font-semibold">Current Balance</p>
          <p className="text-2xl font-bold text-green-300 mt-1">${financial.current_balance?.toFixed(2) || '0.00'}</p>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3">
          <p className="text-xs text-blue-400 uppercase font-semibold">Total Income</p>
          <p className="text-xl font-bold text-blue-300 mt-1">${financial.total_income?.toFixed(2) || '0.00'}</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
          <p className="text-xs text-red-400 uppercase font-semibold">Total Expenses</p>
          <p className="text-xl font-bold text-red-300 mt-1">${financial.total_expenses?.toFixed(2) || '0.00'}</p>
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
            <span className="text-foreground">Monthly Total</span>
            <span className={monthlyRemaining >= 0 ? 'text-green-400' : 'text-red-400'}>
              ${monthlyExpenses.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Remaining Monthly</span>
            <span className={monthlyRemaining >= 0 ? 'text-green-400' : 'text-red-400'}>
              ${monthlyRemaining.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Income Sources */}
      {financial.income_sources && financial.income_sources.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-2">
          <h4 className="text-sm font-semibold text-foreground mb-3">Income Sources</h4>
          {financial.income_sources.map((src, idx) => (
            <div key={idx} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Briefcase className="w-3.5 h-3.5 text-green-400" />
                <span className="text-muted-foreground">
                  {src.location_name} 
                  <span className="text-muted-foreground/60 ml-1">({src.pay_type})</span>
                </span>
              </div>
              <span className="font-semibold text-green-300">
                ${src.pay_amount?.toFixed(2) || '0.00'} {src.pay_type === 'hourly' ? '/hr' : '/yr'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}