import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, DollarSign, CreditCard } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Display financial summary for a character:
 * - Current balance
 * - Total income & expenses
 * - Recurring expenses breakdown
 * - Monthly balance projection
 */
export default function FinancialSummary({ characterId, characterName }) {
  const { data: financial, isLoading } = useQuery({
    queryKey: ["characterFinancial", characterId],
    queryFn: () => base44.asServiceRole.entities.CharacterFinancial.filter(
      { character_id: characterId }
    ).then(arr => arr[0]),
    enabled: !!characterId,
  });

  if (isLoading) {
    return (
      <div className="bg-card rounded-2xl border border-border p-4 space-y-3">
        <div className="h-4 bg-muted rounded animate-pulse" />
        <div className="h-4 bg-muted rounded animate-pulse w-2/3" />
      </div>
    );
  }

  if (!financial) {
    return null;
  }

  const currentBalance = financial.current_balance || 0;
  const monthlyExpenses = (financial.recurring_expenses || []).reduce((sum, e) => sum + (e.monthly_cost || 0), 0);
  const monthlyIncome = (financial.income_sources || []).reduce((sum, i) => sum + (i.pay_amount || 0), 0);
  const monthlyNet = monthlyIncome - monthlyExpenses;

  return (
    <div className="space-y-4">
      {/* Main balance card */}
      <div className="bg-gradient-to-br from-primary/10 to-accent/10 rounded-2xl border border-primary/20 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Current Balance</span>
          <DollarSign className="w-4 h-4 text-primary" />
        </div>
        <div className="text-2xl font-bold text-foreground">
          ${currentBalance.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {currentBalance > 0 ? "Positive balance" : "In debt"}
        </p>
      </div>

      {/* Income vs Expenses */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-green-500/70" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Monthly Income</span>
          </div>
          <p className="text-lg font-semibold text-foreground">
            ${monthlyIncome.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {financial.work_location_names?.length > 0 ? `${financial.work_location_names.length} job${financial.work_location_names.length > 1 ? 's' : ''}` : "Not employed"}
          </p>
        </div>
        <div className="bg-card rounded-xl border border-border p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingDown className="w-3.5 h-3.5 text-red-500/70" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Monthly Expenses</span>
          </div>
          <p className="text-lg font-semibold text-foreground">
            ${monthlyExpenses.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {(financial.recurring_expenses || []).length} expense{(financial.recurring_expenses || []).length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Monthly Net */}
      <div className="bg-secondary/40 rounded-xl border border-border p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Monthly Net</span>
          <CreditCard className="w-3.5 h-3.5 text-primary" />
        </div>
        <p className={`text-lg font-semibold ${monthlyNet >= 0 ? "text-green-500" : "text-red-500"}`}>
          {monthlyNet >= 0 ? "+" : "-"}${Math.abs(monthlyNet).toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {monthlyNet >= 0 ? "Savings per month" : "Deficit per month"}
        </p>
      </div>

      {/* Expenses breakdown */}
      {(financial.recurring_expenses || []).length > 0 && (
        <div className="bg-card rounded-xl border border-border p-3 space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-3">Recurring Expenses</p>
          {financial.recurring_expenses.map((exp, idx) => (
            <div key={idx} className="flex items-center justify-between text-sm">
              <span className="text-foreground capitalize">
                {exp.expense_type === "custom" ? exp.description : exp.expense_type.replace(/_/g, " ")}
              </span>
              <span className="text-muted-foreground font-medium">
                ${exp.monthly_cost.toLocaleString('en-US', { maximumFractionDigits: 0 })}/mo
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Total lifetime stats */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="bg-secondary/20 rounded-lg p-2">
          <p className="text-muted-foreground uppercase tracking-wider text-[9px]">Lifetime Income</p>
          <p className="text-foreground font-semibold text-sm mt-1">
            ${(financial.total_income || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="bg-secondary/20 rounded-lg p-2">
          <p className="text-muted-foreground uppercase tracking-wider text-[9px]">Lifetime Expenses</p>
          <p className="text-foreground font-semibold text-sm mt-1">
            ${(financial.total_expenses || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>
    </div>
  );
}