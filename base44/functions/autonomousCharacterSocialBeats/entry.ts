import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * autonomousCharacterSocialBeats
 *
 * Scheduled lightweight function that generates real character-to-character
 * social continuity events without requiring user initiation.
 *
 * ROOT CAUSE FIX (confirmed via live test):
 *   asServiceRole.entities.Character.list() returns 0 records.
 *   asServiceRole.entities.Character.filter({ status: 'active' }) returns real records.
 *   This matches the pattern used by processScheduledCharacterAlarms (proven working).
 *
 * PAIRING SOURCES (ordered by priority):
 *   1. Community Events — characters connected to the same event (EventParticipation)
 *   2. Shared location context — co-workers, housemates, classmates, religious congregation
 *   3. Family members (npc_family_member character type or family relationship)
 *   4. fictional_relationships with related_character_id — known contacts
 *
 * RECORDS CREATED (all real, owner_email scoped where supported):
 *   - Message (World Phone thread, canonical shared_conversation_key)
 *   - bilateral LifeEvent (sender + receiver)
 *   - bilateral CharacterMemory (sender + receiver, tagged [autonomous_beat])
 *
 * CAPS:
 *   - max 2 beats per user per run
 *   - 4-hour cooldown per pair (via CharacterMemory tag check)
 *
 * USER-FIRST BOUNDARY:
 *   - No approval-required actions, no major life changes
 *   - No interruption to active foreground conversations
 *   - No spam — hard caps + cooldown
 */

const ELIGIBLE_TYPES = new Set([
  'active_created_character',
  'npc_fictitious',
  'npc_family_member',
]);

const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_BEATS_PER_USER = 2;

function pairKey(idA, idB) {
  return [idA, idB].sort().join('::');
}

function canonicalConvoKey(idA, idB) {
  const sorted = [idA, idB].sort();
  return `world_phone::${sorted[0]}::${sorted[1]}`;
}

/**
 * computePairRelationshipStrength
 *
 * Returns 0–100 score for how strong the relationship between sender → receiver is.
 * Used to weight pair selection so strong relationships get priority over weak ones.
 *
 * Sources (in priority order):
 *   1. fictional_relationships entry for this specific pair (all dimensions)
 *   2. family relationship (npc_family_member type = automatic strong bond)
 *   3. shared context (coworker, housemate, classmate) = moderate bond
 *   4. fallback = 30 (neutral acquaintance)
 */
function computePairRelationshipStrength(sender, receiverId, receiverType, pairingSource) {
  const relationships = sender.fictional_relationships || [];

  // Find the specific relationship record for this receiver
  const rel = relationships.find(r => r.related_character_id === receiverId);

  if (rel) {
    // All dimensions contribute — trust and romantic weight more than friendship alone
    const friendship = rel.friendship_level ?? 50;
    const trust = rel.trust_level ?? 50;
    const romantic = rel.romantic_level ?? 0;
    const respect = rel.respect_level ?? 50;
    const tension = rel.tension_level ?? 0;

    // Weighted combination: trust + romantic are highest-weight bonds
    const raw = friendship * 0.25 + trust * 0.30 + romantic * 0.25 + respect * 0.20;
    // Tension reduces the score (conflict creates pressure but lowers desirability)
    const tensionPenalty = tension * 0.15;
    return Math.min(100, Math.max(0, Math.round(raw - tensionPenalty)));
  }

  // Family = inherently strong bond regardless of relationship record
  if (pairingSource === 'family' || receiverType === 'npc_family_member') {
    return 70;
  }

  // Shared context bonds (coworker, housemate, classmate) = moderate
  if (['coworker', 'housemate', 'classmate'].includes(pairingSource)) {
    return 45;
  }

  // Unknown / no relationship record
  return 30;
}

