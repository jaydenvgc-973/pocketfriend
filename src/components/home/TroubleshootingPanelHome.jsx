import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, Loader2, AlertCircle, Zap, Globe, ChevronRight } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import TravelViolationLog from '@/components/travel/TravelViolationLog';
import WorldPhoneReanchorPanel from '@/components/worldphone/WorldPhoneReanchorPanel';

const ISSUE_LIST = [
  { id: 'mark_read', label: '✉️ Mark messages as read', description: 'Clear stale unread badges — marks all unread character messages as read using owner_email-scoped conversation lookup. Returns per-character proof.' },
  { id: 'notification_dots', label: '🔴 Notification dots stuck', description: 'Diagnose unread badge counts per character. Does not clear — use "Mark messages as read" to clear after diagnosing.' },
  { id: 'card_data', label: 'Character cards missing data', description: 'Detect characters missing name or core display fields.' },
  { id: 'emotional_state', label: 'Mood/emotional state missing', description: 'Restore missing emotional state display on character cards.' },
  { id: 'location_display', label: 'Location not showing', description: 'Check city/state display fields on character cards.' },
  { id: 'availability_display', label: 'Availability incorrect (diagnostic only)', description: 'Reports characters missing schedule data. Respects jail, travel, temporary housing, and all valid unavailable states — never overwrites protected states.' },
  { id: 'character_separation', label: 'Character data cross-contamination', description: 'Detect duplicate character records and direct conversations shared across multiple character IDs.' },
  { id: 'missing_characters', label: 'Find missing characters', description: 'Locate characters not showing on home page. Checks status, visibility flags, and required fields. Uses owner_email (not legacy created_by).' },
  { id: 'simulated_interaction', label: 'Simulated interaction tool issues', description: 'Diagnose and fix connection, state, or execution failures in the simulation system.' },
  { id: 'shift_verification', label: '🕒 Enforce work schedules', description: 'Force-updates presence for characters who are on shift but not at work. Respects callouts, jail, and other valid blockers.' },
  { id: 'stale_data_scan', label: '🔄 Global stale data diagnostic', description: 'Scan all major systems (cards, popups, profile, balance, world name, relationships, appearance lock) for UI values out of sync with backend.' },
  { id: 'fix_locations', label: '📍 Fix location display', description: 'Detect characters with stale or missing location data. Reports issues only — does not overwrite jail, travel, hotel, shelter, or temporary housing states.' },
  { id: 'restore_world_contacts', label: '🌐 Restore missing World Contacts', description: 'Find any contact records (any character type) with missing ownership that are referenced by this account\'s contact graph. Identifies them by name, then restores their owner_email. Does not change character types, promote NPCs, or create duplicates.' },
  { id: 'world_phone_anchors', label: '📵 World Phone manual re-anchor', description: 'Open the manual re-anchor workspace. Each unresolved World Phone conversation shows message samples and character name clues. You pick the two live characters, then the system repairs the Conversation and backfills all Message records.' },
  { id: 'vick_bilateral_contacts', label: '🔗 Repair Vick bilateral contacts', description: 'Ensures all characters in Vick\'s World Contacts also have Vick listed in their contacts. Fixes the one-way relationship — Vick sees them but they don\'t see Vick in their World Phone.' },
];

