import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

export default function AdminVerification() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [dryRun, setDryRun] = useState(true);
  const [runTravelTest, setRunTravelTest] = useState(false);
  const [dryRunResult, setDryRunResult] = useState(null);
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const [travelConfirmed, setTravelConfirmed] = useState(false);

  // Auto-run dry run on mount to get character list
  React.useEffect(() => {
    if (!dryRunResult) {
      handleRunVerification(true);
    }
  }, []);

  const handleRunVerification = async (skipCharacterSelection = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('runAppCompletionVerification', {
        dryRun: skipCharacterSelection ? true : dryRun,
        runTravelPromiseTest: skipCharacterSelection ? false : runTravelTest,
        testCharacterId: skipCharacterSelection ? undefined : (selectedCharacterId || undefined),
        testCharacterConfirmed: skipCharacterSelection ? false : travelConfirmed,
      });
      const resultData = res.data;
      setResult(resultData);
      if (skipCharacterSelection) {
        setDryRunResult(resultData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">App Completion Verification</h1>
        <p className="text-muted-foreground mb-4">Runtime proof harness — collects real records and runs checks.</p>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-8 text-sm text-blue-400">
          <p className="font-semibold mb-2">Test Sequence:</p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>Run dry run below to check app state</li>
            <li>If travel test blocked, use app UI to set your current location</li>
            <li>Return here and enable travel test with dryRun=false</li>
            <li>Verify before/after character records and ScheduledEvent are created</li>
          </ol>
        </div>

        {/* Controls */}
        <div className="bg-card rounded-lg p-6 mb-6 border border-border space-y-4">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">Dry run (read-only, no mutations)</span>
            </label>
          </div>

          <div className="border-t border-border pt-4">
            <label className="flex items-center gap-2 cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={runTravelTest}
                onChange={(e) => setRunTravelTest(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm font-medium">Run travel promise test</span>
            </label>

            {runTravelTest && (
              <div className="ml-6 space-y-3 bg-secondary/30 p-3 rounded-lg">
                {result?.travel_test_blocked_reason === 'user_location_unknown' ? (
                  <div className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive">
                    <p className="font-semibold mb-1">⛔ Test blocked: User location unknown</p>
                    <p className="text-destructive/80">Use the app's Travel page to set your current location, then return here.</p>
                  </div>
                ) : (
                  <>
                    <label className="text-xs text-muted-foreground">Select character:</label>
                    <select
                      value={selectedCharacterId}
                      onChange={(e) => setSelectedCharacterId(e.target.value)}
                      className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm"
                    >
                      <option value="">{dryRunResult?.checks?.test_character_name || 'Auto-select'}</option>
                      {dryRunResult?.character_roster_sample ? (
                        dryRunResult.character_roster_sample.map(ch => (
                          <option key={ch.id} value={ch.id}>
                            {ch.name} {ch.is_active_character ? '(active)' : ''}
                          </option>
                        ))
                      ) : null}
                    </select>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={travelConfirmed}
                        onChange={(e) => setTravelConfirmed(e.target.checked)}
                        disabled={dryRun}
                        className="w-4 h-4"
                      />
                      <span className="text-xs text-muted-foreground">
                        Confirm: {dryRun ? '(disabled in dry run)' : 'I confirm to mutate travel state'}
                      </span>
                    </label>
                  </>
                )}
              </div>
            )}
          </div>

          <Button onClick={handleRunVerification} disabled={isLoading} className="w-full">
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running verification...
              </>
            ) : (
              'Run Verification'
            )}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-destructive/10 border border-destructive rounded-lg p-4 mb-6">
            <div className="flex gap-2 mb-2">
              <XCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <span className="font-semibold text-destructive">Error</span>
            </div>
            <p className="text-sm text-destructive/80">{error}</p>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-6">
            {/* Full JSON Report */}
            <div className="bg-card rounded-lg p-6 border border-border">
              <h3 className="font-semibold mb-3">Full JSON Report</h3>
              <pre className="text-[10px] bg-background p-4 rounded overflow-auto max-h-96 text-muted-foreground">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
            {/* Header */}
            <div className="bg-card rounded-lg p-6 border border-border">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold">Verification Report</h2>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  result.proof_level === 'mutating_runtime_test'
                    ? 'bg-primary/20 text-primary'
                    : 'bg-secondary text-secondary-foreground'
                }`}>
                  {result.proof_level}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{result.timestamp}</p>
            </div>

            {/* User */}
            <div className="bg-card rounded-lg p-6 border border-border">
              <h3 className="font-semibold mb-3">User</h3>
              <div className="text-sm space-y-1">
                <p><span className="text-muted-foreground">Email:</span> {result.user.email}</p>
                <p><span className="text-muted-foreground">Name:</span> {result.user.full_name}</p>
              </div>
            </div>

            {/* Checks */}
            <div className="bg-card rounded-lg p-6 border border-border">
              <h3 className="font-semibold mb-4">Runtime Checks</h3>
              <div className="space-y-2">
                {Object.entries(result.checks).map(([key, value]) => {
                  if (key === 'unsupported_images') return null;
                  const isPass = typeof value === 'boolean' ? value : (typeof value === 'number' ? value > 0 : !!value);
                  return (
                    <div key={key} className="flex items-center justify-between text-sm p-2 rounded-lg hover:bg-secondary/50">
                      <span className="text-muted-foreground">{key}</span>
                      <div className="flex items-center gap-2">
                        {typeof value === 'object' ? (
                          <code className="text-xs bg-background px-2 py-1 rounded">{JSON.stringify(value)}</code>
                        ) : (
                          <span className="font-mono">{String(value)}</span>
                        )}
                        {typeof value === 'boolean' && (
                          isPass ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-destructive" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Unsupported Images */}
            {result.checks.unsupported_images.total_count > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-6">
                <div className="flex gap-2 mb-3">
                  <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <h3 className="font-semibold text-amber-400">Unsupported Image Formats Detected</h3>
                </div>
                <div className="text-sm space-y-2 text-amber-400/80">
                  <p>Count: {result.checks.unsupported_images.total_count}</p>
                  <p>Affected locations: {result.checks.unsupported_images.affected_locations.join(', ')}</p>
                  {result.checks.unsupported_images.details.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {result.checks.unsupported_images.details.map((detail, i) => (
                        <p key={i} className="text-[10px]">
                          {detail.location} / {detail.zone}: {detail.unsupported_count} / {detail.total_in_zone}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Warnings */}
            {result.warnings.length > 0 && (
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Warnings ({result.warnings.length})
                </h3>
                <ul className="text-sm space-y-2">
                  {result.warnings.map((w, i) => (
                    <li key={i} className="flex gap-2 text-muted-foreground">
                      <span className="text-amber-500 font-bold">•</span> {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Travel Test Result */}
            {result.travel_promise_test && (
              <div className={`rounded-lg p-6 border ${
                result.travel_promise_test.success || result.travel_promise_test.dry_run
                  ? 'bg-green-500/10 border-green-500/30'
                  : 'bg-destructive/10 border-destructive/30'
              }`}>
                <h3 className="font-semibold mb-4 flex items-center gap-2">
                  {result.travel_promise_test.success ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : result.travel_promise_test.dry_run ? (
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-destructive" />
                  )}
                  Travel Promise Test
                </h3>

                {result.travel_promise_test.dry_run && (
                  <p className="text-sm text-amber-400/80 mb-2">Dry run — would create the following:</p>
                )}

                {result.travel_promise_test.before_record && (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Before</p>
                      <pre className="text-[10px] bg-background p-2 rounded overflow-auto max-h-32">
                        {JSON.stringify(result.travel_promise_test.before_record, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">After</p>
                      <pre className="text-[10px] bg-background p-2 rounded overflow-auto max-h-32">
                        {JSON.stringify(result.travel_promise_test.after_record, null, 2)}
                      </pre>
                    </div>
                    {result.travel_promise_test.scheduled_event_payload && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-1">Scheduled Event Created</p>
                        <pre className="text-[10px] bg-background p-2 rounded overflow-auto max-h-32">
                          {JSON.stringify(result.travel_promise_test.scheduled_event_payload, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                {result.travel_promise_test.error && (
                  <p className="text-sm text-destructive">{result.travel_promise_test.error}</p>
                )}

                {result.travel_promise_test.message && (
                  <p className="text-sm text-muted-foreground">{result.travel_promise_test.message}</p>
                )}

                {result.travel_promise_test.next_required_action && (
                  <p className="text-sm text-foreground mt-3 font-semibold">
                    ➜ {result.travel_promise_test.next_required_action}
                  </p>
                )}
              </div>
            )}

            {/* Next Steps */}
            {result.next_steps.length > 0 && (
              <div className="bg-card rounded-lg p-6 border border-border">
                <h3 className="font-semibold mb-3">Next Steps</h3>
                <ol className="text-sm space-y-2">
                  {result.next_steps.map((step, i) => (
                    <li key={i} className="flex gap-2 text-muted-foreground">
                      <span className="font-bold text-primary flex-shrink-0">{i + 1}.</span> {step}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}