import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import { X, Loader2, Globe, CheckCircle2, AlertCircle } from 'lucide-react';

export default function PublicImpactModal({ event, onClose }) {
  const queryClient = useQueryClient();
  const [userContext, setUserContext] = useState('');
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  const handleProcess = async () => {
    setProcessing(true);
    setError(null);
    setResults(null);
    try {
      const res = await base44.functions.invoke('processPublicImpact', {
        story_event_id: event.id,
        owner_email: event.owner_email,
        user_context: userContext || null,
      });
      if (res?.data?.success) {
        setResults(res.data.results || []);
        // Invalidate public profile queries so they refresh
        for (const r of res.data.results || []) {
          queryClient.invalidateQueries({ queryKey: ['publicProfile', r.character_id] });
        }
      } else {
        setError(res?.data?.error || 'Processing failed');
      }
    } catch (err) {
      const detail = err?.response?.data?.error || err?.message || 'Processing failed';
      setError(detail);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center pb-24 pt-4 px-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Affects Public Relations</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-secondary rounded-lg">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {!results && !processing && (
            <>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Designate this completed event as part of the public-facing history for its participants. The system will analyze what actually happened and determine proportional public consequences.
              </p>
              <p className="text-[10px] text-muted-foreground/70">
                This does NOT make characters famous. It records the event as public-facing evidence. Only sufficient relevant public exposure produces broader recognition.
              </p>
              <div>
                <p className="text-xs font-medium text-foreground mb-1.5">Optional context</p>
                <textarea
                  value={userContext}
                  onChange={e => setUserContext(e.target.value)}
                  placeholder="e.g., This was a major advertising campaign with national distribution..."
                  className="w-full h-20 px-3 py-2 rounded-xl bg-secondary border border-border text-foreground text-xs placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                />
              </div>
              {error && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> {error}
                </p>
              )}
            </>
          )}

          {processing && (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">Analyzing public impact…</p>
            </div>
          )}

          {results && !processing && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <p className="text-xs font-medium">Public impact processed</p>
              </div>
              {results.length === 0 ? (
                <p className="text-xs text-muted-foreground">All participants already had public impact recorded for this event.</p>
              ) : (
                <div className="space-y-1.5">
                  {results.map((r, i) => (
                    <div key={i} className="p-2 rounded-lg bg-secondary/40 border border-border">
                      <p className="text-xs font-medium text-foreground">{r.character_name}</p>
                      <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">{r.impact_summary}</p>
                      {(r.attention_delta > 0 || r.respect_delta > 0 || r.recognition_level_change) && (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {r.attention_delta > 0 && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                              +{r.attention_delta} attention
                            </span>
                          )}
                          {r.respect_delta > 0 && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              +{r.respect_delta} respect
                            </span>
                          )}
                          {r.recognition_level_change && r.recognition_level_change !== 'null' && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                              → {r.recognition_level_change}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-border p-4 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm">
            {results ? 'Done' : 'Cancel'}
          </button>
          {!results && (
            <button
              onClick={handleProcess}
              disabled={processing}
              className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {processing ? 'Processing…' : 'Process Impact'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}