import React, { useState, useEffect } from "react";
import { Trash2, Plus } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";

const EXPENSE_TYPES = [
  { value: "cell_phone", label: "Cell Phone" },
  { value: "internet", label: "Internet/Wi-Fi" },
  { value: "automotive", label: "Automotive (Gas, Repair)" },
  { value: "insurance", label: "Insurance" },
  { value: "child_support", label: "Child Support" },
  { value: "subscription", label: "Subscription Service" },
  { value: "custom", label: "Custom Expense" },
];

export default function CharacterExpenseManager({ characterId, readOnly = false }) {
  const queryClient = useQueryClient();
  const [financial, setFinancial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newExpense, setNewExpense] = useState({
    name: "",
    amount: "",
    type: "custom",
  });
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    base44.entities.CharacterFinancial.filter({ character_id: characterId })
      .then(results => {
        if (results.length > 0) setFinancial(results[0]);
      })
      .finally(() => setLoading(false));
  }, [characterId]);

  if (loading) return <div className="h-20 bg-secondary/30 rounded-xl animate-pulse" />;
  if (!financial) return null;

  const expenses = financial?.other_monthly_expenses || [];

  const handleAddExpense = async () => {
    if (!newExpense.name.trim() || !newExpense.amount || newExpense.amount <= 0) {
      return;
    }

    setSaving(true);
    try {
      const updated = [
        ...expenses,
        {
          name: newExpense.name.trim(),
          amount: parseFloat(newExpense.amount),
          type: newExpense.type,
          total_paid: 0,
        },
      ];

      await base44.entities.CharacterFinancial.update(financial.id, {
        other_monthly_expenses: updated,
      });

      setNewExpense({ name: "", amount: "", type: "custom" });
      setIsAdding(false);
      queryClient.invalidateQueries({ queryKey: ["character", financial.character_id] });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveExpense = async (idx) => {
    setSaving(true);
    try {
      const updated = expenses.filter((_, i) => i !== idx);

      await base44.entities.CharacterFinancial.update(financial.id, {
        other_monthly_expenses: updated,
      });

      queryClient.invalidateQueries({ queryKey: ["character", financial.character_id] });
    } finally {
      setSaving(false);
    }
  };

  const monthlyTotal = expenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">
          Monthly Expenses
        </p>
        {!readOnly && !isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        )}
      </div>

      {/* Add expense form */}
      {!readOnly && isAdding && (
        <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
          <input
            type="text"
            value={newExpense.name}
            onChange={(e) => setNewExpense({ ...newExpense, name: e.target.value })}
            placeholder="Expense name (e.g., Cell Phone, Car Payment)"
            className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
          />
          <div className="flex gap-2">
            <select
              value={newExpense.type}
              onChange={(e) => setNewExpense({ ...newExpense, type: e.target.value })}
              className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:ring-1 focus:ring-primary"
            >
              {EXPENSE_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={newExpense.amount}
              onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
              placeholder="Amount"
              className="w-24 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setIsAdding(false);
                setNewExpense({ name: "", amount: "", type: "custom" });
              }}
              className="flex-1 px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors text-xs font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleAddExpense}
              disabled={saving || !newExpense.name.trim() || !newExpense.amount}
              className="flex-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-xs font-medium disabled:opacity-50"
            >
              {saving ? "Adding..." : "Add Expense"}
            </button>
          </div>
        </div>
      )}

      {/* Expense list */}
      {expenses.length === 0 && !isAdding ? (
        <p className="text-xs text-muted-foreground italic">No personal expenses added yet.</p>
      ) : (
        <div className="space-y-2">
          {expenses.map((expense, idx) => (
            <div key={idx} className="flex items-center justify-between rounded-lg bg-secondary/50 p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{expense.name}</p>
                <p className="text-xs text-muted-foreground">
                  {EXPENSE_TYPES.find((t) => t.value === expense.type)?.label || expense.type}
                </p>
              </div>
              <div className="text-right ml-3 flex-shrink-0">
                <p className="text-sm font-semibold text-foreground">${expense.amount.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">/month</p>
              </div>
              {!readOnly && (
                <button
                  onClick={() => handleRemoveExpense(idx)}
                  disabled={saving}
                  className="ml-2 p-1.5 rounded-lg text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 disabled:opacity-50"
                  title="Remove expense"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Monthly total */}
      {expenses.length > 0 && (
        <div className="pt-2 border-t border-border">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Total monthly expenses</p>
            <p className="text-sm font-semibold text-foreground">${monthlyTotal.toFixed(2)}</p>
          </div>
        </div>
      )}
    </div>
  );
}