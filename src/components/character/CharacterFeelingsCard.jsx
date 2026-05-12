import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, Heart } from "lucide-react";

export default function CharacterFeelingsCard({ character, onRespectCorrected }) {
  const [feelings, setFeelings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!character?.id) return;
    setLoading(true);
    setFeelings(null);
    // Delay 2.5s to avoid 429 — this is a non-critical enrichment call that fires after all primary queries
    const timer = setTimeout(() => {
      base44.functions.invoke("generateCharacterFeelings", { characterId: character.id })
        .then(res => {
          setFeelings(res?.data?.feelings || null);
          if (res?.data?.respect_used !== undefined && res.data.respect_used !== (character.user_respect_level ?? 50)) {
            onRespectCorrected?.();
          }
        })
        .catch(() => setFeelings(null))
        .finally(() => setLoading(false));
    }, 2500);
    return () => clearTimeout(timer);
  }, [character?.id]);

  return (
    <div className="pt-3 border-t border-border space-y-2">
      <div className="flex items-center gap-2">
        <Heart className="w-3.5 h-3.5 text-primary" />
        <p className="text-xs text-muted-foreground uppercase tracking-wider">In Their Own Words</p>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span className="text-xs">Thinking...</span>
        </div>
      ) : feelings ? (
        <p className="text-sm text-foreground leading-relaxed italic">{feelings}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">Nothing to share right now.</p>
      )}
    </div>
  );
}