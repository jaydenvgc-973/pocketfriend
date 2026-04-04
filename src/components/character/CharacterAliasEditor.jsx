import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Plus } from "lucide-react";

export default function CharacterAliasEditor({ character }) {
  const queryClient = useQueryClient();
  const [newAlias, setNewAlias] = useState("");

  const { data: aliases = [], refetch } = {
    data: character._aliases || [],
    refetch: () => {},
  };

  // Read aliases from the CharacterAlias entity
  const [localAliases, setLocalAliases] = useState([]);

  useState(() => {
    base44.entities.CharacterAlias.filter({ character_id: character.id })
      .then(res => setLocalAliases(res || []))
      .catch(() => {});
  });

  const addMutation = useMutation({
    mutationFn: (alias_name) =>
      base44.entities.CharacterAlias.create({
        character_id: character.id,
        alias_name,
        source_type: "manual",
        prior_primary: false,
      }),
    onSuccess: (created) => {
      setLocalAliases(prev => [...prev, created]);
      setNewAlias("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.CharacterAlias.delete(id),
    onSuccess: (_, id) => {
      setLocalAliases(prev => prev.filter(a => a.id !== id));
    },
  });

  const handleAdd = () => {
    const trimmed = newAlias.trim();
    if (!trimmed) return;
    addMutation.mutate(trimmed);
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">Aliases / Also Known As</p>
      <p className="text-xs text-muted-foreground">Other names this character goes by.</p>

      {localAliases.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {localAliases.map(alias => (
            <span
              key={alias.id}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-secondary text-foreground text-xs font-medium"
            >
              {alias.alias_name}
              <button
                onClick={() => deleteMutation.mutate(alias.id)}
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
          value={newAlias}
          onChange={e => setNewAlias(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAdd()}
          placeholder="Add alias..."
          className="flex-1 h-9 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
        />
        <button
          onClick={handleAdd}
          disabled={!newAlias.trim() || addMutation.isPending}
          className="h-9 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center gap-1"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}