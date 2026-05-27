import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Calendar, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createPortal } from "react-dom";

/**
 * IncarcerationReleaseModal
 *
 * Notification modal shown AFTER the character has already been auto-released
 * by checkLifecycleEvents. The release already happened server-side.
 * This is purely informational — no release action needed here.
 *
 * The user can:
 *   - Acknowledge (OK) — moves to next release notification or closes
 *
 * No "Dismiss for now" or "Extend Stay" — the sentence is served and the character is free.
 * Extension is a separate editorial decision on the character profile.
 */
export default function IncarcerationReleaseModal({ releases, onDismiss }) {
  const [idx, setIdx] = useState(0);

  if (!releases || releases.length === 0) return null;
  const release = releases[idx];
  if (!release) return null;

  const advance = () => {
    if (idx + 1 < releases.length) {
      setIdx(idx + 1);
    } else {
      onDismiss?.();
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
            <div className="w-10 h-10 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-green-400 uppercase tracking-widest mb-0.5">Released</p>
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
              <Clock className="w-3 h-3 text-green-400 shrink-0" />
              <span className="text-xs text-green-400 font-medium">
                Sentence completed {formatDate(release.jail_release_date)}
                {release.overdue_hours > 0 && ` · ${release.overdue_hours}h overdue at release`}
              </span>
            </div>
          </div>

          <p className="text-sm text-foreground leading-relaxed">
            {release.character_name} has served their sentence and has been released. They are now back home.
          </p>

          <Button
            onClick={advance}
            className="w-full rounded-2xl h-11 font-semibold text-sm"
          >
            ✅ Got it
          </Button>

          {releases.length > 1 && (
            <p className="text-center text-[10px] text-muted-foreground">{idx + 1} of {releases.length}</p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(modal, document.body);
}