export default function TroubleshootingPanelHome({ isOpen, onClose, ownerEmail }) {
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [selectedIssues, setSelectedIssues] = useState([]);
  // World Contacts repair state — two-step: preview then confirm
  const [wcRepairPreview, setWcRepairPreview] = useState(null); // dry-run result
  const [wcRepairApplied, setWcRepairApplied] = useState(null); // live result
  const [wcRepairRunning, setWcRepairRunning] = useState(false);
  const [showReanchorPanel, setShowReanchorPanel] = useState(false);
  const queryClient = useQueryClient();

  const toggleIssue = (issueId) => {
    setSelectedIssues(prev => 
      prev.includes(issueId) 
        ? prev.filter(id => id !== issueId)
        : [...prev, issueId]
    );
  };

  const runFixAll = async () => {
    // Fix All runs a safe diagnostic pass first: mark_read + notification_dots + card_data + missing_characters.
    // It does NOT run autoFixSystemViolations blindly — that function uses outdated assumptions.
    // Only proven, ownership-scoped repairs are applied.
    setIsRunning(true);
    setError(null);
    setResults(null);
    try {
      const safeIssues = ['mark_read', 'notification_dots', 'card_data', 'missing_characters'];
      const res = await base44.functions.invoke('troubleshootHome', { selectedIssues: safeIssues });
      const data = res?.data?.data || res?.data;
      setResults({
        summary: data?.summary || 'Safe diagnostic + repair complete.',
        fixed: data?.fixes_applied || data?.fixed || [],
        issues_found: data?.issues_found || [],
        checks: data?.checks || [],
        proof: data?.proof || [],
      });
    } catch (err) {
      setError(err.message || 'Fix All failed');
    } finally {
      await queryClient.invalidateQueries({ queryKey: ['characters'] });
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setIsRunning(false);
    }
  };

  const runFixEverything = async () => {
    setIsRunning(true);
    setError(null);
    setResults(null);
    try {
      const res = await base44.functions.invoke('fixEverything', {});
      const data = res?.data;
      setResults({
        summary: data?.summary || 'Full system diagnostic complete.',
        fixed: data?.corrective_actions_taken || [],
        issues_found: data?.issues_found || [],
        checks: (data?.systems_checked || []).map(s => ({ name: s, status: 'info', message: 'System checked' })),
        proof: [],
      });
    } catch (err) {
      setError(err.message || 'Fix Everything failed');
    } finally {
      await queryClient.invalidateQueries();
      setIsRunning(false);
    }
  };

  const runTroubleshooting = async () => {
    setIsRunning(true);
    setError(null);
    setResults(null);

    try {
      // Route missing_characters separately — it has its own dedicated function
      if (selectedIssues.includes('missing_characters') && selectedIssues.length === 1) {
        const res = await base44.functions.invoke('findMissingCharacters', {});
        if (res?.data?.data) {
          setResults(res.data.data);
        } else {
          setError('Missing characters diagnostic failed');
        }
      } else if (selectedIssues.includes('simulated_interaction') && selectedIssues.length === 1) {
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
      } else if (selectedIssues.includes('shift_verification') && selectedIssues.length === 1) {
        const res = await base44.functions.invoke('enforceCharacterWorkSchedule', {});
        const data = res?.data;
        setResults({
          summary: data?.summary || 'Work shift verification complete.',
          fixed: data?.fixes_applied || data?.fixed || [],
          issues_found: data?.issues_found || data?.violations || [],
          checks: data?.checks || [],
        });
      } else if (selectedIssues.includes('stale_data_scan') && selectedIssues.length === 1) {
        const res = await base44.functions.invoke('dailyFullSystemDiagnostic', {});
        const data = res?.data;
        setResults({
          summary: data?.summary || 'Stale data scan complete.',
          fixed: data?.fixes_applied || data?.fixed || [],
          issues_found: data?.issues_found || [],
          checks: data?.checks || [],
        });
      } else if (selectedIssues.includes('fix_locations') && selectedIssues.length === 1) {
        const res = await base44.functions.invoke('troubleshootLocations', {
          selectedIssues: ['stale_location_refs', 'generic_location_labels', 'resolved_location_sync'],
        });
        const data = res?.data?.data || res?.data;
        setResults({
          summary: data?.summary || 'Location diagnostic complete.',
          fixed: data?.fixes_applied || [],
          issues_found: data?.issues_found || [],
          checks: data?.checks || [],
        });
      } else if (selectedIssues.includes('restore_world_contacts') && selectedIssues.length === 1) {
        // Two-step handled separately — don't route through troubleshootHome
        setIsRunning(false);
        return;
      } else if (selectedIssues.includes('world_phone_anchors') && selectedIssues.length === 1) {
        // Two-step handled separately — don't route through troubleshootHome
        setIsRunning(false);
        return;
      } else if (selectedIssues.includes('vick_bilateral_contacts') && selectedIssues.length === 1) {
        const res = await base44.functions.invoke('repairVickBilateralContacts', {});
        const data = res?.data;
        setResults({
          summary: data?.message || 'Vick bilateral contact repair complete.',
          fixed: (data?.repaired || []).map(r => `${r.name} — now has Vick in their contacts`),
          issues_found: (data?.skipped || []).map(r => `Skipped: ${r.name || r.id} — ${r.reason}`),
          checks: (data?.already_bilateral || []).map(r => ({ name: r.name, status: 'passed', message: 'Already bilateral ✓' })),
        });
      } else {
        // All other selections go through troubleshootHome with ONLY the selected issues
        const res = await base44.functions.invoke('troubleshootHome', { selectedIssues });
        const d = res?.data?.data || res?.data;
        if (d) {
          setResults({ ...d, proof: d.proof || [] });
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

  const troubleshootingPanel = createPortal(
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
                      Fix Selected Issues
                    </button>
                    <button
                      onClick={onClose}
                      className="px-4 py-3 rounded-xl bg-secondary text-foreground font-medium hover:bg-secondary/80 transition-colors"
                    >
                      Close
                    </button>
                  </div>
                  <button
                    onClick={runFixEverything}
                    disabled={isRunning}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-400 font-medium hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                  >
                    <Zap className="w-4 h-4" />
                    Fix Everything — Full System Deep Diagnostic
                  </button>


                  {/* ── WORLD PHONE MANUAL RE-ANCHOR — opens full workspace ── */}
                  {selectedIssues.includes('world_phone_anchors') && (
                    <div className="border border-border rounded-xl p-4 space-y-3 bg-secondary/30">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-primary" />
                        <p className="text-sm font-semibold text-foreground">World Phone Manual Re-Anchor Workspace</p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Open the re-anchor workspace to review each unresolved World Phone conversation's message clues and assign the correct live characters.
                      </p>
                      <button
                        onClick={() => setShowReanchorPanel(true)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <Globe className="w-4 h-4" />
                          Open Re-Anchor Workspace
                        </span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {/* ── WORLD CONTACTS REPAIR — two-step in-panel flow ── */}
                  {selectedIssues.includes('restore_world_contacts') && (
                    <div className="border border-border rounded-xl p-4 space-y-3 bg-secondary/30">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-primary" />
                        <p className="text-sm font-semibold text-foreground">World Contacts Ownership Repair</p>
                      </div>

                      {!wcRepairPreview && !wcRepairApplied && (
                        <button
                          onClick={async () => {
                            setWcRepairRunning(true);
                            try {
                              const res = await base44.functions.invoke('repairNullOwnerNPCFictitious', { dryRun: true });
                              setWcRepairPreview(res?.data || {});
                            } catch (e) {
                              setWcRepairPreview({ error: e.message });
                            } finally {
                              setWcRepairRunning(false);
                            }
                          }}
                          disabled={wcRepairRunning}
                          className="w-full px-3 py-2.5 rounded-lg bg-primary/10 text-primary text-sm font-medium hover:bg-primary/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {wcRepairRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                          Step 1 — Preview affected records (dry run)
                        </button>
                      )}

                      {wcRepairPreview && !wcRepairApplied && (
                        <div className="space-y-3">
                          {wcRepairPreview.error ? (
                            <p className="text-xs text-destructive">Error: {wcRepairPreview.error}</p>
                          ) : wcRepairPreview.repaired?.length === 0 ? (
                            <div className="text-xs text-muted-foreground bg-secondary/50 rounded-lg p-3">
                              No null-owner NPC records found that are referenced by this account. World Contacts ownership appears clean.
                            </div>
                          ) : (
                            <>
                              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 space-y-2">
                                <p className="text-xs font-semibold text-amber-400">
                                  {wcRepairPreview.repaired?.length} record{wcRepairPreview.repaired?.length !== 1 ? 's' : ''} found with missing ownership:
                                </p>
                                {wcRepairPreview.repaired?.map((r, i) => (
                                  <div key={i} className="text-xs text-foreground bg-secondary/50 rounded p-2">
                                    <p className="font-medium">{r.name}</p>
                                    <p className="text-muted-foreground">type: {r.character_type} · referenced by: {r.referenced_by}</p>
                                    <p className="text-muted-foreground">id: {r.id?.substring(0, 12)}…</p>
                                  </div>
                                ))}
                              </div>
                              <p className="text-xs text-muted-foreground">Pressing Apply will set owner_email on these records only. No character_type changes. No duplicates.</p>
                              <div className="flex gap-2">
                                <button
                                  onClick={async () => {
                                    setWcRepairRunning(true);
                                    try {
                                      const res = await base44.functions.invoke('repairNullOwnerNPCFictitious', { dryRun: false });
                                      setWcRepairApplied(res?.data || {});
                                      // Invalidate NPC cache so World Contacts refreshes
                                      queryClient.invalidateQueries({ queryKey: ['npc-characters'] });
                                      queryClient.invalidateQueries({ queryKey: ['characters'] });
                                    } catch (e) {
                                      setWcRepairApplied({ error: e.message });
                                    } finally {
                                      setWcRepairRunning(false);
                                    }
                                  }}
                                  disabled={wcRepairRunning}
                                  className="flex-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                  {wcRepairRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                                  Step 2 — Apply ownership repair
                                </button>
                                <button
                                  onClick={() => setWcRepairPreview(null)}
                                  className="px-3 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {wcRepairApplied && (
                        <div className="space-y-2">
                          {wcRepairApplied.error ? (
                            <p className="text-xs text-destructive">Error: {wcRepairApplied.error}</p>
                          ) : (
                            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 space-y-2">
                              <p className="text-xs font-semibold text-emerald-400">
                                ✓ {wcRepairApplied.repaired?.length || 0} record{wcRepairApplied.repaired?.length !== 1 ? 's' : ''} repaired.
                              </p>
                              {wcRepairApplied.repaired?.map((r, i) => (
                                <div key={i} className="text-xs text-foreground">
                                  <span className="font-medium">{r.name}</span>
                                  <span className="text-emerald-400 ml-2">owner_email restored ✓</span>
                                </div>
                              ))}
                              <p className="text-xs text-muted-foreground mt-1">Open World Contacts to verify these contacts are now visible and World Phone can send messages.</p>
                            </div>
                          )}
                          <button
                            onClick={() => { setWcRepairPreview(null); setWcRepairApplied(null); }}
                            className="w-full px-3 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
                          >
                            Reset
                          </button>
                        </div>
                      )}
                    </div>
                  )}
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
                      <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Repairs Applied</p>
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

                  {/* Detailed Checks */}
                  {(results.checks || []).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Diagnostic Details</p>
                      <div className="space-y-1">
                        {(results.checks || []).map((check, i) => {
                          const statusIcon = {
                            passed: <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />,
                            fixed: <CheckCircle2 className="w-4 h-4 text-cyan-400 flex-shrink-0" />,
                            warning: <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />,
                            info: <AlertCircle className="w-4 h-4 text-blue-400 flex-shrink-0" />,
                          }[check.status] || <AlertCircle className="w-4 h-4 text-muted-foreground flex-shrink-0" />;
                          return (
                            <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                              {statusIcon}
                              <div className="flex-1">
                                <p className="font-medium text-foreground">{check.name}</p>
                                <p className="text-muted-foreground/80">{check.message}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Per-character proof output for mark_read */}
                  {(results.proof || []).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Unread Badge Proof</p>
                      <div className="space-y-2">
                        {results.proof.map((row, i) => (
                          <div key={i} className="bg-secondary/60 rounded-lg p-2.5 text-xs space-y-1">
                            <p className="font-semibold text-foreground">{row.character_name}</p>
                            <p className="text-muted-foreground">Chat unread: <span className="text-red-400">{row.chat_unread_before}</span> → <span className="text-emerald-400">0</span></p>
                            <p className="text-muted-foreground">Text unread: <span className="text-red-400">{row.phone_unread_before}</span> → <span className="text-emerald-400">0</span></p>
                            {(row.conversations_with_unread || []).length > 0 && (
                              <p className="text-muted-foreground/60 text-[10px]">Convos: {row.conversations_with_unread.join(' · ')}</p>
                            )}
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

              {/* Travel Violation Log — always visible, not gated by issue selection */}
              {ownerEmail && (
                <div className="border-t border-border pt-4">
                  <TravelViolationLog ownerEmail={ownerEmail} maxItems={15} />
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );

  // Full-screen re-anchor workspace (separate portal, slides in over the troubleshooting panel) — rendered as separate portal above everything
  const reanchorPortal = showReanchorPanel ? createPortal(
    <motion.div
      initial={{ opacity: 0, x: '100%' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '100%' }}
      transition={{ type: 'tween', duration: 0.25 }}
      className="fixed inset-0 z-[60] bg-background flex flex-col"
    >
      <WorldPhoneReanchorPanel onClose={() => {
        setShowReanchorPanel(false);
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        queryClient.invalidateQueries({ queryKey: ['characters'] });
      }} />
    </motion.div>,
    document.body
  ) : null;

  return (
    <>
      {troubleshootingPanel}
      {reanchorPortal}
    </>
  );
}