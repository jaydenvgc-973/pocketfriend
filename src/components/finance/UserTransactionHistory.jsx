import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ChevronDown, ChevronUp, Receipt, ArrowUpRight, ArrowDownLeft } from "lucide-react";

/**
 * UserTransactionHistory
 *
 * The account holder's own ledger. Every purchase paid from their balance is written by
 * the existing transaction authority (executeSceneTransaction) under the established
 * 'user' ledger id — the same convention used for VGC Mobile payments and transfers.
 * This reads that ledger; it never writes, never recalculates the balance.
 */
const TYPE_LABELS = {
  scene_purchase: "Purchase",
  purchase: "Purchase",
  clothing: "Clothing",
  bar_restaurant: "Food & Drink",
  groceries: "Groceries",
  entertainment: "Entertainment",
  transport: "Transport",
  healthcare: "Healthcare",
  rent: "Rent",
  utilities: "Utilities",
  gift: "Gift",
  income: "Income",
  payroll: "Payroll",
  loan: "Loan",
  repayment: "Repayment",
  other: "Other",
};

// Authoritative app timezone — never present UTC to the user.
const etDateTime = (iso) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function UserTransactionHistory() {
  const [isOpen, setIsOpen] = useState(false);

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["userTransactionHistory"],
    queryFn: () => base44.entities.FinancialTransaction.filter({ character_id: "user" }, "-timestamp", 100),
    enabled: isOpen,
    staleTime: 0,
  });

  const spent = transactions
    .filter((t) => t.direction === "expense")
    .reduce((sum, t) => sum + (t.amount || 0), 0);
  const received = transactions
    .filter((t) => t.direction === "income")
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Receipt className="w-4 h-4 text-primary flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Transaction History</p>
            <p className="text-[10px] text-muted-foreground">Your own purchases & payments</p>
          </div>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>

      {isOpen && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="px-2 py-1 rounded-lg bg-red-500/10 text-red-400 font-medium">
              Spent ${spent.toFixed(2)}
            </span>
            <span className="px-2 py-1 rounded-lg bg-green-500/10 text-green-400 font-medium">
              Received ${received.toFixed(2)}
            </span>
          </div>

          {isLoading ? (
            <div className="py-6 flex justify-center">
              <div className="w-5 h-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          ) : transactions.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No transactions yet.</p>
          ) : (
            <div className="divide-y divide-border/60 max-h-80 overflow-y-auto">
              {transactions.map((t) => {
                const isIncome = t.direction === "income";
                return (
                  <div key={t.id} className="flex items-start gap-2.5 py-2.5">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isIncome ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
                      }`}
                    >
                      {isIncome ? <ArrowDownLeft className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground leading-snug break-words">
                        {t.description || TYPE_LABELS[t.transaction_type] || "Transaction"}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {TYPE_LABELS[t.transaction_type] || "Other"} · {t.timestamp ? etDateTime(t.timestamp) : ""}
                      </p>
                    </div>
                    <p className={`text-xs font-semibold flex-shrink-0 ${isIncome ? "text-green-400" : "text-red-400"}`}>
                      {isIncome ? "+" : "−"}${(t.amount || 0).toFixed(2)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}