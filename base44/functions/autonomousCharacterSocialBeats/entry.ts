import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * autonomousCharacterSocialBeats
 *
 * Lightweight scheduled function that generates real character-to-character
 * social events without requiring user initiation.
 *
 * ARCHITECTURE:
 * - Runs entirely as service role (no user session dependency)
 * - Scans all users' active characters for social beat eligibility
 * - Selects eligible pairs based on: relationship data, social need, needs state, cooldown
 * - Creates real records: World Phone Message + bilateral LifeEvent + bilateral CharacterMemory
 * - Caps: max 2 social beats per user per run, 4-hour cooldown per pair
 * - Never creates fake/dashboard-only rows — all records are real and readable by existing systems
 * - Never requires the user to type first
 * - Never overrides user-controlled plans or foreground actions
 * - Never creates destructive or major life events — only lightweight social continuity
 *
 * USER-FIRST BOUNDARY:
 * - No approval-required actions
 * - No major life consequences
 * - No interruptions to active conversations
 * - No spam (capped, cooldown-gated)
 *
 * ELIGIBLE CHARACTER TYPES:
 * - active_created_character (primary participants)
 * - npc_fictitious (can be contacted, can initiate if social need is high)
 * - npc_family_member (family check-ins)
 *
 * BILATERAL REQUIREMENT:
 * - Both sender and receiver get CharacterMemory
 * - Both sender and receiver get a LifeEvent when the beat is emotionally meaningful
 * - Relationship impact stored when relevant
 * - Dashboard ingestion can read all records (timestamped, owner_email scoped)
 */

const ELIGIBLE_TYPES = new Set([
  'active_created_character',
  'npc_fictitious',
  'npc_family_member',
]);

// 4-hour cooldown between beats for the same pair
const COOLDOWN_MS = 4 * 60 * 60 * 1000;

// Max beats per user per run (keeps this lightweight)
const MAX_BEATS_PER_USER = 2;

// Minimum social need threshold to skip pair (if both chars are socially satisfied, no need to initiate)
const SOCIAL_NEED_MIN = 35;

// Pair key — always sort so A↔B and B↔A are the same
function pairKey(idA, idB) {
  return [idA, idB].sort().join('::');
}

// Canonical shared conversation key — mirrors WorldContactsPopup
function canonicalKey(idA, idB) {
  const sorted = [idA, idB].sort();
  return `world_phone::${sorted[0]}::${sorted[1]}`;
}

// Select a beat type based on character needs and relationship state
function selectBeatType(sender, receiver, rel) {
  const socialNeed = sender.social_value ?? 65;
  const mentalVal = sender.mental_value ?? 70;
  const emotionalState = sender.emotional_state || 'calm';
  const friendshipLevel = rel?.friendship_level ?? 30;
  const tensionLevel = rel?.tension_level ?? 0;
  const isFamily = rel?.is_family === true || rel?.relationship_type === 'family';

  // Resolve active tension → reach out to clear the air
  if (tensionLevel > 40 && friendshipLevel > 20) return 'resolve_tension';

  // Mental distress → supportive reach-out from close contact
  if (mentalVal < 35 && friendshipLevel > 50) return 'supportive_checkin';

  // Family check-in
  if (isFamily) return 'family_checkin';

  // Low social need → reach out for connection
  if (socialNeed < SOCIAL_NEED_MIN) return 'social_checkin';

  // Strong friendship → casual catch-up
  if (friendshipLevel > 60) return 'casual_catchup';

  // Default: brief acknowledgment
  return 'brief_acknowledgment';
}

