import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, Check } from "lucide-react";
import CharacterAvatar from "@/components/chat/CharacterAvatar";
import BottomNav from "@/components/BottomNav";
import { useSettingsCharacters } from "@/hooks/useSettingsCharacters";
import SettingsCharacterList from "@/components/settings/SettingsCharacterList";

const NEEDS = [
  { label: "Hunger",    key: "hunger_value",        dbKey: "hunger",    emoji: "🍽️" },
  { label: "Energy",    key: "energy_value",         dbKey: "energy",    emoji: "⚡" },
  { label: "Social",    key: "social_value",         dbKey: "social",    emoji: "👥" },
  { label: "Health",    key: "health_value",         dbKey: "health",    emoji: "❤️" },
  { label: "Mental",    key: "mental_value",         dbKey: "mental",    emoji: "🧠" },
  { label: "Financial", key: "financial_need_value", dbKey: "financial", emoji: "💰" },
  { label: "Hygiene",   key: "hygiene_value",        dbKey: "hygiene",   emoji: "🚿" },
  { label: "Comfort",   key: "comfort_value",        dbKey: "comfort",   emoji: "🛋️" },
];

function getBarColor(value) {
  if (value >= 76) return { bar: "bg-green-600",  label: "Strong",   text: "text-green-500" };
  if (value >= 51) return { bar: "bg-blue-500",   label: "Stable",   text: "text-blue-400"  };
  if (value >= 26) return { bar: "bg-amber-500",  label: "Low",      text: "text-amber-500" };
  return               { bar: "bg-destructive",   label: "Critical", text: "text-destructive" };
}

function NeedsEditor({ character, onBack }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => {
    const init = {};
    for (const n of NEEDS) {
      init[n.dbKey] = Math.round(character[n.key] ?? 70);
    }
    return init;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await base44.functions.invoke("manualOverrideNeeds", {
        characterId: character.id,
        action: "custom",
        needs: values,
      });
      // Refresh simulation so last_need_simulated_at is current
      await base44.functions.invoke("simulateActiveCharacterNeeds", { characterId: character.id });
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Sub-header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/60">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <div className="flex items-center gap-2 flex-1">
          <CharacterAvatar character={character} size="sm" />
          <div>
            <p className="text-sm font-semibold text-foreground">{character.name}</p>
            <p className="text-[10px] text-muted-foreground">Drag sliders to adjust needs</p>
          </div>
        </div>
      </div>

      {/* Sliders */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
        {NEEDS.map(({ label, dbKey, emoji }) => {
          const val = values[dbKey];
          const { bar, label: statusLabel, text } = getBarColor(val);
          return (
            <div key={dbKey}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-foreground">{emoji} {label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">{val}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${text}`}>
                    {statusLabel}
                  </span>
                </div>
              </div>
              {/* Bar preview */}
              <div className="h-2 bg-secondary rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full ${bar} transition-all duration-150`}
                  style={{ width: `${val}%` }}
                />
              </div>
              {/* Slider */}
              <input
                type="range"
                min={0}
                max={100}
                value={val}
                onChange={e => setValues(prev => ({ ...prev, [dbKey]: Number(e.target.value) }))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{ accentColor: val >= 51 ? '#22c55e' : val >= 26 ? '#f59e0b' : '#ef4444' }}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>0 — Critical</span>
                <span>100 — Strong</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Save button */}
      <div className="px-4 py-4 border-t border-border bg-background">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saved
            ? <><Check className="w-4 h-4" /> Saved!</>
            : isSaving
            ? "Saving…"
            : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

export default function EditCharacterNeeds() {
  const [selectedChar, setSelectedChar] = useState(null);

  const { data: user = {} } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  // "needs" module → active_created_character ONLY
  const { sections, isLoading } = useSettingsCharacters(user, "needs");
  // Flatten for mini-bar previews
  const activeChars = sections.flatMap(s => s.items);

  return (
    <div className="min-h-screen bg-background flex flex-col pb-24">
      {/* Top nav */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        {selectedChar ? (
          <button onClick={() => setSelectedChar(null)} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
        ) : (
          <Link to="/settings" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        )}
        <h2 className="text-sm font-semibold text-foreground">
          {selectedChar ? `${selectedChar.name}'s Needs` : "Edit Character Needs"}
        </h2>
      </div>

      {selectedChar ? (
        <div className="flex-1 flex flex-col max-w-lg mx-auto w-full">
          <NeedsEditor character={selectedChar} onBack={() => setSelectedChar(null)} />
        </div>
      ) : (
        <div className="max-w-lg mx-auto w-full px-4 py-6 space-y-3">
          <p className="text-xs text-muted-foreground">Select a character to edit their needs bars.</p>

          {isLoading && (
            <div className="flex justify-center py-8">
              <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
            </div>
          )}

          {!isLoading && activeChars.length === 0 && (
            <p className="text-sm text-muted-foreground italic text-center py-8">No active characters found.</p>
          )}

          {activeChars.map(char => {
            // Show a mini preview of their needs state
            const needsWithValues = NEEDS.map(n => ({
              ...n,
              value: Math.round(char[n.key] ?? 70),
            }));
            const criticalCount = needsWithValues.filter(n => n.value < 26).length;

            return (
              <button
                key={char.id}
                onClick={() => setSelectedChar(char)}
                className="w-full bg-card border border-border rounded-2xl p-4 hover:border-primary/40 transition-colors text-left space-y-3"
              >
                <div className="flex items-center gap-3">
                  <CharacterAvatar character={char} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">{char.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {criticalCount > 0
                        ? <span className="text-destructive">{criticalCount} need{criticalCount > 1 ? "s" : ""} critical or low</span>
                        : <span className="text-green-500">All needs stable</span>
                      }
                    </p>
                  </div>
                  <ArrowLeft className="w-4 h-4 text-muted-foreground rotate-180" />
                </div>

                {/* Mini bar previews */}
                <div className="grid grid-cols-4 gap-x-3 gap-y-2">
                  {needsWithValues.map(({ label, dbKey, emoji, value }) => {
                    const { bar } = getBarColor(value);
                    return (
                      <div key={dbKey}>
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-[9px] text-muted-foreground">{emoji}</span>
                          <span className="text-[9px] font-mono text-muted-foreground">{value}</span>
                        </div>
                        <div className="h-1 bg-secondary rounded-full overflow-hidden">
                          <div className={`h-full ${bar}`} style={{ width: `${value}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <BottomNav />
    </div>
  );
}