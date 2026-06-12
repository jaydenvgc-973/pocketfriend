import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { Star, MapPin, Users, Heart, Image, ChevronDown, Loader2, Send, RefreshCw, X, Check, Shield, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import { format } from 'date-fns';

const REGEN_REASONS = [
  { id: 'flawed', label: 'Image is flawed', icon: '⚠️' },
  { id: 'does_not_look_like_them', label: "Doesn't look like them", icon: '👤' },
  { id: 'location_incorrect', label: 'Location is incorrect', icon: '📍' },
];

export default function StoryEventViewer({ eventId }) {
  const [event, setEvent] = useState(null);
  const [memories, setMemories] = useState([]);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  // Send modal state
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendImage, setSendImage] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState(new Set());
  const [sending, setSending] = useState(false);
  const [sendSent, setSendSent] = useState(false);
  const [sendError, setSendError] = useState(null);

  // Regenerate modal state
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [regenImage, setRegenImage] = useState(null);
  const [regenReasons, setRegenReasons] = useState(new Set());
  const [regenerating, setRegenerating] = useState(false);

  // Impact verification state
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactResult, setImpactResult] = useState(null);
  const [impactError, setImpactError] = useState(null);

  // Load characters for send modal
  useEffect(() => {
    base44.auth.me().then(me => {
      if (!me?.email) return;
      base44.entities.Character.filter({ owner_email: me.email, status: 'active' }, 'name', 200)
        .then(setCharacters)
        .catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!eventId) return;

    const load = async () => {
      setLoading(true);
      try {
        // Subscribe to changes for real-time updates
        const unsub = base44.entities.StoryEvent.subscribe((evt) => {
          if (evt.id === eventId && evt.type === 'update') {
            setEvent(evt.data);
            if (evt.data.status === 'complete' || evt.data.status === 'failed') {
              // Load related data
              loadRelated(eventId);
            }
          }
        });

        // Initial load — must succeed for re-opening after panel close
        let loaded = false;
        try {
          const records = await base44.entities.StoryEvent.filter({ id: eventId }, null, 1);
          if (records[0]) {
            setEvent(records[0]);
            loaded = true;
            if (records[0].status === 'complete' || records[0].status === 'failed') {
              await loadRelated(eventId);
            }
          }
        } catch (fetchErr) {
          console.warn('[StoryEventViewer] Initial fetch failed, retrying:', fetchErr.message);
          // Retry once — sometimes filter needs a moment after creation
          try {
            const retryRecords = await base44.entities.StoryEvent.filter({ id: eventId }, null, 1);
            if (retryRecords[0]) {
              setEvent(retryRecords[0]);
              loaded = true;
              if (retryRecords[0].status === 'complete' || retryRecords[0].status === 'failed') {
                await loadRelated(eventId);
              }
            }
          } catch (_) {}
        }

        if (!loaded) {
          console.warn('[StoryEventViewer] Could not load event:', eventId);
        }

        setLoading(false);
        return unsub;
      } catch (_) {
        setLoading(false);
      }
    };

    const loadRelated = async (eid) => {
      try {
        const [mems, imgs] = await Promise.all([
          base44.entities.StoryEventMemory.filter({ story_event_id: eid }, null, 50).catch(() => []),
          base44.entities.StoryEventImage.filter({ story_event_id: eid }, null, 10).catch(() => []),
        ]);
        setMemories(mems);
        setImages(imgs.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
      } catch (_) {}
    };

    const cleanup = load();
    return () => { cleanup.then(fn => fn && fn()); };
  }, [eventId]);

  const groupedChars = useMemo(() => {
    return {
      active: characters.filter(c => c.character_type === 'active_created_character'),
      family: characters.filter(c => c.character_type === 'npc_family_member'),
      npc: characters.filter(c => c.character_type === 'npc_fictitious'),
      service: characters.filter(c => c.character_type === 'npc_world_service'),
    };
  }, [characters]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!event) {
    return <p className="text-xs text-muted-foreground italic py-2">Event data unavailable.</p>;
  }

  const isGenerating = event.status === 'generating';
  const isComplete = event.status === 'complete';
  const isFailed = event.status === 'failed';

  const focusNames = event.focus_character_names || [];
  const participantNames = event.participant_character_names || [];
  const nonFocusParticipants = participantNames.filter(n => !focusNames.includes(n));
  const venueDisplay = event.venue_name || 'No venue';
  const timeDisplay = event.all_day
    ? 'All day'
    : `${event.start_time || '?'}${event.end_time ? ` – ${event.end_time}` : ''}`;

  const imageByMoment = {};
  images.forEach(img => { imageByMoment[img.moment_type] = img; });

  // ── SEND HANDLER ──────────────────────────────────────────────────────────
  const openSendModal = (img) => {
    setSendImage(img);
    setSelectedRecipientIds(new Set());
    setSendSent(false);
    setSendError(null);
    setShowSendModal(true);
  };

  const handleSend = async () => {
    if (!sendImage || selectedRecipientIds.size === 0) return;
    setSending(true);
    setSendError(null);
    try {
      for (const charId of selectedRecipientIds) {
        const char = characters.find(c => c.id === charId);
        if (!char) continue;

        // Find or create direct conversation
        let convoId = null;
        try {
          const convos = await base44.entities.Conversation.filter(
            { type: 'direct', character_ids: [charId] },
            '-last_message_date', 10
          );
          const directConvo = convos.find(c => {
            const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
            return ids.length === 1 && ids[0] === charId && !c.shared_conversation_key;
          });
          if (directConvo) convoId = directConvo.id;
        } catch (_) {}

        if (!convoId) {
          const newConvo = await base44.entities.Conversation.create({
            title: `direct with ${char.name || char.display_name}`,
            type: 'direct',
            character_ids: [charId],
          });
          convoId = newConvo.id;
        }

        await base44.entities.Message.create({
          conversation_id: convoId,
          sender_type: 'user',
          content: `📸 Story Event: ${event.title} — ${sendImage.moment_type?.replace('_', ' ') || 'moment'}`,
          image_url: sendImage.image_url,
          image_description: sendImage.description || sendImage.prompt,
          image_analysis_status: 'complete',
          generation_context: {
            source: 'story_event_send',
            story_event_id: eventId,
            event_title: event.title,
            event_date: event.event_date,
            moment_type: sendImage.moment_type,
            venue_name: venueDisplay,
            participant_character_ids: event.participant_character_ids || [],
          },
          timestamp: new Date().toISOString(),
        });
      }
      setSendSent(true);
      setTimeout(() => { setShowSendModal(false); setSendImage(null); }, 1200);
    } catch (err) {
      setSendError(err.message || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const toggleRecipient = (id) => {
    const next = new Set(selectedRecipientIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedRecipientIds(next);
  };

  // ── REGENERATE HANDLER ────────────────────────────────────────────────────
  const openRegenModal = (img) => {
    setRegenImage(img);
    setRegenReasons(new Set());
    setShowRegenModal(true);
  };

  const toggleRegenReason = (reasonId) => {
    setRegenReasons(prev => {
      const next = new Set(prev);
      next.has(reasonId) ? next.delete(reasonId) : next.add(reasonId);
      return next;
    });
  };

  const handleRegenerate = async () => {
    if (!regenImage || regenReasons.size === 0) return;
    setRegenerating(true);
    try {
      const res = await base44.functions.invoke('regenerateStoryEventImage', {
        story_event_id: eventId,
        image_id: regenImage.id,
        reasons: [...regenReasons],
      });
      if (res?.data?.success) {
        const imgs = await base44.entities.StoryEventImage.filter(
          { story_event_id: eventId }, null, 10
        ).catch(() => []);
        setImages(imgs.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
        setShowRegenModal(false);
        setRegenImage(null);
      }
    } catch (_) {} finally { setRegenerating(false); }
  };

  // ── IMPACT VERIFICATION ──────────────────────────────────────────────────
  const handleVerifyImpact = async () => {
    setImpactLoading(true);
    setImpactError(null);
    setImpactResult(null);
    try {
      const res = await base44.functions.invoke('backfillStoryEventImpact', { event_id: eventId });
      setImpactResult(res?.data);
    } catch (err) {
      setImpactError(err.message || 'Verification failed');
    } finally {
      setImpactLoading(false);
    }
  };

  const recordStatusIcon = (statusObj) => {
    if (!statusObj) return <AlertCircle className="w-3.5 h-3.5 text-muted-foreground" />;
    const s = statusObj.status || '';
    if (s === 'verified') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
    if (s === 'created') return <CheckCircle2 className="w-3.5 h-3.5 text-primary" />;
    if (s === 'query_failed') return <XCircle className="w-3.5 h-3.5 text-destructive" />;
    if (s === 'missing') return <AlertCircle className="w-3.5 h-3.5 text-amber-400" />;
    if (s === 'unverified' || s === 'inferred_present') return <AlertCircle className="w-3.5 h-3.5 text-slate-500" />;
    return <AlertCircle className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  const statusLabel = (statusObj) => {
    if (!statusObj) return '—';
    const s = statusObj.status || '';
    const labels = {
      verified: 'verified',
      created: 'created',
      query_failed: 'query failed',
      missing: 'missing',
      unverified: 'unverified',
      inferred_present: 'inferred',
    };
    return labels[s] || s;
  };

  const overallBadge = (overall) => {
    const badges = {
      coherent: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
      repaired_partial: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
      partial: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      missing_timeline: 'bg-red-500/20 text-red-400 border-red-500/30',
      conflict: 'bg-red-500/20 text-red-400 border-red-500/30',
      blocked: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
    };
    return badges[overall] || 'bg-muted text-muted-foreground border-border';
  };

  // Pre-compute for JSX safety — complex optional-chaining conditions confuse the parser
  const hasCreatedRecords = impactResult && (
    (impactResult.created_records?.life_events?.length > 0) ||
    (impactResult.created_records?.memories?.length > 0) ||
    (impactResult.created_records?.character_memories?.length > 0) ||
    (impactResult.created_records?.character_memories_array?.length > 0) ||
    (impactResult.created_records?.event_participations?.length > 0) ||
    (impactResult.created_records?.location_history?.length > 0)
  );

  const createdCounts = impactResult?.created_records ? {
    lifeEvents: impactResult.created_records.life_events?.length || 0,
    memories: impactResult.created_records.memories?.length || 0,
    charMems: impactResult.created_records.character_memories?.length || 0,
    charMemArrays: impactResult.created_records.character_memories_array?.length || 0,
    eventParts: impactResult.created_records.event_participations?.length || 0,
    locHistory: impactResult.created_records.location_history?.length || 0,
  } : null;

  return (
    <div className="bg-card/80 border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star className="w-4 h-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">{event.title}</h3>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
              <span>{event.event_date}</span>
              <span>·</span>
              <span>{timeDisplay}</span>
              <span>·</span>
              <span className="capitalize">{isGenerating ? 'Generating…' : isFailed ? 'Failed' : 'Complete'}</span>
            </div>
          </div>
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-muted-foreground hover:text-foreground">
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Generating state */}
          {isGenerating && (
            <div className="flex items-center gap-3 py-4">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">Generating your story…</p>
                <p className="text-xs text-muted-foreground">Narrative, memories, and images are being created.</p>
              </div>
            </div>
          )}

          {/* Failed state */}
          {isFailed && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive font-medium">Generation failed</p>
              {event.generation_error && <p className="text-[10px] text-destructive/70 mt-1">{event.generation_error}</p>}
            </div>
          )}

          {/* Complete state */}
          {isComplete && (
            <>
              {/* Venue + Participants */}
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <MapPin className="w-3 h-3" /> {venueDisplay}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Users className="w-3 h-3" /> {participantNames.length} participants
                </span>
                {focusNames.length > 0 && (
                  <span className="flex items-center gap-1 text-primary">
                    <Star className="w-3 h-3 fill-primary" /> Focus: {focusNames.join(', ')}
                  </span>
                )}
              </div>

              {/* Narrative */}
              {event.generated_narrative && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Story</p>
                  <div className="text-xs text-foreground/85 leading-relaxed whitespace-pre-line bg-secondary/30 rounded-lg p-3 max-h-80 overflow-y-auto">
                    {event.generated_narrative}
                  </div>
                </div>
              )}

              {/* Images */}
              {images.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    <Image className="w-3 h-3 inline mr-1" /> Moments Captured
                  </p>
                  <div className="space-y-3">
                    {['opening', 'key_moment', 'closing'].map(moment => {
                      const img = imageByMoment[moment];
                      if (!img?.image_url) return (
                        <div key={moment} className="aspect-[4/3] rounded-lg bg-secondary/50 border border-border flex items-center justify-center">
                          <span className="text-[9px] text-muted-foreground capitalize">{moment.replace('_', ' ')}</span>
                        </div>
                      );
                      return (
                        <div key={moment} className="rounded-lg overflow-hidden border border-border bg-secondary/20">
                          <img src={img.image_url} alt={img.description || moment} className="w-full aspect-[4/3] object-cover" />
                          <div className="px-3 py-2 flex items-center justify-between">
                            <div>
                              <span className="text-[10px] font-medium text-foreground capitalize">{moment.replace('_', ' ')}</span>
                              {img.description && (
                                <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-1">{img.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openRegenModal(img)}
                                className="p-1.5 rounded-lg bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
                                title="Regenerate image"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => openSendModal(img)}
                                className="p-1.5 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
                                title="Send to character"
                              >
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Emotional Outcomes */}
              {event.emotional_outcomes?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                    <Heart className="w-3 h-3 inline mr-1" /> Emotional Impact
                  </p>
                  <div className="space-y-1">
                    {event.emotional_outcomes.map((eo, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-foreground">{eo.character_name}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="capitalize font-medium text-primary">{eo.emotion}</span>
                        <span className="text-[9px] text-muted-foreground">({eo.intensity})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Relationship Changes */}
              {event.relationship_changes?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Relationship Shifts</p>
                  <div className="space-y-1">
                    {event.relationship_changes.map((rc, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-xs">
                        <span className="font-medium text-foreground">{rc.source_name}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="font-medium text-foreground">{rc.target_name}</span>
                        <span className="text-muted-foreground">:</span>
                        <span className={`capitalize ${rc.change === 'increased' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {rc.change} {rc.dimension}
                        </span>
                        <span className="text-[9px] text-muted-foreground">(+{rc.amount})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Memories */}
              {memories.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Memories Created</p>
                  <div className="space-y-2">
                    {memories.map((mem, i) => (
                      <div key={i} className="p-2 rounded-lg bg-secondary/40 border border-border">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-medium text-foreground">{mem.character_name}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                            mem.importance_score >= 7 ? 'bg-primary/20 text-primary' :
                            mem.importance_score >= 5 ? 'bg-amber-500/20 text-amber-400' :
                            'bg-muted text-muted-foreground'
                          }`}>
                            ★{mem.importance_score}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">{mem.memory_text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── IMPACT PROOF SECTION ──────────────────────────────────── */}
              <div className="border-t border-border pt-3">
                <button
                  onClick={handleVerifyImpact}
                  disabled={impactLoading}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-50"
                >
                  {impactLoading
                    ? <><Loader2 className="w-3 h-3 animate-spin" /> Verifying impact records…</>
                    : <><Shield className="w-3 h-3" /> Verify & Backfill Impact Records</>
                  }
                </button>

                {impactError && (
                  <p className="text-xs text-destructive mt-2">{impactError}</p>
                )}

                {impactResult && (
                  <div className="mt-3 space-y-2">
                    {/* Summary bar with event-level overall status */}
                    <div className={`p-2 rounded-lg border flex items-center gap-2 ${overallBadge(impactResult.event_overall)}`}>
                     <Shield className="w-3 h-3" />
                     <span className="text-[10px] font-medium">
                       {impactResult.participant_count} participants · {impactResult.story_event_images} images · {impactResult.media_gallery_images} gallery images
                     </span>
                     <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-current opacity-70 ml-auto">
                       {impactResult.event_overall?.replace(/_/g, ' ') || 'unknown'}
                     </span>
                    </div>

                    {/* Unverified systems warning */}
                    {impactResult.unverified_systems?.length > 0 && (
                     <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                       <p className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">Unverified Systems</p>
                       <div className="text-[9px] text-amber-300 flex flex-wrap gap-x-3 gap-y-0.5">
                         {impactResult.unverified_systems.map((sys, i) => (
                           <span key={i}>{sys.system}: {sys.statuses.join(', ')}</span>
                         ))}
                       </div>
                     </div>
                    )}

                    {/* Created records summary */}
                    {hasCreatedRecords && (
                     <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
                       <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1">Records Created in This Run</p>
                       <div className="text-[9px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                         {createdCounts.lifeEvents > 0 && <span>LifeEvents: {createdCounts.lifeEvents}</span>}
                         {createdCounts.memories > 0 && <span>Memories: {createdCounts.memories}</span>}
                         {createdCounts.charMems > 0 && <span>CharacterMemories: {createdCounts.charMems}</span>}
                         {createdCounts.charMemArrays > 0 && <span>Char.Memories: {createdCounts.charMemArrays}</span>}
                         {createdCounts.eventParts > 0 && <span>EventParts: {createdCounts.eventParts}</span>}
                         {createdCounts.locHistory > 0 && <span>LocationHistory: {createdCounts.locHistory}</span>}
                       </div>
                     </div>
                    )}

                    {/* Per-participant table — ALL systems, honest status */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-[8px]">
                        <thead>
                          <tr className="border-b border-border">
                            <th className="text-left py-1.5 px-0.5 text-muted-foreground font-medium">Character</th>
                            <th className="text-center py-1.5 px-0.5 text-muted-foreground font-medium">SEMem</th>
                            <th className="text-center py-1.5 px-0.5 text-muted-foreground font-medium">LifeEv</th>
                            <th className="text-center py-1.5 px-0.5 text-muted-foreground font-medium">Memory</th>
                            <th className="text-center py-1.5 px-0.5 text-muted-foreground font-medium">CharMem</th>
                            <th className="text-center py-1.5 px-0.5 text-muted-foreground font-medium">Ch.Mems</th>
                            <th className="text-center py-1.5 px-0.5 text-muted-foreground font-medium">EvPart</th>
                            <th className="text-center py-1.5 px-0.5 text-muted-foreground font-medium">LocHist</th>
                            <th className="text-center py-1.5 px-0.5 text-muted-foreground font-medium">Overall</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(impactResult.participants || []).map((p, i) => (
                            <tr key={i} className="border-b border-border/40 hover:bg-secondary/30">
                              <td className="py-1.5 px-0.5">
                                <div className="flex items-center gap-1">
                                  <span className="font-medium text-foreground text-[8px] truncate max-w-[60px]" title={p.character_name}>{p.character_name}</span>
                                  {p.is_focus && <span className="text-[6px] px-1 py-0.5 rounded bg-primary/20 text-primary">★</span>}
                                </div>
                              </td>
                              <td className="text-center py-1.5 px-0.5">{recordStatusIcon(p.story_event_memory)}</td>
                              <td className="text-center py-1.5 px-0.5">{recordStatusIcon(p.life_event)}</td>
                              <td className="text-center py-1.5 px-0.5">{recordStatusIcon(p.memory)}</td>
                              <td className="text-center py-1.5 px-0.5">{recordStatusIcon(p.character_memory)}</td>
                              <td className="text-center py-1.5 px-0.5">{recordStatusIcon(p.char_memories_array)}</td>
                              <td className="text-center py-1.5 px-0.5">{recordStatusIcon(p.event_participation)}</td>
                              <td className="text-center py-1.5 px-0.5">{recordStatusIcon(p.location_history)}</td>
                              <td className="text-center py-1.5 px-0.5">
                                <span className={`text-[7px] px-1 py-0.5 rounded-full border ${overallBadge(p.overall)}`}>
                                  {p.overall?.replace(/_/g, ' ') || '?'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Legend */}
                    <div className="flex items-center gap-3 text-[8px] text-muted-foreground px-1 flex-wrap">
                      <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-400" /> verified</span>
                      <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-primary" /> created</span>
                      <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-destructive" /> query failed</span>
                      <span className="flex items-center gap-1"><AlertCircle className="w-3 h-3 text-amber-400" /> missing</span>
                      <span className="flex items-center gap-1"><AlertCircle className="w-3 h-3 text-slate-500" /> unverified</span>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── SEND MODAL ────────────────────────────────────────────────────── */}
      {showSendModal && sendImage && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center p-4" onClick={() => setShowSendModal(false)}>
          <div className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Send Image To</h3>
              <button onClick={() => setShowSendModal(false)} className="p-1 hover:bg-secondary rounded-lg"><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div className="p-4 max-h-64 overflow-y-auto space-y-1">
              {[
                { group: 'Active Characters', chars: groupedChars.active },
                { group: 'Family', chars: groupedChars.family },
                { group: 'NPCs', chars: groupedChars.npc },
                { group: 'Services', chars: groupedChars.service },
              ].filter(g => g.chars.length > 0).map(({ group, chars }) => (
                <div key={group}>
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase px-1 py-1">{group}</p>
                  {chars.map(c => (
                    <label key={c.id} className="flex items-center gap-2 px-2 py-2 hover:bg-secondary/40 rounded-lg cursor-pointer">
                      <input type="checkbox" checked={selectedRecipientIds.has(c.id)} onChange={() => toggleRecipient(c.id)} className="w-4 h-4" />
                      <span className="text-sm text-foreground">{c.name || c.display_name}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex-shrink-0 border-t border-border p-4 flex flex-col gap-2">
              {sendError && <p className="text-xs text-destructive">{sendError}</p>}
              <div className="flex gap-2">
                <button onClick={() => setShowSendModal(false)} className="flex-1 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm">Cancel</button>
                <button onClick={handleSend} disabled={sending || sendSent || selectedRecipientIds.size === 0}
                  className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
                  {sendSent ? '✓ Sent!' : sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── REGENERATE MODAL ───────────────────────────────────────────────── */}
      {showRegenModal && regenImage && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center pb-24 pt-4 px-4" onClick={() => setShowRegenModal(false)}>
          <div className="w-full max-w-sm bg-card border border-border rounded-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Regenerate Image</h3>
              <button onClick={() => setShowRegenModal(false)} className="p-1 hover:bg-secondary rounded-lg"><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div className="p-4 space-y-2">
              <p className="text-xs text-muted-foreground">Why regenerate this {regenImage.moment_type?.replace('_', ' ') || 'moment'} image? Select all that apply:</p>
              {REGEN_REASONS.map(r => {
                const isSelected = regenReasons.has(r.id);
                return (
                  <button key={r.id} onClick={() => toggleRegenReason(r.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left ${
                      isSelected ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary/40 text-foreground hover:border-primary/40'
                    }`}>
                    <span className="text-lg">{r.icon}</span>
                    <span className="text-sm font-medium">{r.label}</span>
                    {isSelected && <Check className="w-4 h-4 ml-auto text-primary" />}
                  </button>
                );
              })}
            </div>
            <div className="flex-shrink-0 border-t border-border p-4 flex gap-2">
              <button onClick={() => setShowRegenModal(false)} className="flex-1 py-2 rounded-xl bg-secondary text-secondary-foreground text-sm">Cancel</button>
              <button onClick={handleRegenerate} disabled={regenReasons.size === 0 || regenerating}
                className="flex-1 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                {regenerating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : 'Regenerate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}