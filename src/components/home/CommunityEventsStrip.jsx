import React, { useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Calendar, MapPin, Users } from 'lucide-react';
import { buildDefaultCommunityEvents, EVENT_TYPE_ICONS } from '@/lib/defaultCommunityEvents';

// ── EVENT ATTENDANCE SCORING ──────────────────────────────────────────────────
// Scores how likely a character is to attend an event.
// Returns 0–100. Characters scoring >= ATTENDANCE_THRESHOLD "attend".
// Does NOT overwrite travel, jail, work, school, sleep, hospital, or confinement states.

const ATTENDANCE_THRESHOLD = 45;

const BLOCKED_PRESENCE_STATES = new Set([
  'incarcerated', 'house_arrest', 'confined', 'at_work', 'at_school',
  'sleeping', 'napping', 'temporary_housing',
]);

const EVENT_TYPE_INTEREST_MAP = {
  social:       ['extrovert', 'mostly_extrovert', 'ambivert'],
  fitness:      ['gym', 'fitness', 'active'],
  cultural:     ['creative', 'cultural', 'artsy'],
  educational:  ['student', 'scholar', 'curious'],
  entertainment:['extrovert', 'fun-loving'],
  support:      ['empathetic', 'compassionate'],
  celebration:  ['extrovert', 'ambivert', 'fun-loving'],
  personal:     [],  // user-created — all eligible
};

/**
 * Score a character's likelihood of attending a given event.
 * @param {Object} character
 * @param {Object} event
 * @param {Object[]} appLocations
 * @returns {{ score: number, reasons: string[], blocked: boolean, blockedReason: string|null }}
 */
function scoreAttendance(character, event, appLocations) {
  // ── BLOCKERS (hard stop) ──────────────────────────────────────────────────
  if (character.is_jailed) return { score: 0, reasons: [], blocked: true, blockedReason: 'incarcerated' };
  if (character.house_arrest_active) return { score: 0, reasons: [], blocked: true, blockedReason: 'house arrest' };

  const presence = character.resolved_presence_status || '';
  if (BLOCKED_PRESENCE_STATES.has(presence)) {
    return { score: 0, reasons: [], blocked: true, blockedReason: presence.replace(/_/g, ' ') };
  }

  // Check work schedule — if character should be at work right now, block
  if (presence === 'at_work') return { score: 0, reasons: [], blocked: true, blockedReason: 'at work' };

  let score = 30; // base score
  const reasons = [];

  // ── EVENT VIBE MATCH ──────────────────────────────────────────────────────
  const eventType = event.event_type || 'social';
  const vibe = event.vibe || 'social';
  const socialEnergy = character.social_energy || 'ambivert';
  const energeticVibes = ['energetic', 'social'];
  const quietVibes = ['quiet'];

  if (energeticVibes.includes(vibe) && ['extrovert', 'mostly_extrovert', 'ambivert'].includes(socialEnergy)) {
    score += 15; reasons.push('vibe match');
  }
  if (quietVibes.includes(vibe) && ['introvert', 'mostly_introvert'].includes(socialEnergy)) {
    score += 10; reasons.push('quiet vibe match');
  }

  // ── PERSONALITY MATCH ─────────────────────────────────────────────────────
  const traits = (character.personality_traits || []).map(t => t.toLowerCase());
  const personalityText = (character.personality_summary || '').toLowerCase();

  if (character.trait_compassionate && eventType === 'support') { score += 20; reasons.push('compassionate → support event'); }
  if (character.trait_competitive && eventType === 'fitness') { score += 20; reasons.push('competitive → fitness event'); }
  if (character.trait_loyal && eventType === 'celebration') { score += 15; reasons.push('loyal → celebration'); }
  if (character.trait_night_owl && vibe === 'energetic') { score += 10; reasons.push('night owl'); }
  if (character.trait_loud && eventType === 'entertainment') { score += 10; reasons.push('loud → entertainment'); }

  // ── LOCATION AVAILABILITY ─────────────────────────────────────────────────
  // Check if the event location exists in app locations
  const appLocationMatch = event.location_id
    ? appLocations.find(l => l.id === event.location_id)
    : appLocations.find(l => l.name?.toLowerCase() === event.location_name?.toLowerCase());

  if (appLocationMatch) {
    score += 10; reasons.push('location exists in world');
    // If character frequents this location, bonus
    if ((character.frequented_places || []).includes(appLocationMatch.id)) {
      score += 15; reasons.push('frequents this location');
    }
  } else {
    // Rabbit-hole location — slightly less likely but still possible
    score -= 5; reasons.push('rabbit-hole venue');
  }

  // ── RELATIONSHIP/SOCIAL OPPORTUNITY ──────────────────────────────────────
  if (character.friendship_level > 70) { score += 5; reasons.push('socially active'); }
  if (character.romantic_level > 50) { score += 5; reasons.push('romantically active'); }

  // ── NEEDS STATE ───────────────────────────────────────────────────────────
  // Low social need → more likely to go out
  if ((character.social_value || 65) < 40) { score += 15; reasons.push('low social need → wants to go out'); }
  if ((character.energy_value || 75) < 30) { score -= 20; reasons.push('too tired'); }

  // Cap at 0–100
  score = Math.max(0, Math.min(100, score));
  return { score, reasons, blocked: false, blockedReason: null };
}

/**
 * Get likely attendees for an event from the active character list.
 * Returns characters scored >= ATTENDANCE_THRESHOLD, capped at 4 for display.
 */
