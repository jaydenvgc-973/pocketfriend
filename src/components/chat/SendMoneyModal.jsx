import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { DollarSign, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SendMoneyModal({ character, userBalance, onSend, onClose, isSending }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(false);

  const parsed = parseFloat(amount);
  const isValid = !isNaN(parsed) && parsed > 0 && parsed <= userBalance && reason.trim().length > 0;

  const handleSend = () => {
    if (!isValid) return;
    onSend(parsed, reason.trim(), isAnonymous ? 'anonymous' : 'direct');
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Send Money to {character?.name}</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="bg-secondary/50 rounded-xl px-4 py-2 text-sm text-muted-foreground">
          Your balance: <span className="text-foreground font-semibold">${userBalance?.toLocaleString() ?? "0"}</span>
        </div>

        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Amount ($)</label>
          <input
            type="number"
            min="1"
            max={userBalance}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full px-4 py-3 rounded-xl bg-secondary border border-border text-foreground text-lg font-semibold outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
            autoFocus
          />
          {amount && !isValid && (
            <p className="text-xs text-destructive mt-1">
              {parseFloat(amount) > userBalance ? "Insufficient funds" : "Enter a valid amount"}
            </p>
          )}
        </div>

        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">{isAnonymous ? 'Statement title' : "What's it for?"} (required)</label>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={isAnonymous ? "e.g. Refund, Gift Card, Payroll Adjustment..." : "e.g. rent, groceries, just because..."}
            className="w-full px-4 py-3 rounded-xl bg-secondary border border-border text-foreground text-sm outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
          />
          {!reason.trim() && (
            <p className="text-xs text-destructive mt-1">Required field</p>
          )}
        </div>

        <label className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 border border-border/50 cursor-pointer hover:bg-secondary/50 transition-colors">
          <input
            type="checkbox"
            checked={isAnonymous}
            onChange={e => setIsAnonymous(e.target.checked)}
            className="w-4 h-4 rounded cursor-pointer"
          />
          <span className="text-sm font-medium text-foreground">Send without revealing it was from me</span>
        </label>

        <Button
          onClick={handleSend}
          disabled={!isValid || isSending}
          className={`w-full h-11 rounded-xl gap-2 ${isAnonymous ? 'bg-amber-600 hover:bg-amber-700' : ''}`}
        >
          <DollarSign className="w-4 h-4" />
          {isSending ? "Sending..." : `Send $${parsed > 0 ? parsed.toLocaleString() : "0"}${isAnonymous ? ' (anonymous)' : ''}`}
        </Button>
      </motion.div>
    </motion.div>,
    document.body
  );
}