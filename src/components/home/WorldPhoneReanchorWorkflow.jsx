/**
 * WorldPhoneReanchorWorkflow
 *
 * Manual re-anchor UI for World Phone conversations with dead participant IDs.
 *
 * Shows each unresolved conversation with:
 *   - Dead ID details (any known name from the record)
 *   - Message samples as clues
 *   - Live character selector (pick exactly 2)
 *   - Apply button → calls applyWorldPhoneManualReanchor
 *
 * Paginated: loads 20 at a time. Progress tracked locally.
 */
import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useQueryClient } from '@tanstack/react-query';
import {
  Loader2, ChevronDown, ChevronUp, CheckCircle2, AlertCircle,
  RefreshCw, MessageSquare, Users, ChevronRight, ChevronLeft
} from 'lucide-react';

const PAGE_SIZE = 20;

function CharacterPicker({ liveCharacters, selectedIds, onToggle, max = 2 }) {
  const [search, setSearch] = useState('');
  const filtered = liveCharacters.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <input
        type="text"
        placeholder="Search characters…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full px-3 py-1.5 text-xs bg-secondary border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="max-h-48 overflow-y-auto space-y-1">
        {filtered.map(c => {
          const isSelected = selectedIds.includes(c.id);
          const isDisabled = !isSelected && selectedIds.length >= max;
          return (
            <button
              key={c.id}
              onClick={() => !isDisabled && onToggle(c.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors text-xs ${
                isSelected
                  ? 'bg-primary/20 border border-primary/40 text-foreground'
                  : isDisabled
                    ? 'opacity-40 cursor-not-allowed bg-secondary/30'
                    : 'bg-secondary/50 hover:bg-secondary border border-transparent'
              }`}
            >
              {c.avatar_url ? (
                <img src={c.avatar_url} alt={c.name} className="w-5 h-5 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-[9px] font-bold text-primary">{c.name?.[0]}</span>
                </div>
              )}
              <span className="truncate font-medium">{c.name}</span>
              {c.character_type && (
                <span className="ml-auto text-muted-foreground text-[10px] flex-shrink-0">
                  {c.character_type === 'active_created_character' ? 'active' : c.character_type?.replace('npc_', '')}
                </span>
              )}
              {isSelected && <CheckCircle2 className="w-3 h-3 text-primary flex-shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConversationCard({ conv, liveCharacters, onRepaired }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const toggleChar = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleApply = async () => {
    if (selectedIds.length !== 2) return;
    setApplying(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('applyWorldPhoneManualReanchor', {
        conversation_id: conv.conversation_id,
        character_id_1: selectedIds[0],
        character_id_2: selectedIds[1],
      });
      const data = res?.data;
      if (data?.success) {
        setResult(data);
        onRepaired(conv.conversation_id, data);
      } else {
        setError(data?.error || 'Repair failed');
      }
    } catch (e) {
      setError(e.message || 'Unknown error');
    } finally {
      setApplying(false);
    }
  };

  if (result) {
    return (
      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 space-y-1">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <p className="text-xs font-semibold text-emerald-400">Re-anchored: {result.character_1?.name} ↔ {result.character_2?.name}</p>
        </div>
        <p className="text-xs text-muted-foreground">{result.messages_backfilled} messages backfilled · {result.messages_already_correct} already correct</p>
      </div>
    );
  }

  const deadNames = conv.dead_ids.map(d => d.known_name || `(unknown: ${d.id.substring(0,8)}…)`).join(', ');
  const liveNames = conv.already_live_ids.map(l => l.name).join(', ');
  const previewText = conv.last_message_preview || conv.message_samples?.[0]?.content || '(no preview)';

  return (
    <div className="bg-secondary/40 border border-border rounded-xl overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-secondary/60 transition-colors"
      >
        <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground truncate">
            {deadNames || 'Unknown participants'}
            {liveNames ? <span className="text-muted-foreground"> + {liveNames}</span> : null}
          </p>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
            {previewText}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            Last activity: {conv.last_message_date_eastern || 'unknown'} · {conv.message_count_sampled} msg sample(s)
          </p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-border p-3 space-y-3">

          {/* Dead ID details */}
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Dead participant IDs</p>
            {conv.dead_ids.map(d => (
              <div key={d.id} className="text-[11px] bg-amber-500/10 rounded px-2 py-1 text-amber-300">
                {d.known_name
                  ? <><span className="font-semibold">{d.known_name}</span> <span className="text-muted-foreground">({d.known_status})</span></>
                  : <span className="text-muted-foreground">ID {d.id.substring(0,16)}… — not found in database</span>
                }
              </div>
            ))}
          </div>

          {/* Name clues from messages */}
          {conv.name_clues_from_messages?.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider">Name clues from messages</p>
              <p className="text-[11px] text-blue-300 bg-blue-500/10 rounded px-2 py-1">
                {conv.name_clues_from_messages.join(', ')}
              </p>
            </div>
          )}

          {/* Message samples */}
          {conv.message_samples?.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-foreground uppercase tracking-wider">Message samples</p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {conv.message_samples.map((m, i) => (
                  <div key={i} className="text-[11px] bg-secondary/60 rounded px-2 py-1">
                    <span className="text-muted-foreground">{m.timestamp_eastern} · </span>
                    <span className="font-medium text-foreground">{m.character_name || m.sender_type}: </span>
                    <span className="text-muted-foreground">{m.content || '(empty)'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Character picker */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-foreground uppercase tracking-wider">
              Select 2 replacement characters ({selectedIds.length}/2)
            </p>
            <CharacterPicker
              liveCharacters={liveCharacters}
              selectedIds={selectedIds}
              onToggle={toggleChar}
              max={2}
            />
          </div>

          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">{error}</p>
          )}

          <button
            onClick={handleApply}
            disabled={selectedIds.length !== 2 || applying}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            {applying ? 'Applying re-anchor…' : 'Apply re-anchor & backfill messages'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function WorldPhoneReanchorWorkflow({ ownerEmail }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [offset, setOffset] = useState(0);
  const [repairedIds, setRepairedIds] = useState(new Set());
  const queryClient = useQueryClient();

  const loadPage = useCallback(async (pageOffset) => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('fetchWorldPhoneManualReviewQueue', {
        limit: PAGE_SIZE,
        offset: pageOffset,
      });
      const d = res?.data;
      if (d?.conversations) {
        setData(d);
        setOffset(pageOffset);
      } else {
        setError(d?.error || 'Failed to load review queue');
      }
    } catch (e) {
      setError(e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPage(0);
  }, [loadPage]);

  const handleRepaired = (conversationId) => {
    setRepairedIds(prev => new Set([...prev, conversationId]));
    queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  const visibleConvos = data?.conversations?.filter(c => !repairedIds.has(c.conversation_id)) || [];
  const totalRemaining = (data?.total_needing_manual_review || 0) - repairedIds.size;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-amber-400" />
            <p className="text-sm font-semibold text-foreground">World Phone Manual Re-anchor</p>
          </div>
          {data && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {totalRemaining} conversation{totalRemaining !== 1 ? 's' : ''} need manual review
              {repairedIds.size > 0 && <span className="text-emerald-400 ml-2">· {repairedIds.size} repaired this session</span>}
            </p>
          )}
        </div>
        <button
          onClick={() => loadPage(offset)}
          disabled={loading}
          className="p-1.5 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors text-muted-foreground"
          title="Refresh"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Loading review queue…</span>
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}

      {!loading && data && visibleConvos.length === 0 && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-center space-y-1">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 mx-auto" />
          <p className="text-xs font-semibold text-emerald-400">
            {repairedIds.size > 0
              ? `All ${repairedIds.size} conversations on this page repaired!`
              : 'No conversations needing manual review on this page.'}
          </p>
          {data.has_more && (
            <p className="text-xs text-muted-foreground">More pages available →</p>
          )}
        </div>
      )}

      {!loading && data && visibleConvos.length > 0 && (
        <>
          <div className="space-y-2">
            {visibleConvos.map(conv => (
              <ConversationCard
                key={conv.conversation_id}
                conv={conv}
                liveCharacters={data.live_characters || []}
                onRepaired={handleRepaired}
              />
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={() => loadPage(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0 || loading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-secondary text-xs text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-40"
            >
              <ChevronLeft className="w-3 h-3" /> Prev
            </button>
            <span className="text-xs text-muted-foreground">
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total_needing_manual_review)} of {data.total_needing_manual_review}
            </span>
            <button
              onClick={() => loadPage(offset + PAGE_SIZE)}
              disabled={!data.has_more || loading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-secondary text-xs text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-40"
            >
              Next <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}