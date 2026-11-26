import React from "react";
import { Input } from "@/components/ui/input";

/**
 * LocationHousingCostFields — the monthly rent, bedroom count and utilities of a home or a
 * Generic property. Display only: it reads the form and writes through the same `update`
 * the rest of the form uses, so nothing is stored twice.
 *
 * An Unhoused Living Space is somewhere a character stays, not housing — it never shows a
 * rent, a bedroom count or utility bills.
 */
export default function LocationHousingCostFields({ form, update, isUnhoused = false }) {
  if (!(form.category === "home" || form.category === "generic") || isUnhoused) return null;

  return (
    <div className="space-y-3 bg-primary/5 border border-primary/20 rounded-xl p-4">
      <div>
        <label className="text-xs font-semibold text-foreground uppercase mb-2 block">Monthly Rent</label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">$</span>
          <Input type="number" value={form.rent_or_housing_cost} onChange={e => update("rent_or_housing_cost", parseFloat(e.target.value))} placeholder="1200" className="h-10 rounded-xl flex-1" />
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-foreground uppercase mb-2 block">Bedrooms</label>
        <Input type="number" min="1" value={form.bedroom_count} onChange={e => {
          const count = parseInt(e.target.value) || 1;
          update("bedroom_count", count);
          if (form.rent_or_housing_cost === 1200 || form.rent_or_housing_cost === 1200 + ((form.bedroom_count - 1) * 300)) {
            update("rent_or_housing_cost", 1200 + ((count - 1) * 300));
          }
        }} className="h-10 rounded-xl" />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-semibold text-foreground uppercase">Monthly Utilities</label>
        {Object.entries(form.utility_costs || {}).map(([key, val]) => (
          <div key={key} className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground capitalize w-20">{key}:</label>
            <div className="flex items-center gap-2 flex-1">
              <span className="text-sm">$</span>
              <Input type="number" value={val || 0} onChange={e => update("utility_costs", { ...form.utility_costs, [key]: parseFloat(e.target.value) || 0 })} className="h-8 rounded-lg flex-1 text-sm" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}