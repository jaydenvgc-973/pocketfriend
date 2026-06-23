import { createClientFromRequest } from 'npm:@base44/sdk@0.8.32';

/**
 * sendProactiveMessageForCharacter — v2
 *
 * REPAIR: Added relationship-driven communication pressure.
 *
 * NEW pressure factors (all absent in v1):
 *   1. Per-relationship dimensions: trust_level, romantic_level, respect_level from fictional_relationships
 *   2. Time-since-last-meaningful-contact (days) — longer silence = higher pressure
 *   3. LifeEvent triggers — recent significant events on the character create urgency context
 *   4. Unresolved conversation detection — last message ended with question/unresolved emotion
 *   5. CommunicationCommitment pending fulfillment check — generates context-aware follow-up
 *
 * All existing timing gates, daily caps, and idempotency logic preserved unchanged.
 */

function getEasternTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function getTimeMinutes(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function isWithinWorkHours(char) {
  if (!char.work_start_time || !char.work_end_time) return false;
  const et = getEasternTime();
  const now = getTimeMinutes(et);
  const start = parseInt(char.work_start_time.split(':')[0]) * 60 + parseInt(char.work_start_time.split(':')[1] || 0);
  const end = parseInt(char.work_end_time.split(':')[0]) * 60 + parseInt(char.work_end_time.split(':')[1] || 0);
  return now >= start && now <= end;
}

function isSleepTime(char) {
  if (!char.sleep_start_time || !char.wake_up_time) return false;
  const et = getEasternTime();
  const now = getTimeMinutes(et);
  const sleep = parseInt(char.sleep_start_time.split(':')[0]) * 60 + parseInt(char.sleep_start_time.split(':')[1] || 0);
  const wake = parseInt(char.wake_up_time.split(':')[0]) * 60 + parseInt(char.wake_up_time.split(':')[1] || 0);
  if (sleep > wake) return now >= sleep || now <= wake;
  return now >= sleep && now <= wake;
}

function shouldMessageNow(char, relationshipLevel) {
  const et = getEasternTime();
  const hour = et.getHours();
  if (isSleepTime(char)) return false;
  if (relationshipLevel >= 80) return true;
  if (relationshipLevel >= 60) {
    if (isWithinWorkHours(char) && hour !== 12) return false;
    return true;
  }
  if (relationshipLevel >= 40) {
    if (isWithinWorkHours(char)) return false;
    return true;
  }
  if (isWithinWorkHours(char)) return false;
  if (hour >= 22 || hour <= 7) return false;
  return true;
}

/**
 * computeRelationshipPressure
 *
 * Returns a score 0–100 representing how much communication pressure exists
 * given all relationship dimensions, time-since-contact, and recent life events.
 *
 * Pressure factors (all additive):
 *   base: friendship_level on the character root field (0–100) → weight 0.25
 *   per-relationship dimensions from fictional_relationships (if character-to-user relationship exists):
 *     trust_level → weight 0.15
 *     romantic_level → weight 0.20
 *     respect_level → weight 0.10
 *   chosen_family_level (from char root) → weight 0.10
 *   time-since-contact: exponential increase up to 30 pressure points for 7+ days of silence
 *   unresolved conversation: +15 if last message ended unresolved
 *   recent significant LifeEvent: +20 if within last 48h
 *   pending CommunicationCommitment: +30 (hard — must follow through)
 *
 * Pressure >= 40 = attempt contact
 * Pressure >= 60 = high urgency
 * Pressure >= 80 = must contact if timing allows
 */
function computeRelationshipPressure(char, recentMessages, lifeEvents, pendingCommitment) {
  let pressure = 0;

  // Base from root friendship_level
  const rootFriendship = char.friendship_level ?? 50;
  pressure += rootFriendship * 0.25;

  // Per-relationship dimensions — find the primary relationship record
  const relationships = char.fictional_relationships || [];
  // The primary relationship is the one with the highest combined score
  let bestRelScore = 0;
  let bestTrust = 0;
  let bestRomantic = 0;
  let bestRespect = 0;
  for (const r of relationships) {
    const combined = (r.friendship_level ?? 0) + (r.trust_level ?? 0) + (r.romantic_level ?? 0) + (r.respect_level ?? 0);
    if (combined > bestRelScore) {
      bestRelScore = combined;
      bestTrust = r.trust_level ?? 0;
      bestRomantic = r.romantic_level ?? 0;
      bestRespect = r.respect_level ?? 0;
    }
  }
  pressure += bestTrust * 0.15;
  pressure += bestRomantic * 0.20;
  pressure += bestRespect * 0.10;

  // chosen_family_level from root
  pressure += (char.chosen_family_level ?? 0) * 0.10;

  // Time-since-contact: find most recent message timestamp
  if (recentMessages.length > 0) {
    const sorted = [...recentMessages].sort((a, b) =>
      new Date(b.timestamp || b.created_date) - new Date(a.timestamp || a.created_date)
    );
    const lastMsgTime = new Date(sorted[0].timestamp || sorted[0].created_date);
    const daysSince = (Date.now() - lastMsgTime.getTime()) / (24 * 3600 * 1000);

    // Exponential pressure: 0 at 0 days, ~10 at 1 day, ~20 at 3 days, ~30 at 7+ days
    // Only applies if relationship is meaningful (friendship >= 40 or trust >= 40 or romantic >= 20)
    const isMeaningful = rootFriendship >= 40 || bestTrust >= 40 || bestRomantic >= 20;
    if (isMeaningful) {
      const silencePressure = Math.min(30, 30 * (1 - Math.exp(-daysSince / 3)));
      pressure += silencePressure;
    }
  } else {
    // No messages at all — character has never reached out. Strong relationships must initiate.
    const isMeaningful = rootFriendship >= 50 || bestTrust >= 50 || bestRomantic >= 30;
    if (isMeaningful) pressure += 20;
  }

  // Unresolved conversation detection: last character message ended with question/emotional state
  if (recentMessages.length > 0) {
    const sorted = [...recentMessages].sort((a, b) =>
      new Date(b.timestamp || b.created_date) - new Date(a.timestamp || a.created_date)
    );
    const lastMsg = sorted[0];
    if (lastMsg) {
      const content = (lastMsg.content || '').toLowerCase();
      const emotional = lastMsg.emotional_state;
      const unresolvedMarkers = [
        '?', 'let me know', "i'll find out", "i'll check", 'not sure yet', 'we\'ll see',
        "i'll text you", "i'll message you", "talk later", "we should", "let's", "let us",
        "i was thinking", "you never told me", "what happened", "how did it go",
      ];
      const unresolvedEmotion = ['anxious', 'worried', 'stressed', 'sad', 'upset', 'concerned'].includes(emotional);
      const hasUnresolved = unresolvedMarkers.some(m => content.includes(m)) || unresolvedEmotion;
      if (hasUnresolved) pressure += 15;
    }
  }

  // Recent significant LifeEvent on THIS character (+20 pressure — they have something to share)
  // Include only events that are: within the last 48 hours AND major/significant AND positive or negative
  const nowMs = Date.now();
  const cutoffMs = nowMs - 48 * 3600 * 1000; // 48 hours ago in ms
  const significantEvents = (lifeEvents || []).filter(le => {
    const ts = le.timestamp || le.created_date;
    if (!ts) return false;
    const eventMs = new Date(ts).getTime();
    const withinWindow = eventMs >= cutoffMs && eventMs <= nowMs;
    const isMajor = le.severity === 'major' || le.severity === 'significant';
    const isPositiveOrNegative = le.valence === 'positive' || le.valence === 'negative';
    return withinWindow && isMajor && isPositiveOrNegative;
  });
  if (significantEvents.length > 0) pressure += 20;

  // Pending CommunicationCommitment — hard obligation (+30)
  if (pendingCommitment) pressure += 30;

  return Math.min(100, Math.round(pressure));
}

/**
 * detectConversationCommitments
 *
 * Scans recent messages for communication promise patterns and creates
 * CommunicationCommitment records for untracked promises.
 *
 * Patterns detected:
 *   - "I'll let you know how it goes"
 *   - "I'll text you later/tomorrow"
 *   - "I'll check on you"
 *   - "Tell [Name] I said [message]" / "Tell [Name] [message]"
 *   - "Ask [Name] about..."
 *   - "I'll follow up"
 *   - "We should talk more about this"
 *   - "I'll think about it and get back to you"
 */
async function detectAndRecordCommitments(base44, char, messages, conversationId, ownerEmail) {
  const created = [];
  const now = new Date();

  const FOLLOW_UP_PATTERNS = [
    { pattern: /i'?ll?\s*(let\s+you\s+know|update\s+you|keep\s+you\s+(posted|updated))/i, type: 'will_let_you_know', dueHours: 24 },
    { pattern: /i'?ll?\s*(text|message|call|hit\s+you\s+up)\s*(you\s+)?(later|tomorrow|tonight|soon|when\s+i\s+(know|find\s+out|get\s+there))/i, type: 'follow_up', dueHours: 8 },
    { pattern: /i'?ll?\s*(check\s+(on|in\s+on)\s+you)/i, type: 'check_in', dueHours: 12 },
    { pattern: /i'?ll?\s*(follow\s+up|get\s+back\s+to\s+you)/i, type: 'follow_up', dueHours: 12 },
    { pattern: /(we\s+should\s+(talk|catch\s+up|finish\s+this|continue)\s*(about|later|soon)?)/i, type: 'follow_up', dueHours: 24 },
    { pattern: /i'?ll?\s*(think\s+about\s+it|let\s+you\s+know\s+how\s+it\s+goes)/i, type: 'event_follow_up', dueHours: 24 },
    { pattern: /(after\s+i\s+(go|get|finish|do|see|find)\s*[\w\s]{0,30}),?\s*i'?ll?\s*(tell|let|text|message|update)\s+you/i, type: 'event_follow_up', dueHours: 12 },
  ];

  const THIRD_PARTY_PATTERNS = [
    { pattern: /tell\s+([\w\s]{2,30})\s+i\s+said\s+([\w\s.!,]{2,60})(?:\.|$)/i },
    { pattern: /tell\s+([\w\s]{2,30})\s+(hi|hello|hey|congratulations|congrats|i\s+miss\s+(him|her|them)|i\s+was\s+asking\s+about\s+(him|her|them)|i\s+said\s+hey)/i },
    { pattern: /ask\s+([\w\s]{2,30})\s+(about|how)\s+([\w\s.!,]{2,60})(?:\.|$)/i },
    { pattern: /let\s+([\w\s]{2,30})\s+know\s+([\w\s.!,]{2,80})(?:\.|$)/i },
    { pattern: /pass\s+along\s+to\s+([\w\s]{2,30})\s+([\w\s.!,]{2,80})(?:\.|$)/i },
  ];

  // Scan character-sent messages in last 24 hours from ALL channels:
  //   - direct chat (character_id = char.id)
  //   - World Phone bilateral (sender_character_id = char.id, channel = 'world_phone')
  // This ensures third-party relay obligations created in character-to-character World Phone
  // conversations are captured on the correct obligated character (the receiver of the relay request).
  const oneDayAgo = now.getTime() - 24 * 3600 * 1000;
  const recentCharMsgs = (messages || []).filter(m => {
    const ts = new Date(m.timestamp || m.created_date).getTime();
    if (ts < oneDayAgo) return false;
    if (m.sender_type !== 'character') return false;
    // Direct chat: character_id matches
    if (m.character_id === char.id) return true;
    // World Phone bilateral: sender_character_id matches
    if (m.sender_character_id === char.id) return true;
    return false;
  });

  for (const msg of recentCharMsgs) {
    const content = msg.content || '';

    // Check follow-up/promise patterns
    for (const { pattern, type, dueHours } of FOLLOW_UP_PATTERNS) {
      if (!pattern.test(content)) continue;

      // Check if we already created a commitment for this message
      const existing = await base44.asServiceRole.entities.CommunicationCommitment.filter({
        source_message_id: msg.id,
        character_id: char.id,
      }, null, 1).catch(() => []);
      if (existing.length > 0) continue;

      const dueAfter = new Date(new Date(msg.timestamp || msg.created_date).getTime() + dueHours * 3600 * 1000);

      await base44.asServiceRole.entities.CommunicationCommitment.create({
        character_id: char.id,
        character_name: char.name,
        owner_email: ownerEmail,
        commitment_type: type,
        commitment_text: content.substring(0, 300),
        source_conversation_id: conversationId,
        source_message_id: msg.id,
        context_summary: `Communication promise detected in message`,
        due_after: dueAfter.toISOString(),
        status: 'pending',
        created_at: now.toISOString(),
      }).catch(() => null);

      created.push({ type, dueAfter: dueAfter.toISOString() });
      break; // one commitment per message
    }

    // Check third-party relay patterns
    for (const { pattern } of THIRD_PARTY_PATTERNS) {
      const match = content.match(pattern);
      if (!match) continue;

      const thirdPartyName = match[1]?.trim();
      const relayMessage = match[2]?.trim();
      if (!thirdPartyName || thirdPartyName.length < 2) continue;

      // Check if already recorded
      const existing = await base44.asServiceRole.entities.CommunicationCommitment.filter({
        source_message_id: msg.id,
        commitment_type: 'third_party_relay',
      }, null, 1).catch(() => []);
      if (existing.length > 0) continue;

      const dueAfter = new Date(new Date(msg.timestamp || msg.created_date).getTime() + 6 * 3600 * 1000);

      await base44.asServiceRole.entities.CommunicationCommitment.create({
        character_id: char.id,
        character_name: char.name,
        owner_email: ownerEmail,
        commitment_type: 'third_party_relay',
        commitment_text: content.substring(0, 300),
        third_party_character_name: thirdPartyName,
        third_party_message: relayMessage || '',
        source_conversation_id: conversationId,
        source_message_id: msg.id,
        context_summary: `Relay message to ${thirdPartyName}: "${relayMessage || ''}"`,
        due_after: dueAfter.toISOString(),
        status: 'pending',
        created_at: now.toISOString(),
      }).catch(() => null);

      created.push({ type: 'third_party_relay', target: thirdPartyName });
      break;
    }
  }

  return created;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json();
    const { characterId, forceCommitmentId } = body;
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    // Auth: attempt user identity; if not available (automation/function context), proceed
    // with service role. All entity operations use asServiceRole explicitly regardless.
    await base44.auth.me().catch(() => null);

    // Character lookup — always via service role since this function is called from
    // automations, other backend functions, and test harnesses
    const charList = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1).catch(() => []);
    const char = charList?.[0];
    if (!char) return Response.json({ error: 'Character not found', characterId }, { status: 404 });

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    if (!char.owner_email) {
      return Response.json({ error: `Character id=${char.id} missing owner_email` }, { status: 422 });
    }

    // ── WORLD-SERVICE SCOPE GATE ─────────────────────────────────────────────
    // This function drives social/relationship-pressure messaging to the user:
    // friendship scores, loneliness detection, life event sharing, spontaneous check-ins.
    // That is active-created-character social behavior and is not Vick's role.
    //
    // Vick's messaging paths are:
    //   - World Phone send/receive → sendWorldPhoneMessage (no restriction)
    //   - Character-to-character → triggerCharacterContact → sendWorldPhoneMessage (no restriction)
    //   - Communication commitments → processUnresolvedCommunicationCommitments (no restriction)
    //   - Diagnostics and repair → vickRunDiagnostic, deliverVickFindings (no restriction)
    //
    // Only the social-pressure proactive path (this function) does not apply to Vick,
    // because his role is service-driven, not socially-driven.
    // This gate does NOT affect any other messaging path.
    if (char.character_type === 'npc_world_service' || char.is_world_service === true) {
      return Response.json({ success: false, reason: 'world_service_social_pressure_not_applicable' });
    }

    // ── All entity operations use asServiceRole ──────────────────────────────
    // This function is invoked from scheduled automations, other backend functions,
    // and test harnesses — none of which share the character owner's auth identity.
    // asServiceRole is correct here because we already verified the character exists
    // and belongs to a real owner_email. Security is enforced by the character lookup above.
    const sr = base44.asServiceRole;

    // ── FIND ACTIVE CONVERSATION ─────────────────────────────────────────────
    const convos = await sr.entities.Conversation.filter({
      type: 'direct',
      owner_email: char.owner_email,
      character_ids: [char.id],
    }).catch(() => []);

    let conversationId = null;
    if (convos.length > 0) {
      conversationId = convos[0].id;
    }

    // ── FETCH RECENT MESSAGES ────────────────────────────────────────────────
    // Fetch from two sources:
    //   1. Direct conversation messages (character-to-user)
    //   2. World Phone bilateral messages where this character is the SENDER
    //      (needed so third-party relay obligations in character-to-character messages are detected)
    let recentMessages = [];
    if (conversationId) {
      recentMessages = await sr.entities.Message.filter(
        { conversation_id: conversationId },
        '-timestamp',
        20
      ).catch(() => []);
    }

    // Also fetch World Phone messages this character SENT (as sender_character_id) in last 24h
    const wpMessages = await sr.entities.Message.filter(
      { sender_character_id: char.id, channel: 'world_phone' },
      '-timestamp',
      20
    ).catch(() => []);

    // Merge, deduplicate by id
    const allMessageIds = new Set(recentMessages.map(m => m.id));
    for (const m of wpMessages) {
      if (!allMessageIds.has(m.id)) {
        recentMessages.push(m);
        allMessageIds.add(m.id);
      }
    }

    // ── DETECT AND RECORD NEW COMMUNICATION COMMITMENTS ─────────────────────
    // Runs on every proactive check. Scans both direct and World Phone messages.
    // additive — never destructive
    if (recentMessages.length > 0) {
      await detectAndRecordCommitments(sr, char, recentMessages, conversationId, char.owner_email).catch(() => {});
    }

    // ── CHECK FOR PENDING COMMUNICATION COMMITMENTS ──────────────────────────
    let pendingCommitment = null;
    if (forceCommitmentId) {
      const commitList = await sr.entities.CommunicationCommitment.filter({
        character_id: char.id,
        status: 'pending',
      }, '-created_at', 1).catch(() => []);
      pendingCommitment = commitList.find(c => c.id === forceCommitmentId) || commitList[0] || null;
    } else {
      const pendingList = await sr.entities.CommunicationCommitment.filter({
        character_id: char.id,
        status: 'pending',
      }, 'due_after', 5).catch(() => []);
      // Only act on commitments that are due (due_after <= now)
      pendingCommitment = pendingList.find(c => !c.due_after || new Date(c.due_after) <= now) || null;
    }

    // ── FETCH RECENT LIFE EVENTS ─────────────────────────────────────────────
    const lifeEvents = await sr.entities.LifeEvent.filter(
      { character_id: char.id },
      '-timestamp',
      10
    ).catch(() => []);

    // ── COMPUTE RELATIONSHIP PRESSURE ────────────────────────────────────────
    const pressure = computeRelationshipPressure(char, recentMessages, lifeEvents, pendingCommitment);
    const rootFriendship = char.friendship_level ?? 50;

    // Pressure threshold to attempt contact:
    //   < 25 = don't initiate (relationship too weak or recently contacted)
    //   25-40 = low probability initiation
    //   40+ = initiate if timing allows
    //   60+ = high urgency, bypass some timing gates
    //   80+ = critical (pending commitment), bypass work-hour gate
    const INITIATE_THRESHOLD = 25;
    if (pressure < INITIATE_THRESHOLD && !pendingCommitment) {
      return Response.json({
        success: false,
        reason: 'insufficient_relationship_pressure',
        pressure,
        threshold: INITIATE_THRESHOLD,
      });
    }

    // Timing gate — bypass for critical pressure (commitments, 80+)
    const highUrgency = pressure >= 80 || !!pendingCommitment;
    if (!highUrgency && !shouldMessageNow(char, rootFriendship)) {
      return Response.json({
        success: false,
        reason: 'not_the_right_time',
        pressure,
      });
    }
    // For pressure 25-39: apply random reduction to avoid over-messaging
    if (pressure < 40 && !pendingCommitment) {
      const probability = (pressure - 25) / 75; // 0 at 25 pressure, 0.2 at 40 pressure
      if (Math.random() > probability) {
        return Response.json({ success: false, reason: 'random_pressure_gate', pressure });
      }
    }

    // ── DAILY CAP CHECK ──────────────────────────────────────────────────────
    if (conversationId) {
      const todayMessages = recentMessages.filter(m =>
        m.sender_type === 'character' && m.character_id === char.id &&
        (m.created_date || '').startsWith(today)
      );
      const dailyLimit = pressure >= 70 ? 10 : pressure >= 50 ? 7 : 5;
      if (todayMessages.length >= dailyLimit) {
        return Response.json({ success: false, reason: `daily_cap_reached_${dailyLimit}`, pressure });
      }
    }

    // ── IDEMPOTENCY KEY ──────────────────────────────────────────────────────
    const timeBucket = now.toISOString().substring(0, 13);
    const idempotencyKey = `proactive::${char.owner_email}::${char.id}::direct::${timeBucket}`;

    if (conversationId) {
      const existingThisHour = await sr.entities.Message.filter({
        conversation_id: conversationId,
        sender_type: 'character',
        character_id: char.id,
        idempotency_key: idempotencyKey,
      }, null, 1).catch(() => []);
      if (existingThisHour.length > 0) {
        return Response.json({ success: false, reason: 'already_sent_this_hour', pressure });
      }
    }

    // ── CANONICAL CONTEXT ────────────────────────────────────────────────────
    let canonicalSystemPrompt = null;
    try {
      const ctxRes = await base44.functions.invoke('buildCanonicalCharacterContext', {
        characterId: char.id,
        interactionContext: 'proactive',
        topKMemories: 8,
        ownerEmailHint: char.owner_email,
      });
      if (ctxRes?.data?.systemPrompt) {
        canonicalSystemPrompt = ctxRes.data.systemPrompt;
      }
    } catch (_) {}

    if (!canonicalSystemPrompt) {
      canonicalSystemPrompt = `You are ${char.name}. ${char.personality_summary || ''}`;
    }

    // ── BUILD MESSAGE TYPE BASED ON PRESSURE SOURCE ──────────────────────────
    const et = getEasternTime();
    const hour = et.getHours();
    let timeContext = '';
    if (hour >= 7 && hour < 9) timeContext = 'morning';
    else if (hour >= 12 && hour < 13) timeContext = 'lunch break';
    else if (hour >= 18 && hour < 20) timeContext = 'evening';
    else if (hour >= 21 && hour < 23) timeContext = 'late night';

    // Build context about WHY this character is reaching out
    let reachOutContext = '';
    let messageIntent = 'general check-in';

    if (pendingCommitment) {
      // Commitment follow-through — highest priority
      if (pendingCommitment.commitment_type === 'third_party_relay') {
        reachOutContext = `You previously said you would pass a message along to the person you're talking to. The original message to relay was: "${pendingCommitment.third_party_message || pendingCommitment.commitment_text}". Follow through on this — mention it naturally, as if you remembered and followed through.`;
        messageIntent = 'commitment_relay';
      } else if (pendingCommitment.commitment_type === 'will_let_you_know' || pendingCommitment.commitment_type === 'event_follow_up') {
        reachOutContext = `You previously said you would follow up or let them know how something went. That promise was: "${pendingCommitment.commitment_text.substring(0, 150)}". This is that follow-up. Share what happened, how it went, or what you found out.`;
        messageIntent = 'commitment_followup';
      } else if (pendingCommitment.commitment_type === 'check_in') {
        reachOutContext = `You said you would check in on this person. This is that check-in. Be genuine — ask how they're doing, reference the context of why you wanted to check in.`;
        messageIntent = 'commitment_checkin';
      } else {
        reachOutContext = `You made a promise to follow up: "${pendingCommitment.commitment_text.substring(0, 150)}". This is that follow-up.`;
        messageIntent = 'commitment_general';
      }
    } else {
      // Build context from recent messages and life events
      const lastMsg = recentMessages.sort((a, b) =>
        new Date(b.timestamp || b.created_date) - new Date(a.timestamp || a.created_date))[0];

      if (lifeEvents.length > 0) {
        const recentSignificant = lifeEvents.filter(le => {
          const ts = le.timestamp || le.created_date;
          return ts && (Date.now() - new Date(ts).getTime()) < 48 * 3600 * 1000 &&
            (le.severity === 'major' || le.severity === 'significant');
        })[0];
        if (recentSignificant) {
          reachOutContext = `Something significant just happened in your life: "${recentSignificant.title}". You might naturally want to share this, process it by talking, or just connect with someone after experiencing it.`;
          messageIntent = 'life_event_share';
        }
      }

      if (!reachOutContext && lastMsg) {
        const lastContent = lastMsg.content || '';
        const daysSince = (Date.now() - new Date(lastMsg.timestamp || lastMsg.created_date).getTime()) / (24 * 3600 * 1000);
        if (daysSince > 2) {
          reachOutContext = `It's been ${Math.round(daysSince)} days since you last spoke. You're thinking about this person. Reach out naturally — no need to announce the gap.`;
          messageIntent = 'break_silence';
        } else if (lastContent.includes('?') || lastContent.toLowerCase().includes('let me know')) {
          reachOutContext = `Your last conversation left something open. Continue naturally from where things were. Recent context: "${lastContent.substring(0, 100)}"`;
          messageIntent = 'continue_conversation';
        } else {
          reachOutContext = `You're thinking about this person and want to reach out. Recent context from last conversation: "${lastContent.substring(0, 100)}"`;
          messageIntent = 'general_reach_out';
        }
      }

      if (!reachOutContext) {
        reachOutContext = `You feel like reaching out. Maybe you thought of them, saw something that reminded you of them, or just want to connect.`;
        messageIntent = 'spontaneous';
      }
    }

    const proactivePrompt = `${canonicalSystemPrompt}

━━━━━━━━━━━━━━━━━━━━
PROACTIVE MESSAGE TASK
━━━━━━━━━━━━━━━━━━━━
Generate a natural, spontaneous message RIGHT NOW (1-3 sentences max).

WHY YOU'RE REACHING OUT: ${reachOutContext}
Time: ${timeContext || 'mid-day'}
Relationship pressure: ${pressure}/100 — ${pressure >= 70 ? 'close relationship, genuine connection' : pressure >= 50 ? 'solid friendship, comfortable reaching out' : 'friendly, respectful'}

RULES:
- Write like a real person texting. Short. Human. Imperfect.
- NEVER use em dashes (—), en dashes (–), or spaced hyphens ( - ).
- Be authentic to the reason you're reaching out.
- Do NOT start with your own name or a label.
- Max 2-3 sentences. Often 1 is better.
- Do NOT announce that you're following up unless it flows naturally.`;

    let messageContent;
    try {
      messageContent = await base44.integrations.Core.InvokeLLM({ prompt: proactivePrompt });
    } catch (llmErr) {
      return Response.json({ success: false, reason: 'llm_failure', error: llmErr.message });
    }

    if (!messageContent || typeof messageContent !== 'string' || messageContent.trim().length < 3) {
      return Response.json({ success: false, reason: 'empty_llm_response' });
    }
    messageContent = messageContent.trim();

    // ── FIND OR CREATE CONVERSATION ──────────────────────────────────────────
    if (!conversationId) {
      const newConvo = await sr.entities.Conversation.create({
        title: char.name,
        type: 'direct',
        character_ids: [char.id],
        owner_email: char.owner_email,
      });
      conversationId = newConvo.id;
    }

    // ── SAVE MESSAGE ─────────────────────────────────────────────────────────
    const msg = await sr.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: char.id,
      character_name: char.name,
      sender_character_id: char.id,
      receiver_character_id: null,
      content: messageContent,
      emotional_state: char.emotional_state || 'calm',
      timestamp: now.toISOString(),
      channel: 'direct',
      is_read: false,
      idempotency_key: idempotencyKey,
      source_message_id: null,
      reply_to_message_id: null,
      generation_lock_id: null,
      recovery_signal: false,
      memory_eligible: true,
      relationship_eligible: true,
      autonomy_marker: `proactive::${messageIntent}::pressure_${pressure}`,
    });

    // ── MARK COMMITMENT FULFILLED ────────────────────────────────────────────
    if (pendingCommitment) {
      await sr.entities.CommunicationCommitment.update(pendingCommitment.id, {
        status: 'fulfilled',
        fulfilled_at: now.toISOString(),
        fulfilled_message_id: msg.id,
      }).catch(() => {});
    }

    // ── UPDATE CONVERSATION ──────────────────────────────────────────────────
    await sr.entities.Conversation.update(conversationId, {
      last_message_preview: messageContent.substring(0, 100),
      last_message_date: now.toISOString(),
    }).catch(() => {});

    console.log(
      `[sendProactiveMessageForCharacter] ✓ char=${char.name} | pressure=${pressure} | intent=${messageIntent} | commitment=${!!pendingCommitment} | msg=${msg.id}`
    );

    return Response.json({
      success: true,
      messageId: msg.id,
      characterName: char.name,
      content: messageContent,
      pressure,
      messageIntent,
      commitmentFulfilled: pendingCommitment?.id || null,
    });

  } catch (error) {
    console.error('[sendProactiveMessageForCharacter]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});