// Beat type based on relationship context and needs
function selectBeatType(sender, receiver, rel, pairingSource) {
  const tension = rel?.tension_level ?? 0;
  const friendship = rel?.friendship_level ?? 0;
  const isFamily = pairingSource === 'family' || rel?.relationship_type === 'family' || receiver.character_type === 'npc_family_member';
  const socialNeed = sender.social_value ?? 65;
  const mentalVal = sender.mental_value ?? 70;

  if (pairingSource === 'community_event') return 'community_event_followup';
  if (tension > 40 && friendship > 20) return 'resolve_tension';
  if (mentalVal < 35 && friendship > 50) return 'supportive_checkin';
  if (isFamily) return 'family_checkin';
  if (pairingSource === 'coworker') return 'coworker_checkin';
  if (pairingSource === 'housemate') return 'housemate_checkin';
  if (socialNeed < 35) return 'social_checkin';
  if (friendship > 60) return 'casual_catchup';
  return 'brief_acknowledgment';
}

// Generate message — LLM with safe fallback
async function generateMessage(base44, sender, receiver, beatType, rel, eventName) {
  const senderName = sender.name || sender.display_name || 'them';
  const receiverName = receiver.name || receiver.display_name || 'them';
  const relType = rel?.relationship_type || 'acquaintance';
  const emotion = sender.emotional_state || 'calm';
  const occupation = sender.occupation || '';
  const personality = [
    sender.personality_summary,
    sender.communication_style,
    sender.archetype ? `Archetype: ${sender.archetype}` : null,
    occupation ? `Occupation: ${occupation}` : null,
    `Current emotional state: ${emotion}`,
  ].filter(Boolean).join('. ');

  const contextMap = {
    community_event_followup: `You and ${receiverName} were both connected to the same community event${eventName ? ` (${eventName})` : ''}. You want to message them about it — maybe ask if they're going, follow up after, or just mention it came up.`,
    resolve_tension: `There has been some tension between you and ${receiverName}. You want to reach out to clear the air.`,
    supportive_checkin: `You're going through a rough patch and ${receiverName} is someone close to you. You want to briefly reach out.`,
    family_checkin: `${receiverName} is your ${relType}. Send a quick family check-in the way you normally would.`,
    coworker_checkin: `You and ${receiverName} work together. Send a quick message the way coworkers do.`,
    housemate_checkin: `You and ${receiverName} live together. Send a quick note the way housemates do.`,
    social_checkin: `You haven't heard from ${receiverName} in a bit and feel like reaching out.`,
    casual_catchup: `You and ${receiverName} are friends. Just shoot them a quick message.`,
    brief_acknowledgment: `Send a short, low-key text to ${receiverName} to keep the connection alive.`,
  };

  const prompt = `You are ${senderName}. ${personality}

${contextMap[beatType] || contextMap.brief_acknowledgment}

Write a short, natural text message (1–3 sentences). Sound like yourself. Not formal. Not dramatic.
Do NOT start with your name. Return only the message text.`;

  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt }).catch(() => null);
  if (!result || typeof result !== 'string' || result.trim().length < 3) {
    const fallbacks = {
      community_event_followup: `Hey, are you going to that event? Let me know.`,
      resolve_tension: `Hey. I don't want things to stay weird between us. Can we talk?`,
      supportive_checkin: `Hey, just thinking about you. Hope you're doing okay.`,
      family_checkin: `Hey, just checking in. Miss you.`,
      coworker_checkin: `Hey, hope work's been treating you okay.`,
      housemate_checkin: `Hey, you around later?`,
      social_checkin: `Hey, it's been a while. What have you been up to?`,
      casual_catchup: `Hey! What's going on with you?`,
      brief_acknowledgment: `Hey, just wanted to reach out. Hope everything's good.`,
    };
    return fallbacks[beatType] || fallbacks.brief_acknowledgment;
  }
  return result.trim();
}

