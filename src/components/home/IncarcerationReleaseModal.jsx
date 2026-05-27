import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Calendar, Clock, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createPortal } from "react-dom";
import { base44 } from "@/api/base44Client";

/**
 * IncarcerationReleaseModal
 *
 * Shown when checkLifecycleEvents detects a character whose sentence end date
 * has passed and who is still jailed. The character is NOT yet auto-released —
 * this popup gives the user the decision.
 *
 * Options:
 *   1. Release Now — releases the character immediately, clears jail state
 *   2. Extend Stay — user picks a new release date, sentence key is reset
 *
 * If the user never sees this popup (background tab, no homepage visit),
 * fixOverdueConfinement runs as a scheduled fallback after a grace period.
 */
export default function IncarcerationReleaseModal({ releases, onDismiss }) {
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState('decision'); // 'decision' | 'extend'
  const [extendDate, setExtendDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!releases || releases.length === 0) return null;
  const release = releases[idx];
  if (!release) return null;

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Min extend date = tomorrow
  const minExtendDate = new Date();
  minExtendDate.setDate(minExtendDate.getDate() + 1);
  const minExtendISO = minExtendDate.toISOString().slice(0, 10);

  const advance = () => {
    setMode('decision');
    setExtendDate('');
    setError('');
    if (idx + 1 < releases.length) {
      setIdx(idx + 1);
    } else {
      onDismiss?.();
    }
  };

  const handleRelease = async () => {
    setLoading(true);
    setError('');
    try {
      await base44.functions.invoke('releaseCharacterFromJail', {
        character_id: release.character_id,
        release_date_iso: release.jail_release_date,
      });
      advance();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Release failed');
    } finally {
      setLoading(false);
    }
  };

  const handleExtend = async () => {
    if (!extendDate) { setError('Please pick a new release date.'); return; }
    setLoading(true);
    setError('');
    try {
      await base44.functions.invoke('extendCharacterSentence', {
        character_id: release.character_id,
        new_release_date_iso: new Date(extendDate).toISOString(),
        original_release_date_iso: release.jail_release_date,
      });
      advance();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Extension failed');
    } finally {
      setLoading(false);
    }
  };

  const modal = (
    <AnimatePresence>
      <motion.div
        key="release-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 px-5"
      >
        <motion.div
          key={`release-card-${release.character_id}-${idx}`}
          initial={{ scale: 0.88, opacity: 0, y: 28 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 12 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          className="w-full max-w-sm bg-card border border-border rounded-3xl p-6 flex flex-col gap-4 shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-500/15 border border-orange-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-orange-400 uppercase tracking-widest mb-0.5">Sentence Complete</p>
              <h2 className="text-lg font-bold text-foreground leading-tight">{release.character_name}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{release.facility_name}</p>
            </div>
          </div>

          {/* Details */}
          <div className="bg-secondary/50 rounded-2xl p-3 space-y-2">
            {release.charges?.length > 0 && (
              <div className="flex gap-2">
                <span className="text-xs text-muted-foreground w-16 shrink-0">Charges</span>
                <span className="text-xs text-foreground">{release.charges.join(', ')}</span>
              </div>
            )}
            {release.jailed_at && (
              <div className="flex gap-2 items-center">
                <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="text-xs text-muted-foreground">Booked {formatDate(release.jailed_at)}</span>
              </div>
            )}
            {release.sentence_days && (
              <div className="flex gap-2">
                <span className="text-xs text-muted-foreground w-16 shrink-0">Sentence</span>
                <span className="text-xs text-foreground">{release.sentence_days} days</span>
              </div>
            )}
            <div className="flex gap-2 items-center">
              <Clock className="w-3 h-3 text-orange-400 shrink-0" />
              <span className="text-xs text-orange-400 font-medium">
                Release date was {formatDate(release.jail_release_date)}
                {release.overdue_hours > 0 && ` · ${release.overdue_hours}h ago`}
              </span>
            </div>
          </div>

          {mode === 'decision' && (
            <>
              <p className="text-sm text-foreground leading-relaxed">
                {release.character_name}'s sentence has been served. What would you like to do?
              </p>

              {error && <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>}

              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleRelease}
                  disabled={loading}
                  className="w-full rounded-2xl h-11 font-semibold text-sm bg-green-600 hover:bg-green-700"
                >
                  {loading ? 'Releasing…' : '✅ Release Now'}
                </Button>
                <Button
                  onClick={() => { setMode('extend'); setError(''); }}
                  disabled={loading}
                  variant="outline"
                  className="w-full rounded-2xl h-11 font-semibold text-sm"
                >
                  🔒 Extend Stay
                </Button>
              </div>
            </>
          )}

          {mode === 'extend' && (
            <>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-primary" />
                  <p className="text-sm font-medium text-foreground">Set new release date</p>
                </div>
                <input
                  type="date"
                  value={extendDate}
                  min={minExtendISO}
                  onChange={e => { setExtendDate(e.target.value); setError(''); }}
                  className="w-full h-10 px-3 rounded-xl bg-background border border-border text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/50"
                />
                <p className="text-xs text-muted-foreground">
                  {release.character_name} will remain incarcerated until this new date.
                </p>
              </div>

              {error && <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>}

              <div className="flex gap-2">
                <Button
                  onClick={handleExtend}
                  disabled={loading || !extendDate}
                  className="flex-1 rounded-2xl h-11 font-semibold text-sm"
                >
                  {loading ? 'Saving…' : '🔒 Confirm Extension'}
                </Button>
                <Button
                  onClick={() => { setMode('decision'); setError(''); }}
                  disabled={loading}
                  variant="outline"
                  className="rounded-2xl h-11 px-4"
                >
                  Back
                </Button>
              </div>
            </>
          )}

          {releases.length > 1 && (
            <p className="text-center text-[10px] text-muted-foreground">{idx + 1} of {releases.length}</p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(modal, document.body);
}