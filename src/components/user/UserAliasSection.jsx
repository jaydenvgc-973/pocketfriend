import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { X, Plus } from "lucide-react";

/**
 * User Alias Section
 * Stores aliases/nicknames for the user in UserSettings.user_aliases (array of strings).
 * Helps system recognize nicknames as the same person, reducing duplicate NPC creation.
 */
export default function UserAliasSection({ settings, onSave }) {
  const [aliases, setAliases] = useState(settings.user_aliases || []);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (settings.user_aliases) setAliases(settings.user_aliases);
  }, [JSON.stringify(settings.user_aliases)]);

  const addAliases = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    // Support comma-separated entries
    const newOnes = trimmed.split(",").map(a => a.trim()).filter(a => a && !aliases.includes(a));
    if (newOnes.length === 0) { setInput(""); return; }
    const updated = [...aliases, ...newOnes];
    setAliases(updated);
    setInput("");
    onSave({ user_aliases: updated });
  };

  const removeAlias = (alias) => {
    const updated = aliases.filter(a => a !== alias);
    setAliases(updated);
    onSave({ user_aliases: updated });
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <div>
        <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Your Aliases / Nicknames</p>
        <p className="text-xs text-muted-foreground mt-1">
          Add other names or nicknames you go by. Helps prevent unnecessary duplicate characters from being created.
          Separate multiple with commas.
        </p>
      </div>

      {aliases.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {aliases.map(alias => (
            <span
              key={alias}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary text-foreground text-xs font-medium"
            >
              {alias}
              <button
                onClick={() => removeAlias(alias)}
                className="text-muted-foreground hover:text-destructive transition-colors ml-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addAliases()}
          placeholder="e.g. Mur, Murq, M (comma-separated)"
          className="flex-1 h-9 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
        />
        <button
          onClick={addAliases}
          disabled={!input.trim()}
          className="h-9 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center gap-1"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}