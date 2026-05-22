import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Zap, X, Plus, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { QUIRK_ENTRIES, QUIRK_CATEGORY_ORDER, QUIRK_CATEGORY_META, detectConflicts, TRAIT_ENTRIES } from "@/lib/characterTraitRegistry";

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

  const addQuirk = async (entry) => {
    const already = quirks.find(q => q.quirk_id === entry.quirk_id);
    if (already) return;
    const newQuirk = {
      quirk_id: entry.quirk_id,
      label: entry.label,
      category: entry.category,
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

  // Conflict detection: active quirk IDs + active trait keys
  const activeTraitKeys = TRAIT_ENTRIES.filter(t => !!character?.[t.key]).map(t => t.key);
  const activeQuirkIds = quirks.filter(q => q.active).map(q => q.quirk_id);
  const conflicts = detectConflicts(activeTraitKeys, activeQuirkIds);
  const conflictIds = new Set([...conflicts.map(c => c.a), ...conflicts.map(c => c.b)]);

  // Group catalog by category
  const grouped = QUIRK_CATEGORY_ORDER.map(cat => ({
    category: cat,
    meta: QUIRK_CATEGORY_META[cat],
    items: QUIRK_ENTRIES.filter(e => e.category === cat),
  }));

  const INTENSITY_OPTIONS = ["mild", "moderate", "strong"];

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

      {/* Conflict warnings */}
      {conflicts.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-1">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <p className="text-xs font-semibold text-amber-400">Conflicting traits/quirks</p>
          </div>
          {conflicts.map((c, i) => (
            <p key={i} className="text-[10px] text-amber-300/80 ml-5">
              <span className="font-medium">{c.a_label}</span> conflicts with <span className="font-medium">{c.b_label}</span>
            </p>
          ))}
        </div>
      )}

      {/* Active quirks */}
      {quirks.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No quirks added yet.</p>
      ) : (
        <div className="space-y-2">
          {quirks.map(q => {
            const entry = QUIRK_ENTRIES.find(e => e.quirk_id === q.quirk_id);
            const cat = QUIRK_CATEGORY_META[q.category] || QUIRK_CATEGORY_META.emotional;
            const inConflict = conflictIds.has(q.quirk_id);
            return (
              <div key={q.quirk_id} className={`flex items-center gap-3 p-3 rounded-xl border ${
                !q.active ? 'bg-secondary/30 border-border opacity-50' :
                inConflict ? 'bg-amber-500/10 border-amber-500/30' : cat.bg
              }`}>
                <span className="text-lg">{entry?.emoji || "⚡"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground">{q.label}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${cat.bg} ${cat.color} font-medium capitalize`}>{cat.label}</span>
                    {!q.active && <span className="text-[10px] text-muted-foreground/60">inactive</span>}
                    {inConflict && q.active && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {INTENSITY_OPTIONS.map(intensity => (
                      <button
                        key={intensity}
                        onClick={() => updateIntensity(q.quirk_id, intensity)}
                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize ${
                          q.intensity === intensity
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border text-muted-foreground hover:border-primary/40'
                        }`}
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
          {grouped.map(({ category, meta, items }) => (
            <div key={category}>
              <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${meta.color}`}>{meta.label}</p>
              <div className="grid grid-cols-1 gap-1.5">
                {items.map(item => {
                  const already = quirks.some(q => q.quirk_id === item.quirk_id);
                  return (
                    <button
                      key={item.quirk_id}
                      onClick={() => addQuirk(item)}
                      disabled={already || saving}
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-left transition-colors ${
                        already
                          ? 'border-primary/30 bg-primary/5 opacity-60 cursor-default'
                          : 'border-border hover:border-primary/40 hover:bg-secondary/60'
                      }`}
                    >
                      <span className="text-base flex-shrink-0">{item.emoji}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-foreground">
                          {item.label} {already && <span className="text-primary text-[10px]">✓ Added</span>}
                        </p>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}