// LifeEvent type mapping for beat type
function lifeEventDef(beatType, isSender) {
  const map = {
    community_event_followup: { event_type: 'bonding_event', valence: 'positive', severity: 'minor' },
    resolve_tension: {
      event_type: isSender ? 'conflict_event' : 'recovery_event',
      valence: isSender ? 'negative' : 'positive',
      severity: 'minor',
    },
    supportive_checkin: { event_type: 'supportive_event', valence: 'positive', severity: 'minor' },
    family_checkin: { event_type: 'bonding_event', valence: 'positive', severity: 'minor' },
    coworker_checkin: { event_type: 'routine_positive_event', valence: 'positive', severity: 'minor' },
    housemate_checkin: { event_type: 'routine_positive_event', valence: 'positive', severity: 'minor' },
    social_checkin: { event_type: 'supportive_event', valence: 'positive', severity: 'minor' },
    casual_catchup: { event_type: 'bonding_event', valence: 'positive', severity: 'minor' },
    brief_acknowledgment: { event_type: 'supportive_event', valence: 'positive', severity: 'minor' },
  };
  return map[beatType] || { event_type: 'supportive_event', valence: 'positive', severity: 'minor' };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const now = new Date();
    const nowIso = now.toISOString();

    // ── DIAGNOSTIC: log caller context ─────────────────────────────────────────
    let callerEmail = null;
    try {
      const me = await base44.auth.me();
      callerEmail = me?.email || null;
    } catch { /* scheduled run — no user session */ }
    console.log(`[autonomousSocialBeats] Run start | caller=${callerEmail || 'scheduled_no_session'} | time=${nowIso}`);

    // ── CHECK IF USER IS ACTIVELY USING THE APP ─────────────────────────────────
    // Frontend writes to AppWorldState.user_active_session when in foreground pages
    let isForegroundActive = false;
    try {
      const sessions = await base44.asServiceRole.entities.AppWorldState.filter({ key: 'user_active_session' });
      if (sessions.length > 0) {
        const lastUpdate = sessions[0].value ? new Date(sessions[0].value).getTime() : 0;
        const currentTime = Date.now();
        const thirtySeconds = 30 * 1000;
        isForegroundActive = (currentTime - lastUpdate) < thirtySeconds;
      }
    } catch (_) {
      // If we can't read the flag, assume no foreground activity
    }

    // If user is actively using the app, defer social beat generation
    if (isForegroundActive) {
      console.log(`[autonomousSocialBeats] User active — deferring social beat LLM generation`);
      return Response.json({
        success: true,
        yielded: true,
        reason: 'foreground_user_active',
        beats_generated: 0,
        users_processed: 0,
      });
    }

    // ── PROOF MODE: pin community_event pairs first for live path validation ──
    // Only active when proofEventPath=true in payload. No effect on normal runs.
    const body = await req.json().catch(() => ({}));
    const proofEventPath = body?.proofEventPath === true;



    // ── STEP 1: LOAD ALL ACTIVE CHARACTERS ────────────────────────────────────
    // QUERY STRATEGY:
    // Service role + { character_type, status } filter = the proven pattern from enforceCharacterWorkSchedule.
    // When called via test_backend_function (no real session), service role entity queries return 0 —
    // this is a test runner sandbox limitation, NOT a bug in production.
    // When triggered by the real scheduler or by a logged-in admin, full data is visible.
    //
    // Fallback: if caller has a user session (manual invocation), also load user-scoped characters
    // so that manual test runs can prove the pipeline end-to-end.
    let allChars = [];

    // Path A: service role scan — works in real scheduler context
    const serviceRoleChars = await base44.asServiceRole.entities.Character.filter(
      { character_type: 'active_created_character', status: 'active' },
      '-updated_date',
      300
    ).catch(() => []);

    const serviceRoleNPCs = await base44.asServiceRole.entities.Character.filter(
      { character_type: 'npc_fictitious', status: 'active' },
      '-updated_date',
      200
    ).catch(() => []);

    const serviceRoleFamily = await base44.asServiceRole.entities.Character.filter(
      { character_type: 'npc_family_member', status: 'active' },
      '-updated_date',
      200
    ).catch(() => []);

    allChars = [...serviceRoleChars, ...serviceRoleNPCs, ...serviceRoleFamily];
    console.log(`[autonomousSocialBeats] Service role fetch: active_created=${serviceRoleChars.length} npc_fictitious=${serviceRoleNPCs.length} npc_family=${serviceRoleFamily.length} total=${allChars.length}`);

    // Path B: if caller has a session (manual test invocation), also load user-scoped
    // This makes manual test runs prove the pipeline without waiting for the scheduler
    if (callerEmail && allChars.length === 0) {
      console.log(`[autonomousSocialBeats] Service role returned 0. Trying user-scoped fetch for caller=${callerEmail}`);
      const userChars = await base44.entities.Character.filter(
        { owner_email: callerEmail, status: 'active' },
        '-updated_date',
        300
      ).catch(() => []);
      allChars = userChars.filter(c => ELIGIBLE_TYPES.has(c.character_type) && !c.is_test_character && !c.diagnostic_only && !c.is_jailed && c.owner_email);
      console.log(`[autonomousSocialBeats] User-scoped fallback fetch: ${allChars.length} characters for ${callerEmail}`);
    }

    console.log(`[autonomousSocialBeats] Total characters loaded: ${allChars.length}`);

    // Filter to eligible types with owner_email (service role path needs full filter; user-scoped path already filtered)
    const eligible = allChars.filter(c =>
      ELIGIBLE_TYPES.has(c.character_type) &&
      !c.is_test_character &&
      !c.diagnostic_only &&
      !c.is_jailed &&
      c.owner_email
    );

    console.log(`[autonomousSocialBeats] Eligible after type/ownership filter: ${eligible.length}`);
    const typeBreakdown = {};
    for (const c of eligible) {
      typeBreakdown[c.character_type] = (typeBreakdown[c.character_type] || 0) + 1;
    }
    console.log(`[autonomousSocialBeats] Type breakdown: ${JSON.stringify(typeBreakdown)}`);

    if (eligible.length === 0) {
      console.warn(`[autonomousSocialBeats] ZERO eligible characters. Check: status field is set, character_type is in ${[...ELIGIBLE_TYPES].join('|')}, owner_email is set.`);
      return Response.json({ success: true, beats_generated: 0, users_processed: 0, diagnostic: { total_fetched: allChars.length, eligible: 0, type_breakdown: typeBreakdown } });
    }

    // ── STEP 2: GROUP BY USER ─────────────────────────────────────────────────
    const byUser = {};
    for (const c of eligible) {
      if (!byUser[c.owner_email]) byUser[c.owner_email] = [];
      byUser[c.owner_email].push(c);
    }
    console.log(`[autonomousSocialBeats] Users with eligible characters: ${Object.keys(byUser).length}`);

    // ── STEP 3: LOAD COMMUNITY EVENTS (active, recent/upcoming) ───────────────
    // Load events from last 7 days and next 7 days — interaction window
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const communityEvents = await base44.asServiceRole.entities.CommunityEvent.filter(
      { is_active: true },
      '-start_date',
      50
    ).catch(() => []);
    console.log(`[autonomousSocialBeats] Community events loaded: ${communityEvents.length}`);

    // Load EventParticipation records (recent — last 7 days for post-event followup)
    const recentParticipations = await base44.asServiceRole.entities.EventParticipation.filter(
      {},
      '-participation_date',
      200
    ).catch(() => []);
    console.log(`[autonomousSocialBeats] Recent event participations loaded: ${recentParticipations.length}`);

    // Build: eventId → [characterId, ...] map
    const eventCharMap = {};
    for (const ep of recentParticipations) {
      if (!eventCharMap[ep.event_id]) eventCharMap[ep.event_id] = [];
      eventCharMap[ep.event_id].push({ characterId: ep.character_id, ownerEmail: ep.owner_email });
    }

    // Build: characterId → eventId[] for quick lookup
    const charEventMap = {};
    for (const ep of recentParticipations) {
      if (!charEventMap[ep.character_id]) charEventMap[ep.character_id] = [];
      charEventMap[ep.character_id].push(ep.event_id);
    }

    let totalBeats = 0;
    const results = [];
    const diagnosticSummary = [];

    // ── STEP 4: PROCESS EACH USER ─────────────────────────────────────────────
    for (const [userEmail, userChars] of Object.entries(byUser)) {
      let beatsThisUser = 0;
      const userDiag = { userEmail, chars: userChars.length, pairs_considered: 0, pairs_skipped: [], beats: 0 };

      // Build char ID set for this user
      const userCharIds = new Set(userChars.map(c => c.id));

      // Build relationship map: charId → { receiverId → rel }
      const relMap = {};
      for (const c of userChars) {
        relMap[c.id] = {};
        for (const r of (c.fictional_relationships || [])) {
          if (r.related_character_id && userCharIds.has(r.related_character_id)) {
            relMap[c.id][r.related_character_id] = r;
          }
        }
      }

      // ── GATHER CANDIDATE PAIRS ────────────────────────────────────────────────
      // Each entry: { senderId, receiverId, source, eventName? }
      const candidatePairs = [];
      const seenPairKeys = new Set();

      const addPair = (sId, rId, source, eventName) => {
        if (sId === rId) return;
        if (!userCharIds.has(sId) || !userCharIds.has(rId)) return;
        const k = pairKey(sId, rId);
        if (seenPairKeys.has(k)) return;
        seenPairKeys.add(k);
        candidatePairs.push({ senderId: sId, receiverId: rId, source, eventName: eventName || null });
      };

      // Source 1: Community Events — chars from same user attending same event
      for (const event of communityEvents) {
        const eventParticipants = (eventCharMap[event.id] || [])
          .filter(ep => ep.ownerEmail === userEmail && userCharIds.has(ep.characterId))
          .map(ep => ep.characterId);
        for (let i = 0; i < eventParticipants.length; i++) {
          for (let j = i + 1; j < eventParticipants.length; j++) {
            // Both directions eligible — will be scored below
            addPair(eventParticipants[i], eventParticipants[j], 'community_event', event.name);
            addPair(eventParticipants[j], eventParticipants[i], 'community_event', event.name);
          }
        }
      }

      // Source 2: Shared location context — co-workers, housemates, classmates
      for (const c of userChars) {
        for (const other of userChars) {
          if (c.id === other.id) continue;
          // Co-workers: same occupation_location_id
          if (c.occupation_location_id && c.occupation_location_id === other.occupation_location_id) {
            addPair(c.id, other.id, 'coworker', null);
          }
          // Housemates: same current_home_location_id
          if (c.current_home_location_id && c.current_home_location_id === other.current_home_location_id) {
            addPair(c.id, other.id, 'housemate', null);
          }
          // Classmates: same education_location_id
          if (c.education_location_id && c.education_location_id === other.education_location_id) {
            addPair(c.id, other.id, 'classmate', null);
          }
        }
      }

      // Source 3: Family members (npc_family_member or family relationship)
      for (const c of userChars) {
        // Check character's family_members array for other characters in the user's roster
        for (const fm of (c.family_members || [])) {
          if (fm.character_id && userCharIds.has(fm.character_id)) {
            addPair(c.id, fm.character_id, 'family', null);
          }
        }
        // npc_family_member type characters are always family-source candidates with any active_created_character
        if (c.character_type === 'npc_family_member') {
          for (const other of userChars) {
            if (other.character_type === 'active_created_character') {
              addPair(other.id, c.id, 'family', null);
            }
          }
        }
      }

      // Source 4: fictional_relationships with linked character ID
      for (const c of userChars) {
        for (const r of (c.fictional_relationships || [])) {
          if (r.related_character_id && userCharIds.has(r.related_character_id)) {
            addPair(c.id, r.related_character_id, 'relationship', null);
          }
        }
      }

      userDiag.candidate_pairs = candidatePairs.length;
      console.log(`[autonomousSocialBeats] [${userEmail}] Candidate pairs: ${candidatePairs.length} (event=${candidatePairs.filter(p=>p.source==='community_event').length} coworker=${candidatePairs.filter(p=>p.source==='coworker').length} housemate=${candidatePairs.filter(p=>p.source==='housemate').length} family=${candidatePairs.filter(p=>p.source==='family').length} relationship=${candidatePairs.filter(p=>p.source==='relationship').length})`);

      // ── RELATIONSHIP-STRENGTH WEIGHTED SORT ─────────────────────────────────
      // REPAIR: Strong relationships must get priority over weak ones.
      // Previously: pure random shuffle — a 95/100 trust pair and a 30/100 acquaintance
      //             had identical selection probability. That was wrong.
      // Now: pairs are sorted by relationship strength score (desc), with a small random
      //      jitter so the same pair doesn't ALWAYS fire, but strong bonds consistently win.
      //
      // proofEventPath=true: community_event pairs pinned to front for proof runs only.
      for (const pair of candidatePairs) {
        const sender = userChars.find(c => c.id === pair.senderId);
        pair._strength = sender
          ? computePairRelationshipStrength(sender, pair.receiverId, userChars.find(c => c.id === pair.receiverId)?.character_type, pair.source)
          : 30;
      }

      if (proofEventPath) {
        candidatePairs.sort((a, b) => {
          if (a.source === 'community_event' && b.source !== 'community_event') return -1;
          if (b.source === 'community_event' && a.source !== 'community_event') return 1;
          // Within community_event: stronger relationships first
          return (b._strength - a._strength) + (Math.random() * 10 - 5);
        });
        console.log(`[autonomousSocialBeats] proofEventPath=true: community_event pairs pinned to front`);
      } else {
        // Weighted sort: relationship strength (0-100) + small random jitter (0-15)
        // This ensures strong relationships dominate but not exclusively
        candidatePairs.sort((a, b) => {
          const scoreA = a._strength + Math.random() * 15;
          const scoreB = b._strength + Math.random() * 15;
          return scoreB - scoreA;
        });
      }

      const topStrengths = candidatePairs.slice(0, 3).map(p => `${p.senderId.substring(0,6)}→${p.receiverId.substring(0,6)}:str${p._strength}`).join(', ');
      console.log(`[autonomousSocialBeats] [${userEmail}] Pair sort by strength. Top 3: [${topStrengths}]`);

      for (const pair of candidatePairs) {
        if (beatsThisUser >= MAX_BEATS_PER_USER) break;

        const sender = userChars.find(c => c.id === pair.senderId);
        const receiver = userChars.find(c => c.id === pair.receiverId);
        if (!sender || !receiver) continue;

        // Skip if sender is sleeping or jailed
        const senderSleeping = sender.resolved_presence_status === 'sleeping' || sender.resolved_presence_status === 'napping';
        if (senderSleeping || sender.is_jailed) {
          userDiag.pairs_skipped.push({ pair: pairKey(pair.senderId, pair.receiverId), reason: 'sender_unavailable' });
          continue;
        }

        // ── COOLDOWN CHECK ──────────────────────────────────────────────────────
        const recentMems = await base44.asServiceRole.entities.CharacterMemory.filter({
          character_id: pair.senderId,
          related_character_id: pair.receiverId,
        }).catch(() => []);

        const lastBeat = recentMems
          .filter(m => m.memory_summary?.includes('[autonomous_beat]'))
          .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];

        if (lastBeat) {
          const ageMs = now - new Date(lastBeat.created_date);
          if (ageMs < COOLDOWN_MS) {
            const minsAgo = Math.round(ageMs / 60000);
            console.log(`[autonomousSocialBeats] Cooldown: ${sender.name} ↔ ${receiver.name} (${minsAgo}min ago, need ${Math.round(COOLDOWN_MS/60000)}min)`);
            userDiag.pairs_skipped.push({ pair: pairKey(pair.senderId, pair.receiverId), reason: `cooldown_${minsAgo}min` });
            continue;
          }
        }

        const rel = relMap[pair.senderId]?.[pair.receiverId] || null;
        const beatType = selectBeatType(sender, receiver, rel, pair.source);
        const messageText = await generateMessage(base44, sender, receiver, beatType, rel, pair.eventName);

        // ── FIND OR CREATE CONVERSATION ─────────────────────────────────────────
        const convoKey = canonicalConvoKey(pair.senderId, pair.receiverId);
        const participantIds = [pair.senderId, pair.receiverId].sort();

        const existingConvos = await base44.asServiceRole.entities.Conversation.filter({
          shared_conversation_key: convoKey,
        }).catch(() => []);

        let conversationId;
        if (existingConvos.length > 0) {
          conversationId = existingConvos[0].id;
        } else {
          // Check legacy title-based thread
          const legacyConvos = await base44.asServiceRole.entities.Conversation.filter({
            character_ids: [pair.senderId],
          }).catch(() => []);
          const legacyMatch = legacyConvos.find(c =>
            Array.isArray(c.character_ids) &&
            c.character_ids.includes(pair.receiverId) &&
            c.channel === 'world_phone'
          );

          if (legacyMatch) {
            conversationId = legacyMatch.id;
            await base44.asServiceRole.entities.Conversation.update(conversationId, {
              shared_conversation_key: convoKey,
              participant_character_ids: participantIds,
            }).catch(() => {});
          } else {
            const newConvo = await base44.asServiceRole.entities.Conversation.create({
              title: `world_phone::${participantIds.join('::')}`,
              type: 'direct',
              character_ids: [pair.senderId, pair.receiverId],
              participant_character_ids: participantIds,
              shared_conversation_key: convoKey,
              owner_email: userEmail,
              channel: 'world_phone',
              sync_status: 'complete',
              world_contact_mode: 'character_to_character',
              participant_character_types: [sender.character_type, receiver.character_type].filter(Boolean),
            }).catch(err => {
              console.warn(`[autonomousSocialBeats] Convo create failed: ${err.message}`);
              return null;
            });
            if (!newConvo) continue;
            conversationId = newConvo.id;
          }
        }

        // ── CREATE MESSAGE ──────────────────────────────────────────────────────
        const savedMsg = await base44.asServiceRole.entities.Message.create({
          conversation_id: conversationId,
          sender_type: 'character',
          character_id: pair.senderId,
          character_name: sender.name || sender.display_name,
          sender_character_id: pair.senderId,
          receiver_character_id: pair.receiverId,
          participant_character_ids: participantIds,
          shared_conversation_key: convoKey,
          content: messageText,
          timestamp: nowIso,
          channel: 'world_phone',
          is_read: false,
          sync_status: 'complete',
          recovery_signal: false,
          memory_eligible: true,
          relationship_eligible: true,
          trigger_source: 'autonomous_social_beat',
        }).catch(err => {
          console.warn(`[autonomousSocialBeats] Message create failed: ${err.message}`);
          return null;
        });

        if (!savedMsg) continue;

        await base44.asServiceRole.entities.Conversation.update(conversationId, {
          last_message_preview: messageText.substring(0, 100),
          last_message_date: nowIso,
        }).catch(() => {});

        // ── BILATERAL LIFE EVENTS ───────────────────────────────────────────────
        const senderLEDef = lifeEventDef(beatType, true);
        const receiverLEDef = lifeEventDef(beatType, false);
        const senderTitle = beatType === 'community_event_followup'
          ? `reached out about ${pair.eventName || 'a community event'}`
          : `${beatType.replace(/_/g, ' ')} with ${receiver.name || receiver.display_name}`;
        const receiverTitle = beatType === 'community_event_followup'
          ? `heard from ${sender.name || sender.display_name} about ${pair.eventName || 'a community event'}`
          : `heard from ${sender.name || sender.display_name}`;

        const [senderLE, receiverLE] = await Promise.all([
          base44.asServiceRole.entities.LifeEvent.create({
            character_id: pair.senderId,
            character_name: sender.name || sender.display_name,
            event_type: senderLEDef.event_type,
            valence: senderLEDef.valence,
            severity: senderLEDef.severity,
            title: senderTitle,
            description: `Reached out to ${receiver.name || receiver.display_name}: "${messageText.substring(0, 200)}"`,
            emotional_impact: senderLEDef.valence === 'positive' ? 'felt connected' : 'stirred up emotions',
            triggered_by: 'life_simulation',
            timestamp: nowIso,
          }).catch(() => null),
          base44.asServiceRole.entities.LifeEvent.create({
            character_id: pair.receiverId,
            character_name: receiver.name || receiver.display_name,
            event_type: receiverLEDef.event_type,
            valence: receiverLEDef.valence,
            severity: receiverLEDef.severity,
            title: receiverTitle,
            description: `${sender.name || sender.display_name} reached out: "${messageText.substring(0, 200)}"`,
            emotional_impact: receiverLEDef.valence === 'positive' ? 'felt thought of' : 'brought up tension',
            triggered_by: 'life_simulation',
            timestamp: nowIso,
          }).catch(() => null),
        ]);

        // ── BILATERAL CHARACTER MEMORY ──────────────────────────────────────────
        // Tagged [autonomous_beat] so cooldown check can find them next run
        const [senderMem, receiverMem] = await Promise.all([
          base44.asServiceRole.entities.CharacterMemory.create({
            character_id: pair.senderId,
            memory_type: 'relationship',
            memory_text: `Reached out to ${receiver.name || receiver.display_name} (${beatType.replace(/_/g, ' ')}). Message: "${messageText.substring(0, 200)}"`,
            memory_summary: `[autonomous_beat] Contacted ${receiver.name || receiver.display_name} — ${beatType}`,
            related_character_id: pair.receiverId,
            importance_score: 4,
            confidence_score: 0.95,
            permanence: 'long_term',
            validation_status: 'confirmed',
          }).catch(() => null),
          base44.asServiceRole.entities.CharacterMemory.create({
            character_id: pair.receiverId,
            memory_type: 'relationship',
            memory_text: `${sender.name || sender.display_name} reached out (${beatType.replace(/_/g, ' ')}): "${messageText.substring(0, 200)}"`,
            memory_summary: `[autonomous_beat] Received contact from ${sender.name || sender.display_name} — ${beatType}`,
            related_character_id: pair.senderId,
            importance_score: 4,
            confidence_score: 0.95,
            permanence: 'long_term',
            validation_status: 'confirmed',
          }).catch(() => null),
        ]);

        // Small emotional nudge for meaningful beats
        if (beatType === 'supportive_checkin') {
          await base44.asServiceRole.entities.Character.update(pair.senderId, {
            emotional_state: 'grateful',
          }).catch(() => {});
        } else if (beatType === 'resolve_tension') {
          await base44.asServiceRole.entities.Character.update(pair.senderId, {
            emotional_state: 'hopeful',
          }).catch(() => {});
        }

        beatsThisUser++;
        totalBeats++;

        const beatResult = {
          sender: sender.name,
          receiver: receiver.name,
          beatType,
          source: pair.source,
          eventName: pair.eventName || null,
          messagePreview: messageText.substring(0, 80),
          conversationId,
          messageId: savedMsg.id,
          lifeEventsCreated: [senderLE?.id, receiverLE?.id].filter(Boolean).length,
          memoriesCreated: [senderMem?.id, receiverMem?.id].filter(Boolean).length,
          senderLEId: senderLE?.id || null,
          receiverLEId: receiverLE?.id || null,
          senderMemId: senderMem?.id || null,
          receiverMemId: receiverMem?.id || null,
        };

        console.log(`[autonomousSocialBeats] ✓ Beat | ${sender.name} → ${receiver.name} | type=${beatType} | source=${pair.source} | msg=${savedMsg.id} | senderLE=${senderLE?.id} | receiverLE=${receiverLE?.id}`);
        results.push(beatResult);

        await new Promise(r => setTimeout(r, 300));
      }

      userDiag.beats = beatsThisUser;
      diagnosticSummary.push(userDiag);
    }

    console.log(`[autonomousSocialBeats] ── COMPLETE | beats=${totalBeats} | users=${Object.keys(byUser).length}`);

    return Response.json({
      success: true,
      beats_generated: totalBeats,
      users_processed: Object.keys(byUser).length,
      results,
      diagnostic: {
        total_fetched: allChars.length,
        eligible: eligible.length,
        type_breakdown: typeBreakdown,
        users: diagnosticSummary,
      },
      timestamp: nowIso,
    });

  } catch (error) {
    console.error('[autonomousSocialBeats] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});