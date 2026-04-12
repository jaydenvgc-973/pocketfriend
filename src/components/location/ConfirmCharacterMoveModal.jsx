import { motion } from "framer-motion";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export default function ConfirmCharacterMoveModal({ isOpen, onClose, character, fromLocation, toLocation, onConfirm, isLoading }) {
  if (!isOpen || !character || !fromLocation || !toLocation) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 p-4">
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        className="w-full max-w-md bg-card border border-border rounded-3xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-bold text-foreground">Move Character?</h3>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              Move <span className="font-semibold">{character.name}</span> from <span className="font-semibold">{fromLocation.name}</span> to <span className="font-semibold">{toLocation.name}</span>?
            </p>
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">What happens:</span>
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 ml-2">
                <li>• {character.name} will be removed from {fromLocation.name}</li>
                <li>• {character.name} will be added as a resident at {toLocation.name}</li>
                <li>• Rent and utilities will be recalculated</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="border-t border-border px-5 py-3 flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={isLoading} className="flex-1 rounded-lg">
            Cancel
          </Button>
          <Button onClick={() => onConfirm()} disabled={isLoading} className="flex-1 rounded-lg">
            {isLoading ? "Moving..." : "Confirm Move"}
          </Button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}