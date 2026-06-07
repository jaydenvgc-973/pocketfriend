import React from "react";
import { AlertTriangle, CheckCircle2, Clock, Activity, Eye, HelpCircle, Archive, Search, XCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";

const STATUS_CONFIG = {
  queued:            { label: "Queued",            icon: Clock,         color: "text-muted-foreground" },
  investigating:     { label: "Investigating",      icon: Search,        color: "text-amber-400" },
  awaiting_evidence: { label: "Awaiting Evidence",  icon: HelpCircle,    color: "text-blue-400" },
  monitoring:        { label: "Monitoring",         icon: Activity,      color: "text-primary" },
  findings_ready:    { label: "Findings Ready",     icon: Eye,           color: "text-emerald-400" },
  delivered:         { label: "Delivered",          icon: CheckCircle2,  color: "text-emerald-400" },
  archived:          { label: "Archived",           icon: Archive,       color: "text-muted-foreground" },
};

const RESOLUTION_LABEL = {
  resolved:               "Resolved",
  confirmed_defect:       "Confirmed Defect",
  confirmed_data_issue:   "Data Issue",
  confirmed_system_issue: "System Issue",
  user_action_required:   "Action Required",
  monitoring_required:    "Monitoring",
  unable_to_verify:       "Unable to Verify",
};

const PRIORITY_DOT = {
  critical: "bg-red-500",
  high:     "bg-amber-400",
  normal:   "bg-primary/60",
  low:      "bg-muted-foreground/40",
};

// Active queue: only show these statuses
const ACTIVE_STATUSES = new Set(["queued", "investigating", "awaiting_evidence", "monitoring", "findings_ready", "delivered"]);

export default function VickInvestigationQueue({ investigations, onMarkRead, onDismiss }) {
  if (!investigations || investigations.length === 0) return null;

  // Active: in-progress + critical delivered (not yet dismissed)
  const active = investigations.filter(inv =>
    ACTIVE_STATUSES.has(inv.status) &&
    !(inv.status === "delivered" && inv.priority !== "critical") &&
    !inv.dismissed
  );

  // Critical delivered but not dismissed — always show
  const criticalPending = investigations.filter(inv =>
    inv.status === "delivered" && inv.priority === "critical" && !inv.dismissed
  );

  // Combine without duplicates
  const activeSet = new Map();
  [...active, ...criticalPending].forEach(inv => activeSet.set(inv.id, inv));
  const display = [...activeSet.values()].slice(0, 8);

  if (display.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-0.5">
        Active Investigations
      </p>
      {display.map(inv => {
        const cfg = STATUS_CONFIG[inv.status] || STATUS_CONFIG.queued;
        const Icon = cfg.icon;
        const isUnread = inv.status === "findings_ready" && !inv.findings_read;
        const isCriticalDelivered = inv.priority === "critical" && inv.status === "delivered" && !inv.dismissed;
        const showDismiss = isCriticalDelivered && onDismiss;

        return (
          <div
            key={inv.id}
            onClick={() => isUnread && onMarkRead && onMarkRead(inv.id)}
            className={[
              "flex items-start gap-2 px-3 py-2 rounded-xl text-xs transition-colors",
              isUnread ? "bg-primary/10 border border-primary/20 cursor-pointer" : "bg-secondary/50",
              isCriticalDelivered ? "bg-red-500/10 border border-red-500/20" : "",
            ].join(" ")}
          >
            {/* Priority dot */}
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${PRIORITY_DOT[inv.priority] || PRIORITY_DOT.normal}`} />

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className={`font-medium truncate ${isUnread || isCriticalDelivered ? "text-foreground" : "text-muted-foreground"}`}>
                  {inv.title}
                </span>
                <span className={`flex items-center gap-1 flex-shrink-0 ${cfg.color}`}>
                  <Icon className="w-3 h-3" />
                  <span className="hidden sm:inline">{cfg.label}</span>
                </span>
              </div>

              {/* Resolution label for delivered items */}
              {inv.resolution && inv.status === "delivered" && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {RESOLUTION_LABEL[inv.resolution] || inv.resolution}
                </p>
              )}

              {isUnread && inv.findings && (
                <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[11px]">
                  {inv.findings.substring(0, 80)}
                </p>
              )}

              {inv.requires_user_input && inv.user_input_prompt && (
                <p className="text-amber-400 mt-0.5 text-[11px] line-clamp-1">
                  ⚠ {inv.user_input_prompt}
                </p>
              )}

              {/* Dismiss button for critical delivered items */}
              {showDismiss && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDismiss(inv.id); }}
                  className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-red-400 transition-colors"
                >
                  <XCircle className="w-3 h-3" />
                  Dismiss
                </button>
              )}
            </div>

            {isUnread && (
              <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-1.5" />
            )}
          </div>
        );
      })}
    </div>
  );
}