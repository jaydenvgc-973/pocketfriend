import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Loader2, BookOpen, Users, MapPin, Star } from 'lucide-react';

// Stable synthetic ID for the user participant (not a Character entity ObjectId)
const USER_STORY_ID = '__user__';

export default function StoryEventCreator({ date, characters = [], currentUser = null, userSettings = null, appLocations = [], onCreated, onCancel }) {
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
  const [userIsParticipant, setUserIsParticipant] = useState(false);
  const [userIsFocus, setUserIsFocus] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Build user participant identity
  const userDisplayName = userSettings?.fictional_world_name || currentUser?.full_name || 'You';
  const userParticipant = currentUser ? {
    id: USER_STORY_ID,
    name: userDisplayName,
    participant_type: 'user',
    user_id: currentUser.id,
    avatar_url: null,
    reference_images: userSettings?.appearance_lock ? [] : [],
  } : null;

  const dateStr = date ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).toISOString().split('T')[0] : '';

  // All eligible character types: active_created_character, npc_family_member, npc_fictitious, npc_world_service
  const ELIGIBLE_TYPES = ['active_created_character', 'npc_family_member', 'npc_fictitious', 'npc_world_service'];
  const eligibleChars = characters.filter(c =>
    ELIGIBLE_TYPES.includes(c.character_type) && c.status === 'active'
  );
  // Group by type for organized display
  const activeChars = eligibleChars.filter(c => c.character_type === 'active_created_character');
  const familyChars = eligibleChars.filter(c => c.character_type === 'npc_family_member');
  const fictitiousChars = eligibleChars.filter(c => c.character_type === 'npc_fictitious');
  const serviceChars = eligibleChars.filter(c => c.character_type === 'npc_world_service');

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
    const hasAnyParticipant = participantIds.length > 0 || userIsParticipant;
    if (!hasAnyParticipant) { setError('Please select at least one participant.'); return; }

    setSaving(true);
    setError('');

    // Build user participant payload if selected — include visual identity data
    const userAvatarUrl = currentUser?.generated_avatar_urls?.[0] || null;
    const userReferenceImages = userSettings?.user_closet?.map(outfit => outfit.image_url).filter(Boolean) || [];
    const userParticipantPayload = userIsParticipant && userParticipant ? {
      user_id: currentUser?.id,
      display_name: userDisplayName,
      participant_type: 'user',
      is_focus: userIsFocus,
      avatar_url: userAvatarUrl,
      reference_images: userReferenceImages,
    } : null;

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
        user_participant: userParticipantPayload,
      });

      if (res?.data?.storyEventId) {
        const eventPreview = {
          id: res.data.storyEventId,
          title: title.trim(),
          event_date: dateStr,
          status: 'generating',
          start_time: allDay ? null : (startTime || null),
          end_time: allDay ? null : (endTime || null),
          venue_name: resolveVenueName(),
          focus_character_ids: focusIds,
          participant_character_ids: participantIds,
          focus_character_names: focusIds.map(id => {
            const c = characters.find(ch => ch.id === id);
            return c?.name || c?.display_name || id;
          }),
          participant_character_names: participantIds.map(id => {
            const c = characters.find(ch => ch.id === id);
            return c?.name || c?.display_name || id;
          }),
          all_day: allDay,
          is_rabbit_hole: isRabbitHole,
        };
        if (onCreated) onCreated(res.data.storyEventId, eventPreview);
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
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Participants</span>
        </div>
        <div className="space-y-3 max-h-64 overflow-y-auto">
          {/* User row — always first */}
          {userParticipant && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 px-1">👤 You</p>
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/40 border border-border">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{userParticipant.name}</p>
                  <div className="flex gap-1.5 text-[9px] text-muted-foreground mt-0.5">
                    <span className="px-1 rounded bg-secondary/80">You</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                  <button
                    onClick={() => {
                      setUserIsFocus(f => !f);
                      if (!userIsParticipant) setUserIsParticipant(true);
                    }}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      userIsFocus ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-secondary/60 text-muted-foreground border border-border hover:border-primary/30'
                    }`}
                    title="Focus — you get greater narrative attention"
                  >
                    <Star className={`w-2.5 h-2.5 inline mr-0.5 ${userIsFocus ? 'fill-primary' : ''}`} />
                    Focus
                  </button>
                  <button
                    onClick={() => { if (!userIsFocus) setUserIsParticipant(p => !p); }}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      userIsParticipant && !userIsFocus ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-secondary/60 text-muted-foreground border border-border hover:border-primary/30'
                    }`}
                    disabled={userIsFocus}
                    title={userIsFocus ? 'Focus users are automatically participants' : 'Include yourself as participant'}
                  >
                    {userIsFocus ? 'Included' : userIsParticipant ? 'Participant' : 'Include'}
                  </button>
                </div>
              </div>
            </div>
          )}
          {eligibleChars.length === 0 && !userParticipant ? (
            <p className="text-xs text-muted-foreground italic">No eligible characters available. Create characters first.</p>
          ) : (
            <>
            {[
              { group: '★ My Characters', chars: activeChars },
              { group: '👪 Family', chars: familyChars },
              { group: '🎭 Fictional / NPC', chars: fictitiousChars },
              { group: '🔧 World Services', chars: serviceChars },
            ].filter(g => g.chars.length > 0).map(({ group, chars }) => (
              <div key={group}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 px-1">{group}</p>
                <div className="space-y-1">
                  {chars.map(c => {
                    const isFocus = focusIds.includes(c.id);
                    const isParticipant = participantIds.includes(c.id);
                    const typeLabel = c.character_type === 'npc_world_service'
                      ? 'Service' : c.character_type === 'npc_family_member'
                      ? 'Family' : c.character_type === 'npc_fictitious'
                      ? 'NPC' : '';
                    return (
                      <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/40 border border-border">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">{c.name || c.display_name}</p>
                          <div className="flex gap-1.5 text-[9px] text-muted-foreground mt-0.5">
                            {typeLabel && <span className="px-1 rounded bg-secondary/80">{typeLabel}</span>}
                            {c.occupation && <span className="truncate">{c.occupation}</span>}
                          </div>
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
              </div>
            ))}
            </>
          )}
        </div>
        <p className="text-[9px] text-muted-foreground mt-1">
          ★ Focus = greater narrative attention, richer memories. Selected: {focusIds.length + (userIsFocus ? 1 : 0)}. Participants: {participantIds.length + (userIsParticipant ? 1 : 0)}.
        </p>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={handleSubmit} disabled={saving || !title.trim() || !plot.trim() || (participantIds.length === 0 && !userIsParticipant)} className="h-8 flex-1 text-xs">
          {saving ? <><Loader2 className="w-3 h-3 animate-spin mr-1" />Creating…</> : <><Star className="w-3 h-3 mr-1" />Generate Story Event</>}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} className="h-8 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}