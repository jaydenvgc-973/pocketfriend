/**
 * TravelViolationLog
 *
 * Displays logged TravelViolation records for the current user.
 * Used in troubleshooting panels to surface "NO SILENT FAILURE" violations.
 * Read-only — does not repair. Use enforceArrivalIntegrity for repairs.
 */
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const FAILURE_COLORS = {
  ORPHANED_TRAVEL_STATUS:         "text-orange-400",
  TRAVEL_WITHOUT_RENDER_DATA:     "text-yellow-400",
  ETA_PASSED_NO_ARRIVAL:          "text-red-400",
  DESTINATION_WRITE_FAILURE:      "text-red-500",
  MAP_RENDER_FAILURE:             "text-orange-400",
  STATUS_BAR_RENDER_FAILURE:      "text-orange-400",
  TRAVEL_SESSION_MISSING:         "text-yellow-400",
  STALE_IN_TRANSIT_STATE:         "text-yellow-500",
  INVALID_DESTINATION_REFERENCE:  "text-red-400",
  LOCATION_READBACK_MISMATCH:     "text-red-500",
  CHARACTER_LEFT_OFFSCREEN:       "text-purple-400",
  TRAVEL_REVERTED_TO_ORIGIN:      "text-red-500",
  TRAVEL_CLEARED_WITHOUT_ARRIVAL: "text-orange-500",
  ARRIVAL_WRITE_FAILURE:          "text-red-600",
};

const REPAIR_BADGE = {
  success:       "bg-emerald-500/20 text-emerald-400",
  failed:        "bg-red-500/20 text-red-400",
  partial:       "bg-yellow-500/20 text-yellow-400",
  not_attempted: "bg-zinc-500/20 text-zinc-400",
};

function formatDt(dt) {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default function TravelViolationLog({ ownerEmail, maxItems = 20 }) {
  const { data: violations = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["travelViolations", ownerEmail],
    queryFn: async () => {
      if (!ownerEmail) return [];
      return base44.entities.TravelViolation.filter(
        { owner_email: ownerEmail },
        "-detected_at",
        maxItems
      ).catch(() => []);
    },
    enabled: !!ownerEmail,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground p-4 text-center">
        Loading violation log...
      </div>
    );
  }

  const unresolved = violations.filter(v => !v.violation_resolved);
  const resolved   = violations.filter(v => v.violation_resolved);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-medium text-foreground">Travel Violations</span>
          {unresolved.length > 0 && (
            <Badge className="bg-red-500/20 text-red-400 text-xs px-1.5 py-0">
              {unresolved.length} open
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {violations.length === 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-400">No travel violations logged. All arrivals verified.</p>
        </div>
      )}

      {unresolved.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Open Violations</p>
          {unresolved.map(v => (
            <ViolationCard key={v.id} violation={v} />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Resolved</p>
          {resolved.map(v => (
            <ViolationCard key={v.id} violation={v} dimmed />
          ))}
        </div>
      )}
    </div>
  );
}

function ViolationCard({ violation: v, dimmed = false }) {
  const colorClass = FAILURE_COLORS[v.failure_type] || "text-zinc-400";
  const repairClass = REPAIR_BADGE[v.repair_result] || REPAIR_BADGE.not_attempted;

  return (
    <div className={`rounded-lg border border-border p-3 space-y-1.5 ${dimmed ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={`text-xs font-mono font-semibold ${colorClass}`}>{v.failure_type}</p>
          <p className="text-xs text-foreground font-medium">{v.character_name || v.character_id}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge className={`text-xs px-1.5 py-0 ${repairClass}`}>
            {v.repair_result || "not_attempted"}
          </Badge>
          {v.violation_resolved && (
            <span className="text-xs text-emerald-400">✓ resolved</span>
          )}
        </div>
      </div>

      {v.destination_location_name && (
        <p className="text-xs text-muted-foreground">
          → <span className="text-foreground">{v.destination_location_name}</span>
        </p>
      )}

      {v.blocker_reason && (
        <p className="text-xs text-muted-foreground break-all">{v.blocker_reason}</p>
      )}

      {v.repair_detail && (
        <p className="text-xs text-muted-foreground/70 italic break-all">{v.repair_detail}</p>
      )}

      <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
        <Clock className="w-3 h-3" />
        {formatDt(v.detected_at)}
        {v.session_id && (
          <span className="ml-2 font-mono opacity-50">s:{v.session_id.slice(0, 8)}</span>
        )}
      </div>
    </div>
  );
}