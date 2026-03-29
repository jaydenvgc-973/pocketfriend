import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const ISSUE_LIST = [
  { id: 'event_tracking', label: 'Events not being tracked', description: 'Verify event logging system' },
  { id: 'badge_unlock', label: 'Badge not unlocking', description: 'Check badge trigger conditions' },
  { id: 'achievement_progress', label: 'Achievement progress incorrect', description: 'Recalculate progress' },
  { id: 'counter_accuracy', label: 'Counters not counting correctly', description: 'Verify user-specific counters' },
  { id: 'retroactive_credit', label: 'Retroactive credit missing', description: 'Restore retroactive badges' },
  { id: 'tracker_sync', label: 'Tracker and badge mismatch', description: 'Sync tracker with badges' },
  { id: 'moments_update', label: 'Moments page not updating', description: 'Check data freshness' },
];

export default function TroubleshootingPanelMoments({ isOpen, onClose }) {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [selectedIssues, setSelectedIssues] = useState([]);

  const toggleIssue = (issueId) => {
    setSelectedIssues(prev => 
      prev.includes(issueId) 
        ? prev.filter(id => id !== issueId)
        : [...prev, issueId]
    );
  };

  const runTroubleshooting = async () => {
    setIsRunning(true);
    setError(null);
    setResults(null);

    try {
      const res = await base44.functions.invoke('troubleshootMoments', {
        selectedIssues,
      });

      if (res?.data?.data) {
        setResults(res.data.data);
      } else {
        setError('Failed to run troubleshooting');
      }
    } catch (err) {
      setError(err.message || 'Error running troubleshooting');
    } finally {
      setIsRunning(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-card border border-border rounded-t-2xl max-h-[80vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="sticky top-0 bg-card/80 backdrop-blur-sm border-b border-border p-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Moments Troubleshooting</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Check achievements and tracking systems</p>
              </div>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4">
              {!results && !isRunning && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Select the issues you'd like to check and fix:
                  </p>
                  <div className="space-y-2">
                    {ISSUE_LIST.map(issue => (
                      <button
                        key={issue.id}
                        onClick={() => toggleIssue(issue.id)}
                        className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                          selectedIssues.includes(issue.id)
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-secondary/50 hover:bg-secondary'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground">{issue.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{issue.description}</p>
                          </div>
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ml-2 ${
                            selectedIssues.includes(issue.id)
                              ? 'bg-primary border-primary'
                              : 'border-border'
                          }`}>
                            {selectedIssues.includes(issue.id) && (
                              <CheckCircle2 className="w-4 h-4 text-primary-foreground" />
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={runTroubleshooting}
                      disabled={selectedIssues.length === 0 || isRunning}
                      className="flex-1 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Check Selected Issues
                    </button>
                    <button
                      onClick={onClose}
                      className="px-4 py-3 rounded-xl bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}

              {isRunning && (
                <div className="flex flex-col items-center justify-center py-8 space-y-4">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Checking achievements and tracking...</p>
                </div>
              )}

              {results && !isRunning && (
                <div className="space-y-4">
                  <div className="bg-secondary/50 rounded-lg p-4 space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Checked</p>
                      <ul className="space-y-1 text-sm text-foreground">
                        {results.checked.map((check, i) => (
                          <li key={i}>✓ {check}</li>
                        ))}
                      </ul>
                    </div>

                    {results.fixed.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">Fixed</p>
                        <ul className="space-y-1 text-sm text-foreground">
                          {results.fixed.map((fix, i) => (
                            <li key={i}>✓ {fix}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {results.issues_found.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-yellow-500 uppercase tracking-wider mb-2">Issues Found</p>
                        <ul className="space-y-1 text-sm text-foreground">
                          {results.issues_found.map((issue, i) => (
                            <li key={i}>⚠ {issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="border-t border-border pt-3 mt-3">
                      <p className="text-xs font-medium text-foreground">{results.summary}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setResults(null);
                      setSelectedIssues([]);
                    }}
                    className="w-full px-4 py-3 rounded-xl bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors"
                  >
                    Run Again
                  </button>
                  <button
                    onClick={onClose}
                    className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                  >
                    Close
                  </button>
                </div>
              )}

              {error && (
                <div className="bg-destructive/10 border border-destructive rounded-lg p-4">
                  <p className="text-sm text-destructive">{error}</p>
                  <button
                    onClick={() => setError(null)}
                    className="mt-3 text-xs text-destructive underline hover:no-underline"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}