import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, X, CheckCircle2, XCircle, AlertCircle, Circle, RefreshCw } from 'lucide-react';

/**
 * GenerationProgressModal
 *
 * Non-destructive inspection of the actual persisted state of a Story Event.
 * Does NOT launch an AI diagnostic — simply queries existing records and
 * displays what exists, what does not, and what step has not completed.
 *
 * The user uses this information to decide what happens next:
 *   - Retry Remaining: continue from the first genuinely unfinished portion
 *     (calls generateStoryEvent directly — the backend's idempotent re-entry
 *     skips completed work and only retries missing pieces)
 *   - Close: keep the event in its current state (nothing is deleted)
 */
export default function GenerationProgressModal({
  eventId,
  event,
  memories = [],
  images = [],
  onRetryRemaining,
  retryingRemaining = false,
  onClose,
}) {
  const [participations, setParticipations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const parts = await base44.entities.EventParticipation.filter(
          { event_id: eventId }, null, 200
        ).catch(() => []);
        if (!cancelled) setParticipations(parts || []);
      } catch (_) {
        if (!cancelled) setParticipations([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId]);

  // ── STEP STATUS COMPUTATION ──────────────────────────────────────────────
  // Each step is derived from actual persisted records — no AI, no inference.

  const narrativeComplete = !!(event?.generated_narrative);
  const memoryCount = memories.length;
  const expectedParticipants = (event?.participant_character_ids || []).length;
  const memoryComplete = expectedParticipants > 0 && memoryCount >= expectedParticipants;

  const imageByMoment = {};
  images.forEach(img => { imageByMoment[img.moment_type] = img; });

  const momentSteps = ['opening', 'key_moment', 'closing'].map(moment => {
    const img = imageByMoment[moment];
    if (img?.image_url) return { moment, status: 'complete', label: 'Complete' };
    if (img && !img.image_url) return { moment, status: 'failed', label: 'Failed', error: img.regeneration_reason };
    return { moment, status: 'missing', label: 'Not started' };
  });

  const participationCount = participations.length;
  const participationComplete = expectedParticipants > 0 && participationCount >= expectedParticipants;

  const allSteps = [
    { key: 'narrative', label: 'Narrative', status: narrativeComplete ? 'complete' : 'missing', detail: narrativeComplete ? 'Complete' : 'Not generated' },
    { key: 'memories', label: 'Character Memories', status: memoryComplete ? 'complete' : memoryCount > 0 ? 'partial' : 'missing', detail: `${memoryCount} / ${expectedParticipants} created` },
    ...momentSteps.map(s => ({ key: `image_${s.moment}`, label: `Image: ${s.moment.replace('_', ' ')}`, status: s.status, detail: s.label, error: s.error })),
    { key: 'participation', label: 'Participation Records', status: participationComplete ? 'complete' : participationCount > 0 ? 'partial' : 'missing', detail: `${participationCount} / ${expectedParticipants} created` },
  ];

  const incompleteSteps = allSteps.filter(s => s.status !== 'complete');

  const statusIcon = (status) => {
    switch (status) {
      case 'complete': return <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
      case 'failed': return <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />;
      case 'partial': return <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />;
      default: return <Circle className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />;
    }
  };

  const statusColor = (status) => {
    switch (status) {
      case 'complete': return 'text-emerald-400';
      case 'failed': return 'text-destructive';
      case 'partial': return 'text-amber-400';
      default: return 'text-muted-foreground';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center pb-24 pt-4 px-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Generation Progress</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">{event?.title || 'Story Event'}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body — persisted state checklist */}
        <div className="p-4 space-y-2 max-h-[50vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground mb-2">
                Actual persisted state of this event. Nothing is deleted or modified by viewing this.
              </p>
              {allSteps.map(step => (
                <div key={step.key} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-secondary/30 border border-border">
                  {statusIcon(step.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">{step.label}</p>
                    {step.error && <p className="text-[9px] text-destructive mt-0.5 truncate">{step.error}</p>}
                  </div>
                  <span className={`text-[10px] font-medium ${statusColor(step.status)}`}>
                    {step.detail}
                  </span>
                </div>
              ))}

              {incompleteSteps.length > 0 && (
                <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <p className="text-[10px] text-amber-400 font-medium mb-1">Remaining work:</p>
                  <p className="text-[10px] text-muted-foreground">
                    {incompleteSteps.map(s => s.label).join(', ')}
                  </p>
                </div>
              )}

              {incompleteSteps.length === 0 && (
                <div className="mt-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <p className="text-[10px] text-emerald-400 font-medium">
                    ✓ All steps complete — nothing remaining to retry.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — actions */}
        <div className="flex-shrink-0 border-t border-border p-4 flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              onClick={onRetryRemaining}
              disabled={retryingRemaining || loading || incompleteSteps.length === 0}
              className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {retryingRemaining ? <><Loader2 className="w-4 h-4 animate-spin" /> Retrying…</> : <><RefreshCw className="w-4 h-4" /> Retry Remaining</>}
            </button>
            <button onClick={onClose} className="flex-1 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm">
              Close
            </button>
          </div>
          <p className="text-[9px] text-muted-foreground text-center">
            Retry Remaining continues only the unfinished portion — completed work is preserved.
          </p>
        </div>
      </div>
    </div>
  );
}