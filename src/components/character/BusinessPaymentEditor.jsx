import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { X, DollarSign, Check } from "lucide-react";

export default function BusinessPaymentEditor({ business, characterId, onClose, onSaved, type = "revenue" }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(business.income || business.monthly_owner_revenue || 0);
  const [selectedWorkers, setSelectedWorkers] = useState(business.worker_character_ids || []);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: allCharacters = [] } = useQuery({
    queryKey: ["allCharacters", characterId],
    queryFn: async () => {
      const char = await base44.entities.Character.get(characterId);
      if (!char?.created_by) return [];
      const chars = await base44.entities.Character.filter({ created_by: char.created_by, status: "active" });
      return chars.filter(c => c.id !== characterId);
    },
  });

  const workerOptions = (() => {
    const options = [];
    const active = allCharacters
      .filter(c => c.character_type === 'active' && (!c.age || c.age >= 16))
      .map(c => ({ id: c.id, name: c.name, type: 'character' }));
    if (active.length > 0) {
      options.push({ category: 'Active Created Characters', items: active });
    }
    const npcs = allCharacters
      .filter(c => c.character_type === 'npc' && (!c.age || c.age >= 16))
      .map(c => ({ id: c.id, name: c.name, type: 'npc' }));
    if (npcs.length > 0) {
      options.push({ category: 'NPC Fictional People', items: npcs });
    }
    const family = allCharacters
      .filter(c => c.character_type === 'family_npc' && (!c.age || c.age >= 16))
      .map(c => ({ id: c.id, name: c.name, type: 'family' }));
    if (family.length > 0) {
      options.push({ category: 'NPC Family Members', items: family });
    }
    return options;
  })();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      const paymentAmount = parseFloat(amount);
      const char = await base44.entities.Character.get(characterId);
      
      if (type === "revenue") {
        // Location-based vs custom business logic
        const isLocationBased = !!business.linkedLocationId;
        
        if (isLocationBased) {
          // For location-based: ONLY update the LocationReference
          await base44.entities.LocationReference.update(business.linkedLocationId, {
            income_generated: paymentAmount
          });
        } else {
          // For custom businesses: update character.businesses array
          const businesses = (char.businesses || []).map(b => {
            if (b.id === business.id) {
              return { ...b, income: paymentAmount };
            }
            return b;
          });
          
          // Add if not found
          if (!businesses.find(b => b.id === business.id)) {
            businesses.push({ ...business, income: paymentAmount });
          }
          
          await base44.entities.Character.update(characterId, { businesses });
        }
        
        // Get or create financial record
        let financial = (await base44.entities.CharacterFinancial.filter({ character_id: characterId }))[0];
        if (!financial) {
          financial = await base44.entities.CharacterFinancial.create({
            character_id: characterId,
            character_name: char.name,
            current_balance: 6000,
            total_income: 0,
            total_expenses: 0,
          });
        }
        
        // Create income transaction and update balance
        const newBalance = financial.current_balance + paymentAmount;
        await base44.entities.CharacterFinancial.update(financial.id, {
          current_balance: newBalance,
          total_income: (financial.total_income || 0) + paymentAmount,
        });

        await base44.entities.FinancialTransaction.create({
          character_id: characterId,
          character_name: char.name,
          sender_id: 'system',
          sender_type: 'system',
          sender_name: 'Business System',
          receiver_id: characterId,
          receiver_type: 'character',
          receiver_name: char.name,
          amount: paymentAmount,
          direction: 'income',
          transaction_type: 'income',
          description: `Business revenue from ${business.name}`,
          balance_after: newBalance,
          timestamp: new Date().toISOString(),
        });
      } else if (type === "worker-pay") {
        const businesses = char.businesses || [];
        const idx = businesses.findIndex(b => b.id === business.id);
        
        if (idx >= 0) {
          businesses[idx].monthly_worker_pay = paymentAmount;
          businesses[idx].worker_character_ids = selectedWorkers;
          await base44.entities.Character.update(characterId, { businesses });
        }
        
        if (selectedWorkers.length > 0) {
          for (const workerId of selectedWorkers) {
            const response = await base44.functions.invoke('processBusinessPaymentImmediate', {
              characterId: workerId,
              businessId: business.id,
              amount: paymentAmount,
              type: 'worker-pay',
              workerIds: selectedWorkers,
            });
            console.log(`Worker ${workerId} payment response:`, response.data);
          }
        }
      }
      
      queryClient.invalidateQueries({ queryKey: ["character", characterId] });
      queryClient.invalidateQueries({ queryKey: ["characterFinancial", characterId] });
      queryClient.invalidateQueries({ queryKey: ["ownedLocations", characterId] });
      
      onSaved?.();
      onClose();
    } catch (err) {
      console.error("Failed to save:", err);
      alert('Error processing payment: ' + err.message);
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