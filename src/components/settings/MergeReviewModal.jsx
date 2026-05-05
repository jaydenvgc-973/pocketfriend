import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Check, CheckCircle2, Loader2, X, User, MessageSquare, BookOpen, Brain, Heart } from 'lucide-react';

/**
 * MergeReviewModal
 *
 * Full pre-merge review panel per the merge requirements:
 * - Shows both character names, IDs, types, avatars
 * - Shows which has profile data, chat history, memories, Life Journal
 * - Shows conflicting fields
 * - User picks surviving file and final avatar
 * - No auto-merge, no auto-delete, no data loss
 * - owner_email scoped — never merges across accounts
 */

function DataBadge({ label, icon: Icon, present, count }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-medium ${
      present ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-secondary text-muted-foreground border border-border'
    }`}>
      <Icon className="w-3 h-3" />
      {label}{count != null ? ` (${count})` : ''}
    </div>
  );
}

function AvatarBox({ record, chosen, onChoose, label }) {
  return (
    <button
      onClick={onChoose}
      className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${
        chosen ? 'border-primary bg-primary/10' : 'border-border bg-secondary/30 hover:border-primary/40'
      }`}
    >
      {record.avatar_url ? (
        <img src={record.avatar_url} alt={record.name} className="w-16 h-16 rounded-full object-cover" />
      ) : (
        <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
          <span className="text-xl font-bold text-muted-foreground">{record.name?.[0]?.toUpperCase()}</span>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">{label}</p>
      {chosen && <CheckCircle2 className="w-4 h-4 text-primary" />}
    </button>
  );
}

