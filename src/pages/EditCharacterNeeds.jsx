import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Zap, RotateCcw } from "lucide-react";
import BottomNav from "@/components/BottomNav";
import CharacterAvatar from "@/components/chat/CharacterAvatar";

const NEEDS = [
  { label: "Hunger",    key: "hunger",    dbKey: "hunger_value",          emoji: "🍽️", desc: "How hungry they are" },
  { label: "Energy",    key: "energy",    dbKey: "energy_value",           emoji: "⚡", desc: "Physical energy level" },
  { label: "Social",    key: "social",    dbKey: "social_value",           emoji: "👥", desc: "Social connection need" },
  { label: "Health",    key: "health",    dbKey: "health_value",           emoji: "❤️", desc: "Physical health status" },
  { label: "Mental",    key: "mental",    dbKey: "mental_value",           emoji: "🧠", desc: "Mental wellbeing" },
  { label: "Financial", key: "financial", dbKey: "financial_need_value",   emoji: "💰", desc: "Financial stability" },
  { label: "Hygiene",   key: "hygiene",   dbKey: "hygiene_value",          emoji: "🚿", desc: "Personal hygiene" },
  { label: "Comfort",   key: "comfort",   dbKey: "comfort_value",          emoji: "🛋️", desc: "Comfort and ease" },
];

function getBarColor(value) {
  if (value >= 60) return "bg-green-500";
  if (value >= 35) return "bg-amber-500";
  return "bg-destructive";
}

function getLabel(value) {
  if (value >= 76) return { text: "Strong",   color: "text-green-500" };
  if (value >= 51) return { text: "Stable",   color: "text-blue-400" };
  if (value >= 26) return { text: "Low",      color: "text-amber-500" };
  return               { text: "Critical", color: "text-destructive" };
}

function CharacterNeedsEditor({ character }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(() => {
    const init = {};
    for (const n of NEEDS) init[n.key] = Math.round(character[n.dbKey] ?? 70);
    return init;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(null);

  const isActive = character?.character_type === "active" && character?.status === "active";
  if (!isActive) return null;

  const applyQuick = async (action) => {
    setIsSaving(true);
    setSavedMsg(null);
    try {
      await base44.functions.invoke("manualOverrideNeeds", { characterId: character.id, action });
      await base44.functions.invoke("simulateActiveCharacterNeeds", { characterId: character.id });
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      const preset = action === "stabilize" ? 65 : action === "refill" ? 90 : 70;
      const next = {};
      for (const n of NEEDS) next[n.key] = preset;
      setValues(next);
      setSavedMsg("Applied ✓");
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
      queryClient.invalidateQueries({ queryKey: ["characters"] });
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
      {/* Character header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <CharacterAvatar character={character} size="sm" />
        <div>
          <p className="text-sm font-semibold text-foreground">{character.name}</p>
          <p className="text-[10px] text-muted-foreground">Active Character</p>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Quick actions */}
        <div className="flex flex-wrap gap-2">
          <button
            disabled={isSaving}
            onClick={() => applyQuick("stabilize")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary border border-border text-xs text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Stabilize (65)
          </button>
          <button
            disabled={isSaving}
            onClick={() => applyQuick("refill")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary border border-border text-xs text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" /> Refill All (90)
          </button>
          <button
            disabled={isSaving}
            onClick={() => applyQuick("reset_baseline")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-secondary border border-border text-xs text-foreground hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset (70)
          </button>
        </div>

        {/* Sliders */}
        <div className="space-y-4">
          {NEEDS.map(({ label, key, emoji }) => {
            const val = values[key];
            const { text, color } = getLabel(val);
            return (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">{emoji} {label}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="0" max="100"
                      value={val}
                      onChange={e => setValues(p => ({ ...p, [key]: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) }))}
                      className="w-12 text-center text-xs bg-secondary border border-border rounded-lg px-1 py-0.5 text-foreground"
                    />
                    <span className={`text-[10px] font-semibold w-12 text-right ${color}`}>{text}</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0" max="100"
                  value={val}
                  onChange={e => setValues(p => ({ ...p, [key]: Number(e.target.value) }))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: val >= 60 ? '#22c55e' : val >= 35 ? '#f59e0b' : '#ef4444' }}
                />
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full ${getBarColor(val)} transition-all`}
                    style={{ width: `${val}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Save */}
        <div className="flex items-center justify-between pt-1 border-t border-border">
          {savedMsg ? (
            <span className={`text-xs ${savedMsg.startsWith("Error") ? "text-destructive" : "text-green-400"}`}>{savedMsg}</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">Drag sliders then apply</span>
          )}
          <button
            disabled={isSaving}
            onClick={saveCustom}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isSaving ? "Saving…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function EditCharacterNeeds() {
  const { data: user = {} } = useQuery({
    queryKey: ["user"],
    queryFn: () => base44.auth.me(),
  });

  const { data: characters = [] } = useQuery({
    queryKey: ["characters", user?.email],
    queryFn: () => user?.email
      ? base44.entities.Character.filter({ created_by: user.email, character_type: "active", status: "active" })
      : [],
    enabled: !!user?.email,
  });

  const activeChars = characters.filter(c => c.character_type === "active" && c.status === "active");

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="sticky top-0 bg-background/80 backdrop-blur-xl border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Edit Character Needs</h2>
          <p className="text-xs text-muted-foreground">Manually adjust needs bars for active characters</p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6 space-y-4">
        {activeChars.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No active characters found.</p>
        ) : (
          activeChars.map(char => (
            <CharacterNeedsEditor key={char.id} character={char} />
          ))
        )}
      </div>

      <BottomNav />
    </div>
  );
}