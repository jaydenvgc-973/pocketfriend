/**
 * WorldPhoneReanchorPanel
 *
 * Manual re-anchor UI for World Phone conversations whose participant IDs
 * are completely dead (no auto-resolution possible).
 *
 * Workflow per conversation:
 *   1. Shows dead conversation card with message samples and name clues
 *   2. User selects two live characters from a searchable picker
 *   3. User confirms → calls manualReanchorWorldPhoneConversation
 *   4. Shows result (repaired / collision warning / error)
 *   5. Moves to next unresolved conversation
 *
 * State management:
 *   - Paginated: loads 20 conversations at a time
 *   - Per-conversation repair state stored in repairedIds Set
 *   - Skipped conversations tracked in skippedIds Set
 */
import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, ChevronLeft, ChevronRight, CheckCircle2,
  AlertCircle, SkipForward, Search, X, MessageSquare,
  Users, RefreshCw, ArrowRight
} from 'lucide-react';

// ── Character Picker ──────────────────────────────────────────────────────────
function CharacterPicker({ label, characters, selectedId, onSelect, disabledId }) {
  const [query, setQuery] = useState('');

  const filtered = characters.filter(c => {
    if (disabledId && c.id === disabledId) return false;
    if (!query) return true;
    return c.name?.toLowerCase().includes(query.toLowerCase()) ||
           c.occupation?.toLowerCase().includes(query.toLowerCase());
  });

  const selected = characters.find(c => c.id === selectedId);

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      {selected ? (
        <div className="flex items-center gap-2 p-2 bg-primary/10 border border-primary/30 rounded-lg">
          {selected.avatar_url ? (
            <img src={selected.avatar_url} alt={selected.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-primary">{selected.name?.[0]?.toUpperCase()}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{selected.name}</p>
            {selected.occupation && <p className="text-xs text-muted-foreground truncate">{selected.occupation}</p>}
          </div>
          <button onClick={() => onSelect(null)} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search characters…"
              className="w-full pl-8 pr-3 py-2 text-sm bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {filtered.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground text-center">No characters match</p>
            ) : filtered.map(c => (
              <button
                key={c.id}
                onClick={() => { onSelect(c.id); setQuery(''); }}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary transition-colors text-left"
              >
                {c.avatar_url ? (
                  <img src={c.avatar_url} alt={c.name} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-primary">{c.name?.[0]?.toUpperCase()}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                  {c.occupation && <p className="text-xs text-muted-foreground truncate">{c.occupation}</p>}
                </div>
                <span className="text-xs text-muted-foreground flex-shrink-0">{c.character_type?.replace('_', ' ')}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Conversation Card ─────────────────────────────────────────────────────────
function ConversationCard({ convo, liveChars, onRepaired, onSkipped }) {
  const [participantA, setParticipantA] = useState(null);
  const [participantB, setParticipantB] = useState(null);
  const [repairing, setRepairing] = useState(false);
  const [result, setResult] = useState(null); // { status, error, ... }

  // Pre-fill from name-based suggestions
  useEffect(() => {
    const suggestions = (convo.name_based_suggestions || []).filter(s => s.matched_character);
    if (suggestions[0] && !participantA) setParticipantA(suggestions[0].matched_character.id);
    if (suggestions[1] && !participantB) setParticipantB(suggestions[1].matched_character.id);
  }, [convo.conversation_id]);

  const handleRepair = async () => {
    if (!participantA || !participantB) return;
    setRepairing(true);
    setResult(null);
    try {
      const res = await base44.functions.invoke('manualReanchorWorldPhoneConversation', {
        conversation_id: convo.conversation_id,
        participant_a_id: participantA,
        participant_b_id: participantB,
        dryRun: false,
      });
      const data = res?.data;
      setResult(data);
      if (data?.status === 'repaired') {
        setTimeout(() => onRepaired(convo.conversation_id, data), 1500);
      }
    } catch (e) {
      setResult({ status: 'failed', error: e.message });
    } finally {
      setRepairing(false);
    }
  };

  const canRepair = participantA && participantB && participantA !== participantB;
  const charAName = liveChars.find(c => c.id === participantA)?.name;
  const charBName = liveChars.find(c => c.id === participantB)?.name;

  const lastDate = convo.last_message_date
    ? new Date(convo.last_message_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div className="bg-secondary/50 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground font-mono truncate">
            {convo.conversation_id?.substring(0, 16)}…
          </p>
          <div className="flex items-center gap-3 mt-1">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MessageSquare className="w-3 h-3" />
              {convo.message_count} message{convo.message_count !== 1 ? 's' : ''}
            </span>
            {lastDate && (
              <span className="text-xs text-muted-foreground">Last: {lastDate}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {(convo.dead_ids || []).map(id => (
            <span key={id} className="text-[10px] font-mono bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">
              dead:{id.substring(0, 8)}
            </span>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Name clues */}
        {convo.mentioned_names?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-amber-400 mb-1.5">
              Names found in messages:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {convo.mentioned_names.map(name => {
                const sugg = convo.name_based_suggestions?.find(s => s.name === name);
                return (
                  <span
                    key={name}
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      sugg?.matched_character
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : 'bg-secondary text-muted-foreground'
                    }`}
                  >
                    {name}
                    {sugg?.matched_character && ' ✓'}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Message samples */}
        {convo.sample_messages?.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Message samples:</p>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {convo.sample_messages.slice(0, 6).map(m => (
                <div key={m.id} className="flex items-start gap-2 text-xs">
                  <span className={`flex-shrink-0 font-medium ${m.sender_type === 'user' ? 'text-blue-400' : 'text-primary'}`}>
                    {m.character_name || (m.sender_type === 'user' ? 'User' : '?')}:
                  </span>
                  <span className="text-muted-foreground line-clamp-2">{m.content || '[image/media]'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Character pickers */}
        {!result && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <CharacterPicker
                label="Participant A"
                characters={liveChars}
                selectedId={participantA}
                onSelect={setParticipantA}
                disabledId={participantB}
              />
              <CharacterPicker
                label="Participant B"
                characters={liveChars}
                selectedId={participantB}
                onSelect={setParticipantB}
                disabledId={participantA}
              />
            </div>

            {canRepair && (
              <div className="flex items-center gap-2 p-2 bg-secondary/50 rounded-lg text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{charAName}</span>
                <ArrowRight className="w-3 h-3" />
                <span className="font-medium text-foreground">{charBName}</span>
                <span className="ml-auto">Will backfill {convo.message_count} messages</span>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleRepair}
                disabled={!canRepair || repairing}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {repairing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {repairing ? 'Re-anchoring…' : 'Re-anchor Conversation'}
              </button>
              <button
                onClick={() => onSkipped(convo.conversation_id)}
                className="px-3 py-2.5 rounded-lg bg-secondary text-muted-foreground text-sm hover:text-foreground hover:bg-secondary/80 transition-colors"
                title="Skip for now"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>
          </>
        )}

        {/* Result display */}
        {result && (
          <div className={`rounded-lg p-3 space-y-1.5 ${
            result.status === 'repaired'
              ? 'bg-emerald-500/10 border border-emerald-500/30'
              : result.key_collision
              ? 'bg-amber-500/10 border border-amber-500/30'
              : 'bg-destructive/10 border border-destructive/30'
          }`}>
            {result.status === 'repaired' && (
              <>
                <p className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Re-anchored successfully
                </p>
                <p className="text-xs text-muted-foreground">
                  {result.messages_backfilled} of {result.messages_to_backfill} messages backfilled
                </p>
                {result.key_collision && (
                  <p className="text-xs text-amber-400">
                    ⚠ Key collision detected: another conversation already uses this key. Consider running World Contact thread repair next.
                  </p>
                )}
              </>
            )}
            {result.status === 'failed' && (
              <>
                <p className="text-sm font-semibold text-destructive flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Repair failed
                </p>
                <p className="text-xs text-muted-foreground">{result.error}</p>
                <button
                  onClick={() => setResult(null)}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Try again
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function WorldPhoneReanchorPanel({ onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null); // { total_count, conversations, live_characters }
  const [offset, setOffset] = useState(0);
  const [repairedIds, setRepairedIds] = useState(new Set());
  const [skippedIds, setSkippedIds] = useState(new Set());
  const LIMIT = 10;

  const load = useCallback(async (newOffset = 0) => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('getWorldPhoneManualReviewQueue', {
        offset: newOffset,
        limit: LIMIT,
      });
      setData(res?.data);
      setOffset(newOffset);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(0); }, [load]);

  const handleRepaired = (convoId) => {
    setRepairedIds(prev => new Set([...prev, convoId]));
  };

  const handleSkipped = (convoId) => {
    setSkippedIds(prev => new Set([...prev, convoId]));
  };

  const visibleConvos = (data?.conversations || []).filter(
    c => !repairedIds.has(c.conversation_id) && !skippedIds.has(c.conversation_id)
  );

  const totalRemaining = (data?.total_count || 0) - repairedIds.size;
  const repairedThisSession = repairedIds.size;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-foreground">World Phone Manual Re-Anchor</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {loading ? 'Loading…' : `${totalRemaining} conversations need manual re-anchoring`}
            {repairedThisSession > 0 && ` · ${repairedThisSession} repaired this session`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(offset)}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {onClose && (
            <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {data && (
        <div className="px-4 py-2 flex-shrink-0">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>Repair progress</span>
            <span>{repairedThisSession} / {data.total_count}</span>
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${data.total_count > 0 ? (repairedThisSession / data.total_count) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Loading unresolved conversations…</p>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
            <p className="text-sm text-destructive">{error}</p>
            <button onClick={() => load(offset)} className="mt-2 text-xs text-destructive/70 underline">Retry</button>
          </div>
        )}

        {!loading && !error && data?.total_count === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            <p className="text-sm font-semibold text-foreground">All World Phone anchors resolved!</p>
            <p className="text-xs text-muted-foreground max-w-xs">
              No conversations require manual re-anchoring. World Phone message proof is complete.
            </p>
          </div>
        )}

        {!loading && !error && visibleConvos.length === 0 && data?.total_count > 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <Users className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              All conversations on this page have been handled.
            </p>
            {data?.has_more && (
              <button
                onClick={() => load(offset + LIMIT)}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
              >
                Load next batch
              </button>
            )}
          </div>
        )}

        <AnimatePresence>
          {!loading && !error && visibleConvos.map(convo => (
            <ConversationCard
              key={convo.conversation_id}
              convo={convo}
              liveChars={data?.live_characters || []}
              onRepaired={handleRepaired}
              onSkipped={handleSkipped}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Pagination */}
      {!loading && data && data.total_count > LIMIT && (
        <div className="flex items-center justify-between p-4 border-t border-border flex-shrink-0">
          <button
            onClick={() => load(Math.max(0, offset - LIMIT))}
            disabled={offset === 0}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>
          <span className="text-xs text-muted-foreground">
            {offset + 1}–{Math.min(offset + LIMIT, data.total_count)} of {data.total_count}
          </span>
          <button
            onClick={() => load(offset + LIMIT)}
            disabled={!data.has_more}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}