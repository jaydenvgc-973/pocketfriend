import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Plane } from "lucide-react";

/**
 * VacationModeToggle
 *
 * ON  → character is temporarily exempt from mandatory work and school attendance.
 *       Existing work/school schedules and enrollment remain intact — only enforcement
 *       is skipped. The character remains free to travel and participate normally.
 * OFF → exemption is gone; existing obligations resume normally through their
 *       existing behavior. Nothing needs to be reconstructed because Vacation Mode
 *       never erases or replaces those obligations.
 */
export default function VacationModeToggle({ character }) {
  const queryClient = useQueryClient();
  const isOn = character?.vacation_mode === true;
  const [optimistic, setOptimistic] = useState(null);
  const displayOn = optimistic ?? isOn;

  const mutation = useMutation({
    mutationFn: async (next) => {
      await base44.entities.Character.update(character.id, { vacation_mode: next });
    },
    onMutate: async (next) => {
      setOptimistic(next);
      // Optimistically patch the singular + list caches so the UI updates instantly.
      queryClient.setQueryData(["character", character.id], (prev) =>
        prev ? { ...prev, vacation_mode: next } : prev
      );
      if (character.owner_email) {
        queryClient.setQueryData(["characters", character.owner_email], (prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((c) => (c.id === character.id ? { ...c, vacation_mode: next } : c));
        });
      }
    },
    onError: () => {
      // Revert optimistic state on failure
      setOptimistic(isOn);
      queryClient.setQueryData(["character", character.id], (prev) =>
        prev ? { ...prev, vacation_mode: isOn } : prev
      );
      if (character.owner_email) {
        queryClient.setQueryData(["characters", character.owner_email], (prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((c) => (c.id === character.id ? { ...c, vacation_mode: isOn } : c));
        });
      }
    },
    onSettled: () => {
      setOptimistic(null);
      queryClient.invalidateQueries({ queryKey: ["character", character.id] });
      if (character.owner_email) {
        queryClient.invalidateQueries({ queryKey: ["characters", character.owner_email] });
      }
    },
  });

  const handleToggle = () => {
    mutation.mutate(!displayOn);
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Plane className="w-4 h-4 text-primary flex-shrink-0" />
            <p className="text-xs font-medium text-foreground">Vacation Mode</p>
          </div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {displayOn
              ? "On — temporarily exempt from work and school attendance. Schedules stay intact; switching off resumes normal obligations."
              : "Off — work and school obligations operate normally. Turn on to temporarily exempt this character from attendance."}
          </p>
        </div>
        <button
          onClick={handleToggle}
          disabled={mutation.isPending}
          role="switch"
          aria-checked={displayOn}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            displayOn ? "bg-primary" : "bg-secondary border border-border"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              displayOn ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
    </div>
  );
}