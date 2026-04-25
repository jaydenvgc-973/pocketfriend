import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Generate a catch-up narrative when user returns to chat after time has passed.
 * Uses backfilled AutomaticNarrative records to build the catch-up text.
 * Called from Chat page before character responds.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, lastUserMessageTime, conversationId } = await req.json();
    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    console.log(`[generateCatchupNarrative] characterId=${characterId} conversationId=${conversationId}`);

    // ── 1. FETCH CHARACTER ───────────────────────────────────────────────
    const charList = await base44.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
    const character = charList?.[0];
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }

    // ── 2. DETERMINE ANCHOR TIME ─────────────────────────────────────────
    let anchorTime = lastUserMessageTime ? new Date(lastUserMessageTime) : null;

    // If no anchor time provided, get last user message from conversation
    if (!anchorTime && conversationId) {
      const lastMsgs = await base44.entities.Message.filter(
        { conversation_id: conversationId, sender_type: 'user' },
        '-created_date',
        1
      ).catch(() => []);
      if (lastMsgs?.[0]) {
        anchorTime = new Date(lastMsgs[0].timestamp || lastMsgs[0].created_date);
      }
    }

    if (!anchorTime) {
      return Response.json({ skipped: true, reason: 'no_anchor_time' });
    }

    const minutesAway = Math.floor((Date.now() - anchorTime.getTime()) / 60000);
    console.log(`[generateCatchupNarrative] minutesAway=${minutesAway}`);

    // Only create catch-up if significant time has passed (> 30 mins)
    if (minutesAway < 30) {
      return Response.json({ skipped: true, reason: 'not_enough_time', minutesAway });
    }

    // ── 3. FETCH BACKFILLED NARRATIVES ───────────────────────────────────
    // These are AutomaticNarrative records saved by backfillMissingNarratives with triggered_by='backfill'
    let backfilledNarratives = [];
    
    try {
      backfilledNarratives = await base44.asServiceRole.entities.AutomaticNarrative.filter(
        { character_id: characterId, is_catch_up: true },
        '-timestamp',
        50
      );
      console.log(`[generateCatchupNarrative] Found ${backfilledNarratives.length} backfilled narratives in AutomaticNarrative`);
    } catch (err) {
      console.error(`[generateCatchupNarrative] AutomaticNarrative fetch error: ${err.message}`);
      backfilledNarratives = [];
    }

    // Filter to ones after anchor time
    const newNarratives = backfilledNarratives.filter(n => {
      const nTime = new Date(n.timestamp);
      return nTime > anchorTime;
    });

    console.log(`[generateCatchupNarrative] After anchor time filter: ${newNarratives.length} narratives`);

    // ── 4. BUILD CATCH-UP TEXT ───────────────────────────────────────────
    let catchupText = '';
    const hoursAway = Math.floor(minutesAway / 60);

    if (newNarratives.length === 0) {
      // No backfilled narratives yet — generate a passive catch-up
      catchupText = buildPassiveCatchup(character, hoursAway, minutesAway);
      console.log(`[generateCatchupNarrative] Using passive catch-up (no backfilled narratives)`);
    } else {
      // Sort by time ascending to build a chronological story
      newNarratives.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // Build catch-up text from backfilled narratives
      const timePhrase = hoursAway >= 24
        ? `${Math.floor(hoursAway / 24)} day${Math.floor(hoursAway / 24) > 1 ? 's' : ''}`
        : hoursAway >= 2
        ? `${hoursAway} hours`
        : `${minutesAway} minutes`;

      const narrativeLines = newNarratives
        .slice(0, 5) // Cap at 5 narratives to avoid overwhelming
        .map(n => n.narrative_text)
        .join('\n\n');

      catchupText = `While you were away for ${timePhrase}:\n\n${narrativeLines}`;
      console.log(`[generateCatchupNarrative] Built catch-up from ${newNarratives.length} backfilled narratives`);
    }

    return Response.json({
      success: true,
      catchupText,
      minutesAway,
      hoursAway,
      narrativesFound: newNarratives.length,
      shouldDisplayCatchup: true,
    });

  } catch (error) {
    console.error('[generateCatchupNarrative] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ── HELPERS ───────────────────────────────────────────────────────────────────

function isSleepingNow(character) {
  const hour = new Date().getHours();
  const sleepTime = character.sleep_start_time ? parseInt(character.sleep_start_time) : 23;
  const wakeTime = character.wake_up_time ? parseInt(character.wake_up_time) : 7;
  return hour >= sleepTime || hour < wakeTime;
}

function buildPassiveCatchup(character, hoursAway, minutesAway) {
  const charName = character.name;
  const timePhrase = hoursAway >= 2 ? `${hoursAway} hours` : `${minutesAway} minutes`;

  if (isSleepingNow(character)) {
    return `${charName} has been asleep for the past ${timePhrase}. Just resting.`;
  }
  if (character.resolved_presence_status === 'at_work') {
    return `${charName} has been at work for the past ${timePhrase}, keeping busy with their shift.`;
  }
  return `${charName} has been going about their day for the past ${timePhrase}. Nothing too eventful.`;
}