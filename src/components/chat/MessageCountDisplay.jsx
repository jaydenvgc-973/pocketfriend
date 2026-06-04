import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { MessageSquare, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// Active message limit — matches MSG_WINDOW in useChatLoadConvo.
// This is the initial visible render window, NOT a hard cap.
// All messages are stored in DB; only the render window is bounded.
const MSG_WINDOW = 200;
const WARN_THRESHOLD = 180; // Show warning when approaching the window

export default function MessageCountDisplay({ conversationId }) {
  const [count, setCount] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;

    // Count active (non-archived) messages for this conversation
    base44.entities.Message.filter(
      { conversation_id: conversationId, archived_date: null },
      "-created_date",
      250 // fetch more than MSG_WINDOW to get a real count
    ).then(msgs => {
      if (!cancelled) setCount(Array.isArray(msgs) ? msgs.length : 0);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [conversationId]);

  if (count === null) return null;

  const isApproaching = count >= WARN_THRESHOLD;
  const isAtLimit = count >= MSG_WINDOW;

  // Only show when approaching or at the limit
  if (!isApproaching) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mb-2"
    >
      <div className={`border rounded-xl overflow-hidden ${isAtLimit ? 'bg-amber-950/30 border-amber-500/40' : 'bg-secondary/40 border-border'}`}>
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            {isAtLimit
              ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              : <MessageSquare className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            }
            <span className={`text-xs truncate ${isAtLimit ? 'text-amber-300' : 'text-muted-foreground'}`}>
              {count} active messages · {MSG_WINDOW} shown per load
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">{expanded ? '▲' : '▼'}</span>
        </button>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden border-t border-border"
            >
              <div className="px-3 py-3 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="bg-background/50 rounded-lg px-2 py-2">
                    <p className="text-lg font-bold text-foreground">{count}</p>
                    <p className="text-[10px] text-muted-foreground">Active messages</p>
                  </div>
                  <div className="bg-background/50 rounded-lg px-2 py-2">
                    <p className="text-lg font-bold text-foreground">{MSG_WINDOW}</p>
                    <p className="text-[10px] text-muted-foreground">Shown per load</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {isAtLimit
                    ? `You're at the visible load limit. Older messages are still stored — use "Load older messages" to scroll back, or archive messages you no longer need in your active thread using the message action menu (tap a message → Archive this).`
                    : `You're approaching the visible load limit of ${MSG_WINDOW} messages. To keep your most important messages in view, you can archive older ones using the message action menu (tap a message → Archive this).`
                  }
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  Archived messages are preserved and retrievable. Only you can archive — the system will not archive automatically.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}