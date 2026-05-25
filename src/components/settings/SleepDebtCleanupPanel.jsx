import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";

export default function SleepDebtCleanupPanel() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async () => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await base44.functions.invoke("cleanupSleepDebtLive", {});
      setResult(res.data);
    } catch (e) {
      setError(e.message || "Unknown error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Sleep Debt Live Cleanup</p>
          <p className="text-xs text-muted-foreground">Clears sleep_debt_hours, sleep_interrupted_at, and debt-driven presence states from all characters</p>
        </div>
        <Button onClick={run} disabled={running} size="sm" variant="destructive">
          {running ? "Running..." : "Run Cleanup"}
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive font-mono whitespace-pre-wrap">
          ERROR: {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-1 text-xs font-mono">
            <p className="font-semibold text-foreground mb-2">SUMMARY</p>
            <p><span className="text-muted-foreground">owner_email:</span> <span className="text-emerald-400">{result.owner_email}</span></p>
            <p><span className="text-muted-foreground">total_audited:</span> <span className={result.summary?.total_characters_audited === 0 ? "text-destructive" : "text-foreground"}>{result.summary?.total_characters_audited}</span></p>
            <p><span className="text-muted-foreground">needing_repair:</span> <span className="text-amber-400">{result.summary?.total_needing_repair}</span></p>
            <p><span className="text-muted-foreground">repaired:</span> <span className="text-emerald-400">{result.summary?.total_repaired}</span></p>
            <p><span className="text-muted-foreground">failed:</span> <span className={result.summary?.total_failed > 0 ? "text-destructive" : "text-foreground"}>{result.summary?.total_failed}</span></p>
            <p><span className="text-muted-foreground">clean_no_action:</span> <span className="text-foreground">{result.summary?.total_clean}</span></p>
            <p className="mt-1 font-semibold text-muted-foreground">By type:</p>
            {result.summary?.by_character_type && Object.entries(result.summary.by_character_type).map(([type, count]) => (
              <p key={type}><span className="text-muted-foreground">  {type}:</span> <span className="text-foreground">{count}</span></p>
            ))}
          </div>

          {/* Repair results — only show characters that were actually repaired */}
          {result.repair_results?.length > 0 && (
            <div className="rounded-xl border border-border bg-secondary/20 p-3 space-y-2 text-xs font-mono max-h-96 overflow-y-auto">
              <p className="font-semibold text-foreground mb-2">REPAIR LOG ({result.repair_results.length} changed)</p>
              {result.repair_results.map((r, i) => (
                <div key={i} className={`border-b border-border pb-2 mb-2 ${r.status === 'failed' ? 'border-destructive/40' : ''}`}>
                  <p className={`font-semibold ${r.status === 'failed' ? 'text-destructive' : 'text-emerald-400'}`}>
                    [{r.status?.toUpperCase()}] {r.name} ({r.character_type})
                  </p>
                  {r.status === 'failed' && <p className="text-destructive">Error: {r.error}</p>}
                  {r.before && (
                    <div className="mt-1 space-y-0.5">
                      <p className="text-amber-400">BEFORE:</p>
                      <p className="pl-2 text-muted-foreground">sleep_debt_hours: {r.before.sleep_debt_hours ?? "null"}</p>
                      <p className="pl-2 text-muted-foreground">sleep_interrupted_at: {r.before.sleep_interrupted_at ?? "null"}</p>
                      <p className="pl-2 text-muted-foreground">resolved_presence_status: {r.before.resolved_presence_status ?? "null"}</p>
                      <p className="pl-2 text-muted-foreground">resolved_source_reason: {r.before.resolved_source_reason ?? "null"}</p>
                    </div>
                  )}
                  {r.after && (
                    <div className="mt-1 space-y-0.5">
                      <p className="text-emerald-400">AFTER:</p>
                      <p className="pl-2 text-foreground">sleep_debt_hours: {r.after.sleep_debt_hours ?? "null"}</p>
                      <p className="pl-2 text-foreground">sleep_interrupted_at: {r.after.sleep_interrupted_at ?? "null"}</p>
                      <p className="pl-2 text-foreground">resolved_presence_status: {r.after.resolved_presence_status ?? "null"}</p>
                      <p className="pl-2 text-foreground">resolved_source_reason: {r.after.resolved_source_reason ?? "null"}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Full audit — all characters with their sleep debt state */}
          {result.full_audit?.length > 0 && (
            <div className="rounded-xl border border-border bg-secondary/20 p-3 text-xs font-mono max-h-96 overflow-y-auto">
              <p className="font-semibold text-foreground mb-2">FULL AUDIT — ALL {result.full_audit.length} CHARACTERS</p>
              {result.full_audit.map((a, i) => (
                <div key={i} className={`py-1 border-b border-border/50 ${a.needs_repair ? 'text-amber-400' : 'text-muted-foreground'}`}>
                  <span className="font-medium text-foreground">{a.name}</span>
                  <span className="ml-2 text-muted-foreground">({a.character_type})</span>
                  {a.needs_repair && <span className="ml-2 text-amber-400 font-bold">⚠ NEEDS REPAIR</span>}
                  <span className="ml-2">debt={a.sleep_debt_hours}</span>
                  <span className="ml-2">interrupted={a.sleep_interrupted_at ? "YES" : "null"}</span>
                  <span className="ml-2">status={a.resolved_presence_status ?? "null"}</span>
                  <span className="ml-2">reason={a.resolved_source_reason ?? "null"}</span>
                </div>
              ))}
            </div>
          )}

          {result.summary?.total_characters_audited === 0 && (
            <p className="text-xs text-destructive font-mono">ZERO characters audited — session may not be authenticated properly.</p>
          )}
        </div>
      )}
    </div>
  );
}