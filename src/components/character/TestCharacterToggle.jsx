import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, ShieldCheck, Trash2 } from "lucide-react";

/**
 * TestCharacterToggle
 *
 * Two separate designations, never combined:
 *  - is_test_character: testing ELIGIBILITY. ON = may be used in tests.
 *  - is_disposable: test-cleanup PERMISSION. Disposable = a temporary fixture test
 *    cleanup may remove. Non-Disposable = always preserved.
 *
 * Turning Test Character ON always defaults to Non-Disposable, and this toggle never
 * deletes anything itself.
 */
export default function TestCharacterToggle({ character }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const isTest = character?.is_test_character === true;
  const isDisposable = character?.is_disposable === true;

  const save = async (data) => {
    if (!character?.id || saving) return;
    setSaving(true);
    try {
      await base44.entities.Character.update(character.id, data);
      queryClient.setQueryData(["character", character.id], (prev) =>
        prev ? { ...prev, ...data } : prev
      );
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      queryClient.invalidateQueries({ queryKey: ["characters"] });
    } finally {
      setSaving(false);
    }
  };

  const toggleTest = () =>
    save(
      isTest
        ? { is_test_character: false }
        : { is_test_character: true, is_disposable: false }
    );

  return (
    <div className="mx-4 mt-3 rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-3">
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
          onClick={toggleTest}
          disabled={saving}
          role="switch"
          aria-checked={isTest}
          aria-label="Test Character status"
          className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${isTest ? "bg-primary" : "bg-secondary border border-border"} disabled:opacity-50`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${isTest ? "translate-x-5" : ""}`} />
        </button>
      </div>

      {isTest && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Disposal</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => !isDisposable || save({ is_disposable: false })}
              disabled={saving}
              aria-pressed={!isDisposable}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border text-[11px] font-medium transition-colors ${
                !isDisposable
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                  : "bg-secondary/50 border-border text-muted-foreground hover:border-primary/30"
              } disabled:opacity-50`}
            >
              <ShieldCheck className="w-3.5 h-3.5" /> Non-Disposable
            </button>
            <button
              onClick={() => isDisposable || save({ is_disposable: true })}
              disabled={saving}
              aria-pressed={isDisposable}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border text-[11px] font-medium transition-colors ${
                isDisposable
                  ? "bg-destructive/15 border-destructive/40 text-destructive"
                  : "bg-secondary/50 border-border text-muted-foreground hover:border-primary/30"
              } disabled:opacity-50`}
            >
              <Trash2 className="w-3.5 h-3.5" /> Disposable
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            {isDisposable
              ? 'A test may remove this character when that test finishes. Protect it if it is a continuing character.'
              : 'Always preserved. Test cleanup will never remove this character.'}
          </p>
        </div>
      )}
    </div>
  );
}