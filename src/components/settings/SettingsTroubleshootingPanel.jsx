import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wrench, CheckCircle2, AlertCircle, Loader2, MapPin, Star, Database, Zap, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';

// ── ISSUE LISTS PER SECTION ──────────────────────────────────────────────────

const LOCATION_ISSUES = [
  {
    id: 'stale_location_refs',
    label: 'Characters referencing deleted locations',
    description: 'Scan all active characters for location ID fields pointing to locations that no longer exist'
  },
  {
    id: 'generic_location_labels',
    label: 'Generic location labels on characters',
    description: 'Find characters stuck with generic activity descriptions (e.g., "at a bar") instead of real resolved locations'
  },
  {
    id: 'resolved_location_sync',
    label: 'Resolved location fields out of sync',
    description: 'Check if resolved_current_location_id / resolved_current_location_name / resolved_presence_status are stale or missing'
  },
  {
    id: 'location_type_integrity',
    label: 'Location ownership and scope integrity',
    description: 'Verify all user-scoped locations have correct owner fields and are not leaking into shared scope'
  },
];

const MOMENTS_ISSUES = [
  {
    id: 'event_tracking',
    label: 'Life events not recording',
    description: 'Verify life events are being written to this account correctly'
  },
  {
    id: 'badge_unlock',
    label: 'Badge not unlocking',
    description: 'Check achievement unlock trigger logic for this account'
  },
  {
    id: 'achievement_progress',
    label: 'Achievement progress incorrect',
    description: 'Verify all achievement IDs and counts tracked against this account'
  },
  {
    id: 'retroactive_credit',
    label: 'Missing retroactive credit',
    description: 'Re-run historical achievement scan to grant any missed credits'
  },
  {
    id: 'tracker_sync',
    label: 'Challenge tracker mismatch',
    description: 'Verify active challenges match the badge/achievement state'
  },
  {
    id: 'moments_update',
    label: 'Moments page not updating',
    description: 'Check freshness of the most recent life events for this account'
  },
];

const SYSTEM_ISSUES = [
  {
    id: 'orphaned_characters',
    label: 'Orphaned or incomplete character records',
    description: 'Find characters missing required fields (character_type, status, creator) that may be excluded from lists'
  },
  {
    id: 'character_type_audit',
    label: 'Character type classification audit',
    description: 'Verify all characters have valid character_type values: active, npc, family_npc, background, promoted_npc'
  },
  {
    id: 'world_name_global',
    label: 'World name identity leaks (all characters)',
    description: 'Scan all characters on this account for stale "the user" / "the player" placeholder identity in memories and prompts'
  },
  {
    id: 'work_schedule_sync',
    label: 'Work schedule violations',
    description: 'Check if characters are correctly marked as at-work during their scheduled shifts'
  },
  {
    id: 'closed_venue_presence',
    label: 'Characters at closed venues',
    description: 'Find characters whose current resolved location is a venue outside its operating hours'
  },
  {
    id: 'backfill_owner_email',
    label: 'Backfill Character Owner Email',
    description: 'Repair legacy character records missing owner_email — only repaired when owner_user_id proves they belong to your account. Records without sufficient evidence are flagged, not guessed.',
    isAction: true,
  },
];

// ── RESULT DISPLAY (shared) ──────────────────────────────────────────────────

