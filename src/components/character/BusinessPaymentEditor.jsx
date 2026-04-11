import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { X, DollarSign } from "lucide-react";

export default function BusinessPaymentEditor({ business, characterId, onClose, onSaved, type = "revenue" }) {
  const [amount, setAmount] = useState(business.income || business.monthly_owner_revenue || 0);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        // Update custom business worker pay and trigger immediate payment
        const char = await base44.entities.Character.get(characterId);
        const businesses = char.businesses || [];
        const idx = businesses.findIndex(b => b.id === business.id);
        
        if (idx >= 0) {
          businesses[idx].monthly_worker_pay = parseFloat(amount);
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
    : "What workers earn per week (paid Fridays)";

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