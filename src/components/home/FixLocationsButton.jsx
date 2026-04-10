import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";

export default function FixLocationsButton({ currentUserEmail }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(null); // null | "running" | "done" | "error"
  const [message, setMessage] = useState("");

  const handleFix = async () => {
    setStatus("running");
    setMessage("");
    try {
      const res = await base44.functions.invoke("batchFixCharacterLocations", {});
      const fixed = res?.data?.fixed || 0;
      setMessage(fixed > 0 ? `${fixed} character${fixed > 1 ? "s" : ""} corrected` : "All locations look good");
      setStatus("done");

      // Refresh characters + locations everywhere
      queryClient.invalidateQueries({ queryKey: ["characters", currentUserEmail] });
      queryClient.invalidateQueries({ queryKey: ["locationReferences", currentUserEmail] });

      setTimeout(() => setStatus(null), 4000);
    } catch {
      setMessage("Fix failed — try again");
      setStatus("error");
      setTimeout(() => setStatus(null), 4000);
    }
  };

  const isRunning = status === "running";

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleFix}
        disabled={isRunning}
        title="Sync character locations"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50 text-xs font-medium"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? "animate-spin" : ""}`} />
        {isRunning ? "Fixing..." : "Fix Locations"}
      </button>
      {status === "done" && (
        <span className="flex items-center gap-1 text-xs text-green-400">
          <CheckCircle2 className="w-3.5 h-3.5" /> {message}
        </span>
      )}
      {status === "error" && (
        <span className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="w-3.5 h-3.5" /> {message}
        </span>
      )}
    </div>
  );
}