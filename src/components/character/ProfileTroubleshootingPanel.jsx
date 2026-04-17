import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wrench, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';

const ISSUE_LIST = [
  { id: 'ownership_integrity', label: '🔑 Ownership integrity', description: 'Verify owner_email and created_by are correctly set. For NPCs, confirms they belong to the right user account.' },
  { id: 'family_list', label: 'Family list check (read-only)', description: 'Detect duplicate or mismatched family members. Reports only — never removes members.' },
  { id: 'family_save', label: 'Family / profile edits not saving', description: 'Runs a save round-trip test to confirm profile writes are persisting correctly.' },
  { id: 'wrong_titles', label: 'Wrong relationship titles (read-only)', description: 'Detect titles that conflict between family list and fictional relationships. Reports only.' },
  { id: 'profile_save', label: 'Character details not saving', description: 'Verify that profile field writes round-trip correctly.' },
  { id: 'status_location', label: 'Missing or incorrect status/location (read-only)', description: 'Report current resolved location, presence status, and home/work IDs. Never changes location or schedule.' },
  { id: 'character_identity', label: 'Profile data cross-contamination (read-only)', description: 'Detect duplicate records with the same name. Reports only — never merges or deletes.' },
  { id: 'duplicate_relationships', label: 'Duplicate people in relationships (read-only)', description: 'Detect duplicate entries in fictional_relationships. Reports only.' },
  { id: 'duplicate_records', label: 'Duplicate character records (read-only)', description: 'Find other active records with the same name. Reports only — never deletes.' },
  { id: 'world_name_enforcement', label: 'Character using "the user" instead of my name', description: 'Correct stale identity in memories and system_prompt cache. Safe: only replaces placeholder text.' },
  { id: 'appearance_lock_check', label: 'Appearance lock / age appearance check', description: 'Report appearance_lock field completeness. Never modifies appearance data.' },
  { id: 'stale_location_refs', label: 'Character referencing deleted location (read-only)', description: 'Detect stale location IDs. Reports only — never removes or changes location assignments.' },
  { id: 'fix_everything', label: '🔧 Fix Everything — Full System Deep Diagnostic', description: 'Master cross-system scan. Applies only safe fixes (ownership, defaults, stale caches). No deletions, no location changes, no schedule changes.' },
];

export default function ProfileTroubleshootingPanel({ isOpen, onClose, characterId, characterName }) {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [selectedIssues, setSelectedIssues] = useState([]);
  const queryClient = useQueryClient();

  const toggleIssue = (id) => {
    setSelectedIssues(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const runDiagnostic = async () => {
    setIsRunning(true);
    setError(null);
    setResults(null);
    try {
      const res = await base44.functions.invoke('troubleshootCharacterProfile', { characterId, selectedIssues });
      if (res?.data?.data) {
        setResults(res.data.data);
        queryClient.invalidateQueries({ queryKey: ['character', characterId] });
        queryClient.invalidateQueries({ queryKey: ['characters'] });
      } else {
        setError('Diagnostic failed to return results');
      }
    } catch (err) {
      setError(err.message || 'Error running diagnostic');
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
            className="w-full max-w-2xl bg-card border border-border rounded-t-2xl max-h-[85vh] overflow-y-auto"
          >
            <div className="sticky top-0 bg-card/90 backdrop-blur-sm border-b border-border p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-primary" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Profile Troubleshooting — {characterName}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Safe diagnostics only — no deletions, no location changes</p>
                </div>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {!results && !isRunning && (
                <>
                  <p className="text-sm text-muted-foreground">Select the issues to diagnose:</p>
                  <div className="space-y-2">
                    {ISSUE_LIST.map(issue => (
                      <button
                        key={issue.id}
                        onClick={() => toggleIssue(issue.id)}
                        className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                          selectedIssues.includes(issue.id) ? 'border-primary bg-primary/10' : 'border-border bg-secondary/50 hover:bg-secondary'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-foreground">{issue.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{issue.description}</p>
                          </div>
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ml-2 ${
                            selectedIssues.includes(issue.id) ? 'bg-primary border-primary' : 'border-border'
                          }`}>
                            {selectedIssues.includes(issue.id) && <CheckCircle2 className="w-4 h-4 text-primary-foreground" />}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={runDiagnostic}
                      disabled={selectedIssues.length === 0 || isRunning}
                      className="flex-1 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Run Diagnostic
                    </button>
                    <button onClick={onClose} className="px-4 py-3 rounded-xl bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors">
                      Close
                    </button>
                  </div>
                </>
              )}

              {isRunning && (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Running diagnostic...</p>
                </div>
              )}

              {results && !isRunning && (
                <div className="space-y-4">
                  <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
                    <p className="text-sm font-medium text-foreground">{results.summary}</p>
                  </div>

                  {(results.fixes_applied || []).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Fixed</p>
                      {(results.fixes_applied || []).map((item, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-foreground">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(results.issues_found || []).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Issues Found</p>
                      {(results.issues_found || []).map((item, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-foreground">
                          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(results.checks || []).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Checks</p>
                      {(results.checks || []).map((check, i) => (
                        <div key={i} className={`rounded-lg p-2.5 border text-xs ${
                          check.status === 'passed' ? 'bg-emerald-500/10 border-emerald-500/20' :
                          check.status === 'fixed' ? 'bg-cyan-500/10 border-cyan-500/20' :
                          check.status === 'warning' ? 'bg-amber-500/10 border-amber-500/20' :
                          check.status === 'failed' ? 'bg-destructive/10 border-destructive/20' :
                          'bg-secondary border-border'
                        }`}>
                          <p className="font-medium text-foreground">{check.name}</p>
                          <p className="text-muted-foreground mt-0.5">{check.message}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => { setResults(null); setSelectedIssues([]); }}
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