import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, DollarSign, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { format, startOfMonth, endOfMonth } from "date-fns";

const TYPE_LABELS = {
  gift: "Gift",
  loan: "Loan",
  repayment: "Repayment",
  purchase: "Purchase",
  income: "Income",
  rent: "Rent",
  utilities: "Utilities",
  groceries: "Groceries",
  gym: "Gym",
  tuition: "Tuition",
  childcare: "Childcare",
  bar_restaurant: "Food Order",
  entertainment: "Entertainment",
  transport: "Transport",
  clothing: "Clothing",
  healthcare: "Healthcare",
  simulated_need: "Needs (Auto)",
  scene_purchase: "Scene Purchase",
  payroll: "Payroll",
  other: "Other",
};

const TYPE_COLORS = {
  income: "text-green-400",
  payroll: "text-green-400",
  gift: "text-emerald-400",
  repayment: "text-emerald-300",
  loan: "text-amber-400",
  rent: "text-red-400",
  utilities: "text-orange-400",
  groceries: "text-yellow-400",
  gym: "text-cyan-400",
  tuition: "text-purple-400",
  childcare: "text-pink-400",
  bar_restaurant: "text-amber-500",
  entertainment: "text-violet-400",
  transport: "text-blue-400",
  clothing: "text-rose-400",
  healthcare: "text-teal-400",
  simulated_need: "text-muted-foreground",
  scene_purchase: "text-indigo-400",
  purchase: "text-orange-300",
  other: "text-muted-foreground",
};

export default function MonthlyStatementPanel({ characterId }) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [currentBalance, setCurrentBalance] = useState(0);

  // Parse selected month to get start/end dates
  const [year, month] = selectedMonth.split("-").map(Number);
  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = endOfMonth(new Date(year, month - 1, 1));

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["financialTransactions", characterId, selectedMonth],
    queryFn: async () => {
      const txns = await base44.entities.FinancialTransaction.filter({ character_id: characterId }, '-timestamp', 500);
      // Get current balance from character record
      if (characterId) {
        const char = await base44.asServiceRole.entities.Character.get(characterId).catch(() => null);
        if (char?.current_balance != null) {
          setCurrentBalance(char.current_balance);
        }
      }
      return txns;
    },
    enabled: !!characterId && isOpen,
    staleTime: 30000,
  });

  // Filter to the selected month
  const monthTransactions = transactions.filter(t => {
    if (!t.timestamp) return false;
    const d = new Date(t.timestamp);
    return d >= monthStart && d <= monthEnd;
  }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const totalIncome = monthTransactions
    .filter(t => t.direction === "income")
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const totalExpenses = monthTransactions
    .filter(t => t.direction === "expense")
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const net = totalIncome - totalExpenses;

  // Generate past 6 months for selector
  const monthOptions = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { key, label: format(d, "MMMM yyyy") };
  });

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-primary" />
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Monthly Statement</span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <div className="border-t border-border">
          {/* Month selector */}
          <div className="px-4 pt-3 pb-2">
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-secondary border border-border text-foreground text-xs outline-none focus:ring-1 focus:ring-primary/50"
            >
              {monthOptions.map(o => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Summary row */}
          <div className="grid grid-cols-2 gap-2 px-4 pb-3">
            <div className="bg-green-500/10 rounded-xl p-2.5 text-center">
              <TrendingUp className="w-3.5 h-3.5 text-green-400 mx-auto mb-1" />
              <p className="text-[10px] text-muted-foreground">Current Balance</p>
              <p className="text-sm font-bold text-green-400">${currentBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-red-500/10 rounded-xl p-2.5 text-center">
              <TrendingDown className="w-3.5 h-3.5 text-red-400 mx-auto mb-1" />
              <p className="text-[10px] text-muted-foreground">Total Spent</p>
              <p className="text-sm font-bold text-red-400">${totalExpenses.toLocaleString()}</p>
            </div>
          </div>

          {/* Transaction list */}
          <div className="border-t border-border max-h-80 overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center py-6">
                <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
              </div>
            ) : monthTransactions.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-6 italic">No transactions this month.</p>
            ) : (
              <div className="divide-y divide-border">
                {monthTransactions.map((t, idx) => (
                  <div key={t.id || idx} className="flex items-start gap-3 px-4 py-3">
                    <div className={`mt-0.5 flex-shrink-0 ${t.direction === "income" ? "text-green-400" : "text-red-400"}`}>
                      {t.direction === "income"
                        ? <ArrowUpRight className="w-3.5 h-3.5" />
                        : <ArrowDownLeft className="w-3.5 h-3.5" />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground leading-snug">{t.description}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] font-medium ${TYPE_COLORS[t.transaction_type] || "text-muted-foreground"}`}>
                          {TYPE_LABELS[t.transaction_type] || t.transaction_type}
                        </span>
                        {t.location_name && (
                          <span className="text-[10px] text-muted-foreground/60 truncate">· {t.location_name}</span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                        {t.timestamp ? format(new Date(t.timestamp), "MMM d, h:mm a") : ""}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-semibold ${t.direction === "income" ? "text-green-400" : "text-red-400"}`}>
                        {t.direction === "income" ? "+" : "-"}${(t.amount || 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  ))}
                  </div>
                  )}
                  </div>
                  </div>
                  )}
                  </div>
                  );
                  }