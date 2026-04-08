import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non-binary", label: "Non-binary" },
  { value: "other", label: "Other" },
];

export default function AppearanceAgeField({ character }) {
  const queryClient = useQueryClient();
  const [ageValue, setAgeValue] = useState(character.appearance_age != null ? String(character.appearance_age) : "");
  const [gender, setGender] = useState(character.gender || "");

  const mutation = useMutation({
    mutationFn: (updates) => base44.entities.Character.update(character.id, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["character", character.id] }),
  });

  const saveAge = () => {
    const trimmed = ageValue.trim();
    const current = character.appearance_age != null ? String(character.appearance_age) : "";
    if (trimmed !== current) {
      mutation.mutate({ appearance_age: trimmed === "" ? null : Number(trimmed) });
    }
  };

  const saveGender = (val) => {
    setGender(val);
    mutation.mutate({ gender: val });
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">Appearance (Image Generation)</p>

      {/* Appearance Age */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-wider block">Appearance Age</label>
        <p className="text-xs text-muted-foreground">
          Override the visual age used when generating images. Leave blank to use the profile birthday age.
        </p>
        <input
          type="number"
          min={1}
          max={120}
          placeholder="e.g. 28"
          value={ageValue}
          onChange={e => setAgeValue(e.target.value)}
          onBlur={saveAge}
          className="w-full h-11 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      {/* Gender */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground uppercase tracking-wider block">Gender</label>
        <p className="text-xs text-muted-foreground">
          Sets the gender used for image generation and character context.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {GENDER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => saveGender(opt.value)}
              className={`h-10 rounded-xl border text-sm font-medium transition-colors ${
                gender === opt.value
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}