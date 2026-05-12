import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, AlertCircle, Loader2, Zap } from 'lucide-react';
import { base44 } from '@/api/base44Client';

/**
 * Thomas Anderson Fix Component
 * 
 * SAFETY RULES:
 * 1. Only triggers for active_created_character status=active records
 * 2. Dismissal completely removes popup — no permanent clutter
 * 3. Non-blocking bottom-right toast position
 * 4. 500 errors handled gracefully with dismissal option
 * 5. No auto-repair of deleted/ghost records
 */
export default function ThomasAndersonFix({ onSuccess }) {
  const [isDismissed, setIsDismissed] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runDiagnostic = async () => {
    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await base44.functions.invoke('deepFixThomasAnderson', {});
      
      if (res?.data?.success) {
        setResult(res.data);
        if (res.data.diagnostics?.visible_in_queries) {
          setTimeout(() => {
            if (onSuccess) onSuccess();
            setIsDismissed(true);
          }, 2000);
        }
      } else {
        setError(res?.data?.error || 'Diagnostic failed');
      }
    } catch (err) {
      // 500 or network error — show error and allow dismissal
      setError(err.message || 'Error running diagnostic');
    } finally {
      setIsRunning(false);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
  };

  const handleClose = () => {
    setResult(null);
    if (onSuccess) onSuccess();
    setIsDismissed(true);
  };

  const diagnostics = result?.diagnostics;
  const allChecksPassed = diagnostics?.checks?.every(c => c.status !== 'FAIL');

  if (isDismissed) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="fixed bottom-6 right-6 w-full max-w-sm z-40 bg-card border border-border rounded-xl shadow-lg overflow-hidden"
      >
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Thomas Anderson</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Character visibility check</p>
            </div>
            {!isRunning && !result && (
              <button 
                onClick={handleDismiss}
                className="p-1 hover:bg-secondary rounded-lg transition-colors flex-shrink-0"
                title="Dismiss this notice"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>

          {!result && !isRunning && !error && (
            <button
              onClick={runDiagnostic}
              className="w-full py-2 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4" /> Run Check
            </button>
          )}

          {isRunning && (
            <div className="py-3 flex flex-col items-center gap-2">
              <Loader2 className="w-4 h-4 text-primary animate-spin" />
              <p className="text-xs text-muted-foreground">Running check...</p>
            </div>
          )}

          {result && diagnostics && (
            <div className="space-y-2">
              <div className={`p-2 rounded-lg border text-xs ${allChecksPassed ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                <p className={`font-medium ${allChecksPassed ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {allChecksPassed ? '✓ All checks passed' : '⚠ Some checks did not pass'}
                </p>
              </div>
              <button
                onClick={handleClose}
                className="w-full py-2 px-3 rounded-lg bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
              >
                Done
              </button>
            </div>
          )}

          {error && (
            <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/30 space-y-2">
              <p className="text-xs text-destructive">{error}</p>
              <button
                onClick={handleDismiss}
                className="w-full py-2 px-3 rounded-lg bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}