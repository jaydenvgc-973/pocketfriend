import React, { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { X, DollarSign, Check } from "lucide-react";

export default function BusinessPaymentEditor({ business, characterId, onClose, onSaved, type = "revenue" }) {
  const [amount, setAmount] = useState(business.income || business.monthly_owner_revenue || 0);
  const [selectedWorkers, setSelectedWorkers] = useState(business.worker_character_ids || []);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: ownerChar = null } = useQuery({
    queryKey: ["ownerCharacter", characterId],
    queryFn: () => base44.entities.Character.get(characterId),
  });

  const { data: allCharacters = [] } = useQuery({
    queryKey: ["allCharacters", characterId],
    queryFn: async () => {
      const char = await base44.entities.Character.get(characterId);
      if (!char?.created_by) return [];
      const chars = await base44.entities.Character.filter({ created_by: char.created_by, status: "active" });
      return chars.filter(c => c.id !== characterId);
    },
  });

  // Build worker options: all Character entities (active/npc/family_npc), then unlinked fictional NPCs, then unlinked family members
  // Priority: Character entities take precedence, then deduplicate by name
  const workerOptions = (() => {
    const options = [];
    const usedNames = new Set();

    // All Character entities (active, npc, family_npc types) — age filter: 16+ or undefined
    if (allCharacters.length > 0) {
      const linkedItems = allCharacters
        .filter(c => !c.age || c.age >= 16)
        .map(c => {
          usedNames.add(c.name.toLowerCase());
          return { id: c.id, name: c.name, type: 'character' };
        });
      if (linkedItems.length > 0) {
        options.push({ category: 'Characters', items: linkedItems });
      }
    }

    // Unlinked Fictional NPCs from fictional_relationships (deduplicated)
    if (ownerChar?.fictional_relationships?.length > 0) {
      const npcs = ownerChar.fictional_relationships
        .filter(r => !r.related_character_id && !usedNames.has(r.person_name?.toLowerCase()))
        .map(r => {
          usedNames.add(r.person_name.toLowerCase());
          return { id: r.person_name, name: r.person_name, type: 'npc' };
        });
      if (npcs.length > 0) {
        options.push({ category: 'Fictional NPCs', items: npcs });
      }
    }

    // Unlinked Family Members from family_members (age filter: 16+ or undefined, deduplicated)
    if (ownerChar?.family_members?.length > 0) {
      const family = ownerChar.family_members
        .filter(f => !usedNames.has(f.name?.toLowerCase()) && (!f.age_at_creation || f.age_at_creation >= 16))
        .map(f => {
          usedNames.add(f.name.toLowerCase());
          return { id: f.name, name: f.name, type: 'family' };
        });
      if (family.length > 0) {
        options.push({ category: 'Family Members', items: family });
      }
    }

    return options;
  })();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      if (type === "revenue" && business.isLocationBased) {
        // Update location revenue
        await base44.entities.LocationReference.update(business.linkedLocationId, {
          income_generated: parseFloat(amount)
        });
      } else if (type === "worker-pay") {
        // Update custom business worker pay and workers, trigger immediate payment
        const char = await base44.entities.Character.get(characterId);
        const businesses = char.businesses || [];
        const idx = businesses.findIndex(b => b.id === business.id);
        
        if (idx >= 0) {
          businesses[idx].monthly_worker_pay = parseFloat(amount);
          businesses[idx].worker_character_ids = selectedWorkers;
          await base44.entities.Character.update(characterId, { businesses });
          
          // Process immediate retroactive payment
          try {
            await base44.functions.invoke("processBusinessWorkerPayment", {
              characterId,
              businessId: business.id,
              amount: parseFloat(amount),
              isRetroactive: true
            });
          } catch (err) {
            console.warn("Payment processing queued:", err.message);
          }
        }
      }
      
      onSaved?.();
      onClose();
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const label = type === "revenue" ? "Monthly Revenue" : "Weekly Worker Pay";
  const description = type === "revenue" 
    ? "Income from this business location"
    : "What each worker earns per week (paid Fridays)";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-card border border-border rounded-t-3xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Edit {label}</h3>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {type === "worker-pay" && (
            <div>
              <label className="text-xs font-medium text-foreground mb-2 block">Workers</label>
              <p className="text-xs text-muted-foreground mb-2">Who works at this business?</p>
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {workerOptions.length > 0 ? (
                  workerOptions.map((group) => (
                    <div key={group.category}>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
                        {group.category}
                      </p>
                      <div className="space-y-1">
                        {group.items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setSelectedWorkers(prev =>
                                prev.includes(item.id)
                                  ? prev.filter(id => id !== item.id)
                                  : [...prev, item.id]
                              );
                            }}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-left ${
                              selectedWorkers.includes(item.id)
                                ? "border-primary bg-primary/10"
                                : "border-border hover:border-primary/40"
                            }`}
                          >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                              selectedWorkers.includes(item.id) ? "bg-primary" : "bg-secondary"
                            }`}>
                              {selectedWorkers.includes(item.id) && <Check className="w-3 h-3 text-primary-foreground" />}
                            </div>
                            <span className="text-xs text-foreground font-medium">{item.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground italic">No workers available</p>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-foreground mb-2 block">{label}</label>
            <p className="text-xs text-muted-foreground mb-3">{description}</p>
            <div className="flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-muted-foreground" />
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0"
                step="0.01"
                placeholder="0.00"
                className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {type === "worker-pay" && (
            <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
              <p className="text-xs font-medium text-primary mb-1">⏱️ Immediate Payment</p>
              <p className="text-xs text-primary/80">One payment of ${parseFloat(amount || 0).toFixed(2)} will be processed retroactively (as of yesterday), then recurring every Friday.</p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}