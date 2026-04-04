import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export default function AppearanceAgeField({ character }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(character.appearance_age != null ? String(character.appearance_age) : "");

  const mutation = useMutation({
    mutationFn: (val) =>
      base44.entities.Character.update(character.id, {
        appearance_age: val === "" ? null : Number(val),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["character", character.id] }),
  });

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-2">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">Appearance Age (Image Generation)</p>
      <p className="text-xs text-muted-foreground">
        Override the visual age used when generating images. Leave blank to use the profile birthday age.
      </p>
      <input
        type="number"
        min={1}
        max={120}
        placeholder="e.g. 28"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => {
          const trimmed = value.trim();
          const current = character.appearance_age != null ? String(character.appearance_age) : "";
          if (trimmed !== current) mutation.mutate(trimmed);
        }}
        className="w-full h-11 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50"
      />
    </div>
  );
}