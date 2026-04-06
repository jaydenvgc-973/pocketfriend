import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { AlertCircle, Zap, CheckCircle, Loader, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

export default function GenericLocationFixer() {
  const [isRunning, setIsRunning] = useState(false);
  const [diagnostic, setDiagnostic] = useState(null);
  const [fixed, setFixed] = useState(null);
  const [error, setError] = useState(null);
  const [showComprehensive, setShowComprehensive] = useState(false);

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

  const handleComprehensiveDiagnostic = async () => {
    setIsRunning(true);
    setError(null);
    setDiagnostic(null);

    try {
      const res = await base44.functions.invoke('diagnosticSyncAll', {});
      if (res.data.totalIssues === 0) {
        setFixed({ success: true, message: '✓ All systems synced — no violations detected' });
      } else {
        setDiagnostic({
          totalAffected: res.data.totalIssues,
          issues: res.data.issues,
          requiresAction: res.data.requiresAction
        });
      }
    } catch (err) {
      setError(err.message || 'Comprehensive diagnostic failed');
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

  const handleAutoFixAll = async () => {
    if (!window.confirm('Auto-fix all system violations?\n\n• Move workers to workplace\n• Clear generic labels\n• Return from closed venues')) return;
    
    setIsRunning(true);
    setError(null);

    try {
      const res = await base44.functions.invoke('autoFixSystemViolations', {});
      setFixed({
        success: true,
        message: res.data.message,
        log: res.data.fixLog
      });
    } catch (err) {
      setError(err.message || 'Auto-fix failed');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Generic Location Cleanup */}
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-4">
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
                  {diagnostic.characters?.map((char, i) => (
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

      {/* Comprehensive System Diagnostic */}
      <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 space-y-4">
        <div className="flex items-start gap-3">
          <Search className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-blue-400">Full System Diagnostic</h4>
            <p className="text-xs text-blue-400/80 mt-1">
              Check work schedule adherence, location sync, closed venues, and system integrity.
            </p>
          </div>
        </div>

        {!showComprehensive ? (
          <Button
            onClick={handleComprehensiveDiagnostic}
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
                <Search className="w-4 h-4" />
                Run Full Diagnostic
              </>
            )}
          </Button>
        ) : diagnostic?.issues ? (
          <div className="rounded-lg bg-card p-3 space-y-2 max-h-48 overflow-y-auto text-xs">
            {diagnostic.issues.workScheduleViolations?.length > 0 && (
              <div className="space-y-1">
                <p className="font-semibold text-red-400">Work Schedule Violations ({diagnostic.issues.workScheduleViolations.length}):</p>
                {diagnostic.issues.workScheduleViolations.map((issue, i) => (
                  <p key={i} className="text-muted-foreground ml-2">• {issue.message}</p>
                ))}
              </div>
            )}
            {diagnostic.issues.genericLocationLabels?.length > 0 && (
              <div className="space-y-1">
                <p className="font-semibold text-amber-400">Generic Labels ({diagnostic.issues.genericLocationLabels.length}):</p>
                {diagnostic.issues.genericLocationLabels.map((issue, i) => (
                  <p key={i} className="text-muted-foreground ml-2">• {issue.message}</p>
                ))}
              </div>
            )}
            {diagnostic.issues.closedVenueVisits?.length > 0 && (
              <div className="space-y-1">
                <p className="font-semibold text-amber-400">Closed Venues ({diagnostic.issues.closedVenueVisits.length}):</p>
                {diagnostic.issues.closedVenueVisits.map((issue, i) => (
                  <p key={i} className="text-muted-foreground ml-2">• {issue.message}</p>
                ))}
              </div>
            )}
            {!diagnostic.issues.workScheduleViolations?.length && !diagnostic.issues.genericLocationLabels?.length && !diagnostic.issues.closedVenueVisits?.length && (
              <p className="text-green-400">✓ All systems synced — no violations</p>
            )}
          </div>
        ) : null}

        {showComprehensive && diagnostic?.issues && (
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setShowComprehensive(false);
                setDiagnostic(null);
              }}
              variant="outline"
              size="sm"
              className="flex-1 rounded-lg"
            >
              Close
            </Button>
            <Button
              onClick={handleAutoFixAll}
              disabled={isRunning}
              size="sm"
              className="flex-1 rounded-lg gap-2 bg-green-600 hover:bg-green-700"
            >
              {isRunning ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Fixing...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Auto-Fix All
                </>
              )}
            </Button>
          </div>
        )}

        {error && (
          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {fixed?.success && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-lg bg-green-500/10 border border-green-500/30 p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <p className="text-sm font-semibold text-green-400">{fixed.message}</p>
            </div>
            {fixed.log && (
              <div className="text-xs text-green-400/80 space-y-1">
                {fixed.log.map((log, i) => (
                  <p key={i}>{log}</p>
                ))}
              </div>
            )}
            <Button
              onClick={() => {
                setShowComprehensive(false);
                setFixed(null);
                setDiagnostic(null);
              }}
              variant="outline"
              size="sm"
              className="w-full rounded-lg mt-2"
            >
              Done
            </Button>
          </motion.div>
        )}
      </div>
    </div>
  );
}