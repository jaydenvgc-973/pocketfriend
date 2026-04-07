import React, { useState, useEffect } from "react";
import { Trash2, Plus, User } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";

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
  const [character, setCharacter] = useState(null);
  const [allCharacters, setAllCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newExpense, setNewExpense] = useState({
    name: "",
    amount: "",
    type: "custom",
    payee_id: "",
    payee_name: "",
    payee_type: "none", // none, active_character, npc, family
  });
  const [isAdding, setIsAdding] = useState(false);
  const [showPayeePicker, setShowPayeePicker] = useState(false);

  useEffect(() => {
    Promise.all([
      base44.entities.CharacterFinancial.filter({ character_id: characterId }),
      base44.entities.Character.filter({ id: characterId }),
      base44.entities.Character.list(),
    ])
      .then(([financial, charResults, allChars]) => {
        if (financial.length > 0) setFinancial(financial[0]);
        if (charResults.length > 0) setCharacter(charResults[0]);
        setAllCharacters(allChars || []);
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
          payee_id: newExpense.payee_id || null,
          payee_name: newExpense.payee_name || null,
          payee_type: newExpense.payee_type || "none",
        },
      ];

      await base44.entities.CharacterFinancial.update(financial.id, {
        other_monthly_expenses: updated,
      });

      setNewExpense({ name: "", amount: "", type: "custom", payee_id: "", payee_name: "", payee_type: "none" });
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
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Paid To (Optional)</label>
            <button
              type="button"
              onClick={() => setShowPayeePicker(true)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:ring-1 focus:ring-primary text-left"
            >
              {newExpense.payee_name ? (
                <span className="flex items-center gap-2">
                  <User className="w-3.5 h-3.5" />
                  {newExpense.payee_name}
                  <span className="text-[10px] text-muted-foreground ml-auto">({newExpense.payee_type})</span>
                </span>
              ) : (
                <span className="text-muted-foreground">Select payee...</span>
              )}
            </button>
          </div>
           <div className="flex gap-2">
             <button
               type="button"
               onClick={() => {
                 setIsAdding(false);
                 setNewExpense({ name: "", amount: "", type: "custom", payee_id: "", payee_name: "", payee_type: "none" });
               }}
               className="flex-1 px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors text-xs font-medium"
             >
               Cancel
             </button>
             <button
               type="button"
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
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-muted-foreground">
                    {EXPENSE_TYPES.find((t) => t.value === expense.type)?.label || expense.type}
                  </p>
                  {expense.payee_name && (
                    <p className="text-xs text-primary">→ {expense.payee_name}</p>
                  )}
                </div>
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

      {/* Payee Picker Modal */}
      {showPayeePicker && character && createPortal(
        <PayeePickerModal
          character={character}
          allCharacters={allCharacters}
          onSelect={(payeeId, payeeName, payeeType) => {
            setNewExpense({ ...newExpense, payee_id: payeeId, payee_name: payeeName, payee_type: payeeType });
            setShowPayeePicker(false);
          }}
          onClose={() => setShowPayeePicker(false)}
        />,
        document.body
      )}
    </div>
  );
}

function PayeePickerModal({ character, allCharacters, onSelect, onClose }) {
  const [tab, setTab] = useState("active"); // active, npc, family

  // Active characters
  const activeCharacters = allCharacters.filter(c =>
    c.id !== character.id &&
    c.status !== "deleted" &&
    c.status !== "soft_deleted" &&
    c.character_type !== "npc" &&
    c.character_type !== "family_npc"
  );

  // NPCs (fictional relationships)
  const npcRelationships = (character.fictional_relationships || []).filter(r =>
    r.related_character_id &&
    allCharacters.find(c => c.id === r.related_character_id && (c.character_type === "npc" || c.character_type === "family_npc"))
  );

  // Family members
  const familyMembers = (character.family_members || []).filter(m => m.name?.trim());

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground">Who does this expense go to?</p>
          <p className="text-xs text-muted-foreground mt-1">Select a character or person</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab("active")}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${tab === "active" ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            Active Characters ({activeCharacters.length})
          </button>
          <button
            onClick={() => setTab("npc")}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${tab === "npc" ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            NPCs ({npcRelationships.length})
          </button>
          <button
            onClick={() => setTab("family")}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${tab === "family" ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            Family ({familyMembers.length})
          </button>
        </div>

        {/* Content */}
        <div className="max-h-96 overflow-y-auto">
          {tab === "active" && (
            <div className="space-y-1">
              {activeCharacters.length === 0 ? (
                <p className="text-xs text-muted-foreground p-4">No active characters.</p>
              ) : (
                activeCharacters.map(c => (
                  <button
                    key={c.id}
                    onClick={() => onSelect(c.id, c.name, "active_character")}
                    className="w-full text-left px-4 py-2 hover:bg-secondary transition-colors flex items-center gap-2"
                  >
                    {c.avatar_url
                      ? <img src={c.avatar_url} alt={c.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                      : <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-bold text-primary">{c.name?.[0]}</span></div>
                    }
                    <span className="text-sm text-foreground">{c.name}</span>
                  </button>
                ))
              )}
            </div>
          )}

          {tab === "npc" && (
            <div className="space-y-1">
              {npcRelationships.length === 0 ? (
                <p className="text-xs text-muted-foreground p-4">No NPCs in relationships.</p>
              ) : (
                npcRelationships.map((rel, idx) => (
                  <button
                    key={idx}
                    onClick={() => onSelect(rel.related_character_id, rel.person_name, "npc")}
                    className="w-full text-left px-4 py-2 hover:bg-secondary transition-colors flex items-center gap-2"
                  >
                    {rel.avatar_url
                      ? <img src={rel.avatar_url} alt={rel.person_name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                      : <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-bold text-primary">{rel.person_name?.[0]}</span></div>
                    }
                    <span className="text-sm text-foreground">{rel.person_name}</span>
                  </button>
                ))
              )}
            </div>
          )}

          {tab === "family" && (
            <div className="space-y-1">
              {familyMembers.length === 0 ? (
                <p className="text-xs text-muted-foreground p-4">No family members.</p>
              ) : (
                familyMembers.map((member, idx) => (
                  <button
                    key={idx}
                    onClick={() => onSelect(null, member.name, "family")}
                    className="w-full text-left px-4 py-2 hover:bg-secondary transition-colors flex items-center gap-2"
                  >
                    {member.photo_url
                      ? <img src={member.photo_url} alt={member.name} className="w-6 h-6 rounded-full object-cover flex-shrink-0" />
                      : <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-bold text-primary">{member.name?.[0]}</span></div>
                    }
                    <span className="text-sm text-foreground">{member.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="w-full px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground transition-colors text-xs font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}