export default function MergeReviewModal({ isOpen, onClose, dupeGroup, ownerEmail, onMergeComplete }) {
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [survivorId, setSurvivorId] = useState(null);
  const [avatarCharId, setAvatarCharId] = useState(null);
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || !dupeGroup) return;
    loadPreview();
  }, [isOpen, dupeGroup]);

  const loadPreview = async () => {
    setLoading(true);
    setError(null);
    setPreviewData(null);
    setSurvivorId(null);
    setAvatarCharId(null);
    setMergeResult(null);
    try {
      const res = await base44.functions.invoke('previewCharacterMerge', {
        characterIds: dupeGroup.records.map(r => r.id),
        ownerEmail,
      });
      const d = res?.data;
      if (d?.error) throw new Error(d.error);
      setPreviewData(d);
      // Only pre-select survivor from VERIFIED records
      setSurvivorId(d.recommended_primary_id || d.characters?.[0]?.id || null);
      // Pre-select avatar: whoever has one, or recommended primary
      const avatarHolder = d.characters?.find(c => c.avatar_url);
      setAvatarCharId(avatarHolder?.id || d.recommended_primary_id || d.characters?.[0]?.id || null);
    } catch (err) {
      setError(err.message || 'Failed to load merge preview');
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async () => {
    if (!survivorId || !avatarCharId) return;
    if (!window.confirm(
      `This will merge ${dupeGroup.records.length} records into one. All chat history, memories, and data will be preserved under the surviving record. The duplicate will be deleted only after preservation is confirmed. Continue?`
    )) return;

    setMerging(true);
    setError(null);
    try {
      const chosenAvatarRecord = previewData?.characters?.find(c => c.id === avatarCharId);
      const res = await base44.functions.invoke('mergeCharacters', {
        characterIds: dupeGroup.records.map(r => r.id),
        primaryCharacterId: survivorId,
        masterAvatarUrl: chosenAvatarRecord?.avatar_url || null,
        ownerEmail,
      });
      const d = res?.data;
      if (d?.error) throw new Error(d.error);
      setMergeResult(d);
      onMergeComplete?.();
    } catch (err) {
      setError(err.message || 'Merge failed');
    } finally {
      setMerging(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={!merging ? onClose : undefined}>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl bg-card border border-border rounded-t-2xl max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 bg-card/95 backdrop-blur-sm border-b border-border p-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">Merge Review</h3>
              <p className="text-xs text-muted-foreground">Review before merging — no data will be lost</p>
            </div>
          </div>
          {!merging && (
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="p-4 space-y-5">
          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center py-10 gap-3">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Analyzing records...</p>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 space-y-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button size="sm" variant="outline" onClick={loadPreview}>Retry</Button>
            </div>
          )}

          {/* Merge complete */}
          {mergeResult && (
            <div className="space-y-4">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <p className="text-sm font-semibold text-emerald-400">Merge Complete</p>
                </div>
                <p className="text-xs text-muted-foreground">{mergeResult.message}</p>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>✓ Surviving character: <span className="text-foreground font-medium">{mergeResult.primary_character_name}</span></p>
                <p>✓ Duplicate deleted after verification</p>
                <p>✓ All chat history, memories, and data preserved</p>
              </div>
              <Button onClick={onClose} className="w-full rounded-xl">Done</Button>
            </div>
          )}

          {/* Preview panel */}
          {previewData && !mergeResult && !loading && (
            <>
              {/* Merge blocked — unsafe/legacy records detected */}
              {previewData.merge_blocked && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3 space-y-2">
                  <p className="text-xs text-destructive font-medium">⚠ Merge blocked — {previewData.merge_blocked_reason}</p>
                  {previewData.unsafe_records?.map(r => (
                    <div key={r.id} className="bg-secondary/50 rounded-lg px-3 py-2 space-y-0.5">
                      <p className="text-xs font-medium text-foreground">
                        {r.name || '(unnamed)'} — <span className={
                          r.ownership_state === 'LEGACY_MISSING_OWNER' ? 'text-amber-400' :
                          r.ownership_state === 'CROSS_ACCOUNT_BLOCKED' ? 'text-destructive' :
                          'text-muted-foreground'
                        }>{r.ownership_state}</span>
                      </p>
                      <p className="text-[10px] text-muted-foreground font-mono">ID: {r.id}</p>
                      <p className="text-[10px] text-amber-400">{r.repair_message}</p>
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Run <strong>Backfill Character Owner Email</strong> from Settings → Troubleshoot to repair missing owner_email fields, then retry.
                  </p>
                </div>
              )}

              {/* Legacy ownership warning (old field) */}
              {previewData.ownership_warning && !previewData.merge_blocked && (
                <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
                  <p className="text-xs text-destructive font-medium">⚠ {previewData.ownership_warning}</p>
                  <p className="text-xs text-muted-foreground mt-1">Cannot merge characters from different accounts. Owner email must match.</p>
                </div>
              )}

              {/* Character comparison cards */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Step 1 — Choose the surviving character file</p>
                <div className="grid grid-cols-1 gap-3">
                  {previewData.characters?.map(char => {
                    const isSurvivor = survivorId === char.id;
                    return (
                      <button
                        key={char.id}
                        onClick={() => setSurvivorId(char.id)}
                        className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                          isSurvivor ? 'border-primary bg-primary/10' : 'border-border bg-secondary/30 hover:border-primary/40'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          {char.avatar_url ? (
                            <img src={char.avatar_url} alt={char.name} className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                              <span className="text-base font-bold text-muted-foreground">{char.name?.[0]?.toUpperCase()}</span>
                            </div>
                          )}

                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-foreground">{char.name}</p>
                              {char.is_recommended && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium">Recommended</span>
                              )}
                              {isSurvivor && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium flex items-center gap-1">
                                  <Check className="w-2.5 h-2.5" /> Surviving file
                                </span>
                              )}
                            </div>

                            {/* IDs and type */}
                            <div className="text-[10px] text-muted-foreground space-y-0.5">
                              <p>ID: <span className="font-mono text-foreground/70">{char.id}</span></p>
                              <p>Type: <span className="text-foreground/70">{char.character_type || 'unknown'}</span></p>
                              <p>Owner: <span className="text-foreground/70">{char.owner_email || '⚠ missing'}</span></p>
                            </div>

                            {/* Data presence badges */}
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              <DataBadge label="Profile" icon={User} present={char.has_profile} />
                              <DataBadge label="Chat" icon={MessageSquare} present={char.has_conversations} count={char.conversation_count} />
                              <DataBadge label="Memories" icon={Brain} present={char.has_memories} count={char.memory_count} />
                              <DataBadge label="Life Journal" icon={BookOpen} present={char.has_life_events} count={char.life_event_count} />
                              <DataBadge label="Relationships" icon={Heart} present={char.has_relationships} />
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Avatar selection */}
              {previewData.characters?.some(c => c.avatar_url) && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Step 2 — Choose the final avatar</p>
                  <div className="flex gap-3 justify-start flex-wrap">
                    {previewData.characters?.map(char => (
                      <AvatarBox
                        key={char.id}
                        record={char}
                        chosen={avatarCharId === char.id}
                        onChoose={() => setAvatarCharId(char.id)}
                        label={char.name}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Conflicting fields */}
              {previewData.conflicts?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">Conflicting fields — surviving file wins</p>
                  <div className="space-y-1.5">
                    {previewData.conflicts.map((c, i) => (
                      <div key={i} className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5 text-[10px]">
                        <p className="font-medium text-foreground">{c.field}</p>
                        {previewData.characters?.map(char => (
                          <p key={char.id} className={`text-muted-foreground mt-0.5 ${survivorId === char.id ? 'text-emerald-400' : ''}`}>
                            {char.name}: <span className="font-mono">{String(c.values?.[char.id] ?? '—').substring(0, 80)}</span>
                            {survivorId === char.id ? ' ← wins' : ''}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* What will be preserved */}
              <div className="bg-secondary/50 border border-border rounded-xl p-3 space-y-1">
                <p className="text-xs font-semibold text-foreground">What will be preserved</p>
                <div className="text-[10px] text-muted-foreground space-y-0.5">
                  <p>✓ All chat history and messages (relinked to surviving ID)</p>
                  <p>✓ All memories and Life Journal entries</p>
                  <p>✓ All relationships and family links</p>
                  <p>✓ Needs, schedule, emotions, profile data</p>
                  <p>✓ Avatar (your choice above)</p>
                  <p>✓ Duplicate deleted only after relinking is complete</p>
                </div>
              </div>

              {/* What merge will do */}
              <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-3 space-y-1">
                <p className="text-xs font-semibold text-destructive">What merge will remove</p>
                <div className="text-[10px] text-muted-foreground space-y-0.5">
                  {previewData.characters?.filter(c => c.id !== survivorId).map(c => (
                    <p key={c.id}>✗ The duplicate record for <span className="text-foreground font-medium">{c.name}</span> (ID: {c.id.substring(0, 8)}…) will be deleted after data is moved</p>
                  ))}
                </div>
              </div>

              {/* Action */}
              <div className="flex gap-2 pt-1 pb-2">
                <Button variant="outline" onClick={onClose} className="flex-1 rounded-xl" disabled={merging}>
                  Cancel
                </Button>
                <Button
                  onClick={handleMerge}
                  disabled={!survivorId || merging || !!previewData.ownership_warning || !!previewData.merge_blocked}
                  className="flex-1 rounded-xl bg-primary hover:bg-primary/90"
                >
                  {merging ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> Merging...</>
                  ) : (
                    'Confirm Merge'
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}