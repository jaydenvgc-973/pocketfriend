/**
 * detectAndScheduleCommitments
 *
 * Parses a character message for travel directives, travel promises, and
 * communication promises. Creates durable CharacterCommitment records and
 * ScheduledEvent records for each detected commitment.
 *
 * Called from the chat pipeline immediately after a character sends a message.
 *
 * COMMITMENT TYPES:
 *   travel_directive  — "I'm on my way", "I'm heading there now", "I'm walking in"
 *   travel_promise    — "I'll come by tonight", "I'll stop by after work"
 *   communication_promise — "I'll text you later", "I'll call in 5 minutes"
 *
 * AUTONOMOUS TRAVEL RULE:
 *   The UserSettings.autonomous_travel_enabled (renamed to "Forced Travel") flag
 *   controls ONLY random/needs-based wandering. It NEVER blocks commitments.
 *   All commitment-driven movement executes regardless of that setting.
 *
 * BLOCKING STATES (hard blockers that prevent travel execution):
 *   - is_jailed = true
 *   - resolved_presence_status in ['incarcerated', 'house_arrest', 'confined']
 *   - house_arrest_active = true
 *   (work and sleep are NOT hard blockers — commitments override them with explanation)
 *
 * Returns: { detected, commitments_created, scheduled_events_created, details[] }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// ── TRAVEL DIRECTIVE PATTERNS (immediate action) ────────────────────────────
// These mean travel starts NOW. Location must update to traveling immediately.
const TRAVEL_DIRECTIVE_PATTERNS = [
  /\b(i'?m?\s*on\s+my\s+way|on\s+my\s+way\s+(?:to|now|over)|heading\s+(?:your\s+way|over\s+now|there\s+now|to\s+you\s+now|out\s+now))\b/i,
  /\b(i'?m?\s*(?:leaving|heading|walking|driving|coming|running)\s+(?:out|over|there|now|to\s+you)\s*(?:right\s+now|now)?)\b/i,
  /\b(just\s+left|already\s+(?:left|heading|on\s+my\s+way|coming))\b/i,
  /\b(i'?m?\s*(?:walking\s+in|pulling\s+up|almost\s+there|around\s+the\s+corner|5\s+minutes\s+away|a\s+few\s+minutes\s+away))\b/i,
  /\b(i'?m?\s*(?:on\s+my\s+way\s+over|headed\s+(?:your\s+way|over|there)))\b/i,
];

// ── TRAVEL PROMISE PATTERNS (future travel) ──────────────────────────────────
// These mean travel is planned for a specific future time window.
const TRAVEL_PROMISE_PATTERNS = [
  /\b(i'?ll?\s*(?:come|head|stop|swing|be|come\s+by|stop\s+by|swing\s+by|drop\s+by)\s+(?:over|by|there|tonight|later|soon|after\s+work|after\s+class|this\s+evening|in\s+a\s+bit|around\s+\d|at\s+\d))\b/i,
  /\b(i'?ll?\s*meet\s+you\s+(?:there|at|by|later|tonight|soon|after))\b/i,
  /\b(i'?ll?\s*be\s+(?:there|over|by\s+your\s+place|at\s+your\s+place|with\s+you)\s+(?:soon|tonight|later|in\s+a\s+bit|around|at|by))\b/i,
];

// ── COMMUNICATION PROMISE PATTERNS ──────────────────────────────────────────
// These mean a message/call will be sent at a future time.
const COMM_PROMISE_PATTERNS = [
  /\b(i'?ll?\s*(?:text|call|message|reach\s+out|hit\s+you\s+up|check\s+in|ping\s+you|dm\s+you|get\s+back\s+to\s+you)\s+(?:later|soon|tonight|in\s+a\s+bit|after\s+work|after\s+class|this\s+evening|when\s+i\s+(?:get\s+(?:there|home|out|done)|finish|can)|tomorrow))\b/i,
  /\b(i'?ll?\s*(?:text|call|message|reach\s+out|hit\s+you\s+up|check\s+in|ping\s+you)\s+(?:you\s+)?in\s+(\d+)\s*(?:minutes?|mins?|hours?|hrs?))\b/i,
  /\b((?:talk|speak|chat)\s+(?:to\s+you\s+)?(?:later|soon|tonight|in\s+a\s+bit))\b/i,
  /\b(i'?ll?\s*(?:let\s+you\s+know|update\s+you|keep\s+you\s+(?:posted|updated))\s+(?:later|soon|tonight|when|after))\b/i,
  /\b((?:give\s+you|shoot\s+you)\s+a\s+(?:call|text|ring|message)\s+(?:later|soon|tonight|in\s+a\s+bit|after))\b/i,
];

// ── TIMING RESOLVER ─────────────────────────────────────────────────────────
// Resolves vague time references into ISO datetime strings (UTC).
// Character punctuality trait adjusts offset slightly.

function resolveTimeWindow(text, nowMs, punctualityTrait = 'normal') {
  const lower = (text || '').toLowerCase();

  // Explicit minutes: "in 5 minutes", "in 10 mins"
  const minMatch = lower.match(/in\s+(\d+)\s*(?:minutes?|mins?)/);
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    const lateFactor = punctualityTrait === 'flaky' ? 1.5 : punctualityTrait === 'late' ? 1.25 : punctualityTrait === 'punctual' ? 1.0 : 1.05;
    return { ms: nowMs + Math.round(mins * 60000 * lateFactor), label: `in ${mins} minutes`, explicit: true };
  }

  // Explicit hours: "in 2 hours"
  const hrMatch = lower.match(/in\s+(\d+)\s*(?:hours?|hrs?)/);
  if (hrMatch) {
    const hrs = parseInt(hrMatch[1], 10);
    return { ms: nowMs + hrs * 3600000, label: `in ${hrs} hour${hrs > 1 ? 's' : ''}`, explicit: true };
  }

  const now = new Date(nowMs);
  const h = now.getUTCHours(); // roughly ET offset handled by approximate zones

  // "soon" / "in a bit" = 10-20 mins
  if (/\b(soon|in\s+a\s+bit|shortly)\b/.test(lower)) {
    return { ms: nowMs + 15 * 60000, label: 'soon (≈15 min)', explicit: false };
  }

  // "later" = 1-2 hours from now
  if (/\blater\b/.test(lower) && !/tonight|this evening|after work|after class/.test(lower)) {
    return { ms: nowMs + 90 * 60000, label: 'later (≈90 min)', explicit: false };
  }

  // "after work" / "after class" = 6pm same day (UTC 22:00 ≈ 6pm ET)
  if (/after\s+(work|class|school)/.test(lower)) {
    const target = new Date(nowMs);
    target.setUTCHours(22, 0, 0, 0); // 6pm ET approx
    if (target.getTime() <= nowMs) target.setUTCDate(target.getUTCDate() + 1);
    return { ms: target.getTime(), label: 'after work/class (≈6 PM)', explicit: false };
  }

  // "tonight" / "this evening" = 8pm same day (UTC 24:00 ≈ 8pm ET)
  if (/tonight|this evening/.test(lower)) {
    const target = new Date(nowMs);
    target.setUTCHours(24, 0, 0, 0);
    if (target.getTime() <= nowMs) target.setUTCDate(target.getUTCDate() + 1);
    return { ms: target.getTime(), label: 'tonight (≈8 PM)', explicit: false };
  }

  // "tomorrow" = next morning 9am (UTC 13:00 ≈ 9am ET)
  if (/tomorrow/.test(lower)) {
    const target = new Date(nowMs);
    target.setUTCDate(target.getUTCDate() + 1);
    target.setUTCHours(13, 0, 0, 0);
    return { ms: target.getTime(), label: 'tomorrow morning', explicit: false };
  }

  // Default for travel directives = arrival in 20 minutes
  return { ms: nowMs + 20 * 60000, label: 'soon (≈20 min)', explicit: false };
}

// ── HARD BLOCKER CHECK ───────────────────────────────────────────────────────
function getHardBlockReason(character) {
  if (character.is_jailed) return `${character.name} is currently incarcerated and cannot travel.`;
  if (character.house_arrest_active) return `${character.name} is under house arrest and cannot leave the residence.`;
  const lockedStatuses = ['incarcerated', 'house_arrest', 'confined'];
  if (lockedStatuses.includes(character.resolved_presence_status)) {
    return `${character.name} is in a confined state (${character.resolved_presence_status}) and cannot travel.`;
  }
  return null;
}

// ── PUNCTUALITY TRAIT RESOLVER ───────────────────────────────────────────────
function getPunctualityTrait(character) {
  if (character.trait_conscientious) return 'punctual';
  if (character.trait_flaky || character.trait_wishy_washy) return 'flaky';
  if (character.trait_easily_distracted || character.trait_hot_and_cold) return 'late';
  return 'normal';
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const ownerEmail = user?.email || null;

    const {
      characterId,
      characterName,
      messageContent,
      conversationId,
      recipientType = 'user',
      recipientCharacterId = null,
      recipientCharacterName = null,
    } = await req.json();

    if (!characterId || !messageContent || !conversationId) {
      return Response.json({ error: 'characterId, messageContent, conversationId required' }, { status: 400 });
    }

    const now = Date.now();
    const detected = [];
    const lower = messageContent.toLowerCase();

    // ── STEP 1: Classify the message ─────────────────────────────────────────
    let isDirective = TRAVEL_DIRECTIVE_PATTERNS.some(p => p.test(lower));
    let isTravel    = TRAVEL_PROMISE_PATTERNS.some(p => p.test(lower));
    let isComm      = COMM_PROMISE_PATTERNS.some(p => p.test(lower));

    // Directives take precedence over travel promises for the same trigger
    if (isDirective && isTravel) isTravel = false;

    if (!isDirective && !isTravel && !isComm) {
      return Response.json({ detected: false, reason: 'no_commitment_language_found' });
    }

    // ── STEP 2: Load character record ─────────────────────────────────────────
    let character = null;
    try {
      const charList = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1);
      character = charList?.[0] || null;
    } catch {}

    if (!character) {
      return Response.json({ detected: false, reason: 'character_not_found' });
    }

    const punctuality = getPunctualityTrait(character);
    const blockReason = getHardBlockReason(character);

    const commitmentBase = {
      character_id: characterId,
      character_name: characterName || character.name,
      owner_email: ownerEmail || character.owner_email || '',
      source_message: messageContent.substring(0, 500),
      conversation_id: conversationId,
      recipient_type: recipientType,
      recipient_character_id: recipientCharacterId || null,
      recipient_character_name: recipientCharacterName || null,
      created_at: new Date(now).toISOString(),
      bilateral_memory_written: false,
    };

    const results = [];

    // ── TRAVEL DIRECTIVE ─────────────────────────────────────────────────────
    if (isDirective) {
      const timeInfo = resolveTimeWindow(lower, now, punctuality);
      const status = blockReason ? 'blocked' : 'in_progress';

      const commitment = await base44.asServiceRole.entities.CharacterCommitment.create({
        ...commitmentBase,
        commitment_type: 'travel_directive',
        status,
        promised_action: 'traveling to meet recipient / arriving at stated destination',
        promised_time_window: 'now (directive)',
        scheduled_execute_at: new Date(timeInfo.ms).toISOString(),
        block_reason: blockReason || null,
        travel_started_at: blockReason ? null : new Date(now).toISOString(),
      });

      if (!blockReason) {
        // IMMEDIATE TRAVEL SESSION: Character said "I'm on my way" — this is an autonomous decision.
        // Create a real TravelSession right now so the commitment destination is locked
        // and cannot be overridden by the next autonomous needs cycle.
        // The destination is the character's current conversation context (user's location or agreed location).
        // We store the commitment_id so the session is marked interruption_allowed=false.
        // Note: destination_location_id may not be determinable from text alone — we use
        // the character's existing traveling_to_location_id or current invite destination if available.
        // The travel session will also update Character.travel_status properly through the TravelSession path.
        let travelSessionStarted = false;
        const directiveDestId = character.traveling_to_location_id || character.travel_destination_location_id;
        if (directiveDestId) {
          const tsRes = await base44.functions.invoke('createTravelSession', {
            characterId,
            destinationLocationId: directiveDestId,
            travelReason: `conversation_directive: "${messageContent.substring(0, 100)}"`,
            travelSource: 'promise',
            sourceConversationId: conversationId,
            ownerEmail: ownerEmail || character.owner_email || '',
          }).catch(e => ({ data: { success: false, error: e.message } }));
          const tsData = tsRes?.data || {};
          if (tsData.success) {
            travelSessionStarted = true;
            console.log(`[detectAndScheduleCommitments] ✅ Immediate TravelSession created for directive → ${tsData.destination} ETA: ${tsData.estimated_arrival}`);
          } else {
            console.warn(`[detectAndScheduleCommitments] TravelSession not started: ${tsData.blocker_reason || tsData.error} — updating travel_status only`);
          }
        }

        if (!travelSessionStarted) {
          // No destination ID available — stamp travel_status so UI reflects the commitment
          await base44.asServiceRole.entities.Character.update(characterId, {
            travel_status: 'traveling_to_destination',
            resolved_source_reason: 'conversation_directive',
            resolved_last_updated_at: new Date(now).toISOString(),
          });
        }

        // Create ScheduledEvent to fire arrival
        const arrivalNarrative = `${character.name} has arrived — following through on their commitment.`;
        const scheduledEvent = await base44.asServiceRole.entities.ScheduledEvent.create({
          character_ids: [characterId],
          character_names: [character.name],
          primary_character_id: characterId,
          conversation_id: conversationId,
          description: arrivalNarrative,
          trigger_time: new Date(timeInfo.ms).toISOString(),
          status: 'pending',
          type: 'travel_arrival',
          source: 'commitment',
          owner_email: ownerEmail || character.owner_email || '',
          event_payload: {
            commitment_id: commitment.id,
            destination_location_id: null, // resolved at arrival if destination is found
            destination_location_name: 'destination stated in conversation',
          },
        });

        await base44.asServiceRole.entities.CharacterCommitment.update(commitment.id, {
          scheduled_event_id: scheduledEvent.id,
        });

        // Write memory for the character
        await base44.asServiceRole.entities.CharacterMemory.create({
          character_id: characterId,
          memory_type: 'event',
          memory_text: `I declared I was on my way / heading somewhere: "${messageContent.substring(0, 150)}". This is a real commitment I must honor.`,
          memory_summary: 'Active travel directive declared in conversation',
          importance_score: 7,
          permanence: 'short_term',
        });

        // Write bilateral memory if character-to-character
        if (recipientCharacterId) {
          await base44.asServiceRole.entities.CharacterMemory.create({
            character_id: recipientCharacterId,
            memory_type: 'event',
            memory_text: `${character.name} said they were on their way to meet me: "${messageContent.substring(0, 150)}".`,
            memory_summary: `${character.name} declared they are traveling to meet me`,
            importance_score: 7,
            permanence: 'short_term',
            related_character_id: characterId,
          });
        }
      }

      results.push({ type: 'travel_directive', commitment_id: commitment.id, status, block_reason: blockReason, arrival_scheduled_at: new Date(timeInfo.ms).toISOString() });
      detected.push('travel_directive');
    }

    // ── TRAVEL PROMISE ─────────────────────────────────────────────────────
    if (isTravel) {
      const timeInfo = resolveTimeWindow(lower, now, punctuality);
      const status = blockReason ? 'blocked' : 'active';

      const commitment = await base44.asServiceRole.entities.CharacterCommitment.create({
        ...commitmentBase,
        commitment_type: 'travel_promise',
        status,
        promised_action: 'coming over / meeting up / visiting',
        promised_time_window: timeInfo.label,
        scheduled_execute_at: new Date(timeInfo.ms).toISOString(),
        block_reason: blockReason || null,
      });

      if (!blockReason) {
        const arrivalNarrative = `${character.name} follows through on their promise to come over.`;
        const scheduledEvent = await base44.asServiceRole.entities.ScheduledEvent.create({
          character_ids: [characterId],
          character_names: [character.name],
          primary_character_id: characterId,
          conversation_id: conversationId,
          description: arrivalNarrative,
          trigger_time: new Date(timeInfo.ms).toISOString(),
          status: 'pending',
          type: 'travel_arrival',
          source: 'commitment',
          owner_email: ownerEmail || character.owner_email || '',
          event_payload: {
            commitment_id: commitment.id,
            destination_location_id: null,
            destination_location_name: 'promised destination from conversation',
          },
        });

        await base44.asServiceRole.entities.CharacterCommitment.update(commitment.id, {
          scheduled_event_id: scheduledEvent.id,
        });

        // Memory
        await base44.asServiceRole.entities.CharacterMemory.create({
          character_id: characterId,
          memory_type: 'event',
          memory_text: `I promised to come over / visit: "${messageContent.substring(0, 150)}". Scheduled for: ${timeInfo.label}. I must follow through.`,
          memory_summary: `Travel promise made — due ${timeInfo.label}`,
          importance_score: 7,
          permanence: 'short_term',
        });

        if (recipientCharacterId) {
          await base44.asServiceRole.entities.CharacterMemory.create({
            character_id: recipientCharacterId,
            memory_type: 'event',
            memory_text: `${character.name} promised to come over / visit me. They said: "${messageContent.substring(0, 150)}".`,
            memory_summary: `${character.name} promised to visit — due ${timeInfo.label}`,
            importance_score: 7,
            permanence: 'short_term',
            related_character_id: characterId,
          });
        }
      }

      results.push({ type: 'travel_promise', commitment_id: commitment.id, status, block_reason: blockReason, execute_at: new Date(timeInfo.ms).toISOString(), time_label: timeInfo.label });
      detected.push('travel_promise');
    }

    // ── COMMUNICATION PROMISE ────────────────────────────────────────────────
    if (isComm) {
      const timeInfo = resolveTimeWindow(lower, now, punctuality);
      const status = 'active';

      // Determine the promised action type
      const isCall = /call|ring|phone/.test(lower);
      const promisedAction = isCall ? 'call' : 'text/message';

      const commitment = await base44.asServiceRole.entities.CharacterCommitment.create({
        ...commitmentBase,
        commitment_type: 'communication_promise',
        status,
        promised_action: promisedAction,
        promised_time_window: timeInfo.label,
        scheduled_execute_at: new Date(timeInfo.ms).toISOString(),
      });

      // ScheduledEvent to fire the follow-through message
      const followThrough = isCall
        ? `${character.name} calls as promised.`
        : `${character.name} follows up with a message as promised.`;

      const scheduledEvent = await base44.asServiceRole.entities.ScheduledEvent.create({
        character_ids: [characterId],
        character_names: [character.name],
        primary_character_id: characterId,
        conversation_id: conversationId,
        description: followThrough,
        trigger_time: new Date(timeInfo.ms).toISOString(),
        status: 'pending',
        type: 'communication_promise',
        source: 'commitment',
        owner_email: ownerEmail || character.owner_email || '',
        event_payload: {
          commitment_id: commitment.id,
          promised_action: promisedAction,
          recipient_type: recipientType,
          recipient_character_id: recipientCharacterId || null,
          character_name: character.name,
          character_id: characterId,
        },
      });

      await base44.asServiceRole.entities.CharacterCommitment.update(commitment.id, {
        scheduled_event_id: scheduledEvent.id,
      });

      // Memory
      await base44.asServiceRole.entities.CharacterMemory.create({
        character_id: characterId,
        memory_type: 'event',
        memory_text: `I promised to ${promisedAction}: "${messageContent.substring(0, 150)}". Due: ${timeInfo.label}. I must follow through or explain why I couldn't.`,
        memory_summary: `Communication promise (${promisedAction}) due ${timeInfo.label}`,
        importance_score: 6,
        permanence: 'short_term',
      });

      if (recipientCharacterId) {
        await base44.asServiceRole.entities.CharacterMemory.create({
          character_id: recipientCharacterId,
          memory_type: 'event',
          memory_text: `${character.name} promised to ${promisedAction} me. They said: "${messageContent.substring(0, 150)}".`,
          memory_summary: `${character.name} promised to ${promisedAction} — due ${timeInfo.label}`,
          importance_score: 6,
          permanence: 'short_term',
          related_character_id: characterId,
        });
      }

      results.push({ type: 'communication_promise', commitment_id: commitment.id, status, execute_at: new Date(timeInfo.ms).toISOString(), time_label: timeInfo.label, promised_action: promisedAction });
      detected.push('communication_promise');
    }

    console.log(`[detectAndScheduleCommitments] ✓ char="${character.name}" detected=${detected.join(',')} commitments_created=${results.length}`);

    return Response.json({
      detected: true,
      commitment_types: detected,
      commitments_created: results.length,
      results,
      block_reason: blockReason || null,
      punctuality_trait: punctuality,
    });

  } catch (error) {
    console.error('[detectAndScheduleCommitments] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});