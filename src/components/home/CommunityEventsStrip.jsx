/**
 * CommunityEventsStrip
 *
 * Displays upcoming community events with scored likely-attendee bubbles.
 *
 * SCORING CONTRACT:
 * - Every bubble shown has a documented reason (returned from scoreAttendance).
 * - Hard blockers are checked first — no bubble is shown for a blocked character.
 * - Rabbit-hole events (location not in app) are allowed and tagged "(pop-up)".
 * - No permanent location is ever created by this component.
 * - No character state is ever written by this component.
 *
 * HARD BLOCKERS (score = 0, no bubble):
 *   - is_jailed = true
 *   - house_arrest_active = true
 *   - hospital / incapacitated (health_value < 10 OR health_status contains "hospital")
 *   - resolved_presence_status ∈ { incarcerated, house_arrest, confined, at_work, at_school,
 *       sleeping, napping, temporary_housing, traveling }
 *   - active committed travel (travel_status !== 'not_traveling')
 *   - asleep (night_owl exception: energetic/social events after 20:00 may override)
 *
 * SCORING FACTORS (additive, capped 0–100):
 *   Base:           30
 *   Vibe match:     +10–15
 *   Social energy:  +5–15
 *   Trait match:    +5–25 per matching trait
 *   Event type:     +5–20
 *   Location known: +10 (rabbit-hole: -5)
 *   Frequents loc:  +15
 *   Interests/tags: +10 per match
 *   Low social need:+15 (social_value < 40)
 *   Romantic level: +5 (> 50)
 *   Friendship lvl: +5 (> 70)
 *   Low energy:     -20 (energy_value < 30)
 *   Night owl bonus:+15 for energetic events > 20:00
 *   Religion/comm:  +10 for support/resource events if religious
 *
 * THRESHOLD: >= 45 = included
 * DISPLAY:   top 3 attendees (score-sorted), overflow "+N" badge
 */

