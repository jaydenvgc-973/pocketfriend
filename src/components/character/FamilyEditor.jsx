import React, { useState, useEffect } from "react";
import { Plus, Trash2, Camera, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { buildSystemPrompt } from "@/lib/defaultCharacter";

const RELATIONSHIP_TYPES = [
  "mother", "father", "grandmother", "grandfather",
  "great-grandmother", "great-grandfather", "aunt", "uncle",
  "sister", "brother", "half-sister", "half-brother",
  "step-mother", "step-father", "step-sister", "step-brother",
  "cousin", "niece", "nephew", "daughter", "son", "spouse", "other",
];

// Default relationship bars based on family role
function defaultLevels(relationshipType) {
  const close = ["mother", "father", "sister", "brother", "daughter", "son", "spouse"];
  const isClose = close.includes(relationshipType);
  return {
    user_respect_level: isClose ? 75 : 60,
    friendship_level: isClose ? 80 : 65,
    romantic_level: relationshipType === "spouse" ? 70 : 0,
    attraction_level: 0,
    chosen_family_level: isClose ? 85 : 50,
  };
}

// Sync family members into fictional_relationships so they appear in the world list
async function syncFamilyToRelationships(character, familyMembers) {
  const existing = character.fictional_relationships || [];

  // Remove old family-sourced entries, keep non-family ones
  const nonFamily = existing.filter(r => !r._from_family);

  // Build new entries from family members
  const familyEntries = familyMembers
    .filter(m => m.name?.trim())
    .map(m => ({
      person_name: m.name,
      relationship_type: m.relationship_type || "family",
      description: `${m.name} is ${character.name}'s ${m.relationship_type || "family member"}.`,
      current_status: "part of the family",
      emotional_impact: "",
      history_summary: "",
      last_interaction_summary: "",
      photo_url: m.photo_url || null,
      _from_family: true,
      ...defaultLevels(m.relationship_type),
    }));

  return [...nonFamily, ...familyEntries];
}

export default function FamilyEditor({ character, readOnly = false }) {
  const queryClient = useQueryClient();
  const [members, setMembers] = useState(character.family_members || []);
  const [saving, setSaving] = useState(false);
  const [generatingIdx, setGeneratingIdx] = useState(null);

  // Keep local state in sync if the character prop changes (e.g. after re-fetch)
  useEffect(() => {
    if (!saving) {
      setMembers(character.family_members || []);
    }
  }, [character.id, JSON.stringify(character.family_members)]);

  const addMember = () => {
    setMembers(prev => [...prev, { name: "", relationship_type: "mother", photo_url: null }]);
  };

  const updateMember = (idx, field, value) => {
    setMembers(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  const removeMember = (idx) => {
    setMembers(prev => prev.filter((_, i) => i !== idx));
  };

  const generatePhoto = async (idx) => {
    const member = members[idx];
    if (!member.name?.trim()) return;
    setGeneratingIdx(idx);

    try {
      const prompt = `A realistic, candid-style portrait photo of ${member.name}, who is ${character.name}'s ${member.relationship_type || "family member"}. 
${character.ethnicities?.length > 0 ? `Ethnic background similar to: ${character.ethnicities.join(", ")}.` : ""}
${character.gender ? `${character.name} is ${character.gender}, so reflect natural family resemblance where appropriate.` : ""}
Natural lighting, unposed, like a real person's photo. NOT a cartoon, NOT illustrated. Photorealistic.`;

      const result = await base44.integrations.Core.GenerateImage({ prompt });
      if (result?.url) {
        updateMember(idx, "photo_url", result.url);
      }
    } catch {
      // silently fail — photo generation is optional
    }
    setGeneratingIdx(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      const valid = members.filter(m => m.name?.trim());
      const updatedRelationships = await syncFamilyToRelationships(character, valid);
      const updated = { ...character, family_members: valid };
      const systemPrompt = buildSystemPrompt(updated);

      // Upload system prompt as a file if it's too large
      let updateData = {
        family_members: valid,
        fictional_relationships: updatedRelationships,
      };

      if (systemPrompt && systemPrompt.length > 5000) {
        const file = new File([systemPrompt], "system_prompt.txt", { type: "text/plain" });
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        updateData.system_prompt_url = file_url;
      } else {
        updateData.system_prompt = systemPrompt;
      }

      await base44.entities.Character.update(character.id, updateData);
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    } finally {
      setSaving(false);
    }
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

      <div className="space-y-3">
        {members.map((member, idx) => (
          <div key={idx} className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
            {readOnly ? (
              /* Read-only view with photo */
              <div className="flex items-center gap-3">
                {member.photo_url ? (
                  <img src={member.photo_url} alt={member.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-semibold text-primary">{member.name?.[0]?.toUpperCase() || "?"}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground font-medium">{member.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{member.relationship_type}</p>
                </div>
              </div>
            ) : (
              /* Edit view */
              <>
                <div className="flex items-center gap-2">
                  {/* Photo thumbnail + generate button */}
                  <div className="relative flex-shrink-0">
                    {member.photo_url ? (
                      <img src={member.photo_url} alt={member.name} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center">
                        <span className="text-sm font-semibold text-primary">{member.name?.[0]?.toUpperCase() || "?"}</span>
                      </div>
                    )}
                    <button
                      onClick={() => generatePhoto(idx)}
                      disabled={generatingIdx === idx || !member.name?.trim()}
                      title="Generate photo"
                      className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-primary flex items-center justify-center disabled:opacity-40 hover:bg-primary/80 transition-colors"
                    >
                      {generatingIdx === idx
                        ? <Loader2 className="w-3 h-3 text-primary-foreground animate-spin" />
                        : <Camera className="w-2.5 h-2.5 text-primary-foreground" />
                      }
                    </button>
                  </div>

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
                </div>
                {generatingIdx === idx && (
                  <p className="text-xs text-muted-foreground">Generating photo for {member.name}...</p>
                )}
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