/**
 * RelationshipTensionCard
 *
 * Displays relationship tension between the current character and another
 * connected character. Loads lazily after profile mounts — does NOT block
 * or slow down the profile page.
 *
 * Props:
 *   characterId     — the current character's ID (Profile page)
 *   relatedCharId   — the other person in the tension pair
 *   relatedCharName — display name for the other person
 */
import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const SEVERITY_STYLES = {
  low:    { border: 'border-yellow-500/30',  bg: 'bg-yellow-500/5',  text: 'text-yellow-400',  dot: 'bg-yellow-400', label: 'Mild Tension' },
  medium: { border: 'border-orange-500/30',  bg: 'bg-orange-500/5',  text: 'text-orange-400',  dot: 'bg-orange-400', label: 'Tension' },
  high:   { border: 'border-red-500/30',     bg: 'bg-red-500/5',     text: 'text-red-400',     dot: 'bg-red-400',    label: 'High Tension' },
};

export default function RelationshipTensionCard({ characterId, relatedCharId, relatedCharName, loadDelayMs = 1500 }) {
  const [tension, setTension] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadedRef = useRef(false);

  const loadTension = async (force = false) => {
    if (!characterId || !relatedCharId) { setLoading(false); return; }
    try {
      const res = await base44.functions.invoke('resolveRelationshipTension', {
        characterAId: characterId,
        characterBId: relatedCharId,
        forceRefresh: force,
      });
      const t = res?.data?.tension;
      setTension(t?.has_tension ? t : null);
    } catch {
      // Fail silently — tension card is supplemental, not critical
      setTension(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    // Defer load so profile renders first; loadDelayMs staggers multiple cards
    const timer = setTimeout(() => loadTension(false), loadDelayMs);
    return () => clearTimeout(timer);
  }, [characterId, relatedCharId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadTension(true);
  };

  if (loading || !tension) return null;

  const style = SEVERITY_STYLES[tension.severity] || SEVERITY_STYLES.low;

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-3 space-y-2`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${style.dot}`} />
          <AlertTriangle className={`w-3.5 h-3.5 ${style.text}`} />
          <span className={`text-xs font-semibold ${style.text}`}>
            {style.label}
          </span>
          <span className="text-[11px] text-muted-foreground">
            with {relatedCharName}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh tension analysis"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Summary — always visible */}
      {tension.summary && (
        <p className="text-xs text-foreground/80 leading-relaxed">
          {tension.summary}
        </p>
      )}

      {/* Evidence — expanded only */}
      {expanded && tension.evidence?.length > 0 && (
        <div className="pt-1 space-y-1 border-t border-border/30">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Evidence</p>
          {tension.evidence.map((e, i) => (
            <p key={i} className="text-[11px] text-muted-foreground leading-snug">
              · {e}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}