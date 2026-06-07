import React from "react";
import { AlertTriangle, CheckCircle2, Clock, Activity, Eye, HelpCircle, Archive, Search } from "lucide-react";

const STATUS_CONFIG = {
  queued:            { label: "Queued",           icon: Clock,         color: "text-muted-foreground" },
  investigating:     { label: "Investigating",     icon: Search,        color: "text-amber-400" },
  awaiting_evidence: { label: "Awaiting Evidence", icon: HelpCircle,    color: "text-blue-400" },
  monitoring:        { label: "Monitoring",        icon: Activity,      color: "text-primary" },
  findings_ready:    { label: "Findings Ready",    icon: Eye,           color: "text-emerald-400" },
  completed:         { label: "Completed",         icon: CheckCircle2,  color: "text-muted-foreground" },
  closed:            { label: "Closed",            icon: Archive,       color: "text-muted-foreground" },
};

const PRIORITY_DOT = {
  critical: "bg-red-500",
  high:     "bg-amber-400",
  normal:   "bg-primary/60",
  low:      "bg-muted-foreground/40",
};

export default function VickInvestigationQueue({ investigations, onMarkRead }) {
  if (!investigations || investigations.length === 0) return null;

  // Show active/ready first, then completed
  const active = investigations.filter(i => !["completed", "closed"].includes(i.status));
  const done   = investigations.filter(i => ["completed", "closed"].includes(i.status)).slice(0, 3);
  const display = [...active, ...done].slice(0, 6);

  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-0.5">
        Investigation Queue
      </p>
      {display.map(inv => {
        const cfg = STATUS_CONFIG[inv.status] || STATUS_CONFIG.queued;
        const Icon = cfg.icon;
        const isUnread = inv.status === "findings_ready" && !inv.findings_read;
        const isCritical = inv.priority === "critical";

        return (
          <div
            key={inv.id}
            onClick={() => isUnread && onMarkRead && onMarkRead(inv.id)}
            className={`flex items-start gap-2 px-3 py-2 rounded-xl text-xs transition-colors
              ${isUnread ? "bg-primary/10 border border-primary/20 cursor-pointer" : "bg-secondary/50"}
              ${isCritical && isUnread ? "bg-red-500/10 border-red-500/20" : ""}
            `}
          >
            {/* Priority dot */}
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${PRIORITY_DOT[inv.priority] || PRIORITY_DOT.normal}`} />

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <span className={`font-medium truncate ${isUnread ? "text-foreground" : "text-muted-foreground"}`}>
                  {inv.title}
                </span>
                <span className={`flex items-center gap-1 flex-shrink-0 ${cfg.color}`}>
                  <Icon className="w-3 h-3" />
                  <span className="hidden sm:inline">{cfg.label}</span>
                </span>
              </div>
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