function ResultDisplay({ results, onReset }) {
  return (
    <div className="space-y-4">
      <div className="bg-primary/10 border border-primary/30 rounded-lg p-3">
        <p className="text-sm font-medium text-foreground">{results.summary}</p>
      </div>

      {(results.fixes_applied || []).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Repairs Applied</p>
          {results.fixes_applied.map((item, i) => (
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
          {results.issues_found.map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-foreground">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      )}

      {(results.checks || []).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Diagnostic Details</p>
          {results.checks.map((check, i) => (
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
        onClick={onReset}
        className="w-full px-4 py-2 rounded-xl bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors text-sm"
      >
        Run Again
      </button>
    </div>
  );
}

// ── ISSUE SELECTOR (shared) ──────────────────────────────────────────────────

function IssueSelector({ issues, selected, onToggle, onRun, onClose, isRunning }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Select the issues to diagnose:</p>
      <div className="space-y-2">
        {issues.map(issue => (
          issue.isAction ? (
            // Action items launch their own dedicated panel — not added to diagnostic batch
            <button
              key={issue.id}
              onClick={() => onToggle(issue.id)}
              className="w-full text-left p-3 rounded-lg border-2 border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-foreground">{issue.label}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">Action</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{issue.description}</p>
                </div>
                <div className="text-xs text-amber-400 flex-shrink-0 ml-2 mt-1">Run →</div>
              </div>
            </button>
          ) : (
            <button
              key={issue.id}
              onClick={() => onToggle(issue.id)}
              className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                selected.includes(issue.id) ? 'border-primary bg-primary/10' : 'border-border bg-secondary/50 hover:bg-secondary'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{issue.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{issue.description}</p>
                </div>
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ml-2 ${
                  selected.includes(issue.id) ? 'bg-primary border-primary' : 'border-border'
                }`}>
                  {selected.includes(issue.id) && <CheckCircle2 className="w-4 h-4 text-primary-foreground" />}
                </div>
              </div>
            </button>
          )
        ))}
      </div>
      <div className="flex gap-2 pt-2">
        <button
          onClick={onRun}
          disabled={selected.length === 0 || isRunning}
          className="flex-1 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Run Diagnostic
        </button>
        <button
          onClick={onClose}
          className="px-4 py-3 rounded-xl bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ── BACKFILL OWNER EMAIL PANEL (action item — runs its own function) ──────────

function BackfillOwnerEmailPanel({ onReset }) {
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const queryClient = useQueryClient();

  const run = async () => {
    setStatus('running');
    setResult(null);
    setErrorMsg(null);
    try {
      const res = await base44.functions.invoke('backfillMyCharacterOwnerEmail', {});
      const d = res?.data;
      if (!d) throw new Error('No response from backfill function');
      setResult(d);
      setStatus('done');
      queryClient.invalidateQueries({ queryKey: ['characters'] });
    } catch (err) {
      setErrorMsg(err.message || 'Backfill failed');
      setStatus('error');
    }
  };

  if (status === 'idle') {
    return (
      <div className="space-y-4">
        <div className="bg-secondary/50 border border-border rounded-lg p-3 space-y-1.5">
          <p className="text-sm font-medium text-foreground">Backfill Character Owner Email</p>
          <p className="text-xs text-muted-foreground">
            Scans your character records for any missing <code className="text-primary">owner_email</code> fields.
            Repairs only records where <code className="text-primary">owner_user_id</code> matches your account ID — no guessing, no cross-account access.
          </p>
          <p className="text-xs text-amber-400 font-medium mt-1">
            Evidence required: owner_user_id must match your account. Records without sufficient evidence are flagged for admin review — not modified.
          </p>
        </div>
        <button
          onClick={run}
          className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors text-sm"
        >
          Run Backfill
        </button>
        <button onClick={onReset} className="w-full px-4 py-2 rounded-xl bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors text-sm">
          Back
        </button>
      </div>
    );
  }

  if (status === 'running') {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-3">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
        <p className="text-sm text-muted-foreground">Scanning and repairing character records…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="space-y-3">
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <p className="text-sm text-destructive">{errorMsg}</p>
        </div>
        <button onClick={() => setStatus('idle')} className="w-full px-4 py-2 rounded-xl bg-secondary text-foreground text-sm font-medium">Try Again</button>
      </div>
    );
  }

  // Done — show results
  const r = result?.results || {};
  const needsAdmin = result?.admin_required;
  return (
    <div className="space-y-3">
      <div className={`p-3 rounded-xl border text-xs ${r.repaired?.length > 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-secondary border-border'}`}>
        <p className="font-semibold text-foreground">{result?.summary}</p>
      </div>

      <div className="space-y-1 text-xs">
        <p className="text-muted-foreground">Records scanned: <span className="text-foreground font-medium">{r.scanned ?? '—'}</span></p>
        <p className="text-muted-foreground">Already correct: <span className="text-foreground font-medium">{r.already_correct ?? 0}</span></p>
        <p className="text-muted-foreground">Repaired: <span className="text-emerald-400 font-medium">{r.repaired?.length ?? 0}</span></p>
        {r.repaired?.length > 0 && (
          <div className="pl-3 space-y-0.5">
            {r.repaired.map((rec, i) => (
              <p key={i} className="text-emerald-400">✓ {rec.name} <span className="font-mono text-foreground/50">({rec.id?.substring(0, 8)}…)</span></p>
            ))}
          </div>
        )}
        {r.skipped_wrong_account?.length > 0 && (
          <div className="mt-2">
            <p className="text-destructive font-medium">Blocked — cross-account or mismatched evidence ({r.skipped_wrong_account.length}):</p>
            {r.skipped_wrong_account.map((rec, i) => (
              <p key={i} className="text-muted-foreground pl-3">{rec.name}: {rec.reason}</p>
            ))}
          </div>
        )}
        {r.errors?.length > 0 && (
          <div className="mt-2">
            <p className="text-destructive font-medium">Write errors ({r.errors.length}):</p>
            {r.errors.map((rec, i) => (
              <p key={i} className="text-muted-foreground pl-3">{rec.name}: {rec.error}</p>
            ))}
          </div>
        )}
      </div>

      {needsAdmin && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-400">
          <p className="font-medium">Some records require manual admin repair</p>
          <p className="text-muted-foreground mt-0.5">Records without sufficient evidence (no owner_user_id or mismatched ID) cannot be repaired from your account. A support report has been created.</p>
        </div>
      )}

      <button onClick={onReset} className="w-full px-4 py-2 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors">
        Done
      </button>
    </div>
  );
}

// ── TAB PANEL ────────────────────────────────────────────────────────────────

function TabPanel({ title, icon: Icon, issues, functionName, onClose, user }) {
  const [selected, setSelected] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [activeAction, setActiveAction] = useState(null); // id of an action-type issue being executed
  const queryClient = useQueryClient();

  const toggle = (id) => {
    const issue = issues.find(i => i.id === id);
    // Action items: clicking launches them directly rather than adding to the diagnostic batch
    if (issue?.isAction) {
      setActiveAction(id);
      return;
    }
    setSelected(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id]);
  };

  const resetAction = () => setActiveAction(null);

  const run = async () => {
    // Filter out action items — they are handled separately
    const diagnosticIssues = selected.filter(id => !issues.find(i => i.id === id)?.isAction);
    if (diagnosticIssues.length === 0) return;
    setIsRunning(true);
    setError(null);
    setResults(null);
    try {
      const res = await base44.functions.invoke(functionName, { selectedIssues: diagnosticIssues });
      const d = res?.data?.data || res?.data;
      if (d) {
        setResults({
          summary: d.summary || 'Diagnostic complete.',
          fixes_applied: d.fixes_applied || d.fixed || [],
          issues_found: d.issues_found || [],
          checks: d.checks || [],
        });
        queryClient.invalidateQueries({ queryKey: ['characters'] });
        queryClient.invalidateQueries({ queryKey: ['locationReferences'] });
      } else {
        setError('Diagnostic returned no data');
      }
    } catch (err) {
      setError(err.message || 'Diagnostic failed');
    } finally {
      setIsRunning(false);
    }
  };

  // If an action item is active, render its dedicated panel
  if (activeAction === 'backfill_owner_email') {
    return <BackfillOwnerEmailPanel onReset={resetAction} />;
  }

  return (
    <div className="space-y-4">
      {isRunning && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Running diagnostic...</p>
        </div>
      )}

      {!isRunning && !results && (
        <IssueSelector
          issues={issues}
          selected={selected}
          onToggle={toggle}
          onRun={run}
          onClose={onClose}
          isRunning={isRunning}
        />
      )}

      {!isRunning && results && (
        <ResultDisplay results={results} onReset={() => { setResults(null); setSelected([]); }} />
      )}

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
}

// ── SYNC ALL CHARACTER LOCATIONS PANEL ───────────────────────────────────────

function SyncLocationsPanel({ user }) {
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [results, setResults] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const queryClient = useQueryClient();

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const runSync = async () => {
    if (!user?.email) {
      setErrorMsg('No authenticated user found.');
      return;
    }
    setStatus('running');
    setResults([]);
    setErrorMsg(null);

    // Step 1: Discovery — get all active_created_character IDs for this owner
    let characterIds = [];
    try {
      const discoveryRes = await base44.functions.invoke('enforceLocationPresenceForOwner', {
        owner_email: user.email
      });
      characterIds = discoveryRes?.data?.character_ids || [];
      if (characterIds.length === 0) {
        setStatus('done');
        setResults([{ name: '—', status: 'no_change', message: 'No active characters found for this account.' }]);
        return;
      }
    } catch (err) {
      setStatus('error');
      setErrorMsg(`Discovery failed: ${err.message}`);
      return;
    }

    // Step 2: Sequential loop — one call per character, 300ms apart
    const collected = [];
    for (const { character_id, name } of characterIds) {
      try {
        const res = await base44.functions.invoke('enforceCharacterLocationPresence', {
          character_id,
          owner_email: user.email
        });
        const d = res?.data;
        collected.push({
          name: name || character_id,
          character_id,
          status: d?.status || 'no_change',
          message: d?.message || null,
        });
      } catch (err) {
        collected.push({
          name: name || character_id,
          character_id,
          status: 'error',
          message: err.message,
        });
      }
      setResults([...collected]); // update progressively
      await sleep(300);
    }

    queryClient.invalidateQueries({ queryKey: ['characters'] });
    setStatus('done');
  };

  const reset = () => {
    setStatus('idle');
    setResults([]);
    setErrorMsg(null);
  };

  const statusColor = (s) => {
    if (s === 'updated') return 'text-emerald-400';
    if (s === 'no_change') return 'text-muted-foreground';
    if (s === 'error') return 'text-destructive';
    return 'text-muted-foreground';
  };

  const statusIcon = (s) => {
    if (s === 'updated') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />;
    if (s === 'error') return <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0" />;
    return <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/40 flex-shrink-0" />;
  };

  return (
    <div className="space-y-4">
      <div className="bg-secondary/50 border border-border rounded-lg p-3">
        <p className="text-xs text-muted-foreground">
          Discovers all your active characters, then calls the location enforcement function for each one sequentially.
          This syncs each character's <code className="text-primary">resolved_presence_status</code> to the current schedule truth.
        </p>
      </div>

      <button
        onClick={runSync}
        disabled={status === 'running'}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
      >
        {status === 'running' ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Syncing locations...</>
        ) : (
          <><RefreshCw className="w-4 h-4" /> Sync All Character Locations</>
        )}
      </button>

      {errorMsg && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <p className="text-sm text-destructive">{errorMsg}</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Results ({results.length} character{results.length !== 1 ? 's' : ''})
          </p>
          <div className="space-y-1.5">
            {results.map((r, i) => (
              <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-secondary/40 border border-border text-xs">
                {statusIcon(r.status)}
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-foreground">{r.name}</span>
                  <span className={`ml-2 ${statusColor(r.status)}`}>
                    {r.status === 'updated' ? 'updated' : r.status === 'error' ? 'error' : 'no change'}
                  </span>
                  {r.message && r.status === 'error' && (
                    <p className="text-destructive mt-0.5 truncate">{r.message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {status === 'done' && (
            <button
              onClick={reset}
              className="w-full px-4 py-2 rounded-xl bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors text-sm mt-2"
            >
              Clear Results
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── MAIN PANEL ───────────────────────────────────────────────────────────────

const TABS = [
  { id: 'location', label: 'Location', icon: MapPin, issues: LOCATION_ISSUES, fn: 'troubleshootLocations' },
  { id: 'moments', label: 'Moments', icon: Star, issues: MOMENTS_ISSUES, fn: 'troubleshootMoments' },
  { id: 'system', label: 'System & Data', icon: Database, issues: SYSTEM_ISSUES, fn: 'troubleshootSystemData' },
  { id: 'sync', label: 'Sync', icon: RefreshCw, issues: null, fn: null },
];

export default function SettingsTroubleshootingPanel({ isOpen, onClose, user }) {
  const [activeTab, setActiveTab] = useState('location');

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
            onClick={e => e.stopPropagation()}
            className="w-full max-w-2xl bg-card border border-border rounded-t-2xl max-h-[88vh] overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="sticky top-0 bg-card/90 backdrop-blur-sm border-b border-border p-4 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-primary" />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Settings Troubleshooting</h3>
                  <p className="text-xs text-muted-foreground">Location, Moments, and System diagnostics</p>
                </div>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border flex-shrink-0">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium transition-colors border-b-2 ${
                    activeTab === tab.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'sync' ? (
                <SyncLocationsPanel user={user} />
              ) : (
                TABS.filter(t => t.id !== 'sync').map(tab => (
                  activeTab === tab.id && (
                    <TabPanel
                      key={tab.id}
                      title={tab.label}
                      icon={tab.icon}
                      issues={tab.issues}
                      functionName={tab.fn}
                      onClose={onClose}
                      user={user}
                    />
                  )
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}