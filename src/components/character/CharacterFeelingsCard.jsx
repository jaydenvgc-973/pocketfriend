import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, Heart } from "lucide-react";

export default function CharacterFeelingsCard({ character }) {
  const [feelings, setFeelings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!character?.id) return;
    setLoading(true);
    setFeelings(null);
    base44.functions.invoke("generateCharacterFeelings", { characterId: character.id })
      .then(res => setFeelings(res?.data?.feelings || null))
      .finally(() => setLoading(false));
  }, [character?.id]);

  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Heart className="w-4 h-4 text-primary" />
        <p className="text-xs text-muted-foreground uppercase tracking-wider">How They Feel Right Now</p>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Thinking...</span>
        </div>
      ) : feelings ? (
        <p className="text-sm text-foreground leading-relaxed">{feelings}</p>
      ) : (
        <p className="text-sm text-muted-foreground italic">Nothing to share right now.</p>
      )}
    </div>
  );
}