import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { AlertTriangle, Calendar, Clock, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPortal } from "react-dom";

/**
 * IncarcerationReleaseModal
 *
 * Shown when a character's sentence end date has passed.
 * Options:
 *   - Release Now: triggers fixOverdueConfinement with dry_run=false scoped to this character
 *   - Extend Stay: sets a new jail_release_date, keeps character jailed
 *   - Dismiss: closes without action (character remains jailed, popup won't re-show until next session)
 */
export default function IncarcerationReleaseModal({ releases, onDismiss, onReleased }) {
  const [idx, setIdx] = useState(0);
  const [showExtend, setShowExtend] = useState(false);
  const [extendDate, setExtendDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!releases || releases.length === 0) return null;
  const release = releases[idx];
  if (!release) return null;

  const advance = () => {
    setShowExtend(false);
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
      // Use existing fixOverdueConfinement with dry_run=false
      // That function scopes by owner_email and handles presence/location restoration
      await base44.functions.invoke('fixOverdueConfinement', { dry_run: false });
      onReleased?.(release);
      advance();
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Release failed');
    } finally {
      setLoading(false);
    }
  };

  const handleExtend = async () => {
    if (!extendDate) { setError('Please select a new release date'); return; }
    setLoading(true);
    setError('');
    try {
      const newReleaseDateISO = new Date(extendDate + 'T23:59:00').toISOString();
      await base44.entities.Character.update(release.character_id, {
        jail_release_date: newReleaseDateISO,
        last_release_popup_at: null, // reset so popup fires again when new date passes
      });
      advance();
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Extension failed');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
          key={`release-card-${release.character_id}`}
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
              <p className="text-xs text-muted-foreground mt-0.5">
                {release.facility_name}
              </p>
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
            <div className="flex gap-2 items-center">
              <Clock className="w-3 h-3 text-orange-400 shrink-0" />
              <span className="text-xs text-orange-400 font-medium">
                Sentence ended {formatDate(release.jail_release_date)}
                {release.overdue_hours > 0 && ` · ${release.overdue_hours}h overdue`}
              </span>
            </div>
            {release.sentence_days && (
              <div className="flex gap-2">
                <span className="text-xs text-muted-foreground w-16 shrink-0">Sentence</span>
                <span className="text-xs text-foreground">{release.sentence_days} days</span>
              </div>
            )}
          </div>

          <p className="text-sm text-foreground leading-relaxed">
            {release.character_name}'s sentence has been served. They can be released or their stay can be extended.
          </p>

          {/* Extend form */}
          <AnimatePresence>
            {showExtend && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden space-y-2"
              >
                <p className="text-xs text-muted-foreground">Select new release date:</p>
                <Input
                  type="date"
                  value={extendDate}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={e => setExtendDate(e.target.value)}
                  className="h-9 rounded-xl text-sm"
                />
              </motion.div>
            )}
          </AnimatePresence>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded-xl px-3 py-2">{error}</p>
          )}

          {/* Actions */}
          <div className="space-y-2">
            {!showExtend ? (
              <>
                <Button
                  onClick={handleRelease}
                  disabled={loading}
                  className="w-full rounded-2xl h-11 font-semibold text-sm"
                >
                  {loading ? 'Releasing...' : '✅ Release Now'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowExtend(true)}
                  disabled={loading}
                  className="w-full rounded-2xl h-11 text-sm flex items-center justify-center gap-1"
                >
                  Extend Stay <ChevronRight className="w-4 h-4" />
                </Button>
                <button
                  onClick={advance}
                  disabled={loading}
                  className="w-full text-xs text-muted-foreground py-2 hover:text-foreground transition-colors"
                >
                  Dismiss for now
                </button>
              </>
            ) : (
              <>
                <Button
                  onClick={handleExtend}
                  disabled={loading || !extendDate}
                  className="w-full rounded-2xl h-11 font-semibold text-sm"
                >
                  {loading ? 'Saving...' : 'Confirm Extension'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => { setShowExtend(false); setExtendDate(''); setError(''); }}
                  disabled={loading}
                  className="w-full rounded-2xl h-11 text-sm"
                >
                  Back
                </Button>
              </>
            )}
          </div>

          {releases.length > 1 && (
            <p className="text-center text-[10px] text-muted-foreground">{idx + 1} of {releases.length}</p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(modal, document.body);
}