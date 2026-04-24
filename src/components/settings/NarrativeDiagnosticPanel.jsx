import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { Play, CheckCircle2, XCircle, AlertCircle, Clock, Loader2, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

function StatusBadge({ status }) {
  if (status === 'sent') return <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> SENT</span>;
  if (status === 'skipped') return <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> SKIPPED</span>;
  if (status === 'error') return <span className="text-xs font-semibold text-destructive flex items-center gap-1"><XCircle className="w-3 h-3" /> ERROR</span>;
  return null;
}

function CharacterRow({ char }) {
  const [open, setOpen] = useState(char.status !== 'skipped');
  return (
    <div className={`rounded-xl border text-xs transition-colors ${char.status === 'sent' ? 'border-emerald-500/30 bg-emerald-500/5' : char.status === 'error' ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-secondary/20'}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
          <span className="font-medium text-foreground truncate">{char.name}</span>
          <span className="text-muted-foreground/60 flex-shrink-0">{char.type}</span>
        </div>
        <StatusBadge status={char.status} />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/40 pt-2">
          <p className="text-muted-foreground"><span className="text-foreground/70">Reason:</span> {char.reason}</p>
          {char.stateSnapshot && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span><span className="text-foreground/60">Location:</span> {char.stateSnapshot.location || 'unknown'}</span>
              <span><span className="text-foreground/60">Sleep:</span> {char.stateSnapshot.isAsleep ? '😴 ASLEEP' : '👁 AWAKE'}</span>
              <span><span className="text-foreground/60">Activity:</span> {char.stateSnapshot.activity || 'none'}</span>
              <span><span className="text-foreground/60">Emotion:</span> {char.stateSnapshot.emotionalState}</span>
              <span><span className="text-foreground/60">Time ET:</span> {char.stateSnapshot.currentTimeET || '—'}</span>
              <span><span className="text-foreground/60">Messages:</span> {char.messageCount ?? '—'}</span>
            </div>
          )}
          {char.lastNarrativeTimestamp && (
            <p className="text-[11px] text-muted-foreground">Last narrative: {new Date(char.lastNarrativeTimestamp).toLocaleTimeString()}</p>
          )}
          {char.narrativeCreated && (
            <div className="mt-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-1">
              <p className="text-emerald-400 font-semibold text-[11px]">✓ Narrative saved</p>
              <p className="text-[11px] text-muted-foreground">Msg ID: {char.narrativeCreated.messageId}</p>
              <p className="text-[11px] text-muted-foreground">Convo: {char.narrativeCreated.conversationId}</p>
              <p className="text-[11px] text-foreground/80 italic">"{char.narrativeCreated.preview}"</p>
            </div>
          )}
          {char.checks && (
            <div className="space-y-0.5 text-[11px]">
              {Object.entries(char.checks).map(([key, val]) => (
                <div key={key} className={`flex items-center gap-1.5 ${val ? 'text-muted-foreground' : 'text-destructive'}`}>
                  {val ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <XCircle className="w-3 h-3" />}
                  {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NarrativeDiagnosticPanel() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  const runDiagnostic = async () => {
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const res = await base44.functions.invoke('runNarrativeDiagnostic', {});
      if (res?.data?.success) {
        setReport(res.data.report);
      } else {
        setError(res?.data?.error || 'Diagnostic returned no data');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Automatic Narrative Diagnostic</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Runs the full narrative pipeline for your characters — shows exactly what happens and why.</p>
        </div>
        <button
          onClick={runDiagnostic}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {running ? 'Running...' : 'Run Diagnostic'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <AnimatePresence>
        {report && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            {/* Summary bar */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Total', value: report.summary.total, color: 'text-foreground' },
                { label: 'Eligible', value: report.summary.eligible, color: 'text-primary' },
                { label: 'Sent', value: report.summary.sent, color: 'text-emerald-400' },
                { label: 'Skipped', value: report.summary.skipped, color: 'text-muted-foreground' },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-xl bg-secondary/40 border border-border px-3 py-2 text-center">
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>

            {report.summary.errors > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                <AlertCircle className="w-3.5 h-3.5" /> {report.summary.errors} character(s) had errors — expand below for details
              </div>
            )}

            <div className="text-[10px] text-muted-foreground px-1">
              Run ID: {report.runId} · {new Date(report.timestamp).toLocaleTimeString()} · Account: {report.user}
            </div>

            <div className="space-y-2">
              {/* Sent first */}
              {report.characters.filter(c => c.status === 'sent').map(char => (
                <CharacterRow key={char.characterId} char={char} />
              ))}
              {/* Errors next */}
              {report.characters.filter(c => c.status === 'error').map(char => (
                <CharacterRow key={char.characterId} char={char} />
              ))}
              {/* Skipped last, collapsed */}
              {report.characters.filter(c => c.status === 'skipped').map(char => (
                <CharacterRow key={char.characterId} char={char} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}