import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { motion } from "framer-motion";
import { Shield, AlertTriangle, CheckCircle2, Activity, MessageSquare } from "lucide-react";

/**
 * VickServiceCard
 *
 * Dedicated Home page card for Vick Servicio (npc_world_service).
 * Shows service status, unread message count, and critical alerts.
 * Vick is never shown as asleep — he is a service operator, always available.
 *
 * NON-EXPANSION GUARDRAIL: This card is ONLY for Vick Servicio (npc_world_service + is_world_service).
 * Do NOT generalize this component for other NPCs.
 */
export default function VickServiceCard({ ownerEmail }) {
  const navigate = useNavigate();
  const [vick, setVick] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestMessage, setLatestMessage] = useState(null);
  const [status, setStatus] = useState("available");

  // Load Vick's character record
  useEffect(() => {
    if (!ownerEmail) return;
    base44.entities.Character.filter({
      owner_email: ownerEmail,
      character_type: "npc_world_service",
      is_world_service: true,
    }).then(results => {
      // Find the canonical Vick (name match as safety guard)
      const vickRecord = results.find(c =>
        c.name?.toLowerCase().includes("vick") ||
        c.display_name?.toLowerCase().includes("vick")
      );
      if (vickRecord) setVick(vickRecord);
    }).catch(() => {});
  }, [ownerEmail]);

  // Load Vick's conversation + unread count
  useEffect(() => {
    if (!vick?.id || !ownerEmail) return;

    base44.entities.Conversation.filter({
      owner_email: ownerEmail,
    }).then(convos => {
      const vickConvo = convos.find(c =>
        (c.character_ids || []).includes(vick.id) &&
        (c.type === "direct" || c.type === "npc")
      );
      if (!vickConvo) return;
      setConversationId(vickConvo.id);

      // Count unread messages from Vick
      base44.entities.Message.filter({
        conversation_id: vickConvo.id,
        sender_type: "character",
        is_read: false,
      }, "-timestamp", 20).then(msgs => {
        const vickMsgs = msgs.filter(m => m.character_id === vick.id);
        setUnreadCount(vickMsgs.length);
        if (vickMsgs.length > 0) {
          setLatestMessage(vickMsgs[0]);
          // Escalate status if unread messages exist
          const content = vickMsgs[0].content?.toLowerCase() || "";
          if (content.includes("critical") || content.includes("corruption") || content.includes("data loss") || content.includes("severe")) {
            setStatus("critical_alert");
          } else if (content.includes("complete") || content.includes("found") || content.includes("finished") || content.includes("results")) {
            setStatus("findings_ready");
          } else {
            setStatus("message_waiting");
          }
        }
      }).catch(() => {});
    }).catch(() => {});
  }, [vick?.id, ownerEmail]);

  // Real-time message subscription for Vick's conversation
  useEffect(() => {
    if (!conversationId || !vick?.id) return;
    const unsubscribe = base44.entities.Message.subscribe((event) => {
      if (event.data?.conversation_id !== conversationId) return;
      if (event.data?.sender_type === "character" && event.data?.character_id === vick.id && !event.data?.is_read) {
        setUnreadCount(prev => prev + 1);
        setLatestMessage(event.data);
        const content = event.data.content?.toLowerCase() || "";
        if (content.includes("critical") || content.includes("corruption") || content.includes("data loss")) {
          setStatus("critical_alert");
        } else if (content.includes("complete") || content.includes("found") || content.includes("finished")) {
          setStatus("findings_ready");
        } else {
          setStatus("message_waiting");
        }
      }
    });
    return () => unsubscribe();
  }, [conversationId, vick?.id]);

  const handleOpen = () => {
    if (!vick?.id) return;
    navigate(`/chat/${vick.id}`);
  };

  if (!vick) return null;

  const statusConfig = {
    available: {
      label: "Available",
      icon: <Shield className="w-3.5 h-3.5" />,
      color: "text-emerald-400",
      bgColor: "bg-emerald-500/10",
      borderColor: "border-emerald-500/20",
    },
    message_waiting: {
      label: "Message waiting",
      icon: <MessageSquare className="w-3.5 h-3.5" />,
      color: "text-blue-400",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/20",
    },
    findings_ready: {
      label: "Findings ready",
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      color: "text-primary",
      bgColor: "bg-primary/10",
      borderColor: "border-primary/20",
    },
    critical_alert: {
      label: "Critical alert",
      icon: <AlertTriangle className="w-3.5 h-3.5" />,
      color: "text-red-400",
      bgColor: "bg-red-500/10",
      borderColor: "border-red-500/20",
    },
    investigating: {
      label: "Investigating",
      icon: <Activity className="w-3.5 h-3.5" />,
      color: "text-amber-400",
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-500/20",
    },
  };

  const cfg = statusConfig[status] || statusConfig.available;
  const avatarUrl = vick.avatar_url || vick.image_avatar_url || null;
  const displayName = vick.display_name || vick.primary_name || vick.name || "Vick Servicio";
  const hasCriticalAlert = status === "critical_alert";
  const hasUnread = unreadCount > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mb-4"
    >
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Service Operator</p>
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={handleOpen}
        className={`w-full text-left rounded-2xl border bg-card p-4 transition-all duration-200 hover:bg-secondary/50 ${hasCriticalAlert ? "border-red-500/40 shadow-red-500/10 shadow-md" : hasUnread ? "border-primary/30" : "border-border"}`}
      >
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-12 h-12 rounded-xl object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary" />
              </div>
            )}
            {/* Unread badge */}
            {unreadCount > 0 && (
              <span className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${hasCriticalAlert ? "bg-red-500" : "bg-primary"}`}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-semibold text-foreground truncate">{displayName}</span>
                {hasCriticalAlert && (
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                )}
              </div>
              {/* Status badge */}
              <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${cfg.color} ${cfg.bgColor} border ${cfg.borderColor}`}>
                {cfg.icon}
                {cfg.label}
              </span>
            </div>

            {/* Role label */}
            <p className="text-[11px] text-muted-foreground mt-0.5">Account diagnostics · Repair · Investigation</p>

            {/* Latest message preview */}
            {latestMessage?.content && (
              <p className={`text-xs mt-1.5 line-clamp-1 ${hasUnread ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                {latestMessage.content.slice(0, 90)}
              </p>
            )}

            {/* Always available indicator */}
            {!latestMessage?.content && (
              <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                Always available — no sleep schedule
              </p>
            )}
          </div>
        </div>
      </motion.button>
    </motion.div>
  );
}