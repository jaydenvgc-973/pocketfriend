import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const ISSUE_LIST = [
  { id: 'mark_read', label: 'Mark messages as read', description: 'Reset all unread notification counts to 0' },
  { id: 'card_data', label: 'Character cards missing data', description: 'Restore missing name or core fields' },
  { id: 'emotional_state', label: 'Mood/emotional state missing', description: 'Restore character mood display' },
  { id: 'location_display', label: 'Location not showing', description: 'Check city/state display' },
  { id: 'availability_display', label: 'Availability incorrect', description: 'Verify work schedule display' },
  { id: 'notification_dots', label: 'Notification dots stuck', description: 'Recalculate unread counts' },
  { id: 'character_separation', label: 'Character data cross-contamination', description: 'Detect and fix characters sharing threads, memories, or routing' },
  { id: 'simulated_interaction', label: 'Simulated interaction tool issues', description: 'Diagnose and fix connection, state, or execution failures' },
];

export default function TroubleshootingPanelHome({ isOpen, onClose }) {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [selectedIssues, setSelectedIssues] = useState([]);
  const queryClient = useQueryClient();

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
      // Route simulated_interaction separately — it has its own dedicated function
      if (selectedIssues.includes('simulated_interaction') && selectedIssues.length === 1) {
        const res = await base44.functions.invoke('troubleshootSimulatedInteraction', {});
        if (res?.data?.data) {
          setResults({
            summary: res.data.data.summary,
            fixed: res.data.data.fixes_applied || [],
            issues_found: res.data.data.issues_found || [],
            checks: (res.data.data.checks_performed || []).map(check => ({
              name: check, status: 'info', message: 'Diagnostic performed'
            }))
          });
        } else {
          setError('Simulated interaction diagnostic failed');
        }
      } else {
        // All other selections go through troubleshootHome with ONLY the selected issues
        const res = await base44.functions.invoke('troubleshootHome', { selectedIssues });
        if (res?.data?.data) {
          setResults(res.data.data);
        } else {
          setError('Failed to run troubleshooting');
        }
      }

      // Always invalidate UI caches after any diagnostic
      await queryClient.invalidateQueries({ queryKey: ['characters'] });
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
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
            className="w-full max-w-2xl bg-card border border-border rounded-t-2xl max-h-[80vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="sticky top-0 bg-card/80 backdrop-blur-sm border-b border-border p-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Home Page Troubleshooting</h3>
                <p className="text-xs text-muted-foreground mt-1">Diagnose character card and display issues</p>
              </div>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {!results && !isRunning && (
                <>
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
                </>
              )}

              {isRunning && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Checking Home page systems...</p>
                </div>
              )}

              {results && !isRunning && (
                <div className="space-y-4">
                  {/* Summary */}
                  <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
                    <p className="text-sm font-medium text-foreground">{results.summary}</p>
                  </div>

                  {/* Fixed */}
                  {(results.fixed || results.fixes_applied || []).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Fixed</p>
                      <div className="space-y-1">
                        {(results.fixed || results.fixes_applied || []).map((item, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-foreground">
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Issues Found */}
                  {(results.issues_found || []).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Issues Found</p>
                      <div className="space-y-1">
                        {(results.issues_found || []).map((item, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-foreground">
                            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setResults(null);
                      setSelectedIssues([]);
                    }}
                    className="w-full px-4 py-2 rounded-xl bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors text-sm"
                  >
                    Run Again
                  </button>
                </div>
              )}

              {error && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                  <p className="text-sm text-destructive">{error}</p>
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