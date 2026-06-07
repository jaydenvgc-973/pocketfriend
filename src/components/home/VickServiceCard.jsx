import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { motion } from "framer-motion";
import { Shield, AlertTriangle, CheckCircle2, Activity, MessageSquare, ChevronDown, ChevronUp } from "lucide-react";
import VickInvestigationQueue from "./VickInvestigationQueue";

/**
 * VickServiceCard — Dedicated Home page card for Vick Servicio (npc_world_service).
 *
 * Shows:
 *  - Service status (never asleep)
 *  - Unread message count
 *  - Active / completed investigation queue
 *  - Critical alerts with distinct styling
 *
 * NON-EXPANSION GUARDRAIL: This card is ONLY for Vick Servicio.
 * Do NOT generalize for other NPCs.
 */
export default function VickServiceCard({ ownerEmail }) {
  const navigate = useNavigate();
  const [vick, setVick] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestMessage, setLatestMessage] = useState(null);
  const [messageStatus, setMessageStatus] = useState("available");
  const [investigations, setInvestigations] = useState([]);
  const [showQueue, setShowQueue] = useState(false);

  // Load Vick's character record
  useEffect(() => {
    if (!ownerEmail) return;
    base44.entities.Character.filter({
      owner_email: ownerEmail,
      character_type: "npc_world_service",
      is_world_service: true,
    }).then(results => {
      const vickRecord = results.find(c =>
        c.name?.toLowerCase().includes("vick") ||
        c.display_name?.toLowerCase().includes("vick")
      );
      if (vickRecord) setVick(vickRecord);
    }).catch(() => {});
  }, [ownerEmail]);

  // Load investigations for this account
  const loadInvestigations = useCallback(() => {
    if (!ownerEmail) return;
    base44.entities.VickInvestigation.filter(
      { owner_email: ownerEmail },
      "-created_date",
      20
    ).then(invs => {
      setInvestigations(invs);
      // Auto-expand queue if there are unread findings or active investigations
      const hasUnreadFindings = invs.some(i => i.status === "findings_ready" && !i.findings_read);
      if (hasUnreadFindings) setShowQueue(true);
    }).catch(() => {});
  }, [ownerEmail]);

  useEffect(() => {
    loadInvestigations();
  }, [loadInvestigations]);

  // Real-time subscription for investigation changes
  useEffect(() => {
    if (!ownerEmail) return;
    const unsubscribe = base44.entities.VickInvestigation.subscribe((event) => {
      if (event.data?.owner_email !== ownerEmail) return;
      loadInvestigations();
    });
    return () => unsubscribe();
  }, [ownerEmail, loadInvestigations]);

  // Load conversation + unread messages
  useEffect(() => {
    if (!vick?.id || !ownerEmail) return;

    base44.entities.Conversation.filter({ owner_email: ownerEmail }).then(convos => {
      const vickConvo = convos.find(c =>
        (c.character_ids || []).includes(vick.id) &&
        (c.type === "direct" || c.type === "npc")
      );
      if (!vickConvo) return;
      setConversationId(vickConvo.id);

      base44.entities.Message.filter({
        conversation_id: vickConvo.id,
        sender_type: "character",
        is_read: false,
      }, "-timestamp", 20).then(msgs => {
        const vickMsgs = msgs.filter(m => m.character_id === vick.id);
        setUnreadCount(vickMsgs.length);
        if (vickMsgs.length > 0) {
          setLatestMessage(vickMsgs[0]);
          const content = vickMsgs[0].content?.toLowerCase() || "";
          if (content.includes("critical") || content.includes("corruption") || content.includes("data loss")) {
            setMessageStatus("critical_alert");
          } else if (content.includes("complete") || content.includes("findings") || content.includes("results")) {
            setMessageStatus("findings_ready");
          } else {
            setMessageStatus("message_waiting");
          }
        }
      }).catch(() => {});
    }).catch(() => {});
  }, [vick?.id, ownerEmail]); // eslint-disable-line

  // Real-time subscription for new Vick messages
  useEffect(() => {
    if (!conversationId || !vick?.id) return;
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.data?.conversation_id !== conversationId) return;
      if (event.data?.sender_type === "character" && event.data?.character_id === vick.id && !event.data?.is_read) {
        setUnreadCount(prev => prev + 1);
        setLatestMessage(event.data);
        const content = event.data.content?.toLowerCase() || "";
        if (content.includes("critical") || content.includes("corruption")) setMessageStatus("critical_alert");
        else if (content.includes("complete") || content.includes("findings")) setMessageStatus("findings_ready");
        else setMessageStatus("message_waiting");
      }
    });
    return () => unsubscribe();
  }, [conversationId, vick?.id]);

  const handleMarkInvestigationRead = async (investigationId) => {
    await base44.entities.VickInvestigation.update(investigationId, { findings_read: true }).catch(() => {});
    loadInvestigations();
  };

  const handleDismissInvestigation = async (investigationId) => {
    await base44.entities.VickInvestigation.update(investigationId, {
      dismissed: true,
      dismissed_at: new Date().toISOString(),
      status: "archived",
      archived_at: new Date().toISOString(),
    }).catch(() => {});
    loadInvestigations();
  };

  const handleOpen = () => {
    if (!vick?.id) return;
    navigate(`/chat/${vick.id}`);
  };

  if (!vick) return null;

  // Derive status from investigation state first, fall back to message state
  const activeInvCount = investigations.filter(i => ["queued", "investigating", "monitoring", "awaiting_evidence"].includes(i.status)).length;
  const unreadFindingsCount = investigations.filter(i => i.status === "findings_ready" && !i.findings_read).length;
  const hasCriticalInv = investigations.some(i => i.priority === "critical" && i.status === "findings_ready" && !i.findings_read);

  const status = hasCriticalInv ? "critical_alert"
    : unreadFindingsCount > 0 ? "findings_ready"
    : activeInvCount > 0 ? "investigating"
    : messageStatus;

  const statusConfig = {
    available:       { label: "Available",        icon: <Shield className="w-3.5 h-3.5" />,       color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    message_waiting: { label: "Message waiting",  icon: <MessageSquare className="w-3.5 h-3.5" />, color: "text-blue-400",    bg: "bg-blue-500/10",    border: "border-blue-500/20" },
    findings_ready:  { label: "Findings ready",   icon: <CheckCircle2 className="w-3.5 h-3.5" />,  color: "text-primary",     bg: "bg-primary/10",     border: "border-primary/20" },
    critical_alert:  { label: "Critical alert",   icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "text-red-400",     bg: "bg-red-500/10",     border: "border-red-500/20" },
    investigating:   { label: "Investigating",    icon: <Activity className="w-3.5 h-3.5" />,      color: "text-amber-400",   bg: "bg-amber-500/10",   border: "border-amber-500/20" },
  };

  const cfg = statusConfig[status] || statusConfig.available;
  const avatarUrl = vick.avatar_url || vick.image_avatar_url || null;
  const displayName = vick.display_name || vick.primary_name || vick.name || "Vick Servicio";
  const hasCriticalAlert = status === "critical_alert";
  const hasUnread = unreadCount > 0;
  const hasQueue = investigations.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mb-4"
    >
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Service Operator</p>
      <div className={`rounded-2xl border bg-card transition-all duration-200 ${hasCriticalAlert ? "border-red-500/40 shadow-red-500/10 shadow-md" : hasUnread || unreadFindingsCount > 0 ? "border-primary/30" : "border-border"}`}>

        {/* Main card row — tappable to open chat */}
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleOpen}
          className="w-full text-left p-4"
        >
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-12 h-12 rounded-xl object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-primary" />
                </div>
              )}
              {/* Unread badge */}
              {(unreadCount > 0 || unreadFindingsCount > 0) && (
                <span className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${hasCriticalAlert ? "bg-red-500" : "bg-primary"}`}>
                  {Math.min(unreadCount + unreadFindingsCount, 9)}
                  {unreadCount + unreadFindingsCount > 9 ? "+" : ""}
                </span>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-semibold text-foreground truncate">{displayName}</span>
                  {hasCriticalAlert && <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                </div>
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${cfg.color} ${cfg.bg} border ${cfg.border}`}>
                  {cfg.icon}
                  {cfg.label}
                </span>
              </div>

              <p className="text-[11px] text-muted-foreground mt-0.5">Account diagnostics · Repair · Investigation</p>

              {/* Summary line */}
              {(activeInvCount > 0 || unreadFindingsCount > 0) ? (
                <p className="text-xs mt-1.5 text-foreground">
                  {unreadFindingsCount > 0 && <span className="text-primary font-medium">{unreadFindingsCount} finding{unreadFindingsCount > 1 ? "s" : ""} ready</span>}
                  {unreadFindingsCount > 0 && activeInvCount > 0 && <span className="text-muted-foreground"> · </span>}
                  {activeInvCount > 0 && <span className="text-muted-foreground">{activeInvCount} active</span>}
                </p>
              ) : latestMessage?.content ? (
                <p className={`text-xs mt-1.5 line-clamp-1 ${hasUnread ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                  {latestMessage.content.slice(0, 90)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  Always available — no sleep schedule
                </p>
              )}
            </div>
          </div>
        </motion.button>

        {/* Investigation queue toggle */}
        {hasQueue && (
          <div className="border-t border-border">
            <button
              onClick={() => setShowQueue(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>
                Investigation queue ({investigations.length})
                {unreadFindingsCount > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                    {unreadFindingsCount} ready
                  </span>
                )}
              </span>
              {showQueue ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showQueue && (
              <div className="px-3 pb-3">
                <VickInvestigationQueue
                  investigations={investigations}
                  onMarkRead={handleMarkInvestigationRead}
                  onDismiss={handleDismissInvestigation}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}