import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * organicCharacterInteractions
 *
 * Character-to-character conversation system with realism constraints:
 * - 3-hour scheduler cycle (not 20 minutes)
 * - Realistic conversation pacing (3-10 messages typical)
 * - Cooldowns between interactions
 * - Natural stopping points
 * - Respects sleep, work, and travel states
 * - Creates real Message + Conversation records
 * - Fully user-scoped by owner_email
 * - Does NOT affect character-to-user texting
 */

const ELIGIBLE_TYPES = new Set([
  'active_created_character',
  'npc_fictitious',
  'npc_family_member',
]);

const PAIR_COOLDOWN_HOURS = 6;       // same pair cooldown
const CHAR_COOLDOWN_HOURS = 2;       // character cooldown before starting another conversation
const CONVO_TARGET_MIN = 3;          // minimum messages per conversation
const CONVO_TARGET_MAX = 10;         // typical max messages
const CONVO_EXTENDED_MAX = 20;       // extended conversation if high relationship weight
const MAX_CONVOS_PER_RUN = 2;        // max new conversations per scheduler run
const SKIP_PROB = 0.45;              // 45% chance to skip co-located pair (natural variation)

function getFamiliarityLabel(count) {
  const levels = [
    { label: 'Seen around', minCount: 0 },
    { label: 'Briefly met', minCount: 1 },
    { label: 'Acquaintance', minCount: 3 },
    { label: 'Friendly acquaintance', minCount: 7 },
    { label: 'Friend', minCount: 15 },
    { label: 'Close friend', minCount: 30 },
  ];
  let label = levels[0].label;
  for (const level of levels) {
    if (count >= level.minCount) label = level.label;
  }
  return label;
}

function buildInteractionNote(charA, charB, locationName, locCategory) {
  const map = {
    gym: `saw each other during a workout at ${locationName}`,
    workplace: `crossed paths during a shift at ${locationName}`,
    school: `ran into each other at ${locationName}`,
    food_drink: `were both grabbing something at ${locationName}`,
    social: `had a moment together at ${locationName}`,
    bar: `spotted each other at ${locationName}`,
    home: `were both home at ${locationName}`,
    outdoor: `crossed paths near ${locationName}`,
    grocery: `were at the store at ${locationName}`,
    medical: `were both at ${locationName}`,
    generic: `were at ${locationName}`,
  };
  return map[locCategory] || `met at ${locationName}`;
}

// Determine conversation target message count based on relationship weight
function getConversationTarget(relationship, priorInteractions) {
  const weight = (relationship?.friendship_level || 0) + 
                 (relationship?.romantic_level || 0) +
                 (relationship?.chosen_family_level || 0) +
                 (priorInteractions > 3 ? 10 : 0);
  
  if (weight > 50) return Math.floor(Math.random() * (CONVO_EXTENDED_MAX - 10 + 1)) + 10;
  if (weight > 30) return Math.floor(Math.random() * (CONVO_TARGET_MAX - CONVO_TARGET_MIN + 1)) + CONVO_TARGET_MIN + 3;
  return Math.floor(Math.random() * (CONVO_TARGET_MAX - CONVO_TARGET_MIN + 1)) + CONVO_TARGET_MIN;
}

// Check if character is available for starting a conversation
function isCharacterAvailable(char) {
  // Sleeping = not available
  if (char.resolved_presence_status === 'sleeping') return false;
  // In transit during non-commute = lower availability
  if (char.resolved_presence_status === 'in_transit') return false;
  // At work/school = can respond but not start casually
  return true;
}

// Natural stopping points for conversations
const STOPPING_PHRASES = [
  "okay, i'll text you later",
  "gotta go",
  "i'll let you know",
  "talk later",
  "heading out",
  "see you later",
  "catch you soon",
  "ttyl",
  "thanks for checking on me",
  "alright, good to hear",
  "cool, thanks",
  "sounds good",
  "i'm good thanks",
];