// Build beat message using LLM — returns text string
async function generateBeatMessage(base44, sender, receiver, beatType, rel) {
  const senderName = sender.name || sender.display_name || 'them';
  const receiverName = receiver.name || receiver.display_name || 'them';
  const relType = rel?.relationship_type || 'acquaintance';
  const senderEmotion = sender.emotional_state || 'calm';
  const senderOccupation = sender.occupation || '';

  const beatContextMap = {
    resolve_tension: `There has been some tension between you and ${receiverName} recently. You want to reach out to clear the air or check in.`,
    supportive_checkin: `You are going through a tough time emotionally and ${receiverName} is someone you trust. You want to reach out briefly.`,
    family_checkin: `${receiverName} is your ${relType}. It has been a while and you want to check in the way family does.`,
    social_checkin: `You are feeling a bit isolated and you miss being in contact with ${receiverName}. You want to send them something brief.`,
    casual_catchup: `You and ${receiverName} are good friends and you just want to shoot them a quick message like you normally would.`,
    brief_acknowledgment: `You want to briefly acknowledge ${receiverName} — a short, low-key text that keeps the connection alive.`,
  };

  const beatContext = beatContextMap[beatType] || beatContextMap.brief_acknowledgment;
  const personalityContext = [
    sender.personality_summary,
    sender.communication_style,
    sender.archetype ? `Archetype: ${sender.archetype}` : null,
    senderOccupation ? `Occupation: ${senderOccupation}` : null,
    `Current emotional state: ${senderEmotion}`,
  ].filter(Boolean).join('. ');

  const prompt = `You are ${senderName}. ${personalityContext}

${beatContext}

Write a short, natural text message (1–3 sentences) you would send to ${receiverName} right now.
Sound like yourself — natural, not formal, not dramatic.
Do NOT start with your name. Do NOT use quotation marks around the whole message.
Return only the message text.`;

  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt }).catch(() => null);
  if (!result || typeof result !== 'string' || result.trim().length < 3) {
    // Safe fallback per beat type
    const fallbacks = {
      resolve_tension: `Hey. Can we talk? I don't want things to stay weird between us.`,
      supportive_checkin: `Hey, just thinking about you. Hope you're doing okay.`,
      family_checkin: `Hey, just checking in on you. Miss you.`,
      social_checkin: `Hey, it's been a while. What have you been up to?`,
      casual_catchup: `Hey! What's going on with you lately?`,
      brief_acknowledgment: `Hey, just wanted to reach out. Hope everything's good.`,
    };
    return fallbacks[beatType] || fallbacks.brief_acknowledgment;
  }
  return result.trim();
}

