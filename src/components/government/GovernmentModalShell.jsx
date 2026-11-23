import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

/**
 * Shared shell for the Government venue flows. One presentation, so City Hall and
 * the Courthouse read as the same kind of place. It holds no behaviour of its own.
 */
export default function GovernmentModalShell({ open, title, subtitle, onClose, footer, children, wide = false }) {
  if (!open) return null;
  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/70 z-[120] flex items-end sm:items-center justify-center p-3"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className={`w-full ${wide ? "max-w-lg" : "max-w-md"} bg-card border border-border rounded-3xl overflow-hidden flex flex-col max-h-[88vh]`}
        >
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border flex-shrink-0">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              {subtitle && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg transition-colors flex-shrink-0" aria-label="Close">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
          {footer && <div className="px-5 py-3 border-t border-border flex-shrink-0">{footer}</div>}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}