function getEventAttendees(event, characters, appLocations) {
  if (!characters || characters.length === 0) return [];

  return characters
    .map(char => {
      const result = scoreAttendance(char, event, appLocations);
      return { character: char, ...result };
    })
    .filter(r => !r.blocked && r.score >= ATTENDANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(r => r.character);
}

// Confinement venue filter — events at these venues never appear in the strip
const CONFINEMENT_NAME_FRAGMENTS = [
  'jail', 'prison', 'detention', 'correctional', 'holding cell',
  'juvenile detention', 'halfway house', 'cgv jail',
];
const isConfinementVenue = (locationName) => {
  if (!locationName) return false;
  const lower = locationName.toLowerCase();
  return CONFINEMENT_NAME_FRAGMENTS.some(f => lower.includes(f));
};

export default function CommunityEventsStrip({ currentUser, characters = [] }) {
  const scrollRef = useRef(null);

  const { data: appLocations = [] } = useQuery({
    queryKey: ['locationReferences', currentUser?.email],
    queryFn: async () => {
      const res = await base44.functions.invoke('fetchAllLocationsForUser', {});
      return res?.data?.locations || [];
    },
    enabled: !!currentUser?.email,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  // Source 1: Global/system DB-backed community events
  const { data: globalDbEvents = [] } = useQuery({
    queryKey: ['communityEventsGlobal'],
    queryFn: () => base44.entities.CommunityEvent.filter({ is_active: true }, 'start_date', 100).catch(() => []),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  // Source 2: User-created Moments calendar events
  const { data: userDbEvents = [] } = useQuery({
    queryKey: ['communityEventsUser', currentUser?.email],
    queryFn: () => base44.entities.CommunityEvent.filter(
      { owner_email: currentUser.email, is_active: true }, 'start_date', 50
    ).catch(() => []),
    enabled: !!currentUser?.email,
    staleTime: 2 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });

  const displayEvents = useMemo(() => {
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const seenIds = new Set();
    const merged = [];

    for (const e of globalDbEvents) {
      if (!e.start_date || new Date(e.start_date) < cutoff) continue;
      if (isConfinementVenue(e.location_name)) continue;
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      merged.push(e);
    }

    for (const e of userDbEvents) {
      if (!e.start_date || new Date(e.start_date) < cutoff) continue;
      if ((e.source === 'user_calendar' || e.source === 'user') && e.show_on_community_strip === false) continue;
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      merged.push(e);
    }

    merged.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    for (const e of buildDefaultCommunityEvents(appLocations)) {
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      merged.push(e);
    }

    return merged.slice(0, 10);
  }, [globalDbEvents, userDbEvents, appLocations]);

  // Compute attendees per event (scored, not exhaustive)
  const eventAttendees = useMemo(() => {
    const result = {};
    for (const event of displayEvents) {
      result[event.id] = getEventAttendees(event, characters, appLocations);
    }
    return result;
  }, [displayEvents, characters, appLocations]);

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
        Community Activity
      </h3>
      <div ref={scrollRef} className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
        {displayEvents.map((event) => {
          const icon = event._icon || EVENT_TYPE_ICONS[event.event_type] || '📌';
          const eventDate = event.start_date ? new Date(event.start_date) : null;
          const attendees = eventAttendees[event.id] || [];
          // Determine if the event location exists in app or is a rabbit hole
          const appLocationMatch = event.location_id
            ? appLocations.find(l => l.id === event.location_id)
            : appLocations.find(l => l.name?.toLowerCase() === event.location_name?.toLowerCase());
          const isRabbitHole = event.location_name && !appLocationMatch;

          return (
            <div
              key={event.id}
              className="flex-shrink-0 w-52 p-3 rounded-lg bg-secondary/50 border border-border hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start gap-1.5 mb-1">
                <span className="text-sm leading-none mt-0.5 shrink-0">{icon}</span>
                <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{event.name}</p>
              </div>
              <p className="text-xs text-muted-foreground capitalize mb-2">
                {(event.event_type || 'community').replace(/_/g, ' ')}
              </p>
              <div className="space-y-1 text-xs text-muted-foreground">
                {event.location_name && (
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">
                      {event.location_name}
                      {isRabbitHole && (
                        <span className="ml-1 text-[10px] text-muted-foreground/50">(pop-up)</span>
                      )}
                    </span>
                  </div>
                )}
                {eventDate && (
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">
                      {eventDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {' · '}
                      {eventDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                )}
              </div>

              {/* Likely attendees */}
              {attendees.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5">
                  <Users className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <div className="flex -space-x-1.5">
                    {attendees.slice(0, 3).map(char => (
                      <div key={char.id} className="w-5 h-5 rounded-full border border-border bg-secondary overflow-hidden flex-shrink-0" title={char.name}>
                        {char.avatar_url
                          ? <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
                          : <span className="text-[8px] font-bold text-foreground flex items-center justify-center w-full h-full">{char.name?.[0]}</span>
                        }
                      </div>
                    ))}
                    {attendees.length > 3 && (
                      <div className="w-5 h-5 rounded-full border border-border bg-secondary flex items-center justify-center flex-shrink-0">
                        <span className="text-[8px] text-muted-foreground">+{attendees.length - 3}</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground/70 truncate">
                    {attendees.length === 1 ? `${attendees[0].name?.split(' ')[0]} may attend` : `${attendees.length} may attend`}
                  </span>
                </div>
              )}

              {event.vibe && (
                <p className="text-[10px] text-muted-foreground/60 mt-1.5 capitalize">
                  Vibe: <span className="text-foreground/70">{event.vibe}</span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}