import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2 } from "lucide-react";

// Session-level in-memory cache — survives component remounts within the same tab session.
// Key: characterId → feelings string. Never expires within the session.
// This prevents repeat LLM calls when navigating away and back to the same profile.
const feelingsCache = {};

// Global in-flight map — prevents concurrent duplicate calls for the same character.
// Key: characterId → Promise. Resolved promise is removed from map.
const inFlight = {};

export default function CharacterFeelingsCard({ character, onRespectCorrected }) {
  const charId = character?.id;

  // Seed from cache immediately — no loading flash if we already have feelings for this character.
  const [feelings, setFeelings] = useState(() => feelingsCache[charId] || null);
  const [loading, setLoading] = useState(() => !feelingsCache[charId]);

  useEffect(() => {
    if (!charId) return;

    // Cache hit — show immediately, no network call needed.
    if (feelingsCache[charId]) {
      setFeelings(feelingsCache[charId]);
      setLoading(false);
      return;
    }

    // If a call is already in-flight for this character (e.g. two profile panels mounted simultaneously),
    // attach to it instead of firing a second request.
    if (inFlight[charId]) {
      setLoading(true);
      inFlight[charId].then(result => {
        if (result) { setFeelings(result); }
        setLoading(false);
      }).catch(() => setLoading(false));
      return;
    }

    setLoading(true);

    // 2.5s delay — avoids firing before the profile's higher-priority queries complete.
    const timer = setTimeout(() => {
      const promise = base44.functions.invoke("generateCharacterFeelings", { characterId: charId })
        .then(res => {
          const newFeelings = res?.data?.feelings || null;
          if (newFeelings) {
            feelingsCache[charId] = newFeelings;
            setFeelings(newFeelings);
          }
          if (res?.data?.respect_used !== undefined && res.data.respect_used !== (character.user_respect_level ?? 50)) {
            onRespectCorrected?.();
          }
          return newFeelings;
        })
        .catch(() => null)
        .finally(() => {
          delete inFlight[charId];
          setLoading(false);
        });

      inFlight[charId] = promise;
    }, 2500);

    return () => clearTimeout(timer);
  }, [charId]); // eslint-disable-line

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