function shouldEndConversation(lastMessage, targetReached) {
  if (targetReached) return true;
  const lower = lastMessage.toLowerCase();
  return STOPPING_PHRASES.some(phrase => lower.includes(phrase));
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    let callerEmail = null;
    try {
      const me = await base44.auth.me();
      callerEmail = me?.email || null;
    } catch { /* scheduled — no user session */ }

    // ── LOAD ALL ELIGIBLE CHARACTERS ──────────────────────────────────────
    const allChars = await base44.asServiceRole.entities.Character.list('-resolved_last_updated_at', 500);

    const eligible = allChars.filter(c =>
      ELIGIBLE_TYPES.has(c.character_type) &&
      (!c.status || c.status === 'active') &&
      !c.is_test_character &&
      !c.diagnostic_only &&
      !c.is_jailed &&
      c.resolved_current_location_id
    );

    console.log(`[organicInteractions] Starting cycle. Eligible characters: ${eligible.length}`);

    // ── GROUP BY USER ─────────────────────────────────────────────────────
    const byUser = {};
    for (const c of eligible) {
      const email = c.owner_email;
      if (!email) continue;
      if (!byUser[email]) byUser[email] = [];
      byUser[email].push(c);
    }

    const now = new Date();
    const pairCooldownMs = PAIR_COOLDOWN_HOURS * 60 * 60 * 1000;
    const charCooldownMs = CHAR_COOLDOWN_HOURS * 60 * 60 * 1000;
    let convosCreatedThisCycle = 0;
    let totalInteractions = 0;

    // ── PROCESS EACH USER'S CHARACTER SET ─────────────────────────────────
    for (const [userEmail, userChars] of Object.entries(byUser)) {

      // Track characters that started conversations this cycle (cooldown)
      const charsStartedThisCycle = new Set();

      // Group by location
      const byLocation = {};
      for (const c of userChars) {
        const locId = c.resolved_current_location_id;
        if (!byLocation[locId]) byLocation[locId] = [];
        byLocation[locId].push(c);
      }

      // ── EVALUATE PAIRS AT SHARED LOCATIONS ────────────────────────────────
      for (const [locId, charsHere] of Object.entries(byLocation)) {
        if (charsHere.length < 2 || convosCreatedThisCycle >= MAX_CONVOS_PER_RUN) continue;

        // Load location once
        let locationName = charsHere[0].resolved_current_location_name || 'a shared location';
        let locCategory = 'generic';
        try {
          const locRecord = await base44.asServiceRole.entities.LocationReference.get(locId).catch(() => null);
          if (locRecord) {
            locationName = locRecord.name || locationName;
            locCategory = locRecord.category || 'generic';
          }
        } catch { /* skip */ }

        // ── RANDOMIZE PAIR ORDER & EVALUATE ──────────────────────────────────
        const pairs = [];
        for (let i = 0; i < charsHere.length; i++) {
          for (let j = i + 1; j < charsHere.length; j++) {
            pairs.push([charsHere[i], charsHere[j]]);
          }
        }

        // Shuffle pairs for variation
        for (let i = pairs.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
        }

        for (const [charA, charB] of pairs) {
          if (convosCreatedThisCycle >= MAX_CONVOS_PER_RUN) break;

          // SKIP: Already started a conversation this cycle
          if (charsStartedThisCycle.has(charA.id)) continue;

          // SKIP: Either character not available
          if (!isCharacterAvailable(charA) || !isCharacterAvailable(charB)) continue;

          // SKIP: Natural variation (45% chance to skip co-located pair)
          if (Math.random() < SKIP_PROB) continue;

          // ── COOLDOWN CHECK: Pair ──────────────────────────────────────────
          const recentMemories = await base44.asServiceRole.entities.CharacterMemory.filter({
            character_id: charA.id,
            related_character_id: charB.id,
            memory_type: 'relationship',
          }).catch(() => []);

          const lastInteraction = recentMemories
            .filter(m => m.memory_summary?.includes('[co-location]'))
            .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0];

          if (lastInteraction) {
            const age = now - new Date(lastInteraction.created_date);
            if (age < pairCooldownMs) {
              console.log(`[organicInteractions] Skipping ${charA.name}↔${charB.name}: pair cooldown active`);
              continue;
            }
          }

          const priorCount = recentMemories.filter(m => m.memory_summary?.includes('[co-location]')).length;

          // ── CREATE CONVERSATION & INITIAL MESSAGES ───────────────────────
          const convoTitle = `npc_chat__${charA.id}__${charB.name || charB.display_name}`;
          const existingConvo = await base44.asServiceRole.entities.Conversation.filter(
            { title: convoTitle, type: 'npc' },
            null,
            1
          ).catch(() => []);

          let conversation = existingConvo[0];
          const isNewConvo = !conversation;

          if (isNewConvo) {
            conversation = await base44.asServiceRole.entities.Conversation.create({
              title: convoTitle,
              type: 'npc',
              character_ids: [charA.id, charB.id],
            }).catch(e => {
              console.warn(`[organicInteractions] Conversation creation failed: ${e.message}`);
              return null;
            });
          }

          if (!conversation) continue;

          // ── GENERATE CONVERSATION THREAD ──────────────────────────────────
          const targetMessages = getConversationTarget(
            (charB.fictional_relationships || []).find(r => r.related_character_id === charA.id),
            priorCount
          );

          const interactionNote = buildInteractionNote(charA, charB, locationName, locCategory);
          const familiarityLabel = getFamiliarityLabel(priorCount + 1);
          const timestamp = now.toISOString();

          // Opening message
          const openingMessages = [
            `hey, ${interactionNote}. how's it going?`,
            `you here too? ${interactionNote}.`,
            `hey! didn't expect to see you here. ${interactionNote}.`,
            `yo, ${interactionNote}. what are you up to?`,
            `${charB.name || charB.display_name}! ${interactionNote}.`,
          ];

          const opening = openingMessages[Math.floor(Math.random() * openingMessages.length)];

          try {
            const messages = [];
            messages.push({
              conversation_id: conversation.id,
              sender_type: 'character',
              character_id: charA.id,
              character_name: charA.name || charA.display_name,
              content: opening,
              timestamp,
            });

            // Generate responsive conversation
            let messageCount = 1;
            let lastSender = charA.id;
            let conversationContext = [{ role: 'user', content: opening }];

            while (messageCount < targetMessages && messageCount < 30) {
              const responder = lastSender === charA.id ? charB : charA;
              const initiator = lastSender === charA.id ? charA : charB;

              const relationInfo = (responder.fictional_relationships || []).find(
                r => r.related_character_id === initiator.id
              );

              const contextStr = conversationContext
                .slice(-4) // last 4 exchanges for context
                .map(m => `${m.role === 'user' ? initiator.name : responder.name}: ${m.content}`)
                .join('\n');

              const prompt = `You are ${responder.name || responder.display_name} texting ${initiator.name || initiator.display_name}.
Relationship: ${relationInfo?.description || 'acquaintance'} (${relationInfo?.current_status || 'friendly'}).
Context: ${contextStr}

Reply naturally in 1-2 sentences. Keep it brief and realistic. Use casual, imperfect texting tone.
${messageCount > (targetMessages - 2) ? 'Consider wrapping up the conversation naturally.' : ''}`;

              const llmResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt }).catch(() => '...');
              const content = (llmResponse || '...').trim();

              messages.push({
                conversation_id: conversation.id,
                sender_type: 'character',
                character_id: responder.id,
                character_name: responder.name || responder.display_name,
                content,
                timestamp: new Date(new Date(timestamp).getTime() + messageCount * 60000).toISOString(),
              });

              conversationContext.push({ role: 'user', content });

              // Natural stopping point check
              if (shouldEndConversation(content, messageCount >= targetMessages)) {
                console.log(`[organicInteractions] Natural ending after ${messageCount + 1} messages`);
                break;
              }

              messageCount++;
              lastSender = responder.id;
            }

            // Batch insert messages
            for (const msg of messages) {
              await base44.asServiceRole.entities.Message.create(msg).catch(e => 
                console.warn(`[organicInteractions] Message creation failed: ${e.message}`)
              );
            }

            console.log(`[organicInteractions] ✓ Conversation: ${charA.name}↔${charB.name} (${messages.length} messages) at ${locationName}`);

            // ── SYNC MEMORIES ────────────────────────────────────────────────
            await Promise.all([
              base44.asServiceRole.entities.CharacterMemory.create({
                character_id: charA.id,
                memory_type: 'relationship',
                memory_text: `They ${interactionNote} with ${charB.name || charB.display_name}. Familiarity: ${familiarityLabel}.`,
                memory_summary: `[co-location] ${charB.name || charB.display_name} at ${locationName}`,
                related_character_id: charB.id,
                related_location_id: locId,
                importance_score: Math.min(3 + priorCount, 7),
                confidence_score: 0.9,
                permanence: 'long_term',
                validation_status: 'confirmed',
              }).catch(() => {}),
              base44.asServiceRole.entities.CharacterMemory.create({
                character_id: charB.id,
                memory_type: 'relationship',
                memory_text: `They ${interactionNote} with ${charA.name || charA.display_name}. Familiarity: ${familiarityLabel}.`,
                memory_summary: `[co-location] ${charA.name || charA.display_name} at ${locationName}`,
                related_character_id: charA.id,
                related_location_id: locId,
                importance_score: Math.min(3 + priorCount, 7),
                confidence_score: 0.9,
                permanence: 'long_term',
                validation_status: 'confirmed',
              }).catch(() => {}),
            ]);

            // ── UPDATE FICTIONAL RELATIONSHIPS ───────────────────────────────
            const updateFictionalRel = async (sourceChar, targetChar) => {
              if (sourceChar.character_type !== 'active_created_character') return;

              const existing = (sourceChar.fictional_relationships || []).find(
                r => r.related_character_id === targetChar.id
              );

              const updatedRel = existing
                ? { ...existing, current_status: familiarityLabel }
                : {
                    person_name: targetChar.name || targetChar.display_name,
                    related_character_id: targetChar.id,
                    relationship_type: 'other',
                    description: `Seen around at ${locationName}.`,
                    current_status: 'Seen around',
                    friendship_level: 0,
                  };

              const updatedList = existing
                ? (sourceChar.fictional_relationships || []).map(r =>
                    r.related_character_id === targetChar.id ? updatedRel : r
                  )
                : [...(sourceChar.fictional_relationships || []), updatedRel];

              await base44.asServiceRole.entities.Character.update(sourceChar.id, {
                fictional_relationships: updatedList,
              }).catch(() => {});
            };

            await Promise.all([
              updateFictionalRel(charA, charB),
              updateFictionalRel(charB, charA),
            ]);

            charsStartedThisCycle.add(charA.id);
            convosCreatedThisCycle++;
            totalInteractions++;

          } catch (conversationErr) {
            console.warn(`[organicInteractions] Conversation generation failed: ${conversationErr.message}`);
          }

          await new Promise(r => setTimeout(r, 100));
        }
      }
    }

    return Response.json({
      success: true,
      conversations_created: convosCreatedThisCycle,
      total_interactions: totalInteractions,
      users_processed: Object.keys(byUser).length,
      timestamp: now.toISOString(),
    });

  } catch (error) {
    console.error('[organicCharacterInteractions]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});