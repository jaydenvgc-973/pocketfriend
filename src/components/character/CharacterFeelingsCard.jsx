import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2 } from "lucide-react";

export default function CharacterFeelingsCard({ character, onRespectCorrected }) {
  const [feelings, setFeelings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!character?.id) return;
    setLoading(true);
    // Do NOT reset feelings to null on character change — preserve last-known-good while loading.
    // This prevents the section from disappearing during refresh/navigation.
    const timer = setTimeout(() => {
      base44.functions.invoke("generateCharacterFeelings", { characterId: character.id })
        .then(res => {
          const newFeelings = res?.data?.feelings || null;
          // Only update if we got a real value — never overwrite with null on partial failure
          if (newFeelings) setFeelings(newFeelings);
          if (res?.data?.respect_used !== undefined && res.data.respect_used !== (character.user_respect_level ?? 50)) {
            onRespectCorrected?.();
          }
        })
        .catch(() => {
          // On error: keep last-known-good feelings, don't set null
        })
        .finally(() => setLoading(false));
    }, 2500);
    return () => clearTimeout(timer);
  }, [character?.id]);

  // SECTION PERSISTENCE: Always renders content — never collapses.
  // Loading spinner appears inline while last-known-good feelings remain visible.
  // On error: keeps prior feelings text. Never returns null.
  return (
    <div className="space-y-1.5">
      {loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
      {feelings ? (
        <p className="text-sm text-foreground leading-relaxed italic">{feelings}</p>
      ) : !loading ? (
        <p className="text-sm text-muted-foreground italic">Nothing to share right now.</p>
      ) : null}
    </div>
  );
}