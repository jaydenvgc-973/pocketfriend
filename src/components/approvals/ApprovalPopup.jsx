import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { X, Check, AlertTriangle, Home, Heart, Baby, MapPin, User } from "lucide-react";
import { Button } from "@/components/ui/button";

const ICONS = {
  move_in: Home,
  marriage: Heart,
  birth: Baby,
  location_match: MapPin,
  npc_create: User,
};

const COLORS = {
  move_in: "text-blue-400",
  marriage: "text-pink-400",
  birth: "text-amber-400",
  location_match: "text-primary",
  npc_create: "text-purple-400",
};

/**
 * ApprovalPopup — generic approval modal for life events
 * 
 * Props:
 *   type: 'move_in' | 'marriage' | 'birth' | 'location_match' | 'npc_create'
 *   title: string
 *   description: string
 *   details: object (type-specific extra data)
 *   onApprove: (data?) => void
 *   onDeny: () => void
 *   children: optional JSX for custom content area
 */
export default function ApprovalPopup({ type, title, description, details, onApprove, onDeny, children }) {
  const Icon = ICONS[type] || AlertTriangle;
  const color = COLORS[type] || "text-primary";

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onDeny(); }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        >
          <div className="flex items-start gap-3 mb-4">
            <div className={`w-10 h-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0`}>
              <Icon className={`w-5 h-5 ${color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
            </div>
            <button onClick={onDeny} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          {children && (
            <div className="mb-4 p-3 bg-secondary/50 rounded-xl text-xs text-foreground space-y-1">
              {children}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onDeny}
              className="flex-1 rounded-xl text-xs"
            >
              No, skip
            </Button>
            <Button
              size="sm"
              onClick={() => onApprove(details)}
              className="flex-1 rounded-xl gap-1.5 text-xs"
            >
              <Check className="w-3.5 h-3.5" /> Approve
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}