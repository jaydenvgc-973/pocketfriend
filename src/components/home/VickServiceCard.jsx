import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { motion } from "framer-motion";
import { Shield, AlertTriangle, CheckCircle2, Activity, MessageSquare, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import VickInvestigationQueue from "./VickInvestigationQueue";
import { getOrResolveVick, isVickRecord, updateVickCache, getCachedVick } from "@/lib/vickServiceCache";

/**
 * VickServiceCard — Dedicated Home page card for Vick Servicio (npc_world_service).
 *
 * STABILITY CONTRACT:
 * - Uses a module-level stable cache (vickServiceCache.js) so the Vick record
 *   is resolved ONCE per session and returned instantly on every subsequent
 *   mount — eliminating the flicker caused by re-running 4 async lookups on
 *   every Chat → Home → Travel → Home navigation.
 * - Never returns null silently. Shows a skeleton while loading.
 * - On cache hit: isLoading is never set to true — card renders immediately.
 * - On cache miss: runs multi-path lookup once, then caches.
 * - Vick is not optional — this card must render every time.
 */

async function resolveVickRecord(ownerEmail) {
  // Path 1: service type filter
  const r1 = await base44.entities.Character.filter({ owner_email: ownerEmail, character_type: 'npc_world_service' }, null, 10).catch(() => []);
  const found1 = r1.find(isVickRecord);
  if (found1) return found1;

  // Path 2: is_world_service flag
  const r2 = await base44.entities.Character.filter({ owner_email: ownerEmail, is_world_service: true }, null, 10).catch(() => []);
  const found2 = r2.find(isVickRecord);
  if (found2) return found2;

  // Path 3: diagnostic_only flag
  const r3 = await base44.entities.Character.filter({ owner_email: ownerEmail, diagnostic_only: true }, null, 10).catch(() => []);
  const found3 = r3.find(isVickRecord);
  if (found3) return found3;

  // Path 4: fetchNPCsForUser backend fallback (covers ownership/created_by gaps)
  const npcRes = await base44.functions.invoke('fetchNPCsForUser', {}).catch(() => null);
  const npcs = npcRes?.data?.npcs || npcRes?.npcs || [];
  const found4 = npcs.find(isVickRecord);
  if (found4) return found4;

  return null;
}

export default function VickServiceCard({ ownerEmail }) {
  const navigate = useNavigate();

  // ── STABLE INITIALISATION: if cache already has Vick, start with him immediately.
  // This is the key fix for the flicker: on re-mount after navigation, getCachedVick()
  // returns the already-resolved record synchronously, so isLoading starts as false
  // and the card renders in its full state with zero async delay.
  const cachedOnMount = getCachedVick();
  const [vick, setVick] = useState(cachedOnMount);
  const [isLoading, setIsLoading] = useState(!cachedOnMount);
  const [conversationId, setConversationId] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [latestMessage, setLatestMessage] = useState(null);
  const [messageStatus, setMessageStatus] = useState("available");
  const [investigations, setInvestigations] = useState([]);
  const [showQueue, setShowQueue] = useState(false);

  // ── VICK LOAD — uses module-level cache, runs lookup only once per session ──
  useEffect(() => {
    if (!ownerEmail) { setIsLoading(false); return; }
    // If already initialised from cache on mount, skip the async fetch
    if (vick) return;
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const found = await getOrResolveVick(ownerEmail, () => resolveVickRecord(ownerEmail));
        if (cancelled) return;
        if (found) {
          setVick(found);
        } else {
          console.warn('[VickServiceCard] No Vick record found via any lookup path');
        }
      } catch (err) {
        if (cancelled) return;
        console.warn('[VickServiceCard] Vick lookup error:', err?.message);
      }
      if (!cancelled) setIsLoading(false);
    };
    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerEmail]);

  // ── LIVE VICK RECORD SYNC — keep cache fresh without full re-lookup ─────────
  // Subscribe to Character updates. If Vick's own record is updated by the backend,
  // patch state and cache in-place instead of triggering a full multi-path reload.
  useEffect(() => {
    if (!vick?.id) return;
    const unsubscribe = base44.entities.Character.subscribe((event) => {
      if (event.id !== vick.id) return;
      if (event.type === 'update' && event.data) {
        setVick(event.data);
        updateVickCache(event.data);
      }
    });
    return () => unsubscribe();
  }, [vick?.id]);

  // ── INVESTIGATIONS ─────────────────────────────────────────────────────────
  const loadInvestigations = useCallback(() => {
    if (!ownerEmail) return;
    base44.entities.VickInvestigation.filter({ owner_email: ownerEmail }, "-created_date", 20)
      .then(invs => {
        const meaningful = invs.filter(i => {
          if (["queued", "investigating", "awaiting_evidence", "monitoring"].includes(i.status)) return true;
          if (i.status === "findings_ready" && !i.findings_read) return true;
          if (i.priority === "critical" && !i.dismissed && !i.findings_read) return true;
          return false;
        });
        setInvestigations(meaningful);
        if (meaningful.some(i => i.status === "findings_ready" && !i.findings_read)) setShowQueue(true);
      }).catch(() => {});
  }, [ownerEmail]);

  useEffect(() => { loadInvestigations(); }, [loadInvestigations]);

  useEffect(() => {
    if (!ownerEmail) return;
    const unsubscribe = base44.entities.VickInvestigation.subscribe((event) => {
      if (event.data?.owner_email !== ownerEmail) return;
      loadInvestigations();
    });
    return () => unsubscribe();
  }, [ownerEmail, loadInvestigations]);

  // ── CONVERSATION + UNREAD ─────────────────────────────────────────────────
  useEffect(() => {
    if (!vick?.id || !ownerEmail) return;
    base44.entities.Conversation.filter({ owner_email: ownerEmail }).then(convos => {
      const vickConvo = convos.find(c =>
        (c.character_ids || []).includes(vick.id) &&
        (c.type === "direct" || c.type === "npc")
      );
      if (!vickConvo) return;
      setConversationId(vickConvo.id);
      base44.entities.Message.filter({ conversation_id: vickConvo.id, sender_type: "character", is_read: false }, "-timestamp", 20)
        .then(msgs => {
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
      dismissed: true, dismissed_at: new Date().toISOString(),
      status: "archived", archived_at: new Date().toISOString(),
    }).catch(() => {});
    loadInvestigations();
  };

  const handleOpen = () => {
    if (!vick?.id) return;
    navigate(`/chat/${vick.id}`);
  };

  // ── LOADING SKELETON — shown while lookup is in progress ──────────────────
  if (isLoading) {
    return (
      <div className="mb-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Service Operator</p>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Loader2 className="w-5 h-5 text-primary/40 animate-spin" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-muted rounded w-32 animate-pulse" />
              <div className="h-2.5 bg-muted rounded w-48 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── NO VICK FOUND — show a stable placeholder (never null) ────────────────
  if (!vick) {
    return (
      <div className="mb-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Service Operator</p>
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-primary/40" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Vick Servicio</p>
              <p className="text-[11px] text-muted-foreground">Setting up your account service operator…</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── FULL CARD ──────────────────────────────────────────────────────────────
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
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleOpen}
          className="w-full text-left p-4"
        >
          <div className="flex items-center gap-3">
            <div className="relative flex-shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt={displayName} className="w-12 h-12 rounded-xl object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-primary" />
                </div>
              )}
              {(unreadCount > 0 || unreadFindingsCount > 0) && (
                <span className={`absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${hasCriticalAlert ? "bg-red-500" : "bg-primary"}`}>
                  {Math.min(unreadCount + unreadFindingsCount, 9)}{unreadCount + unreadFindingsCount > 9 ? "+" : ""}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-semibold text-foreground truncate">{displayName}</span>
                  {hasCriticalAlert && <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                </div>
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${cfg.color} ${cfg.bg} border ${cfg.border}`}>
                  {cfg.icon}{cfg.label}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">Account diagnostics · Repair · Investigation</p>
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