import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle2, AlertCircle, Loader2, Zap } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function ThomasAndersonFix({ onSuccess }) {
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
          }, 2000);
        }
      } else {
        setError(res?.data?.error || 'Diagnostic failed');
      }
    } catch (err) {
      setError(err.message || 'Error running diagnostic');
    } finally {
      setIsRunning(false);
    }
  };

  const diagnostics = result?.diagnostics;
  const allChecksPassed = diagnostics?.checks?.every(c => c.status !== 'FAIL');

  return createPortal(
    <AnimatePresence>
      {true && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="fixed top-4 left-4 right-4 max-w-md mx-auto z-50 bg-card border border-border rounded-2xl shadow-lg overflow-hidden"
        >
          <div className="p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Thomas Anderson Issue Detected</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Character found but not visible on homepage</p>
              </div>
              {!isRunning && !result && (
                <button 
                  onClick={() => setError('dismissed')}
                  className="p-1 hover:bg-secondary rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
            </div>

            {!result && !isRunning && !error && (
              <button
                onClick={runDiagnostic}
                className="w-full py-2 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                <Zap className="w-4 h-4" /> Run Diagnostic & Fix
              </button>
            )}

            {isRunning && (
              <div className="py-4 flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
                <p className="text-xs text-muted-foreground">Running deep diagnostic...</p>
              </div>
            )}

            {result && diagnostics && (
              <div className="space-y-2">
                <div className={`p-2 rounded-lg border ${allChecksPassed ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                  <p className={`text-xs font-medium ${allChecksPassed ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {allChecksPassed ? '✓ All checks passed' : '⚠ Some checks did not pass'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{diagnostics.final_status}</p>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1">
                  {diagnostics.checks?.map((check, i) => {
                    const isPass = check.status === 'PASS';
                    const isWarning = check.status === 'WARNING';
                    return (
                      <div key={i} className="text-xs">
                        <div className="flex items-start gap-2">
                          {isPass ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />
                          ) : isWarning ? (
                            <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                          ) : (
                            <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                          )}
                          <div className="flex-1">
                            <p className={`font-medium ${isPass ? 'text-emerald-600' : isWarning ? 'text-amber-600' : 'text-red-600'}`}>
                              {check.check}
                            </p>
                            <p className="text-muted-foreground">{check.detail}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {diagnostics.fixes_applied?.length > 0 && (
                  <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30">
                    <p className="text-xs font-medium text-blue-600 mb-1">Fixes Applied:</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {diagnostics.fixes_applied.map((fix, i) => (
                        <li key={i}>• {fix}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  onClick={() => {
                    setResult(null);
                    if (onSuccess) onSuccess();
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-secondary text-foreground text-xs font-medium hover:bg-secondary/80 transition-colors"
                >
                  Close & Refresh
                </button>
              </div>
            )}

            {error && error !== 'dismissed' && (
              <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/30">
                <p className="text-xs text-destructive">{error}</p>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}