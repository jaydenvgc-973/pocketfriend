import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Zap, X, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

const QUIRK_CATALOG = [
  // Spending
  { quirk_id: "shopaholic", label: "Shopaholic", category: "spending", emoji: "🛍️", description: "Impulse purchases when stressed, bored, or near stores. Creates joy then guilt." },
  { quirk_id: "retail_therapy", label: "Retail Therapy", category: "spending", emoji: "💳", description: "Spends to cope with emotional lows. Tied to mood, not routine." },
  { quirk_id: "sneaker_obsession", label: "Sneaker Obsession", category: "spending", emoji: "👟", description: "Buys limited releases. Builds outfits around shoes. High excitement, low guilt." },
  { quirk_id: "luxury_oriented", label: "Luxury-Oriented", category: "spending", emoji: "💎", description: "Prefers premium options. Frustration when downgraded." },
  { quirk_id: "frugal", label: "Frugal", category: "spending", emoji: "🪙", description: "Avoids unnecessary spending. Stress when forced to overpay." },
  { quirk_id: "impulsive_spender", label: "Impulsive Spender", category: "spending", emoji: "💸", description: "Acts on financial urges fast. Regret common." },
  { quirk_id: "financially_anxious", label: "Financially Anxious", category: "spending", emoji: "😰", description: "High stress around money. Conflicts with spending quirks." },
  { quirk_id: "generous", label: "Generous", category: "spending", emoji: "🎁", description: "Frequently pays for others. Fulfillment but possible regret." },
  // Addictions
  { quirk_id: "smoker", label: "Smoker", category: "addiction", emoji: "🚬", description: "Recurring urge. Habit expense. Short relief, long-term health decline." },
  { quirk_id: "social_smoker", label: "Social Smoker", category: "addiction", emoji: "🎉", description: "Only smokes in social/nightlife settings. Clustered spending." },
  { quirk_id: "drinker", label: "Drinker", category: "addiction", emoji: "🥃", description: "Regular alcohol use. Social or solo. Affects mood, health, finances." },
  { quirk_id: "stress_eater", label: "Stress Eater", category: "addiction", emoji: "🍔", description: "Food spending spikes under stress. Comfort followed by guilt." },
  { quirk_id: "gambling", label: "Gambling", category: "addiction", emoji: "🎲", description: "Thrill-seeking financial risk. Variable outcomes, emotional swings." },
  { quirk_id: "overworking", label: "Overworking", category: "addiction", emoji: "⚙️", description: "Can't disconnect from work. Burnout risk, relationship strain." },
  // Lifestyle
  { quirk_id: "fitness_guru", label: "Fitness Guru", category: "lifestyle", emoji: "🏋️", description: "Gym is a priority. Fitness spending, emotional reward, frustration if disrupted." },
  { quirk_id: "health_obsessed", label: "Health Obsessed", category: "lifestyle", emoji: "🥗", description: "Proactive wellness. Consistent health spending. Stability tied to routine." },
  { quirk_id: "gym_avoidant", label: "Gym Avoidant", category: "lifestyle", emoji: "🛋️", description: "Avoids exercise despite knowing better. Guilt and slow health decline." },
  { quirk_id: "homebody", label: "Homebody", category: "lifestyle", emoji: "🏠", description: "Stays home. Lower spending, less movement. Comfort in routine." },
  { quirk_id: "always_outside", label: "Always Outside", category: "lifestyle", emoji: "🌳", description: "Constantly moving and going out. Higher spending, social energy." },
  { quirk_id: "disciplined", label: "Disciplined", category: "lifestyle", emoji: "📋", description: "Sticks to routines. Rarely impulsive. Stable finances and health." },
  // Emotional
  { quirk_id: "overthinker", label: "Overthinker", category: "emotional", emoji: "🌀", description: "Delays decisions, creates anxiety. Affects timing and spending." },
  { quirk_id: "people_pleaser", label: "People Pleaser", category: "emotional", emoji: "🙏", description: "Spends on others, avoids conflict. Burnout and financial drain." },
  { quirk_id: "emotionally_guarded", label: "Emotionally Guarded", category: "emotional", emoji: "🧱", description: "Slow to open up. Deflects vulnerability. Dialogue stays surface-level until trust builds." },
  { quirk_id: "jealous", label: "Jealous", category: "emotional", emoji: "👀", description: "Compares to others. Reactive emotionally. Can trigger impulsive spending." },
  { quirk_id: "thrill_seeker", label: "Thrill Seeker", category: "emotional", emoji: "🎢", description: "Seeks excitement and risk. Reckless financially and socially." },
  { quirk_id: "dependent", label: "Dependent", category: "emotional", emoji: "🔗", description: "Borrows money, relies on others. Tied to support systems." },
  // Work
  { quirk_id: "workaholic", label: "Workaholic", category: "work", emoji: "💼", description: "Prioritizes work over everything. Higher income but burnout risk." },
  { quirk_id: "entrepreneurial", label: "Entrepreneurial", category: "work", emoji: "🚀", description: "Builds side businesses. Variable income, reinvestment mindset." },
  { quirk_id: "unmotivated", label: "Unmotivated", category: "work", emoji: "😴", description: "Avoids responsibility. Leads to financial instability over time." },
];

