import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ThomasPopulationFix({ onSuccess }) {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runPopulation = async () => {
    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await base44.functions.invoke('populateThomasCharacter', {});
      if (res?.data?.success) {
        setResult(res.data);
        // Call onSuccess callback if provided — triggers parent refresh
        if (onSuccess) {
          setTimeout(onSuccess, 1000);
        }
      } else {
        setError(res?.data?.error || 'Population failed');
      }
    } catch (err) {
      setError(err.message || 'Error running population');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3 mb-4"
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-700">Thomas Population Fix</p>
            <p className="text-xs text-amber-600/80 mt-1">
              Thomas was found but hasn't been added to the active character list. Click below to populate him now.
            </p>
          </div>
        </div>

        {!result && !error && (
          <button
            onClick={runPopulation}
            disabled={isRunning}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-600 text-white font-medium hover:bg-amber-700 transition-colors disabled:opacity-50 text-sm"
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Populating Thomas...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                Populate Thomas to Homepage
              </>
            )}
          </button>
        )}

        {result && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <div className="flex items-start gap-2 text-xs text-emerald-600">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{result.message}</span>
            </div>
            <div className="bg-white/40 rounded-lg p-2.5 text-xs text-amber-900 space-y-1">
              <p>✓ Thomas ID: {result.thomas.id}</p>
              <p>✓ Status: {result.thomas.status}</p>
              <p>✓ Ready for homepage: {result.population_status.ready_for_homepage ? 'Yes' : 'No'}</p>
            </div>
          </motion.div>
        )}

        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 text-xs text-red-600"
          >
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}