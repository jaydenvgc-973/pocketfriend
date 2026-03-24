import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { buildSystemPrompt } from "@/lib/defaultCharacter";

const RELATIONSHIP_TYPES = [
  "mother",
  "father",
  "grandmother",
  "grandfather",
  "great-grandmother",
  "great-grandfather",
  "aunt",
  "uncle",
  "sister",
  "brother",
  "half-sister",
  "half-brother",
  "step-mother",
  "step-father",
  "step-sister",
  "step-brother",
  "cousin",
  "niece",
  "nephew",
  "daughter",
  "son",
  "other",
];

export default function FamilyEditor({ character, readOnly = false }) {
  const queryClient = useQueryClient();
  const [members, setMembers] = useState(character.family_members || []);
  const [saving, setSaving] = useState(false);

  const addMember = () => {
    setMembers(prev => [...prev, { name: "", relationship_type: "mother" }]);
  };

  const updateMember = (idx, field, value) => {
    setMembers(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  const removeMember = (idx) => {
    setMembers(prev => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    setSaving(true);
    const valid = members.filter(m => m.name.trim());
    await base44.entities.Character.update(character.id, { family_members: valid });
    queryClient.invalidateQueries({ queryKey: ["character", character.id] });
    setSaving(false);
  };

  const hasChanges = JSON.stringify(members) !== JSON.stringify(character.family_members || []);

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Family</p>
        {!readOnly && (
          <button
            onClick={addMember}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        )}
      </div>

      {members.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No family members added yet.</p>
      )}

      <div className="space-y-2">
        {members.map((member, idx) => (
          <div key={idx} className="flex items-center gap-2">
            {readOnly ? (
              <div className="flex-1 flex items-center gap-2 bg-secondary/40 rounded-xl px-3 py-2">
                <span className="text-sm text-foreground flex-1">{member.name}</span>
                <span className="text-xs text-muted-foreground capitalize">{member.relationship_type}</span>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={member.name}
                  onChange={e => updateMember(idx, "name", e.target.value)}
                  placeholder="Name"
                  className="flex-1 bg-secondary text-foreground text-sm rounded-xl px-3 py-2 outline-none border border-transparent focus:border-primary/50 placeholder:text-muted-foreground min-w-0"
                />
                <select
                  value={member.relationship_type}
                  onChange={e => updateMember(idx, "relationship_type", e.target.value)}
                  className="bg-secondary text-foreground text-sm rounded-xl px-2 py-2 outline-none border border-transparent focus:border-primary/50 capitalize"
                >
                  {RELATIONSHIP_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                <button
                  onClick={() => removeMember(idx)}
                  className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {!readOnly && hasChanges && (
        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-primary text-primary-foreground text-sm font-medium rounded-xl py-2 hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Family"}
        </button>
      )}
    </div>
  );
}