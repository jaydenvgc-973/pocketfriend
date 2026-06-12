import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, BookOpen, Users, MapPin, Star } from 'lucide-react';

export default function StoryEventCreator({ date, characters = [], appLocations = [], onCreated, onCancel }) {
  const [title, setTitle] = useState('');
  const [plot, setPlot] = useState('');
  const [notes, setNotes] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [selectedVenueId, setSelectedVenueId] = useState('');
  const [isRabbitHole, setIsRabbitHole] = useState(false);
  const [rabbitHoleName, setRabbitHoleName] = useState('');
  const [focusIds, setFocusIds] = useState([]);
  const [participantIds, setParticipantIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dateStr = date ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString().split('T')[0] : '';

  const activeChars = characters.filter(c =>
    c.character_type === 'active_created_character' && c.status === 'active'
  );

  const venues = appLocations.filter(l => l !== null && l?.name);

  const toggleFocus = (id) => {
    setFocusIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    if (!participantIds.includes(id)) {
      setParticipantIds(prev => [...prev, id]);
    }
  };

  const toggleParticipant = (id) => {
    if (focusIds.includes(id)) return;
    setParticipantIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const resolveVenueName = () => {
    if (isRabbitHole) return rabbitHoleName || 'Custom venue';
    const v = venues.find(l => l.id === selectedVenueId);
    return v?.name || 'No venue selected';
  };

  const handleSubmit = async () => {
    if (!title.trim()) { setError('Please enter a title.'); return; }
    if (!plot.trim()) { setError('Please enter a plot/plan for the event.'); return; }
    if (participantIds.length === 0) { setError('Please select at least one participant.'); return; }

    setSaving(true);
    setError('');
    try {
      const res = await base44.functions.invoke('createStoryEvent', {
        title: title.trim(),
        event_date: dateStr,
        plot: plot.trim(),
        additional_notes: notes.trim(),
        start_time: allDay ? null : (startTime || null),
        end_time: allDay ? null : (endTime || null),
        all_day: allDay,
        venue_id: isRabbitHole ? null : (selectedVenueId || null),
        venue_name: resolveVenueName(),
        is_rabbit_hole: isRabbitHole,
        rabbit_hole_venue_name: isRabbitHole ? (rabbitHoleName || 'Custom venue') : null,
        focus_character_ids: focusIds,
        participant_character_ids: participantIds,
      });

      if (res?.data?.storyEventId) {
        if (onCreated) onCreated(res.data.storyEventId);
      } else {
        setError(res?.data?.error || 'Failed to create event.');
      }
    } catch (err) {
      setError(err?.message || 'Failed to create event.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 animate-in fade-in duration-200">
      <div className="flex items-center gap-2 mb-1">
        <Star className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold text-primary uppercase tracking-wider">Create Story Event</span>
      </div>

      <input
        type="text"
        placeholder="Event title (e.g., 'Surprise birthday dinner')"
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
        autoFocus
      />

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} className="rounded" />
          All-day
        </label>
        {!allDay && (
          <div className="flex gap-2 flex-1">
            <input
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
              className="flex-1 px-2 py-1.5 bg-input border border-border rounded-lg text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder="Start"
            />
            <span className="text-xs text-muted-foreground self-center">to</span>
            <input
              type="time"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
              className="flex-1 px-2 py-1.5 bg-input border border-border rounded-lg text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
              placeholder="End"
            />
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-1 mb-1">
          <MapPin className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Venue</span>
        </div>
        {!isRabbitHole && (
          <select
            value={selectedVenueId}
            onChange={e => setSelectedVenueId(e.target.value)}
            className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">Select a venue…</option>
            {venues.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name} ({loc.category || 'location'})</option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={isRabbitHole} onChange={e => setIsRabbitHole(e.target.checked)} className="rounded" />
          Rabbit-hole venue
        </label>
        {isRabbitHole && (
          <input
            type="text"
            placeholder="Venue name (e.g., 'Cozy lakeside cabin')"
            value={rabbitHoleName}
            onChange={e => setRabbitHoleName(e.target.value)}
            className="w-full mt-1 px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        )}
      </div>

      <div>
        <div className="flex items-center gap-1 mb-1">
          <BookOpen className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Plot / Plan (foundation)</span>
        </div>
        <textarea
          placeholder="Describe what happens — this is the foundation of the event. Be specific: who does what, where, why. The generation will follow your plan."
          value={plot}
          onChange={e => setPlot(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
        />
      </div>

      <textarea
        placeholder="Additional notes (optional) — mood, specific details, constraints…"
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
      />

      <div>
        <div className="flex items-center gap-1 mb-2">
          <Users className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Characters</span>
        </div>
        {activeChars.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No active characters available.</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {activeChars.map(c => {
              const isFocus = focusIds.includes(c.id);
              const isParticipant = participantIds.includes(c.id);
              return (
                <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/40 border border-border">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{c.name || c.display_name}</p>
                    {c.occupation && <p className="text-[10px] text-muted-foreground truncate">{c.occupation}</p>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <button
                      onClick={() => toggleFocus(c.id)}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                        isFocus ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-secondary/60 text-muted-foreground border border-border hover:border-primary/30'
                      }`}
                      title="Focus character — gets more narrative attention"
                    >
                      <Star className={`w-2.5 h-2.5 inline mr-0.5 ${isFocus ? 'fill-primary' : ''}`} />
                      Focus
                    </button>
                    <button
                      onClick={() => toggleParticipant(c.id)}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                        isParticipant && !isFocus ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-secondary/60 text-muted-foreground border border-border hover:border-primary/30'
                      }`}
                      disabled={isFocus}
                      title={isFocus ? 'Focus characters are automatically participants' : 'Include as participant'}
                    >
                      {isFocus ? 'Included' : isParticipant ? 'Participant' : 'Include'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[9px] text-muted-foreground mt-1">
          ★ Focus = greater narrative attention, richer memories. Selected: {focusIds.length}. Participants: {participantIds.length}.
        </p>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={handleSubmit} disabled={saving || !title.trim() || !plot.trim() || participantIds.length === 0} className="h-8 flex-1 text-xs">
          {saving ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Creating…</> : <><Star className="w-3 h-3 mr-1" />Generate Story Event</>}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} className="h-8 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}