import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertCircle, Zap, CheckCircle, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

export default function GenericLocationFixer() {
  const [isRunning, setIsRunning] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const [fixed, setFixed] = useState(null);
  const [error, setError] = useState(null);

  const handleDiagnose = async () => {
    setIsRunning(true);
    setError(null);
    setDiagnostic(null);
    setFixed(null);

    try {
      const res = await base44.functions.invoke('diagnosticGenericLocations', {});
      setDiagnostic(res.data);
    } catch (err) {
      setError(err.message || 'Diagnosis failed');
    } finally {
      setIsRunning(false);
    }
  };

  const handleFix = async () => {
    if (!diagnostic?.characters?.length) return;
    
    setIsRunning(true);
    setError(null);

    try {
      const charIds = diagnostic.characters.map(c => c.id);
      const res = await base44.functions.invoke('fixGenericLocations', { characterIds: charIds });
      setFixed(res.data);
    } catch (err) {
      setError(err.message || 'Fix failed');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-amber-400">Generic Location Cleanup</h4>
          <p className="text-xs text-amber-400/80 mt-1">
            Characters at generic locations like "at a bar" need to be reassigned to real venues, work shifts, school, or home.
          </p>
        </div>
      </div>

      {!diagnostic && !fixed ? (
        <Button
          onClick={handleDiagnose}
          disabled={isRunning}
          variant="outline"
          size="sm"
          className="w-full rounded-lg gap-2"
        >
          {isRunning ? (
            <>
              <Loader className="w-4 h-4 animate-spin" />
              Scanning...
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4" />
              Find Affected Characters
            </>
          )}
        </Button>
      ) : diagnostic && !fixed ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-card p-3 space-y-2">
            <p className="text-sm font-semibold text-foreground">
              {diagnostic.totalAffected} character{diagnostic.totalAffected !== 1 ? 's' : ''} need fixing:
            </p>
            <div className="space-y-1 max-h-48 overflow-y-auto text-xs">
              <AnimatePresence>
                {diagnostic.characters.map((char, i) => (
                  <motion.div
                    key={char.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="p-2 rounded bg-secondary/50 space-y-1"
                  >
                    <p className="font-medium text-foreground">{char.name}</p>
                    <p className="text-muted-foreground">Currently: {char.currentActivity}</p>
                    <p className="text-green-400">→ {char.proposedReason}</p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => setDiagnostic(null)}
              variant="outline"
              size="sm"
              className="flex-1 rounded-lg"
            >
              Cancel
            </Button>
            <Button
              onClick={handleFix}
              disabled={isRunning}
              size="sm"
              className="flex-1 rounded-lg gap-2"
            >
              {isRunning ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Fixing...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Apply Fixes
                </>
              )}
            </Button>
          </div>
        </div>
      ) : fixed ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-lg bg-green-500/10 border border-green-500/30 p-3 space-y-2"
        >
          <div className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <p className="text-sm font-semibold text-green-400">Fixed!</p>
          </div>
          <p className="text-xs text-green-400/80">
            {fixed.charactersFixed} character{fixed.charactersFixed !== 1 ? 's' : ''} moved to correct location{fixed.charactersFixed !== 1 ? 's' : ''}.
          </p>
          <Button
            onClick={() => {
              setDiagnostic(null);
              setFixed(null);
            }}
            variant="outline"
            size="sm"
            className="w-full rounded-lg mt-2"
          >
            Done
          </Button>
        </motion.div>
      ) : null}

      {error && (
        <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
    </div>
  );
}