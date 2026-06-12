import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Star, MapPin, Users, Heart, Image, ChevronDown, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

export default function StoryEventViewer({ eventId }) {
  const [event, setEvent] = useState(null);
  const [memories, setMemories] = useState([]);
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

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
                  <div className="grid grid-cols-3 gap-2">
                    {['opening', 'key_moment', 'closing'].map(moment => {
                      const img = imageByMoment[moment];
                      if (!img?.image_url) return (
                        <div key={moment} className="aspect-[4/3] rounded-lg bg-secondary/50 border border-border flex items-center justify-center">
                          <span className="text-[9px] text-muted-foreground capitalize">{moment.replace('_', ' ')}</span>
                        </div>
                      );
                      return (
                        <div key={moment} className="aspect-[4/3] rounded-lg overflow-hidden border border-border relative group">
                          <img src={img.image_url} alt={img.description || moment} className="w-full h-full object-cover" />
                          <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                            <span className="text-[8px] text-white/80 capitalize">{moment.replace('_', ' ')}</span>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}