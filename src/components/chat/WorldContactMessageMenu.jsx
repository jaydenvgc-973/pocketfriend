import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Trash2, Trash, BookX, AlertOctagon, X, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

/**
 * WorldContactMessageMenu
 *
 * Long-press / right-click context menu for individual World Phone messages.
 * Appears anchored near the message bubble.
 *
 * Menu options:
 *   Delete Message          — removes the message from view. Memories already created are not touched.
 *   Delete and Remove from Canon — removes the message AND prevents it from influencing any future
 *                                  memory, relationship, journal, or context assembly.
 *   Report: Fourth-Wall Violation — same as canon removal, also flags the content for review.
 *   Report: Impossible Knowledge  — same as canon removal, flags knowledge the character shouldn't have.
 *
 * Props:
 *   message: { id, role, content }
 *   conversationId: string
 *   onDeleted: (messageId) => void  — called after successful deletion so parent can remove from state
 *   onClose: () => void
 *   anchorRect: DOMRect — position to anchor the menu near
 */
export default function WorldContactMessageMenu({ message, conversationId, onDeleted, onClose, anchorRect }) {
  const [loading, setLoading] = useState(false);
  const [confirmMode, setConfirmMode] = useState(null); // null | 'canon' | 'violation_fw' | 'violation_ik'
  const menuRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [onClose]);

  const handleDelete = async (mode, violationType) => {
    setLoading(true);
    try {
      await base44.functions.invoke('deleteCanonMessage', {
        messageId: message.id,
        mode,
        violationType: violationType || undefined,
        conversationId,
      });
      onDeleted(message.id);
      onClose();
    } catch (e) {
      console.error('[WorldContactMessageMenu] delete failed:', e.message);
      setLoading(false);
    }
  };

  // Position menu near the anchor rect, keeping it on screen
  const menuStyle = {};
  if (anchorRect) {
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const menuH = 220; // approx
    const menuW = 240; // approx

    // Prefer below the message, flip to above if too close to bottom
    let top = anchorRect.bottom + 6;
    if (top + menuH > viewportH - 20) {
      top = anchorRect.top - menuH - 6;
    }
    top = Math.max(8, Math.min(top, viewportH - menuH - 8));

    // Align to message side
    let left = anchorRect.left;
    if (left + menuW > viewportW - 8) {
      left = viewportW - menuW - 8;
    }
    left = Math.max(8, left);

    menuStyle.top = top;
    menuStyle.left = left;
  } else {
    // Fallback: center
    menuStyle.top = '50%';
    menuStyle.left = '50%';
    menuStyle.transform = 'translate(-50%, -50%)';
  }

  const isSent = message.role === 'sent';
  const snippet = (message.content || '').substring(0, 60) + ((message.content || '').length > 60 ? '…' : '');

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[200]" onClick={onClose}>
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.12 }}
          style={{ position: 'fixed', ...menuStyle, zIndex: 201, minWidth: 220 }}
          onClick={e => e.stopPropagation()}
          className="bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
        >
          {/* Message preview */}
          <div className="px-4 py-2.5 border-b border-border bg-secondary/40">
            <p className="text-[10px] text-muted-foreground font-medium mb-0.5">
              {isSent ? 'Your message' : 'Their message'}
            </p>
            <p className="text-xs text-foreground line-clamp-2 italic">"{snippet}"</p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 text-primary animate-spin" />
            </div>
          ) : confirmMode ? (
            <div className="p-4">
              <p className="text-sm font-medium text-foreground mb-1">
                {confirmMode === 'canon' && 'Remove from canon?'}
                {confirmMode === 'violation_fw' && 'Report fourth-wall violation?'}
                {confirmMode === 'violation_ik' && 'Report impossible knowledge?'}
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                {confirmMode === 'canon' && 'This message will be deleted and will no longer influence memories, relationships, or future conversations.'}
                {confirmMode === 'violation_fw' && 'This message will be removed from canon and flagged as a fourth-wall violation.'}
                {confirmMode === 'violation_ik' && 'This message will be removed from canon and flagged as impossible knowledge.'}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmMode(null)}
                  className="flex-1 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (confirmMode === 'canon') handleDelete('delete_from_canon', null);
                    else if (confirmMode === 'violation_fw') handleDelete('report_violation', 'fourth_wall');
                    else if (confirmMode === 'violation_ik') handleDelete('report_violation', 'impossible_knowledge');
                  }}
                  className="flex-1 py-2 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          ) : (
            <div className="py-1">
              {/* Delete for me */}
              <button
                onClick={() => handleDelete('delete_for_me', null)}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/60 transition-colors text-left"
              >
                <Trash2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="font-medium">Delete Message</p>
                  <p className="text-[11px] text-muted-foreground">Removes from this view</p>
                </div>
              </button>

              {/* Delete and remove from canon */}
              <button
                onClick={() => setConfirmMode('canon')}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/60 transition-colors text-left"
              >
                <BookX className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <div>
                  <p className="font-medium">Delete and Remove from Canon</p>
                  <p className="text-[11px] text-muted-foreground">Message is treated as if it never happened</p>
                </div>
              </button>

              <div className="mx-4 border-t border-border my-1" />

              {/* Report: Fourth-Wall Violation */}
              <button
                onClick={() => setConfirmMode('violation_fw')}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/60 transition-colors text-left"
              >
                <AlertOctagon className="w-4 h-4 text-red-400 flex-shrink-0" />
                <div>
                  <p className="font-medium text-red-400">Report: Fourth-Wall Violation</p>
                  <p className="text-[11px] text-muted-foreground">Character referenced system internals</p>
                </div>
              </button>

              {/* Report: Impossible Knowledge */}
              <button
                onClick={() => setConfirmMode('violation_ik')}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/60 transition-colors text-left"
              >
                <AlertOctagon className="w-4 h-4 text-orange-400 flex-shrink-0" />
                <div>
                  <p className="font-medium text-orange-400">Report: Impossible Knowledge</p>
                  <p className="text-[11px] text-muted-foreground">Character knew something they couldn't know</p>
                </div>
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}