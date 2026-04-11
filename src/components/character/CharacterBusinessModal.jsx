import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { X, Globe, Eye, EyeOff } from "lucide-react";

const BUSINESS_TYPE_CATEGORIES = {
  "Retail & Sales": ["Clothing Store / Boutique", "Convenience Store / Bodega", "Supermarket / Grocery Store", "Electronics Store", "Furniture Store", "Jewelry Store", "Online Retail Store (E-commerce)", "Thrift / Resale Shop"],
  "Food & Hospitality": ["Restaurant", "Café / Coffee Shop", "Bakery", "Catering Business", "Food Truck", "Bar", "Nightclub", "Lounge"],
  "Health & Wellness": ["Gym / Fitness Center", "Personal Training Business", "Yoga / Pilates Studio", "Spa / Massage Therapy", "Barber Shop", "Hair Salon", "Nail Salon", "Medical Practice / Clinic", "Therapy / Counseling Practice"],
  "Professional Services": ["Consulting Firm", "Marketing / Branding Agency", "Accounting / Tax Services", "Legal Practice", "Real Estate Agency", "Insurance Agency", "Staffing / Recruiting Agency"],
  "Criminal / Underground": ["Drug Distribution", "Money Laundering", "Stolen Goods Resale", "Illegal Gambling", "Loan Sharking", "Hacking / Cyber Intrusion", "Counterfeit Goods"],
};

export default function CharacterBusinessModal({ characterId, onClose, onBusinessAdded }) {
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [customType, setCustomType] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [income, setIncome] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const allTypes = Object.values(BUSINESS_TYPE_CATEGORIES).flat();
  const showCustom = customType || (!allTypes.includes(businessType) && businessType);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!businessName.trim() || !businessType.trim() || !visibility) return;

    setIsSubmitting(true);
    try {
      const finalType = showCustom ? customType : businessType;
      
      // Store business in Character's fictional_relationships or custom field
      // For now, we'll use a custom businesses array on character
      const char = await base44.entities.Character.get(characterId);
      const businesses = char.businesses || [];
      
      const newBusiness = {
        id: Math.random().toString(36).substr(2, 9),
        name: businessName.trim(),
        type: finalType,
        visibility,
        income: income ? parseFloat(income) : 0,
        notes: notes.trim(),
        created_at: new Date().toISOString(),
        linked_location_id: null,
      };

      businesses.push(newBusiness);
      await base44.entities.Character.update(characterId, { businesses });

      onBusinessAdded?.();
      onClose();
    } catch (err) {
      console.error("Failed to add business:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-card border border-border rounded-t-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Add Business</h3>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Business Name */}
          <div>
            <label className="text-xs font-medium text-foreground">Business Name *</label>
            <input
              type="text"
              placeholder="e.g. Anderson's Bar, Eastside Agency"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Business Type */}
          <div>
            <label className="text-xs font-medium text-foreground">Business Type *</label>
            <select
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Select or type custom...</option>
              {Object.entries(BUSINESS_TYPE_CATEGORIES).map(([category, types]) => (
                <optgroup key={category} label={category}>
                  {types.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            {showCustom && (
              <input
                type="text"
                placeholder="Custom business type"
                value={customType || businessType}
                onChange={(e) => setCustomType(e.target.value)}
                className="w-full mt-2 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            )}
          </div>

          {/* Visibility */}
          <div>
            <label className="text-xs font-medium text-foreground mb-2 block">Ownership Visibility *</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "public", label: "Public", icon: Globe },
                { value: "private", label: "Private", icon: Eye },
                { value: "secret", label: "Secret", icon: EyeOff },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setVisibility(value)}
                  className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors ${
                    visibility === value
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-medium">{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Income */}
          <div>
            <label className="text-xs font-medium text-foreground">Monthly Income (optional)</label>
            <div className="flex items-center gap-1 mt-1">
              <span className="text-sm text-muted-foreground">$</span>
              <input
                type="number"
                placeholder="0"
                value={income}
                onChange={(e) => setIncome(e.target.value)}
                min="0"
                step="100"
                className="flex-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-foreground">Notes (optional)</label>
            <textarea
              placeholder="Details about this business..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary resize-none"
              rows={2}
            />
          </div>

          {/* Submit */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!businessName.trim() || !businessType.trim() || !visibility || isSubmitting}
              className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? "Adding..." : "Add Business"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}