import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { Sliders, RefreshCw, Zap, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

const NEEDS = [
  { label: "Hunger",    key: "hunger",    emoji: "🍽️" },
  { label: "Energy",    key: "energy",    emoji: "⚡" },
  { label: "Social",    key: "social",    emoji: "👥" },
  { label: "Health",    key: "health",    emoji: "❤️" },
  { label: "Mental",    key: "mental",    emoji: "🧠" },
  { label: "Financial", key: "financial", emoji: "💰" },
  { label: "Hygiene",   key: "hygiene",   emoji: "🚿" },
  { label: "Comfort",   key: "comfort",   emoji: "🛋️" },
];

const DB_KEY = {
  hunger: "hunger_value",
  energy: "energy_value",
  social: "social_value",
  health: "health_value",
  mental: "mental_value",
  financial: "financial_need_value",
  hygiene: "hygiene_value",
  comfort: "comfort_value",
};

function getColor(value) {
  if (value >= 60) return "bg-green-500";
  if (value >= 35) return "bg-amber-500";
  return "bg-destructive";
}

export default function ManualNeedsEditor({ character }) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [values, setValues] = useState(() => {
    const init = {};
    for (const n of NEEDS) {
      init[n.key] = Math.round(character[DB_KEY[n.key]] ?? 70);
    }
    return init;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(null);

  const isActive = character?.character_type === "active" && character?.status === "active";
  if (!isActive) return null;

  const handleSlider = (key, val) => setValues(prev => ({ ...prev, [key]: Number(val) }));

  const applyAction = async (action) => {
    setIsSaving(true);
    setSavedMsg(null);
    try {
      await base44.functions.invoke("manualOverrideNeeds", {
        characterId: character.id,
        action,
      });
      // Refresh UI values from DB
      await base44.functions.invoke("simulateActiveCharacterNeeds", { characterId: character.id });
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      setSavedMsg(`${action} applied ✓`);

      // Update local slider state to match action
      const presets = {
        stabilize:      65,
        refill:         90,
        reset_baseline: 70,
      };
      if (presets[action] !== undefined) {
        const next = {};
        for (const n of NEEDS) next[n.key] = presets[action];
        setValues(next);
      }
    } catch (err) {
      setSavedMsg(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
      setTimeout(() => setSavedMsg(null), 3000);
    }
  };

  const saveCustom = async () => {
    setIsSaving(true);
    setSavedMsg(null);
    try {
      await base44.functions.invoke("manualOverrideNeeds", {
        characterId: character.id,
        action: "custom",
        needs: values,
      });
      await base44.functions.invoke("simulateActiveCharacterNeeds", { characterId: character.id });
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      setSavedMsg("Saved ✓");
    } catch (err) {
      setSavedMsg(`Error: ${err.message}`);
    } finally {
      setIsSaving(false);
      setTimeout(() => setSavedMsg(null), 3000);
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setIsOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Manual Needs Override</span>
          <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-medium">Admin / Debug</span>
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-3">
          {/* Quick action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs rounded-xl"
              disabled={isSaving}
              onClick={() => applyAction("stabilize")}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Stabilize (65)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs rounded-xl"
              disabled={isSaving}
              onClick={() => applyAction("refill")}
            >
              <Zap className="w-3.5 h-3.5" /> Refill All (90)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs rounded-xl"
              disabled={isSaving}
              onClick={() => applyAction("reset_baseline")}
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset Baseline (70)
            </Button>
          </div>

          {/* Sliders */}
          <div className="space-y-3">
            {NEEDS.map(({ label, key, emoji }) => (
              <div key={key}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-foreground">{emoji} {label}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0" max="100"
                      value={values[key]}
                      onChange={e => handleSlider(key, e.target.value)}
                      className="w-12 text-center text-xs bg-secondary border border-border rounded-lg px-1 py-0.5 text-foreground"
                    />
                  </div>
                </div>
                <div className="relative h-5 flex items-center gap-2">
                  <input
                    type="range"
                    min="0" max="100"
                    value={values[key]}
                    onChange={e => handleSlider(key, e.target.value)}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer"
                    style={{ accentColor: values[key] >= 60 ? '#22c55e' : values[key] >= 35 ? '#f59e0b' : '#ef4444' }}
                  />
                </div>
                {/* Mini bar preview */}
                <div className="h-1 bg-secondary rounded-full overflow-hidden mt-1">
                  <div
                    className={`h-full ${getColor(values[key])} transition-all`}
                    style={{ width: `${values[key]}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Save custom */}
          <div className="flex items-center justify-between pt-1">
            {savedMsg ? (
              <span className={`text-xs ${savedMsg.startsWith("Error") ? "text-destructive" : "text-green-400"}`}>
                {savedMsg}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                Drag sliders then click Apply to override
              </span>
            )}
            <Button
              size="sm"
              className="rounded-xl text-xs gap-1.5"
              disabled={isSaving}
              onClick={saveCustom}
            >
              {isSaving ? "Saving…" : "Apply Custom Values"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}