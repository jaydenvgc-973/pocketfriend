import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, X } from "lucide-react";

/**
 * FixLocationsButton — Dry-run preview + confirm flow
 *
 * Step 1: Call fixCharacterLocationDisplay without confirm → receive preview
 * Step 2: Show user what will change, what is flagged, what is skipped
 * Step 3: User taps Confirm → call again with confirm:true → writes execute
 * Step 4: Invalidate queries and show summary
 */
export default function FixLocationsButton({ currentUserEmail }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(null); // null | "loading" | "preview" | "writing" | "done" | "error"
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  const [showFlagged, setShowFlagged] = useState(false);

  const handleDryRun = async () => {
    setStatus("loading");
    setPreview(null);
    setMessage("");
    setShowFlagged(false);
    try {
      const res = await base44.functions.invoke("fixCharacterLocationDisplay", {});
      const data = res?.data;
      if (!data) throw new Error("No response from server");
      if (data.error) throw new Error(data.error);
      setPreview(data);
      setStatus("preview");
    } catch (err) {
      setMessage(err.message || "Scan failed — try again");
      setStatus("error");
      setTimeout(() => setStatus(null), 5000);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setStatus("writing");
    try {
      const res = await base44.functions.invoke("fixCharacterLocationDisplay", { confirm: true });
      const data = res?.data;
      if (!data) throw new Error("No response from server");
      if (data.error) throw new Error(data.error);
      setMessage(data.summary || "Locations repaired.");
      setPreview(null);
      setStatus("done");
      queryClient.invalidateQueries({ queryKey: ["characters", currentUserEmail] });
      queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUserEmail] });
      setTimeout(() => setStatus(null), 5000);
    } catch (err) {
      setMessage(err.message || "Repair failed — try again");
      setStatus("error");
      setTimeout(() => setStatus(null), 5000);
    }
  };

  const handleDismiss = () => {
    setStatus(null);
    setPreview(null);
    setMessage("");
    setShowFlagged(false);
  };

  const isLoading  = status === "loading";
  const isWriting  = status === "writing";
  const isBusy     = isLoading || isWriting;

  return (
    <div className="relative">
      {/* Main button */}
      <button
        onClick={status === "preview" ? handleDismiss : handleDryRun}
        disabled={isBusy}
        title="Scan and fix character location displays"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50 text-xs font-medium"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? "animate-spin" : ""}`} />
        {isLoading ? "Scanning..." : isWriting ? "Repairing..." : "Fix Locations"}
      </button>

      {/* Status feedback (done / error) */}
      {status === "done" && (
        <span className="flex items-start gap-1 text-xs text-green-400 max-w-[200px] leading-tight mt-1">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {message}
        </span>
      )}
      {status === "error" && (
        <span className="flex items-center gap-1 text-xs text-destructive mt-1">
          <AlertCircle className="w-3.5 h-3.5" /> {message}
        </span>
      )}

      {/* Dry-run preview panel */}
      {status === "preview" && preview && (
        <div className="absolute top-full right-0 mt-2 z-50 w-80 bg-card border border-border rounded-2xl shadow-2xl p-4 space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Location Scan Results</p>
            <button onClick={handleDismiss} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Summary counts */}
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="bg-secondary rounded-xl py-2">
              <p className="text-base font-bold text-primary">{preview.to_write_count ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">To repair</p>
            </div>
            <div className="bg-secondary rounded-xl py-2">
              <p className="text-base font-bold text-foreground">{preview.no_change_count ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">No change</p>
            </div>
            <div className="bg-secondary rounded-xl py-2">
              <p className={`text-base font-bold ${(preview.valid_skipped_count ?? 0) > 0 ? 'text-green-400' : 'text-foreground'}`}>
                {preview.valid_skipped_count ?? 0}
              </p>
              <p className="text-[10px] text-muted-foreground">Valid (kept)</p>
            </div>
            <div className="bg-secondary rounded-xl py-2">
              <p className={`text-base font-bold ${(preview.flagged_count ?? 0) > 0 ? 'text-amber-400' : 'text-foreground'}`}>
                {preview.flagged_count ?? 0}
              </p>
              <p className="text-[10px] text-muted-foreground">Flagged</p>
            </div>
          </div>

          {/* Valid states preserved */}
          {(preview.valid_skipped_count ?? 0) > 0 && (
            <div className="space-y-1 max-h-28 overflow-y-auto">
              <p className="text-[10px] font-semibold text-green-400 uppercase tracking-wider">Valid states preserved (not corrected):</p>
              {preview.valid_skipped_items?.map((r, i) => (
                <div key={i} className="text-[10px] bg-green-500/10 border border-green-500/20 rounded-lg px-2 py-1.5">
                  <p className="font-medium text-green-400">{r.character_name}</p>
                  <p className="text-muted-foreground">{r.detail}</p>
                </div>
              ))}
            </div>
          )}

          {/* Corrections preview */}
          {preview.corrections_preview?.length > 0 && (
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Will be repaired:</p>
              {preview.corrections_preview.map((r, i) => (
                <div key={i} className="text-[10px] bg-secondary/50 rounded-lg px-2 py-1.5 space-y-0.5">
                  <p className="font-medium text-foreground">{r.character_name} <span className="text-muted-foreground font-normal">({r.action})</span></p>
                  {r.before && r.after && (
                    <p className="text-muted-foreground">
                      {Object.entries(r.before).map(([k, v]) => (
                        <span key={k}>{k}: <span className="text-amber-400">{String(v ?? '—')}</span> → <span className="text-green-400">{String(r.after[k] ?? '—')}</span> </span>
                      ))}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Flagged issues */}
          {preview.flagged_count > 0 && (
            <div>
              <button
                onClick={() => setShowFlagged(p => !p)}
                className="flex items-center gap-1 text-[10px] text-amber-400 font-medium"
              >
                {showFlagged ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {preview.flagged_count} flagged issue{preview.flagged_count !== 1 ? 's' : ''} (reported only — not repaired)
              </button>
              {showFlagged && (
                <div className="mt-1.5 space-y-1 max-h-24 overflow-y-auto">
                  {preview.flagged_items?.map((r, i) => (
                    <div key={i} className="text-[10px] bg-amber-500/10 border border-amber-500/20 rounded-lg px-2 py-1.5">
                      <p className="font-medium text-amber-400">{r.character_name}</p>
                      <p className="text-muted-foreground">{r.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Internal family info */}
          {preview.internal_family_count > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {preview.internal_family_count} internal family file{preview.internal_family_count !== 1 ? 's' : ''} detected — not modified.
            </p>
          )}

          {/* No contradictions found */}
          {preview.to_write_count === 0 && preview.flagged_count === 0 && (
            <p className="text-xs text-green-400 text-center py-1">All location displays are consistent. No contradictions found.</p>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleDismiss}
              className="flex-1 py-2 rounded-xl bg-secondary text-muted-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
            >
              Cancel
            </button>
            {preview.to_write_count > 0 && (
              <button
                onClick={handleConfirm}
                className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                Confirm Repair
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}