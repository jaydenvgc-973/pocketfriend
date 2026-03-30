import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wrench, AlertCircle, CheckCircle2, Clock, Loader2, ChevronRight } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const ISSUE_LIST = [
  { id: 'thread_load', label: 'Thread not loading correctly', description: 'Check if conversation is properly linked to this character — detect cross-character routing' },
  { id: 'missing_messages', label: 'Messages missing from thread', description: 'Restore messages that exist in DB but aren\'t showing' },
  { id: 'unread_stuck', label: 'Unread notification stuck', description: 'Fix out-of-sync unread counts' },
  { id: 'pending_messages', label: 'Messages not delivering', description: 'Deliver pending messages stuck in queue' },
  { id: 'media_missing', label: 'Images not loading', description: 'Deep scan: find messages with missing/failed image URLs and attempt recovery' },
  { id: 'archived_messages', label: 'Hidden or archived messages', description: 'Recover messages hidden from view' },
  { id: 'character_identity', label: 'Wrong character responding', description: 'Detect if messages from another character are appearing in this thread' },
  { id: 'deep_character_recovery', label: 'Retrieve any & all images, messages, memories for this character', description: 'Deep dive across ALL app data — finds orphaned messages, memories, images, and life events anywhere in the system and reattaches them to this character. Also restores them to the correct chat thread.' },
];

export default function TroubleshootingPanel({ isOpen, onClose, conversationId, characterId }) {
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
      const res = await base44.functions.invoke('troubleshootThread', {
        conversationId,
        characterId,
        selectedIssues, // only run diagnostics for what the user selected
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

  if (!isOpen) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 z-50 flex items-end justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90vh] bg-card border border-border rounded-t-3xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wrench className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Thread Troubleshooting</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
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
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Checking thread...</p>
            </div>
          )}

          {results && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="p-4 rounded-xl bg-secondary/50 border border-border">
                <p className="text-sm font-medium text-foreground">{results.summary}</p>
              </div>

              {/* Fixes Applied */}
              {results.fixes_applied.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    Fixes Applied
                  </h3>
                  <div className="space-y-1">
                    {results.fixes_applied.map((fix, idx) => (
                      <p key={idx} className="text-xs text-emerald-600 bg-emerald-500/10 px-3 py-2 rounded-lg">
                        ✓ {fix}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Check Results */}
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Detailed Results</h3>
                <div className="space-y-2">
                  {results.checks.map((check, idx) => {
                    const statusIcon = {
                      passed: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
                      warning: <AlertCircle className="w-4 h-4 text-amber-500" />,
                      failed: <AlertCircle className="w-4 h-4 text-destructive" />,
                      info: <Clock className="w-4 h-4 text-blue-500" />,
                    }[check.status];

                    const bgColor = {
                      passed: 'bg-emerald-500/10',
                      warning: 'bg-amber-500/10',
                      failed: 'bg-destructive/10',
                      info: 'bg-blue-500/10',
                    }[check.status];

                    return (
                      <div key={idx} className={`${bgColor} border border-border/50 rounded-lg p-3 space-y-1`}>
                        <div className="flex items-center gap-2">
                          {statusIcon}
                          <span className="text-xs font-semibold text-foreground">{check.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground ml-6">{check.message}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-4">
                <button
                  onClick={runTroubleshooting}
                  disabled={isRunning}
                  className="flex-1 px-4 py-2 rounded-lg bg-primary/10 text-primary font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
                >
                  Run Again
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 rounded-lg bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-destructive">Error</p>
                <p className="text-xs text-destructive/80">{error}</p>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}