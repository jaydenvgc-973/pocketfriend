import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, PlusCircle, MinusCircle, DollarSign, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';

export default function ManualTransactionModal({ character, initialDirection = 'income', onClose, onSuccess }) {
  const [direction, setDirection] = useState(initialDirection || 'income');
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid positive amount.');
      return;
    }
    if (!title.trim()) {
      setError('A transaction title is required.');
      return;
    }

    setSaving(true);
    try {
      const res = await base44.functions.invoke('manualCharacterTransaction', {
        character_id: character.id,
        direction,
        amount: parsedAmount,
        title: title.trim(),
        note: note.trim(),
      });

      if (res?.data?.success) {
        onSuccess(res.data);
      } else {
        setError(res?.data?.error || 'Transaction failed.');
      }
    } catch (err) {
      setError(err?.message || 'Transaction failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
        onClick={() => !saving && onClose()}
      >
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          onClick={e => e.stopPropagation()}
          className="w-full max-w-lg bg-card border border-border rounded-t-2xl flex flex-col mb-16"
          style={{ maxHeight: 'calc(85dvh - 4rem)' }}
        >
          {/* Header — fixed, never scrolls */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
            <h3 className="text-sm font-semibold text-foreground">
              Manual Transaction — {character.name}
            </h3>
            {!saving && (
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-3">
            {/* Direction toggle */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDirection('income')}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                  direction === 'income'
                    ? 'bg-green-500/15 border-green-500/50 text-green-400'
                    : 'bg-card border-border text-muted-foreground hover:border-green-500/30'
                }`}
              >
                <PlusCircle className="w-4 h-4" /> Add Money
              </button>
              <button
                type="button"
                onClick={() => setDirection('expense')}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                  direction === 'expense'
                    ? 'bg-red-500/15 border-red-500/50 text-red-400'
                    : 'bg-card border-border text-muted-foreground hover:border-red-500/30'
                }`}
              >
                <MinusCircle className="w-4 h-4" /> Subtract Money
              </button>
            </div>

            {/* Amount */}
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="Amount"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full h-10 pl-9 pr-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                required
              />
            </div>

            {/* Title */}
            <input
              type="text"
              placeholder="Transaction title (e.g. Birthday gift)"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={100}
              className="w-full h-10 px-3 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              required
            />

            {/* Note (optional) */}
            <textarea
              placeholder="Note (optional)"
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-xl bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary"
            />

            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>

          {/* Footer button — outside scroll area, always visible */}
          <div className="flex-shrink-0 px-5 pt-3 pb-5 border-t border-border bg-card">
            <Button
              onClick={handleSubmit}
              disabled={saving}
              className={`w-full rounded-xl gap-2 ${direction === 'income' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : direction === 'income' ? <PlusCircle className="w-4 h-4" /> : <MinusCircle className="w-4 h-4" />}
              {saving ? 'Processing...' : direction === 'income' ? `Add $${amount || '0'}` : `Subtract $${amount || '0'}`}
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}