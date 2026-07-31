import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, BookOpen, Users, MapPin, Star, X } from 'lucide-react';

const USER_STORY_ID = '__user__';

/**
 * StoryEventEditor — Modal for editing an existing StoryEvent.
 *
 * Props:
 *   event        — the StoryEvent record to edit
 *   characters   — full character roster (already loaded by parent)
 *   currentUser  — authenticated user entity
 *   onSaved(updateData) — called after successful update
 *   onCancel()   — called when modal is closed without saving
 *
 * Loads userSettings and appLocations internally.
 */
export default function StoryEventEditor({ event, characters = [], currentUser = null, onSaved, onCancel }) {
  const [title, setTitle] = useState(event.title || '');
  const [plot, setPlot] = useState(event.plot || '');
  const [notes, setNotes] = useState(event.additional_notes || '');
  const [startTime, setStartTime] = useState(event.start_time || '');
  const [endTime, setEndTime] = useState(event.end_time || '');
  const [allDay, setAllDay] = useState(event.all_day || false);
  const [selectedVenueId, setSelectedVenueId] = useState(event.venue_id || '');
  const [isRabbitHole, setIsRabbitHole] = useState(event.is_rabbit_hole || false);
  const [rabbitHoleName, setRabbitHoleName] = useState(event.rabbit_hole_venue_name || '');
  const [focusIds, setFocusIds] = useState(event.focus_character_ids || []);
  const [participantIds, setParticipantIds] = useState(event.participant_character_ids || []);
  const [userIsParticipant, setUserIsParticipant] = useState(!!event.user_participant);
  const [userIsFocus, setUserIsFocus] = useState(event.user_participant?.is_focus || false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load userSettings + appLocations
  const [userSettings, setUserSettings] = useState(null);
  const [appLocations, setAppLocations] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentUser?.email) return;
      try {
        const settings = await base44.entities.UserSettings.filter({ owner_email: currentUser.email }, null, 1);
        if (!cancelled && settings[0]) setUserSettings(settings[0]);
      } catch (_) {}
      try {
        const locs = await base44.entities.LocationReference.filter(
          { $or: [{ owner_email: currentUser.email }, { scope: 'shared' }, { scope: 'account_global' }] },
          'name', 200
        );
        if (!cancelled) setAppLocations(locs.filter(l => l?.name));
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [currentUser?.email]);

  const userDisplayName = userSettings?.fictional_world_name || currentUser?.full_name || 'You';

  const ELIGIBLE_TYPES = ['active_created_character', 'npc_family_member', 'npc_fictitious', 'npc_world_service'];
  const eligibleChars = characters.filter(c =>
    ELIGIBLE_TYPES.includes(c.character_type) && c.status === 'active'
  );
  const activeChars = eligibleChars.filter(c => c.character_type === 'active_created_character');
  const familyChars = eligibleChars.filter(c => c.character_type === 'npc_family_member');
  const fictitiousChars = eligibleChars.filter(c => c.character_type === 'npc_fictitious');
  const serviceChars = eligibleChars.filter(c => c.character_type === 'npc_world_service');

  const venues = appLocations;

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
    return v?.name || event.venue_name || 'No venue selected';
  };

  const handleSubmit = async () => {
    if (!title.trim()) { setError('Please enter a title.'); return; }
    if (!plot.trim()) { setError('Please enter a plot/plan for the event.'); return; }
    const hasAnyParticipant = participantIds.length > 0 || userIsParticipant;
    if (!hasAnyParticipant) { setError('Please select at least one participant.'); return; }

    setSaving(true);
    setError('');

    try {
      const focusNames = focusIds.map(id => {
        const c = characters.find(ch => ch.id === id);
        return c?.name || c?.display_name || id;
      });
      const participantNames = participantIds.map(id => {
        const c = characters.find(ch => ch.id === id);
        return c?.name || c?.display_name || id;
      });

      const userParticipantMetadata = userIsParticipant ? {
        user_id: currentUser?.id,
        display_name: userDisplayName,
        is_focus: userIsFocus,
      } : null;

      const updateData = {
        title: title.trim(),
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
        focus_character_names: focusNames,
        participant_character_ids: participantIds,
        participant_character_names: participantNames,
        user_participant: userParticipantMetadata,
      };

      await base44.entities.StoryEvent.update(event.id, updateData);
      if (onSaved) onSaved(updateData);
    } catch (err) {
      setError(err?.message || 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center pb-24 pt-4 px-4" onClick={onCancel}>
      <div className="w-full max-w-md bg-card border border-border rounded-3xl overflow-hidden max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Edit Story Event</h3>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-secondary rounded-lg">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <input
            type="text"
            placeholder="Event title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} className="rounded" />
              All-day
            </label>
            {!allDay && (
              <div className="flex gap-2 flex-1">
                <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}
                  className="flex-1 px-2 py-1.5 bg-input border border-border rounded-lg text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary/50" />
                <span className="text-xs text-muted-foreground self-center">to</span>
                <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}
                  className="flex-1 px-2 py-1.5 bg-input border border-border rounded-lg text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary/50" />
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-1 mb-1">
              <MapPin className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Venue</span>
            </div>
            {!isRabbitHole && (
              <select value={selectedVenueId} onChange={e => setSelectedVenueId(e.target.value)}
                className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50">
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
              <input type="text" placeholder="Venue name" value={rabbitHoleName}
                onChange={e => setRabbitHoleName(e.target.value)}
                className="w-full mt-1 px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50" />
            )}
          </div>

          <div>
            <div className="flex items-center gap-1 mb-1">
              <BookOpen className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Plot / Plan</span>
            </div>
            <textarea placeholder="Describe what happens…" value={plot} onChange={e => setPlot(e.target.value)} rows={3}
              className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />
          </div>

          <textarea placeholder="Additional notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none" />

          <div>
            <div className="flex items-center gap-1 mb-2">
              <Users className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Participants</span>
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {/* User row */}
              {currentUser && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/40 border border-border">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{userDisplayName}</p>
                    <span className="text-[9px] text-muted-foreground">You</span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <button onClick={() => { setUserIsFocus(f => !f); if (!userIsParticipant) setUserIsParticipant(true); }}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${userIsFocus ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-secondary/60 text-muted-foreground border border-border hover:border-primary/30'}`}>
                      <Star className={`w-2.5 h-2.5 inline mr-0.5 ${userIsFocus ? 'fill-primary' : ''}`} />Focus
                    </button>
                    <button onClick={() => { if (!userIsFocus) setUserIsParticipant(p => !p); }} disabled={userIsFocus}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${userIsParticipant && !userIsFocus ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-secondary/60 text-muted-foreground border border-border hover:border-primary/30'}`}>
                      {userIsFocus ? 'Included' : userIsParticipant ? 'Participant' : 'Include'}
                    </button>
                  </div>
                </div>
              )}
              {[
                { group: '★ My Characters', chars: activeChars },
                { group: '👪 Family', chars: familyChars },
                { group: '🎭 Fictional / NPC', chars: fictitiousChars },
                { group: '🔧 World Services', chars: serviceChars },
              ].filter(g => g.chars.length > 0).map(({ group, chars }) => (
                <div key={group}>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 px-1">{group}</p>
                  <div className="space-y-1">
                    {chars.map(c => {
                      const isFocus = focusIds.includes(c.id);
                      const isParticipant = participantIds.includes(c.id);
                      return (
                        <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/40 border border-border">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">{c.name || c.display_name}</p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                            <button onClick={() => toggleFocus(c.id)}
                              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${isFocus ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-secondary/60 text-muted-foreground border border-border hover:border-primary/30'}`}>
                              <Star className={`w-2.5 h-2.5 inline mr-0.5 ${isFocus ? 'fill-primary' : ''}`} />Focus
                            </button>
                            <button onClick={() => toggleParticipant(c.id)} disabled={isFocus}
                              className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${isParticipant && !isFocus ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-secondary/60 text-muted-foreground border border-border hover:border-primary/30'}`}>
                              {isFocus ? 'Included' : isParticipant ? 'Participant' : 'Include'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-border p-4 flex gap-2">
          <Button size="sm" variant="outline" onClick={onCancel} className="h-9 flex-1 text-xs">Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={saving || !title.trim() || !plot.trim()} className="h-9 flex-1 text-xs">
            {saving ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Saving…</> : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}