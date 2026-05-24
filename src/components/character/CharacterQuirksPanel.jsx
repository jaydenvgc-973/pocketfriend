import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Zap, X, Plus, ChevronDown, ChevronUp, AlertTriangle, Check } from "lucide-react";
import {
  QUIRK_ENTRIES, QUIRK_CATEGORY_ORDER, QUIRK_CATEGORY_META,
  TRAIT_ENTRIES, TRAIT_CATEGORY_ORDER,
  detectConflicts, ALL_ENTRIES,
} from "@/lib/characterTraitRegistry";

/**
 * CharacterQuirksPanel — Traits & Quirks section on Character Profile.
 *
 * ONE SYSTEM. Uses the canonical registry (lib/characterTraitRegistry.js).
 * - Traits: flat boolean fields on Character (trait_loyal, trait_blunt, etc.)
 * - Quirks: saved to character.quirks[] array
 * Both are shown in the same panel, both editable here.
 * Add button opens the FULL canonical catalog (traits + quirks).
 */
export default function CharacterQuirksPanel({ character }) {
  const queryClient = useQueryClient();
  const [showCatalog, setShowCatalog] = useState(false);
  const [saving, setSaving] = useState(false);

  const quirks = character?.quirks || [];

  // ── SAVE HELPERS ────────────────────────────────────────────────────────────
  const saveQuirks = async (newQuirks) => {
    setSaving(true);
    await base44.entities.Character.update(character.id, { quirks: newQuirks });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
    setSaving(false);
  };

  const saveTraitToggle = async (traitKey, value) => {
    setSaving(true);
    await base44.entities.Character.update(character.id, { [traitKey]: value });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
    setSaving(false);
  };

  // ── QUIRK ACTIONS ────────────────────────────────────────────────────────────
  const addQuirk = async (entry) => {
    if (quirks.find(q => q.quirk_id === entry.quirk_id)) return;
    await saveQuirks([...quirks, {
      quirk_id: entry.quirk_id,
      label: entry.label,
      category: entry.category,
      intensity: "moderate",
      active: true,
      trigger_count: 0,
    }]);
  };

  const removeQuirk = async (quirk_id) => {
    await saveQuirks(quirks.filter(q => q.quirk_id !== quirk_id));
  };

  const toggleQuirkActive = async (quirk_id) => {
    await saveQuirks(quirks.map(q => q.quirk_id === quirk_id ? { ...q, active: !q.active } : q));
  };

  const updateIntensity = async (quirk_id, intensity) => {
    setSaving(true);
    await saveQuirks(quirks.map(q => q.quirk_id === quirk_id ? { ...q, intensity } : q));
    setSaving(false);
  };

  // ── TRAIT INTENSITY (stored in character.trait_intensities object) ────────────
  const traitIntensities = character?.trait_intensities || {};

  const updateTraitIntensity = async (traitKey, intensity) => {
    setSaving(true);
    const updated = { ...traitIntensities, [traitKey]: intensity };
    await base44.entities.Character.update(character.id, { trait_intensities: updated });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
    setSaving(false);
  };

  // ── TRAIT ACTIONS ─────────────────────────────────────────────────────────────
  const addTrait = async (entry) => {
    if (character?.[entry.key]) return;
    await saveTraitToggle(entry.key, true);
  };

  const removeTrait = async (entry) => {
    await saveTraitToggle(entry.key, false);
  };

  // ── CONFLICT DETECTION (only from visible selected items) ─────────────────────
  const activeTraitKeys = TRAIT_ENTRIES.filter(t => !!character?.[t.key]).map(t => t.key);
  const activeQuirkIds  = quirks.filter(q => q.active).map(q => q.quirk_id);
  const conflicts    = detectConflicts(activeTraitKeys, activeQuirkIds);
  const conflictIds  = new Set([...conflicts.map(c => c.a), ...conflicts.map(c => c.b)]);

  // ── SELECTED TRAITS (flat booleans on character) ──────────────────────────────
  const selectedTraits = TRAIT_ENTRIES.filter(t => !!character?.[t.key]);

  // ── CATALOG GROUPING: traits by category, then quirks by category (both alphabetical) ──
  const traitCatalogGroups = TRAIT_CATEGORY_ORDER.map(cat => ({
    label: cat,
    type: "trait",
    color: "text-primary",
    items: TRAIT_ENTRIES
      .filter(t => t.category === cat)
      .sort((a, b) => a.label.localeCompare(b.label)),
  })).filter(g => g.items.length > 0);

  const quirkCatalogGroups = QUIRK_CATEGORY_ORDER.map(cat => ({
    label: QUIRK_CATEGORY_META[cat].label,
    type: "quirk",
    color: QUIRK_CATEGORY_META[cat].color,
    bg: QUIRK_CATEGORY_META[cat].bg,
    catKey: cat,
    items: QUIRK_ENTRIES
      .filter(e => e.category === cat)
      .sort((a, b) => a.label.localeCompare(b.label)),
  })).filter(g => g.items.length > 0);

  const INTENSITY_OPTIONS = ["mild", "moderate", "strong"];
  const hasAny = selectedTraits.length > 0 || quirks.length > 0;

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Traits & Quirks</p>
        </div>
        <button
          onClick={() => setShowCatalog(v => !v)}
          className="flex items-center gap-1 text-xs text-primary font-medium hover:opacity-80 transition-opacity"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
          {showCatalog ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">Traits and quirks shape communication, behavior, spending, movement, and emotional responses.</p>

      {/* Conflict warnings — only from visible selected traits/quirks */}
      {conflicts.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-1">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <p className="text-xs font-semibold text-amber-400">Conflicting traits/quirks</p>
          </div>
          {conflicts.map((c, i) => (
            <p key={i} className="text-[10px] text-amber-300/80 ml-5">
              <span className="font-medium">{c.a_label}</span> conflicts with <span className="font-medium">{c.b_label}</span> — may create complex behavior.
            </p>
          ))}
        </div>
      )}

      {/* Selected Traits (boolean fields) */}
      {selectedTraits.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Active Traits</p>
          {selectedTraits.map(t => {
            const inConflict = conflictIds.has(t.key);
            const currentIntensity = traitIntensities[t.key] || 'moderate';
            return (
              <div
                key={t.key}
                className={`flex items-center gap-3 p-3 rounded-xl border ${
                  inConflict ? 'bg-amber-500/10 border-amber-500/30' : 'bg-primary/10 border-primary/40'
                }`}
              >
                <span className="text-lg">{t.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-medium ${inConflict ? 'text-amber-400' : 'text-primary'}`}>{t.label}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-primary/30 text-primary/70 font-medium">{t.category}</span>
                    {inConflict && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                  </div>
                  {t.desc && <p className="text-[10px] text-muted-foreground mt-0.5">{t.desc}</p>}
                  <div className="flex items-center gap-2 mt-1">
                    {INTENSITY_OPTIONS.map(intensity => (
                      <button
                        key={intensity}
                        onClick={() => updateTraitIntensity(t.key, intensity)}
                        disabled={saving}
                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors capitalize ${
                          currentIntensity === intensity
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
                    onClick={() => removeTrait(t)}
                    disabled={saving}
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

      {/* Selected Quirks */}
      {quirks.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Active Quirks</p>
          {quirks.map(q => {
            const entry = QUIRK_ENTRIES.find(e => e.quirk_id === q.quirk_id);
            const catMeta = QUIRK_CATEGORY_META[q.category] || QUIRK_CATEGORY_META.emotional;
            const inConflict = conflictIds.has(q.quirk_id);
            return (
              <div key={q.quirk_id} className={`flex items-center gap-3 p-3 rounded-xl border ${
                !q.active ? 'bg-secondary/30 border-border opacity-50' :
                inConflict ? 'bg-amber-500/10 border-amber-500/30' : catMeta.bg
              }`}>
                <span className="text-lg">{entry?.emoji || "⚡"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground">{q.label}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${catMeta.bg} ${catMeta.color} font-medium capitalize`}>{catMeta.label}</span>
                    {!q.active && <span className="text-[10px] text-muted-foreground/60">inactive</span>}
                    {inConflict && q.active && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                  </div>
                  {/* Intensity selector */}
                  <div className="flex items-center gap-2 mt-1">
                    {INTENSITY_OPTIONS.map(intensity => (
                      <button
                        key={intensity}
                        onClick={() => updateIntensity(q.quirk_id, intensity)}
                        disabled={saving}
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
                    onClick={() => toggleQuirkActive(q.quirk_id)}
                    disabled={saving}
                    className="text-[10px] px-2 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {q.active ? "On" : "Off"}
                  </button>
                  <button
                    onClick={() => removeQuirk(q.quirk_id)}
                    disabled={saving}
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

      {!hasAny && (
        <p className="text-sm text-muted-foreground italic">No traits or quirks added yet. Use the Add button to browse the full catalog.</p>
      )}

      {/* Full canonical catalog — traits first, then quirks, all alphabetical within category */}
      {showCatalog && (
        <div className="border border-border rounded-xl bg-secondary/20 p-3 space-y-5">
          <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Full Catalog</p>

          {/* Traits section */}
          <div className="space-y-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary/80">Traits</p>
            {traitCatalogGroups.map(({ label, items }) => (
              <div key={label}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {items.map(item => {
                    const already = !!character?.[item.key];
                    return (
                      <button
                        key={item.key}
                        onClick={() => already ? removeTrait(item) : addTrait(item)}
                        disabled={saving}
                        className={`flex items-start gap-2.5 p-2.5 rounded-lg border text-left transition-colors ${
                          already
                            ? 'border-primary/30 bg-primary/5'
                            : 'border-border hover:border-primary/40 hover:bg-secondary/60'
                        }`}
                      >
                        <span className="text-base flex-shrink-0">{item.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground">
                            {item.label} {already && <span className="text-primary text-[10px]">✓ Active</span>}
                          </p>
                          <p className="text-[10px] text-muted-foreground leading-relaxed">{item.desc}</p>
                        </div>
                        {already && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0 mt-0.5" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Quirks section */}
          <div className="space-y-4 pt-3 border-t border-border">
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary/80">Quirks</p>
            {quirkCatalogGroups.map(({ label, color, bg, catKey, items }) => (
              <div key={catKey}>
                <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${color}`}>{label}</p>
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
        </div>
      )}
    </div>
  );
}