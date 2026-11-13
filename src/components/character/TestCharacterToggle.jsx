import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";

/**
 * TestCharacterToggle
 *
 * Controls Character.is_test_character on the character profile. This is a
 * separate classification from character_type: turning it off leaves the
 * character's normal type, name, alias, avatar and history untouched.
 */
export default function TestCharacterToggle({ character }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const isTest = character?.is_test_character === true;

  const toggle = async () => {
    if (!character?.id || saving) return;
    setSaving(true);
    try {
      const next = !isTest;
      await base44.entities.Character.update(character.id, { is_test_character: next });
      queryClient.setQueryData(["character", character.id], (prev) =>
        prev ? { ...prev, is_test_character: next } : prev
      );
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-4 mt-3 rounded-2xl border border-border bg-card px-4 py-3 flex items-center gap-3">
      <FlaskConical className={`w-4 h-4 flex-shrink-0 ${isTest ? "text-primary" : "text-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground">
          Test Character{isTest && <span className="ml-2 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">Test</span>}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {isTest
            ? 'Eligible for app testing. Character type is unchanged.'
            : 'Regular character — not used when tests are run.'}
        </p>
      </div>
      <button
        onClick={toggle}
        disabled={saving}
        role="switch"
        aria-checked={isTest}
        aria-label="Test Character status"
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${isTest ? "bg-primary" : "bg-secondary border border-border"} disabled:opacity-50`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${isTest ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}