import React, { useRef, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Calendar, MapPin, Users, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { buildDefaultCommunityEvents, EVENT_TYPE_ICONS } from '@/lib/defaultCommunityEvents';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const ATTENDANCE_THRESHOLD = 45;

/** Hard-blocked presence states — no bubble ever shown */
const HARD_BLOCKED_PRESENCE = new Set([
  'incarcerated',
  'house_arrest',
  'confined',
  'at_work',
  'at_school',
  'sleeping',
  'napping',
  'temporary_housing',
  'traveling',
]);

/** Confinement venue names — events at these are filtered from the strip entirely */
const CONFINEMENT_NAME_FRAGMENTS = [
  'jail', 'prison', 'detention', 'correctional', 'holding cell',
  'juvenile detention', 'halfway house', 'cgv jail',
];

/** Map event types → personality text keywords that indicate interest */
const EVENT_TYPE_INTEREST_KEYWORDS = {
  fitness:       ['fitness', 'gym', 'active', 'sport', 'yoga', 'health', 'workout', 'athletic', 'runner'],
  educational:   ['curious', 'student', 'scholar', 'bookworm', 'intellectual', 'learn', 'education', 'study'],
  cultural:      ['creative', 'artsy', 'culture', 'art', 'museum', 'gallery', 'theater', 'artist'],
  entertainment: ['performer', 'singer', 'musician', 'dancer', 'comedian', 'karaoke', 'nightlife'],
  support:       ['empath', 'compassion', 'therapist', 'counselor', 'mentor', 'social work'],
  celebration:   ['party', 'festive', 'fun', 'social', 'dance', 'celebrate'],
  social:        ['social', 'coffee', 'outgoing', 'friendly', 'talkative', 'community'],
  health_awareness: ['health', 'wellness', 'medical', 'nurse', 'doctor', 'fitness'],
  resource_fair: ['volunteer', 'ministry', 'community', 'service', 'charitable', 'food'],
};

/** Map event types → avoidance/dislike keywords that lower the score */
const EVENT_TYPE_AVOIDANCE_KEYWORDS = {
  fitness:       ['lazy', 'sedentary', 'hates exercise', 'couch'],
  social:        ['antisocial', 'loner', 'recluse', 'hates crowds', 'crowd'],
  entertainment: ['quiet', 'shy', 'reserved', 'introvert', 'hates loud'],
  celebration:   ['depressed', 'grieving', 'withdrawn', 'antisocial'],
};

// ── SCORING ENGINE ────────────────────────────────────────────────────────────

/**
 * Score a character's likelihood of attending a community event.
 *
 * @param {Object} character - Full Character entity record
 * @param {Object} event     - CommunityEvent record (or default event object)
 * @param {Object[]} appLocations - All LocationReference records for this user
 * @returns {{
 *   score: number,
 *   reasons: string[],
 *   blocked: boolean,
 *   blockedReason: string|null,
 *   diagnostic: Object
 * }}
 */
function scoreAttendance(character, event, appLocations) {
  const diagnostic = {
    characterName: character.name || character.display_name,
    characterId: character.id,
    eventName: event.name,
    eventLocation: event.location_name,
    blockerChecks: [],
    scoringFactors: [],
  };

  // ── HARD BLOCKER: Incarcerated ──────────────────────────────────────────
  if (character.is_jailed) {
    diagnostic.blockerChecks.push('is_jailed = true → HARD BLOCK');
    return { score: 0, reasons: [], blocked: true, blockedReason: 'incarcerated', diagnostic };
  }

  // ── HARD BLOCKER: House Arrest ──────────────────────────────────────────
  if (character.house_arrest_active) {
    diagnostic.blockerChecks.push('house_arrest_active = true → HARD BLOCK');
    return { score: 0, reasons: [], blocked: true, blockedReason: 'house arrest', diagnostic };
  }

  // ── HARD BLOCKER: Hospitalized / Incapacitated ──────────────────────────
  const healthStatus = (character.health_status || '').toLowerCase();
  const healthValue = character.health_value ?? 80;
  const isHospitalized = healthValue < 10 || healthStatus.includes('hospital') || healthStatus.includes('incapacitat') || healthStatus.includes('critical');
  if (isHospitalized) {
    diagnostic.blockerChecks.push(`health_value=${healthValue}, health_status="${character.health_status}" → HARD BLOCK (hospitalized/incapacitated)`);
    return { score: 0, reasons: [], blocked: true, blockedReason: 'hospitalized/incapacitated', diagnostic };
  }

  // ── HARD BLOCKER: Presence state ────────────────────────────────────────
  const presence = character.resolved_presence_status || '';
  if (HARD_BLOCKED_PRESENCE.has(presence)) {
    // Night-owl exception: if sleeping AND it's an energetic/social event after 8PM,
    // check if character is a night owl before blocking.
    if ((presence === 'sleeping' || presence === 'napping') && character.trait_night_owl) {
      const eventHour = event.start_date ? new Date(event.start_date).getHours() : 0;
      const vibe = event.vibe || '';
      if ((vibe === 'energetic' || vibe === 'social') && eventHour >= 20) {
        // Night owl exception granted — don't block, continue scoring
        diagnostic.blockerChecks.push(`presence=${presence} BUT trait_night_owl=true + event hour=${eventHour} + vibe=${vibe} → NIGHT OWL EXCEPTION GRANTED`);
      } else {
        diagnostic.blockerChecks.push(`presence=${presence} → HARD BLOCK (asleep, no night-owl exception for this event)`);
        return { score: 0, reasons: [], blocked: true, blockedReason: `asleep (${presence})`, diagnostic };
      }
    } else {
      diagnostic.blockerChecks.push(`resolved_presence_status="${presence}" → HARD BLOCK`);
      return { score: 0, reasons: [], blocked: true, blockedReason: presence.replace(/_/g, ' '), diagnostic };
    }
  }

  // All blockers passed — begin scoring
  let score = 30;
  const reasons = [];
  const factors = diagnostic.scoringFactors;

  const eventType = event.event_type || 'social';
  const vibe = event.vibe || 'social';
  const socialEnergy = character.social_energy || 'ambivert';
  const personalityText = ((character.personality_summary || '') + ' ' + (character.backstory || '')).toLowerCase();
  const traits = (character.personality_traits || []).map(t => t.toLowerCase()).join(' ');
  const allText = personalityText + ' ' + traits;
  const eventHour = event.start_date ? new Date(event.start_date).getHours() : 12;
  const awarenessInterests = (character.interest_tags || []).map(t => t.toLowerCase());

  // ── VIBE × SOCIAL ENERGY ────────────────────────────────────────────────
  if (vibe === 'energetic' || vibe === 'social') {
    if (['extrovert', 'mostly_extrovert'].includes(socialEnergy)) {
      score += 15; reasons.push('extrovert matches energetic/social vibe');
      factors.push({ factor: 'vibe+social_energy', delta: +15 });
    } else if (socialEnergy === 'ambivert') {
      score += 8; reasons.push('ambivert matches social vibe');
      factors.push({ factor: 'vibe+social_energy', delta: +8 });
    } else {
      score -= 5; reasons.push('introvert at social/energetic event');
      factors.push({ factor: 'vibe+social_energy', delta: -5 });
    }
  } else if (vibe === 'quiet') {
    if (['introvert', 'mostly_introvert'].includes(socialEnergy)) {
      score += 12; reasons.push('introvert matches quiet vibe');
      factors.push({ factor: 'vibe+social_energy', delta: +12 });
    } else if (socialEnergy === 'ambivert') {
      score += 6; reasons.push('ambivert at quiet event');
      factors.push({ factor: 'vibe+social_energy', delta: +6 });
    }
  }

  // ── BOOLEAN TRAIT MATCHES ────────────────────────────────────────────────
  if (character.trait_compassionate && (eventType === 'support' || eventType === 'resource_fair')) {
    score += 20; reasons.push('compassionate → support/resource event'); factors.push({ factor: 'trait_compassionate', delta: +20 });
  }
  if (character.trait_competitive && eventType === 'fitness') {
    score += 20; reasons.push('competitive → fitness event'); factors.push({ factor: 'trait_competitive', delta: +20 });
  }
  if (character.trait_loyal && eventType === 'celebration') {
    score += 15; reasons.push('loyal → celebration'); factors.push({ factor: 'trait_loyal', delta: +15 });
  }
  if (character.trait_night_owl && (vibe === 'energetic' || vibe === 'social') && eventHour >= 20) {
    score += 15; reasons.push('night owl + late energetic event'); factors.push({ factor: 'trait_night_owl', delta: +15 });
  }
  if (character.trait_loud && eventType === 'entertainment') {
    score += 12; reasons.push('loud → entertainment event'); factors.push({ factor: 'trait_loud', delta: +12 });
  }
  if (character.trait_empathetic && eventType === 'support') {
    score += 15; reasons.push('empathetic → support event'); factors.push({ factor: 'trait_empathetic', delta: +15 });
  }
  if (character.trait_conscientious && eventType === 'educational') {
    score += 12; reasons.push('conscientious → educational event'); factors.push({ factor: 'trait_conscientious', delta: +12 });
  }
  if (character.trait_generous && (eventType === 'resource_fair' || eventType === 'support')) {
    score += 10; reasons.push('generous → community giving event'); factors.push({ factor: 'trait_generous', delta: +10 });
  }
  if (character.trait_flirty && (eventType === 'social' || eventType === 'entertainment')) {
    score += 8; reasons.push('flirty → social/entertainment event'); factors.push({ factor: 'trait_flirty', delta: +8 });
  }
  if (character.trait_risk_taker && eventType === 'entertainment') {
    score += 8; reasons.push('risk taker → entertainment'); factors.push({ factor: 'trait_risk_taker', delta: +8 });
  }
  if (character.trait_morning_person && eventHour < 11) {
    score += 10; reasons.push('morning person + early event'); factors.push({ factor: 'trait_morning_person', delta: +10 });
  }
  if (character.trait_hard_to_read && vibe === 'quiet') {
    score += 5; reasons.push('hard to read → prefers quiet'); factors.push({ factor: 'trait_hard_to_read', delta: +5 });
  }
  if (character.trait_bougie && (eventType === 'cultural' || eventType === 'celebration')) {
    score += 10; reasons.push('bougie → cultural/celebration event'); factors.push({ factor: 'trait_bougie', delta: +10 });
  }

  // ── AVOIDANCE / NEGATIVE TRAITS (blockers-light) ──────────────────────────
  if (character.trait_cynical) {
    score -= 5; reasons.push('cynical (slight aversion to group events)'); factors.push({ factor: 'trait_cynical', delta: -5 });
  }
  if (character.trait_self_absorbed && eventType === 'support') {
    score -= 10; reasons.push('self-absorbed → unlikely to attend support events'); factors.push({ factor: 'trait_self_absorbed', delta: -10 });
  }
  if (character.trait_goody_two_shoes && (eventType === 'entertainment' && vibe === 'energetic')) {
    score -= 5; reasons.push('goody two shoes + energetic entertainment (slight mismatch)'); factors.push({ factor: 'trait_goody_two_shoes', delta: -5 });
  }

  // ── PERSONALITY TEXT / INTEREST KEYWORD SCAN ────────────────────────────
  const interestKeywords = EVENT_TYPE_INTEREST_KEYWORDS[eventType] || [];
  const matchedInterests = interestKeywords.filter(kw => allText.includes(kw));
  if (matchedInterests.length > 0) {
    const delta = Math.min(matchedInterests.length * 8, 24);
    score += delta; reasons.push(`personality mentions: ${matchedInterests.slice(0, 2).join(', ')}`);
    factors.push({ factor: 'interest_keyword_match', matched: matchedInterests, delta });
  }

  // Avoidance keyword scan
  const avoidanceKeywords = EVENT_TYPE_AVOIDANCE_KEYWORDS[eventType] || [];
  const matchedAvoidances = avoidanceKeywords.filter(kw => allText.includes(kw));
  if (matchedAvoidances.length > 0) {
    const delta = -matchedAvoidances.length * 6;
    score += delta; reasons.push(`avoidance indicators: ${matchedAvoidances.slice(0, 2).join(', ')}`);
    factors.push({ factor: 'avoidance_keyword_match', matched: matchedAvoidances, delta });
  }

  // ── AWARENESS PROFILE INTEREST TAGS ─────────────────────────────────────
  const relevantTags = {
    fitness: ['fitness', 'gym', 'health', 'yoga', 'sport'],
    educational: ['education', 'books', 'learning', 'reading'],
    cultural: ['art', 'culture', 'theater', 'museum', 'gallery'],
    entertainment: ['music', 'performance', 'comedy', 'karaoke'],
    social: ['coffee', 'socializing', 'community'],
  }[eventType] || [];
  const tagMatches = awarenessInterests.filter(tag => relevantTags.some(r => tag.includes(r)));
  if (tagMatches.length > 0) {
    score += Math.min(tagMatches.length * 8, 16);
    reasons.push(`interest tags match: ${tagMatches.slice(0, 2).join(', ')}`);
    factors.push({ factor: 'interest_tags', matched: tagMatches, delta: Math.min(tagMatches.length * 8, 16) });
  }

  // ── RELIGION/COMMUNITY ALIGNMENT ────────────────────────────────────────
  const religion = character.religion || 'None';
  const beliefLevel = character.belief_level || 'moderate';
  if (religion !== 'None' && religion !== '' && (eventType === 'support' || eventType === 'resource_fair')) {
    score += 10; reasons.push(`religious (${religion}) → community/support event`);
    factors.push({ factor: 'religion_community', delta: +10 });
  }

  // ── LOCATION AVAILABILITY ────────────────────────────────────────────────
  // Rabbit-hole: event at a location not in the app — still possible (backstory opportunity)
  const appLocationMatch = event.location_id
    ? appLocations.find(l => l.id === event.location_id)
    : appLocations.find(l => l.name?.toLowerCase().trim() === event.location_name?.toLowerCase().trim());

  if (appLocationMatch) {
    score += 10; reasons.push(`location "${appLocationMatch.name}" exists in world`);
    factors.push({ factor: 'location_in_world', delta: +10 });
    // Bonus: character frequents this location
    if ((character.frequented_places || []).includes(appLocationMatch.id)) {
      score += 15; reasons.push(`frequents ${appLocationMatch.name}`);
      factors.push({ factor: 'frequents_location', delta: +15 });
    }
    // Bonus: character lives or works nearby
    if (character.current_home_location_id === appLocationMatch.id) {
      score += 5; reasons.push('lives at event venue'); factors.push({ factor: 'lives_at_venue', delta: +5 });
    }
  } else if (event.location_name) {
    // Rabbit-hole — slightly less likely but valid (creates natural backstory/narrative)
    score -= 5; reasons.push('rabbit-hole venue (not in app — possible backstory opportunity)');
    factors.push({ factor: 'rabbit_hole_venue', delta: -5 });
  }

  // ── RELATIONSHIP/SOCIAL MOTIVATION ──────────────────────────────────────
  if ((character.friendship_level || 75) > 70) {
    score += 5; reasons.push('high friendship level → socially motivated');
    factors.push({ factor: 'friendship_level', delta: +5 });
  }
  if ((character.romantic_level || 0) > 50) {
    score += 5; reasons.push('romantically active → likely to attend social events');
    factors.push({ factor: 'romantic_level', delta: +5 });
  }

  // ── NEEDS STATE ───────────────────────────────────────────────────────────
  const socialValue = character.social_value ?? 65;
  const energyValue = character.energy_value ?? 75;

  if (socialValue < 40) {
    score += 15; reasons.push(`low social need (${socialValue}) → wants to socialize`);
    factors.push({ factor: 'low_social_need', delta: +15 });
  }
  if (energyValue < 30) {
    score -= 20; reasons.push(`very low energy (${energyValue}) → unlikely to attend`);
    factors.push({ factor: 'low_energy', delta: -20 });
  } else if (energyValue < 50) {
    score -= 8; reasons.push(`low energy (${energyValue}) → slight dampening`);
    factors.push({ factor: 'low_energy_mild', delta: -8 });
  }

  // Cap at 0–100
  score = Math.max(0, Math.min(100, score));

  diagnostic.blockerChecks.push('ALL BLOCKERS PASSED');
  diagnostic.finalScore = score;
  diagnostic.threshold = ATTENDANCE_THRESHOLD;
  diagnostic.included = score >= ATTENDANCE_THRESHOLD;

  return { score, reasons, blocked: false, blockedReason: null, diagnostic };
}

/**
 * Get scored likely attendees for an event.
 * Returns full diagnostic for each character evaluated.
 */
function getEventAttendeesWithDiagnostic(event, characters, appLocations) {
  if (!characters || characters.length === 0) return { attendees: [], allDiagnostics: [] };

  const evaluated = characters.map(char => {
    const result = scoreAttendance(char, event, appLocations);
    return { character: char, ...result };
  });

  const included = evaluated
    .filter(r => !r.blocked && r.score >= ATTENDANCE_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  return {
    attendees: included.slice(0, 4).map(r => r.character),
    allDiagnostics: evaluated.map(r => ({
      name: r.character.name,
      score: r.score,
      included: !r.blocked && r.score >= ATTENDANCE_THRESHOLD,
      blocked: r.blocked,
      blockedReason: r.blockedReason,
      reasons: r.reasons,
      diagnostic: r.diagnostic,
    })),
  };
}

// Confinement venue guard — events AT these venues never appear
const isConfinementVenue = (locationName) => {
  if (!locationName) return false;
  const lower = locationName.toLowerCase();
  return CONFINEMENT_NAME_FRAGMENTS.some(f => lower.includes(f));
};

// ── DIAGNOSTIC PANEL ─────────────────────────────────────────────────────────

function AttendanceDiagnosticPanel({ diagnostics, eventName, onClose }) {
  return (
    <div className="mt-2 bg-card border border-border rounded-lg p-3 space-y-2 text-xs max-h-64 overflow-y-auto">
      <div className="flex items-center justify-between mb-1">
        <p className="font-semibold text-foreground">{eventName} — Attendance Diagnostic</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-[10px] underline">Close</button>
      </div>
      {diagnostics.map((d, i) => (
        <div key={i} className={`rounded p-2 border ${d.included ? 'border-green-500/30 bg-green-500/5' : d.blocked ? 'border-red-500/30 bg-red-500/5' : 'border-border bg-secondary/30'}`}>
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`font-medium ${d.included ? 'text-green-400' : d.blocked ? 'text-red-400' : 'text-muted-foreground'}`}>
              {d.included ? '✓' : d.blocked ? '✗' : '–'} {d.name}
            </span>
            <span className="text-muted-foreground">score: <span className="text-foreground">{d.score}</span></span>
            {d.blocked && <span className="text-red-400 text-[10px]">({d.blockedReason})</span>}
          </div>
          {d.reasons.length > 0 && (
            <p className="text-muted-foreground text-[10px] leading-relaxed">{d.reasons.join(' · ')}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function CommunityEventsStrip({ currentUser, characters = [] }) {
  const scrollRef = useRef(null);
  const [openDiagnosticEventId, setOpenDiagnosticEventId] = useState(null);

  // Fetch app locations — shared query key with Home page (no duplicate fetch)
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

  // DB-backed system events (admin-created)
  const { data: globalDbEvents = [] } = useQuery({
    queryKey: ['communityEventsGlobal'],
    queryFn: () => base44.entities.CommunityEvent.filter({ is_active: true }, 'start_date', 100).catch(() => []),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  // User-created Moments calendar events
  const { data: userDbEvents = [] } = useQuery({
    queryKey: ['communityEventsUser', currentUser?.email],
    queryFn: () => base44.entities.CommunityEvent.filter(
      { owner_email: currentUser.email, is_active: true }, 'start_date', 50
    ).catch(() => []),
    enabled: !!currentUser?.email,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  // Merge + dedupe events (DB first, defaults fill gaps)
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

    // Fill remaining slots with default events (no permanent location creation)
    for (const e of buildDefaultCommunityEvents(appLocations)) {
      if (seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      merged.push(e);
    }

    return merged.slice(0, 10);
  }, [globalDbEvents, userDbEvents, appLocations]);

  // Score all characters against each event — memoized
  const eventData = useMemo(() => {
    const result = {};
    for (const event of displayEvents) {
      result[event.id] = getEventAttendeesWithDiagnostic(event, characters, appLocations);
    }
    return result;
  }, [displayEvents, characters, appLocations]);

  if (displayEvents.length === 0) return null;

  return (
    <div className="pt-4 border-t border-border">
      <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
        Community Activity
      </h3>

      <div ref={scrollRef} className="flex gap-2 overflow-x-auto scrollbar-hide pb-2">
        {displayEvents.map((event) => {
          const icon = event._icon || EVENT_TYPE_ICONS[event.event_type] || '📌';
          const eventDate = event.start_date ? new Date(event.start_date) : null;
          const { attendees, allDiagnostics } = eventData[event.id] || { attendees: [], allDiagnostics: [] };
          const isShowingDiagnostic = openDiagnosticEventId === event.id;

          // Rabbit-hole detection: location name given but not matched to any app location
          const appLocationMatch = event.location_id
            ? appLocations.find(l => l.id === event.location_id)
            : appLocations.find(l => l.name?.toLowerCase().trim() === event.location_name?.toLowerCase().trim());
          const isRabbitHole = event.location_name && !appLocationMatch;

          return (
            <div
              key={event.id}
              className="flex-shrink-0 w-56 p-3 rounded-lg bg-secondary/50 border border-border hover:border-primary/40 transition-colors"
            >
              {/* Event header */}
              <div className="flex items-start gap-1.5 mb-1">
                <span className="text-sm leading-none mt-0.5 shrink-0">{icon}</span>
                <p className="text-sm font-semibold text-foreground leading-snug line-clamp-2">{event.name}</p>
              </div>

              <p className="text-xs text-muted-foreground capitalize mb-2">
                {(event.event_type || 'community').replace(/_/g, ' ')}
              </p>

              {/* Location + date */}
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

              {/* Scored attendee bubbles */}
              {attendees.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5">
                  <Users className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  <div className="flex -space-x-1.5">
                    {attendees.slice(0, 3).map(char => (
                      <div
                        key={char.id}
                        className="w-5 h-5 rounded-full border border-border bg-secondary overflow-hidden flex-shrink-0"
                        title={`${char.name} — may attend`}
                      >
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
                  <span className="text-[10px] text-muted-foreground/70 truncate flex-1">
                    {attendees.length === 1
                      ? `${attendees[0].name?.split(' ')[0]} may attend`
                      : `${attendees.length} may attend`}
                  </span>
                  {/* Diagnostic toggle — only shown when characters are passed */}
                  {allDiagnostics.length > 0 && (
                    <button
                      onClick={() => setOpenDiagnosticEventId(isShowingDiagnostic ? null : event.id)}
                      className="text-muted-foreground/50 hover:text-primary transition-colors flex-shrink-0"
                      title="View attendance diagnostic"
                    >
                      <Info className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              {/* No attendees — still show diagnostic button so user can see why */}
              {attendees.length === 0 && allDiagnostics.length > 0 && (
                <div className="mt-2 flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground/50 flex-1">No likely attendees</span>
                  <button
                    onClick={() => setOpenDiagnosticEventId(isShowingDiagnostic ? null : event.id)}
                    className="text-muted-foreground/40 hover:text-primary transition-colors flex-shrink-0"
                    title="View why no one is attending"
                  >
                    <Info className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Vibe tag */}
              {event.vibe && (
                <p className="text-[10px] text-muted-foreground/60 mt-1.5 capitalize">
                  Vibe: <span className="text-foreground/70">{event.vibe}</span>
                </p>
              )}

              {/* Inline diagnostic panel */}
              {isShowingDiagnostic && allDiagnostics.length > 0 && (
                <AttendanceDiagnosticPanel
                  diagnostics={allDiagnostics}
                  eventName={event.name}
                  onClose={() => setOpenDiagnosticEventId(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}