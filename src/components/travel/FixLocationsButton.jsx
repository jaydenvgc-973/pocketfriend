import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, X } from "lucide-react";

/**
 * Travel FixLocationsButton — Uses shared location/travel diagnostic service
 * Same as Home, ensuring consistency across app
 */
export default function FixLocationsButton({ currentUserEmail }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(null);
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  const [expandStuck, setExpandStuck] = useState(false);

  const handleDryRun = async () => {
    setStatus("loading");
    setPreview(null);
    setMessage("");
    try {
      const res = await base44.functions.invoke("sharedLocationTravelDiagnosticAndRepair", {
        mode: "diagnose",
        owner_email: currentUserEmail,
      });
      const data = res?.data;
      if (!data) throw new Error("No response from server");
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
      const res = await base44.functions.invoke("sharedLocationTravelDiagnosticAndRepair", {
        mode: "repair_verified",
        owner_email: currentUserEmail,
      });
      const data = res?.data;
      if (!data) throw new Error("No response from server");
      setMessage(
        `${data.summary.verified_and_repaired} locations repaired, ${data.summary.skipped} skipped.`
      );
      setPreview(null);
      setStatus("done");
      queryClient.invalidateQueries({ queryKey: ["characters", currentUserEmail] });
      queryClient.invalidateQueries({ queryKey: ["travelSessions", currentUserEmail] });
      setTimeout(() => setStatus(null), 6000);
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
    setExpandStuck(false);
  };

  const isLoading = status === "loading";
  const isWriting = status === "writing";
  const isBusy = isLoading || isWriting;

  return (
    <div className="relative">
      <button
        onClick={status === "preview" ? handleDismiss : handleDryRun}
        disabled={isBusy}
        title="Scan and fix character location displays and stuck travel"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50 text-xs font-medium"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? "animate-spin" : ""}`} />
        {isLoading ? "Scanning..." : isWriting ? "Repairing..." : "Fix Travel"}
      </button>

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

      {status === "preview" && preview && (
        <div className="absolute top-full right-0 mt-2 z-50 w-80 bg-card border border-border rounded-2xl shadow-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Travel & Location Repair</p>
            <button onClick={handleDismiss} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="bg-secondary rounded-xl py-2">
              <p className="text-base font-bold text-green-400">{preview.summary?.verified_and_repaired ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">To repair</p>
            </div>
            <div className="bg-secondary rounded-xl py-2">
              <p className="text-base font-bold text-foreground">{preview.summary?.no_action_needed ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">OK</p>
            </div>
            <div className="bg-secondary rounded-xl py-2">
              <p className="text-base font-bold text-amber-400">{preview.summary?.skipped ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">Protected</p>
            </div>
            <div className="bg-secondary rounded-xl py-2">
              <p className={`text-base font-bold ${(preview.summary?.stuck_travel_sessions ?? 0) > 0 ? 'text-orange-400' : 'text-foreground'}`}>
                {preview.summary?.stuck_travel_sessions ?? 0}
              </p>
              <p className="text-[10px] text-muted-foreground">Stuck</p>
            </div>
          </div>

          {preview.proof && preview.proof.filter(p => p.action_taken && p.action_taken !== 'no_action_needed').length > 0 && (
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase">Will be repaired:</p>
              {preview.proof.filter(p => p.action_taken && p.action_taken !== 'no_action_needed').map((r, i) => (
                <div key={i} className="text-[10px] bg-secondary/50 rounded-lg px-2 py-1.5">
                  <p className="font-medium text-foreground">{r.character_name}</p>
                </div>
              ))}
            </div>
          )}

          {preview.stuck_travel && preview.stuck_travel.length > 0 && (
            <div>
              <button
                onClick={() => setExpandStuck(p => !p)}
                className="flex items-center gap-1 text-[10px] text-orange-400 font-medium"
              >
                {expandStuck ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                {preview.stuck_travel.length} stuck travel{preview.stuck_travel.length !== 1 ? 's' : ''}
              </button>
              {expandStuck && (
                <div className="mt-1.5 space-y-1 max-h-24 overflow-y-auto">
                  {preview.stuck_travel.map((ts, i) => (
                    <div key={i} className="text-[10px] bg-orange-500/10 border border-orange-500/20 rounded-lg px-2 py-1.5">
                      <p className="font-medium text-orange-400">{ts.character_name}</p>
                      <p className="text-muted-foreground text-[9px]">{ts.blocker_reason || ts.route_status}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleDismiss}
              className="flex-1 py-2 rounded-xl bg-secondary text-muted-foreground text-xs font-medium hover:bg-secondary/80"
            >
              Cancel
            </button>
            {(preview.summary?.verified_and_repaired ?? 0) > 0 && (
              <button
                onClick={handleConfirm}
                className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
              >
                Confirm
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}