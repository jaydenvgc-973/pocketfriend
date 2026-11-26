import React from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Car, PawPrint } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * MissingBelongingModal — the owner has not recorded the thing this activity needs.
 *
 * It says what is missing and where to add it, and offers Cancel. Cancelling changes
 * nothing: no car or pet is invented, nobody is charged, and the scene stays as it was.
 */
export default function MissingBelongingModal({ open, kind, ownerName, isUser = false, onClose }) {
  if (!open) return null;
  const isCar = kind === "car";
  const Icon = isCar ? Car : PawPrint;
  const what = isCar ? "a car" : "a pet";
  const who = isUser ? "You do not have" : `${ownerName || "This character"} does not have`;
  const where = isUser ? "your profile" : "the character's profile";

  return createPortal(
    <div className="fixed inset-0 z-[196] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-card border border-border p-5 space-y-3"
      >
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          <p className="text-sm font-bold text-foreground">Nothing to use here yet</p>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {who} {what}. Please visit {where} to add one.
        </p>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose} className="rounded-xl">Cancel</Button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}