const CATEGORY_LABELS = {
  spending: { label: "Spending", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/20" },
  addiction: { label: "Habits & Addictions", color: "text-red-400", bg: "bg-red-400/10 border-red-400/20" },
  lifestyle: { label: "Lifestyle", color: "text-green-400", bg: "bg-green-400/10 border-green-400/20" },
  emotional: { label: "Emotional", color: "text-blue-400", bg: "bg-blue-400/10 border-blue-400/20" },
  work: { label: "Work & Identity", color: "text-purple-400", bg: "bg-purple-400/10 border-purple-400/20" },
};

const INTENSITY_OPTIONS = ["mild", "moderate", "strong"];

export default function CharacterQuirksPanel({ character }) {
  const queryClient = useQueryClient();
  const [showCatalog, setShowCatalog] = useState(false);
  const [saving, setSaving] = useState(false);

  const quirks = character?.quirks || [];

  const saveQuirks = async (newQuirks) => {
    setSaving(true);
    await base44.entities.Character.update(character.id, { quirks: newQuirks });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
    setSaving(false);
  };

  const addQuirk = async (catalog) => {
    const already = quirks.find(q => q.quirk_id === catalog.quirk_id);
    if (already) return;
    const newQuirk = {
      quirk_id: catalog.quirk_id,
      label: catalog.label,
      category: catalog.category,
      intensity: "moderate",
      active: true,
      trigger_count: 0,
    };
    await saveQuirks([...quirks, newQuirk]);
  };

  const removeQuirk = async (quirk_id) => {
    await saveQuirks(quirks.filter(q => q.quirk_id !== quirk_id));
  };

  const toggleActive = async (quirk_id) => {
    await saveQuirks(quirks.map(q => q.quirk_id === quirk_id ? { ...q, active: !q.active } : q));
  };

  const updateIntensity = async (quirk_id, intensity) => {
    await saveQuirks(quirks.map(q => q.quirk_id === quirk_id ? { ...q, intensity } : q));
  };

  const grouped = QUIRK_CATALOG.reduce((acc, q) => {
    if (!acc[q.category]) acc[q.category] = [];
    acc[q.category].push(q);
    return acc;
  }, {});

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Personality Quirks</p>
        </div>
        <button
          onClick={() => setShowCatalog(v => !v)}
          className="flex items-center gap-1 text-xs text-primary font-medium hover:opacity-80 transition-opacity"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Quirk
          {showCatalog ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">Quirks actively influence spending, emotions, health, location, and dialogue — not just labels.</p>

      {/* Active quirks */}
      {quirks.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No quirks added yet.</p>
      ) : (
        <div className="space-y-2">
          {quirks.map(q => {
            const catalog = QUIRK_CATALOG.find(c => c.quirk_id === q.quirk_id);
            const cat = CATEGORY_LABELS[q.category] || CATEGORY_LABELS.emotional;
            return (
              <div key={q.quirk_id} className={`flex items-center gap-3 p-3 rounded-xl border ${q.active ? cat.bg : 'bg-secondary/30 border-border opacity-50'}`}>
                <span className="text-lg">{catalog?.emoji || "⚡"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground">{q.label}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${cat.bg} ${cat.color} font-medium capitalize`}>{cat.label}</span>
                    {!q.active && <span className="text-[10px] text-muted-foreground/60">inactive</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {INTENSITY_OPTIONS.map(intensity => (
                      <button
                        key={intensity}
                        onClick={() => updateIntensity(q.quirk_id, intensity)}
                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize ${q.intensity === intensity ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}
                      >
                        {intensity}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleActive(q.quirk_id)}
                    className="text-[10px] px-2 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                    title={q.active ? "Deactivate" : "Activate"}
                  >
                    {q.active ? "On" : "Off"}
                  </button>
                  <button
                    onClick={() => removeQuirk(q.quirk_id)}
                    className="p-1 text-muted-foreground hover:text-destructive rounded-lg transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Catalog browser */}
      {showCatalog && (
        <div className="border border-border rounded-xl bg-secondary/20 p-3 space-y-4">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Choose from catalog</p>
          {Object.entries(grouped).map(([cat, items]) => {
            const catDef = CATEGORY_LABELS[cat];
            return (
              <div key={cat}>
                <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${catDef.color}`}>{catDef.label}</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {items.map(item => {
                    const already = quirks.some(q => q.quirk_id === item.quirk_id);
                    return (
                      <button
                        key={item.quirk_id}
                        onClick={() => addQuirk(item)}
                        disabled={already || saving}
                        className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-left transition-colors ${already ? 'border-primary/30 bg-primary/5 opacity-60 cursor-default' : 'border-border hover:border-primary/40 hover:bg-secondary/60'}`}
                      >
                        <span className="text-base flex-shrink-0">{item.emoji}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground">{item.label} {already && <span className="text-primary text-[10px]">✓ Added</span>}</p>
                          <p className="text-[10px] text-muted-foreground leading-relaxed">{item.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}