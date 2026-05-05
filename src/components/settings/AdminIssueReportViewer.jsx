import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, ChevronDown, ChevronUp, CheckCircle2, Clock, AlertTriangle, XCircle, Filter } from "lucide-react";

const STATUS_CONFIG = {
  received:       { label: 'Received',       color: 'text-sky-400',     bg: 'bg-sky-500/10',     icon: Clock },
  in_review:      { label: 'In Review',      color: 'text-amber-400',   bg: 'bg-amber-500/10',   icon: AlertTriangle },
  repair_pending: { label: 'Repair Pending', color: 'text-orange-400',  bg: 'bg-orange-500/10',  icon: AlertTriangle },
  fixed:          { label: 'Fixed',          color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: CheckCircle2 },
  cannot_fix:     { label: 'Cannot Fix',     color: 'text-destructive', bg: 'bg-destructive/10', icon: XCircle },
  escalated:      { label: 'Escalated',      color: 'text-purple-400',  bg: 'bg-purple-500/10',  icon: AlertTriangle },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.received;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${cfg.bg} ${cfg.color}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

function IssueRow({ report, onStatusChange }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleStatus = async (newStatus) => {
    setSaving(true);
    await base44.entities.IssueReport.update(report.id, {
      status: newStatus,
      ...(newStatus === 'fixed' ? { resolved_at: new Date().toISOString() } : {})
    });
    onStatusChange();
    setSaving(false);
  };

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start gap-3 p-3 bg-card hover:bg-secondary/30 transition-colors text-left"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={report.status} />
            <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded capitalize">{(report.category || 'other').replace(/_/g, ' ')}</span>
          </div>
          <p className="text-sm font-medium text-foreground mt-1 truncate">{report.title}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{report.owner_email} · {new Date(report.created_date).toLocaleDateString()}</p>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="border-t border-border p-3 space-y-3 bg-secondary/20">
              {report.description && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Description</p>
                  <p className="text-xs text-foreground whitespace-pre-wrap">{report.description}</p>
                </div>
              )}

              {report.findings?.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Diagnostic Findings</p>
                  <div className="space-y-1">
                    {report.findings.filter(f => f.status !== 'passed').map((f, i) => (
                      <div key={i} className={`text-xs px-2 py-1 rounded flex items-start gap-1.5 ${f.status === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-400'}`}>
                        <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span><strong>{f.check}:</strong> {f.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status update controls (admin only) */}
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Update Status</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => handleStatus(key)}
                      disabled={saving || report.status === key}
                      className={`text-[10px] px-2 py-1 rounded border transition-colors disabled:opacity-40 ${
                        report.status === key
                          ? `${cfg.bg} ${cfg.color} border-transparent`
                          : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground'
                      }`}
                    >
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AdminIssueReportViewer() {
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');

  const { data: reports = [], refetch, isLoading } = useQuery({
    queryKey: ['issueReports', filterStatus, filterCategory],
    queryFn: async () => {
      const filter = {};
      if (filterStatus !== 'all') filter.status = filterStatus;
      if (filterCategory !== 'all') filter.category = filterCategory;
      return base44.entities.IssueReport.filter(filter, '-created_date', 100);
    },
  });

  const openCount = reports.filter(r => !['fixed', 'cannot_fix'].includes(r.status)).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">Issue Reports</p>
        {openCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold">{openCount} open</span>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Filter className="w-3 h-3" />
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="bg-secondary border border-border rounded-lg px-2 py-1 text-xs text-foreground"
          >
            <option value="all">All statuses</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="bg-secondary border border-border rounded-lg px-2 py-1 text-xs text-foreground"
        >
          <option value="all">All categories</option>
          {['character_duplicates','ghost_records','dangling_references','ownership_mismatch','chat_linkage','missing_memories','location_presence','schedule_travel','financial','images_voice','other'].map(c => (
            <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-xs text-muted-foreground text-center py-4">Loading reports…</p>}

      {!isLoading && reports.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">No issue reports found.</p>
      )}

      <div className="space-y-2">
        {reports.map(report => (
          <IssueRow key={report.id} report={report} onStatusChange={refetch} />
        ))}
      </div>
    </div>
  );
}