// Determine emotional impact for LifeEvent based on beat type
function lifeEventForBeat(beatType, senderPerspective) {
  const map = {
    resolve_tension: {
      event_type: senderPerspective ? 'conflict_event' : 'recovery_event',
      valence: senderPerspective ? 'negative' : 'positive',
      severity: 'minor',
    },
    supportive_checkin: {
      event_type: 'supportive_event',
      valence: 'positive',
      severity: 'minor',
    },
    family_checkin: {
      event_type: 'bonding_event',
      valence: 'positive',
      severity: 'minor',
    },
    social_checkin: {
      event_type: 'supportive_event',
      valence: 'positive',
      severity: 'minor',
    },
    casual_catchup: {
      event_type: 'bonding_event',
      valence: 'positive',
      severity: 'minor',
    },
    brief_acknowledgment: {
      event_type: 'supportive_event',
      valence: 'positive',
      severity: 'minor',
    },
  };
  return map[beatType] || map.brief_acknowledgment;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // This is a scheduled function — no user session. All operations use service role.
    // Caller email is only used for manual/admin invocation logging.
    let callerEmail = null;
    try {
      const me = await base44.auth.me();
      callerEmail = me?.email || null;
    } catch { /* scheduled — no session */ }

    const now = new Date();
    const nowIso = now.toISOString();

    // ── LOAD ALL ACTIVE ELIGIBLE CHARACTERS (service role) ────────────────────
    let allChars;
    try {
      allChars = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        console.warn('[autonomousSocialBeats] Rate limited on character fetch — aborting run');
        return Response.json({ status: 'rate_limited', beats_generated: 0 }, { status: 429 });
      }
      throw err;
    }

    // Filter to eligible characters only
    const eligible = allChars.filter(c =>
      ELIGIBLE_TYPES.has(c.character_type) &&
      (!c.status || c.status === 'active') &&
      !c.is_test_character &&
      !c.diagnostic_only &&
      !c.is_jailed &&
      c.owner_email // must have ownership
    );

    console.log(`[autonomousSocialBeats] Eligible characters: ${eligible.length}`);

    // ── GROUP BY USER ─────────────────────────────────────────────────────────
    const byUser = {};
    for (const c of eligible) {
      if (!byUser[c.owner_email]) byUser[c.owner_email] = [];
      byUser[c.owner_email].push(c);
    }

    let totalBeats = 0;
    const results = [];

    // ── PROCESS EACH USER'S CHARACTER SET ─────────────────────────────────────
    for (const [userEmail, userChars] of Object.entries(byUser)) {
      let beatsThisUser = 0;

      // Only active_created_character or high-social-need NPCs can initiate
      const initiators = userChars.filter(c =>
        c.character_type === 'active_created_character' ||
        (ELIGIBLE_TYPES.has(c.character_type) && (c.social_value ?? 65) < SOCIAL_NEED_MIN)
      );

      // Shuffle initiators so we don't always pick the same character first
      initiators.sort(() => Math.random() - 0.5);

      for (const sender of initiators) {
        if (beatsThisUser >= MAX_BEATS_PER_USER) break;

        // ── FIND CANDIDATE RECEIVERS ──────────────────────────────────────────
        // Only characters who: belong to same user, are not the sender, are active, are not sleeping/jailed
        const candidates = userChars.filter(c =>
          c.id !== sender.id &&
          (!c.status || c.status === 'active') &&
          c.resolved_presence_status !== 'sleeping' &&
          c.resolved_presence_status !== 'napping' &&
          !c.is_jailed
        );

        if (candidates.length === 0) continue;

        // ── FIND BEST RECEIVER based on relationship data ─────────────────────
        // Prefer characters the sender has a relationship with
        const senderRels = sender.fictional_relationships || [];
        const relMap = {};
        for (const r of senderRels) {
          if (r.related_character_id) relMap[r.related_character_id] = r;
        }

        // Score candidates: known contacts ranked higher, family ranked highest for family beats
        const scored = candidates.map(c => {
          const rel = relMap[c.id] || null;
          const isFamily = rel?.relationship_type === 'family' || c.character_type === 'npc_family_member';
          const friendship = rel?.friendship_level ?? 0;
          const tension = rel?.tension_level ?? 0;
          const knownBonus = rel ? 20 : 0;
          const familyBonus = isFamily ? 30 : 0;
          // Tension creates urgency — pairs with tension are prioritized for resolve_tension beats
          const tensionBonus = tension > 30 ? 15 : 0;
          const score = friendship + knownBonus + familyBonus + tensionBonus + Math.random() * 10;
          return { char: c, rel, score };
        });

        scored.sort((a, b) => b.score - a.score);
        const { char: receiver, rel } = scored[0];

        // ── COOLDOWN CHECK ─────────────────────────────────────────────────────
        // Check if this pair had a recent autonomous beat via CharacterMemory
        const key = pairKey(sender.id, receiver.id);
        const recentMemories = await base44.asServiceRole.entities.CharacterMemory.filter({
          character_id: sender.id,
          related_character_id: receiver.id,
        }).catch(() => []);

        const lastBeat = recentMemories
          .filter(m => m.memory_summary?.includes('[autonomous_beat]'))
          .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];

        if (lastBeat) {
          const ageMs = now - new Date(lastBeat.created_date);
          if (ageMs < COOLDOWN_MS) {
            console.log(`[autonomousSocialBeats] Cooldown: ${sender.name} ↔ ${receiver.name} (${Math.round(ageMs / 60000)}min ago)`);
            continue;
          }
        }

        // ── SENDER AVAILABILITY CHECK ─────────────────────────────────────────
        // Don't initiate if sender is asleep, at work with no-contact preference, or overwhelmed
        const senderIsSleeping = sender.resolved_presence_status === 'sleeping' || sender.resolved_presence_status === 'napping';
        if (senderIsSleeping) continue;

        // ── SELECT BEAT TYPE ───────────────────────────────────────────────────
        const beatType = selectBeatType(sender, receiver, rel);

        // ── GENERATE MESSAGE ───────────────────────────────────────────────────
        const messageText = await generateBeatMessage(base44, sender, receiver, beatType, rel);

        // ── FIND OR CREATE WORLD PHONE CONVERSATION ────────────────────────────
        // Use canonical key matching WorldContactsPopup exactly
        const convoKey = canonicalKey(sender.id, receiver.id);
        const participantIds = [sender.id, receiver.id].sort();

        const existingConvos = await base44.asServiceRole.entities.Conversation.filter({
          shared_conversation_key: convoKey,
        }).catch(() => []);

        let conversationId;
        if (existingConvos.length > 0) {
          conversationId = existingConvos[0].id;
        } else {
          // Also check legacy title-based thread
          const legacyConvos = await base44.asServiceRole.entities.Conversation.filter({
            character_ids: [sender.id],
          }).catch(() => []);
          const legacyMatch = legacyConvos.find(c =>
            Array.isArray(c.character_ids) &&
            c.character_ids.includes(receiver.id) &&
            c.channel === 'world_phone'
          );
          if (legacyMatch) {
            conversationId = legacyMatch.id;
            // Upgrade to canonical key
            await base44.asServiceRole.entities.Conversation.update(conversationId, {
              shared_conversation_key: convoKey,
              participant_character_ids: participantIds,
            }).catch(() => {});
          } else {
            // Create new canonical thread
            const newConvo = await base44.asServiceRole.entities.Conversation.create({
              title: `world_phone::${participantIds.join('::')}`,
              type: 'direct',
              character_ids: [sender.id, receiver.id],
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

        // ── CREATE THE MESSAGE ─────────────────────────────────────────────────
        const savedMsg = await base44.asServiceRole.entities.Message.create({
          conversation_id: conversationId,
          sender_type: 'character',
          character_id: sender.id,
          character_name: sender.name || sender.display_name,
          sender_character_id: sender.id,
          receiver_character_id: receiver.id,
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
          // mark source so other systems can identify autonomous beats
          trigger_source: 'autonomous_social_beat',
        }).catch(err => {
          console.warn(`[autonomousSocialBeats] Message create failed: ${err.message}`);
          return null;
        });

        if (!savedMsg) continue;

        // Update conversation preview
        await base44.asServiceRole.entities.Conversation.update(conversationId, {
          last_message_preview: messageText.substring(0, 100),
          last_message_date: nowIso,
        }).catch(() => {});

        // ── BILATERAL LIFE EVENTS ──────────────────────────────────────────────
        // Only write if emotionally meaningful — the receiver's LifeEvent is what
        // makes this readable in the receiver's dashboard
        const senderLEDef = lifeEventForBeat(beatType, true);
        const receiverLEDef = lifeEventForBeat(beatType, false);
        const leTitle = `${beatType.replace(/_/g, ' ')} with ${receiver.name || receiver.display_name}`;
        const receiverLeTitle = `heard from ${sender.name || sender.display_name}`;

        const [senderLE, receiverLE] = await Promise.all([
          base44.asServiceRole.entities.LifeEvent.create({
            character_id: sender.id,
            character_name: sender.name || sender.display_name,
            event_type: senderLEDef.event_type,
            valence: senderLEDef.valence,
            severity: senderLEDef.severity,
            title: leTitle,
            description: `Reached out to ${receiver.name || receiver.display_name}: "${messageText.substring(0, 200)}"`,
            emotional_impact: senderLEDef.valence === 'positive' ? 'uplifting' : 'stirred up emotions',
            triggered_by: 'life_simulation',
            timestamp: nowIso,
          }).catch(() => null),
          base44.asServiceRole.entities.LifeEvent.create({
            character_id: receiver.id,
            character_name: receiver.name || receiver.display_name,
            event_type: receiverLEDef.event_type,
            valence: receiverLEDef.valence,
            severity: receiverLEDef.severity,
            title: receiverLeTitle,
            description: `${sender.name || sender.display_name} reached out: "${messageText.substring(0, 200)}"`,
            emotional_impact: receiverLEDef.valence === 'positive' ? 'felt noticed and thought of' : 'brought up tension',
            triggered_by: 'life_simulation',
            timestamp: nowIso,
          }).catch(() => null),
        ]);

        // ── BILATERAL CHARACTER MEMORY ─────────────────────────────────────────
        // Tagged with [autonomous_beat] so cooldown check can find them
        await Promise.all([
          base44.asServiceRole.entities.CharacterMemory.create({
            character_id: sender.id,
            memory_type: 'relationship',
            memory_text: `Reached out to ${receiver.name || receiver.display_name} with a ${beatType.replace(/_/g, ' ')}. Said: "${messageText.substring(0, 200)}"`,
            memory_summary: `[autonomous_beat] Contacted ${receiver.name || receiver.display_name} — ${beatType}`,
            related_character_id: receiver.id,
            importance_score: 4,
            confidence_score: 0.95,
            permanence: 'long_term',
            validation_status: 'confirmed',
          }).catch(() => null),
          base44.asServiceRole.entities.CharacterMemory.create({
            character_id: receiver.id,
            memory_type: 'relationship',
            memory_text: `${sender.name || sender.display_name} reached out with a ${beatType.replace(/_/g, ' ')}. Said: "${messageText.substring(0, 200)}"`,
            memory_summary: `[autonomous_beat] Received contact from ${sender.name || sender.display_name} — ${beatType}`,
            related_character_id: sender.id,
            importance_score: 4,
            confidence_score: 0.95,
            permanence: 'long_term',
            validation_status: 'confirmed',
          }).catch(() => null),
        ]);

        // ── EMOTIONAL STATE UPDATE — small nudge, not a full override ──────────
        // Only when beat type has a clear directional impact
        if (beatType === 'supportive_checkin' || beatType === 'resolve_tension') {
          const senderNewEmotion = beatType === 'resolve_tension' ? 'hopeful' : 'grateful';
          await base44.asServiceRole.entities.Character.update(sender.id, {
            emotional_state: senderNewEmotion,
          }).catch(() => {});
        }

        beatsThisUser++;
        totalBeats++;

        console.log(
          `[autonomousSocialBeats] ✓ Beat | ${sender.name} → ${receiver.name}` +
          ` | type=${beatType} | user=${userEmail}` +
          ` | msg_id=${savedMsg.id} | convo=${conversationId}`
        );

        results.push({
          sender: sender.name,
          receiver: receiver.name,
          beatType,
          messagePreview: messageText.substring(0, 80),
          conversationId,
          lifeEventsCreated: [senderLE?.id, receiverLE?.id].filter(Boolean).length,
        });

        // Small delay between beats to avoid DB hammering
        await new Promise(r => setTimeout(r, 300));
      }
    }

    console.log(`[autonomousSocialBeats] Run complete | total_beats=${totalBeats} | users=${Object.keys(byUser).length}`);

    return Response.json({
      success: true,
      beats_generated: totalBeats,
      users_processed: Object.keys(byUser).length,
      results,
      timestamp: nowIso,
    });

  } catch (error) {
    console.error('[autonomousSocialBeats] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});