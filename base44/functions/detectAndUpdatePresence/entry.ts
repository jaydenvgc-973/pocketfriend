import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * detectAndUpdatePresence
 *
 * Detects presence changes from character narratives and updates PresenceState.
 * Called after each character response to auto-detect arrival/departure.
 *
 * Input:
 *  - characterId: character ID
 *  - narrativeText: the character's response (visible text only, not internal prompts)
 *  - conversationId: current conversation ID
 *
 * Returns:
 *  - presenceState: updated PresenceState object
 *  - stateChanged: boolean (did presence change?)
 *  - changeReason: string (why the change occurred)
 */

const ARRIVAL_PATTERNS = [
  /\b(walk|comes|arrives|shows up|pulls up|sits down|sits across|sits next to|takes a seat|joins|enters|walks in|walks up to|approaches|spots|sees|looks at|greets|hugs|hugs you)\b/i,
  /\b(I'm (here|at|with|by))\b/i,
  /\b(just arrived|just got here|I'm here now|I'm with you|I'm at)\b/i,
  /\b(sits|takes a seat|sits down) ?(next to you|across from you|by you)?/i,
];

const DEPARTURE_PATTERNS = [
  /\b(leaves|walk away|walks away|stands up and leaves|heading out|getting out of here|gotta go|I'm leaving|going back|walk back|step back|back away|turn away|walks off|drives off|get up and|get out of)\b/i,
  /\b(I'm (leaving|going|heading|out of here))\b/i,
  /\b(see you (later|soon)|catch you (later|soon)|gotta (run|split|bounce)|I'm out)\b/i,
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, narrativeText, conversationId } = await req.json();
    if (!characterId || !narrativeText || !conversationId) {
      return Response.json({ error: 'characterId, narrativeText, conversationId required' }, { status: 400 });
    }

    // Fetch or create current presence state
    const existing = await base44.asServiceRole.entities.PresenceState.filter({ character_id: characterId });
    let presenceState = existing[0] || {
      character_id: characterId,
      state: 'remote',
      meeting_scheduled: false,
      conversation_id: conversationId,
    };

    let stateChanged = false;
    let changeReason = '';
    const oldState = presenceState.state;

    // Check for arrival patterns
    const hasArrivalCue = ARRIVAL_PATTERNS.some(p => p.test(narrativeText));
    // Check for departure patterns
    const hasDepartureCue = DEPARTURE_PATTERNS.some(p => p.test(narrativeText));

    // LOGIC:
    // 1. If narrative implies arrival AND we're not yet in same_space, transition to same_space
    // 2. If narrative implies departure AND we're in same_space, revert to remote
    // 3. If scheduled meeting is due, automatically expect same_space (but only after arrival narrative)

    if (hasArrivalCue && presenceState.state !== 'same_space') {
      presenceState.state = 'same_space';
      presenceState.narrative_confirmed_at = new Date().toISOString();
      presenceState.meeting_started_at = new Date().toISOString();
      presenceState.last_narrative_trigger = narrativeText.substring(0, 150);
      stateChanged = true;
      changeReason = 'Arrival detected in narrative';
    } else if (hasDepartureCue && presenceState.state === 'same_space') {
      presenceState.state = 'remote';
      presenceState.meeting_ended_at = new Date().toISOString();
      presenceState.last_narrative_trigger = narrativeText.substring(0, 150);
      stateChanged = true;
      changeReason = 'Departure detected in narrative';
      
      // If meeting happened, log it to memory
      if (presenceState.meeting_started_at) {
        await base44.asServiceRole.entities.Memory.create({
          character_id: characterId,
          title: 'Met with user',
          description: `You met with the user at ${presenceState.meeting_location || 'a location'}. You were together for a while, then left.`,
          emotional_impact: 'positive',
          timestamp: new Date().toISOString(),
          source_context: `presence_meeting_${presenceState.meeting_started_at}`,
        }).catch(() => {});
      }
    }

    presenceState.last_state_change = new Date().toISOString();

    // Persist to database
    if (existing[0]) {
      await base44.asServiceRole.entities.PresenceState.update(presenceState.id, presenceState);
    } else {
      await base44.asServiceRole.entities.PresenceState.create(presenceState);
    }

    return Response.json({
      success: true,
      presenceState,
      stateChanged,
      changeReason,
      oldState,
      detectedArrival: hasArrivalCue,
      detectedDeparture: hasDepartureCue,
    });
  } catch (error) {
    console.error('[detectAndUpdatePresence]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});