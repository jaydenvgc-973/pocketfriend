import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";
import { X, Baby, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * BirthApprovalPopup
 * 
 * Shown when a birth event is detected in conversation.
 * Lets user name the child or dismiss without creating an NPC.
 * 
 * Props:
 *   parentCharacter: Character object
 *   otherParentName: string (optional, for partner)
 *   onApprove: ({ childName, parentCharacterId }) => void
 *   onDeny: () => void
 */
export default function BirthApprovalPopup({ parentCharacter, otherParentName, onApprove, onDeny }) {
  const [childName, setChildName] = useState("");

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
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <Baby className="w-5 h-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground">Birth Event Detected</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                It looks like {parentCharacter?.name} may have had a baby.
                {otherParentName && ` (with ${otherParentName})`}
              </p>
            </div>
            <button onClick={onDeny} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mb-4 space-y-3">
            <div className="p-3 bg-secondary/50 rounded-xl space-y-1 text-xs">
              <p className="text-foreground"><span className="text-muted-foreground">Parent:</span> {parentCharacter?.name}</p>
              {otherParentName && (
                <p className="text-foreground"><span className="text-muted-foreground">Other parent:</span> {otherParentName}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Name the child (optional)</label>
              <Input
                value={childName}
                onChange={e => setChildName(e.target.value)}
                placeholder="Leave blank to skip NPC creation"
                className="h-10 rounded-xl text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                If you name them, they'll be added as a family NPC linked to {parentCharacter?.name}.
                Leave blank to acknowledge the event without creating a character.
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onDeny}
              className="flex-1 rounded-xl text-xs"
            >
              Not a new character
            </Button>
            <Button
              size="sm"
              onClick={() => onApprove({ childName: childName.trim(), parentCharacterId: parentCharacter?.id })}
              className="flex-1 rounded-xl gap-1.5 text-xs"
            >
              <Check className="w-3.5 h-3.5" />
              {childName.trim() ? "Add child" : "Just note it"}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}