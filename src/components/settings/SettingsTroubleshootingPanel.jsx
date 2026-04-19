import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Wrench, CheckCircle2, AlertCircle, Loader2, MapPin, Star, Database, Zap } from 'lucide-react';
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

// ── TAB PANEL ────────────────────────────────────────────────────────────────

function TabPanel({ title, icon: Icon, issues, functionName, onClose, user }) {
  const [selected, setSelected] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const queryClient = useQueryClient();

  const toggle = (id) => setSelected(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id]);

  const run = async () => {
    setIsRunning(true);
    setError(null);
    setResults(null);
    try {
      const res = await base44.functions.invoke(functionName, { selectedIssues: selected });
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

// ── MAIN PANEL ───────────────────────────────────────────────────────────────

const TABS = [
  { id: 'location', label: 'Location', icon: MapPin, issues: LOCATION_ISSUES, fn: 'troubleshootLocations' },
  { id: 'moments', label: 'Moments', icon: Star, issues: MOMENTS_ISSUES, fn: 'troubleshootMoments' },
  { id: 'system', label: 'System & Data', icon: Database, issues: SYSTEM_ISSUES, fn: 'troubleshootSystemData' },
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
              {TABS.map(tab => (
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
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}