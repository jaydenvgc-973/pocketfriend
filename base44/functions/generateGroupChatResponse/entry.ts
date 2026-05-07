import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

// STRICT RULES:
// - Max 3 independent messages per character per conversation cycle (since last user message)
// - Asleep characters must not respond
// - No infinite loops

const BLOCKING_ACTIVITIES = ['showering', 'shower', 'swimming', 'swim', 'bathroom', 'sick', 'throwing up', 'vomiting', 'sleeping', 'sleep'];
const INDEPENDENT_MSG_LIMIT = 3; // strict cap per character per cycle

function isCharacterAsleepServer(character) {
  const sleepStart = character?.sleep_start_time || "23:00";
  const wakeUp = character?.wake_up_time || "07:00";
  const now = new Date();
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const [sleepH, sleepM] = sleepStart.split(":").map(Number);
  const [wakeH, wakeM] = wakeUp.split(":").map(Number);
  const sleepMinutes = sleepH * 60 + sleepM;
  const wakeMinutes = wakeH * 60 + wakeM;
  if (sleepMinutes > wakeMinutes) {
    return currentMinutes >= sleepMinutes || currentMinutes < wakeMinutes;
  }
  return currentMinutes >= sleepMinutes && currentMinutes < wakeMinutes;
}

function isCharacterBlocked(character) {
  if (isCharacterAsleepServer(character)) return true;
  if (!character.current_activity) return false;
  const activity = character.current_activity.toLowerCase();
  return BLOCKING_ACTIVITIES.some(blocked => activity.includes(blocked));
}

// Count messages per character since the last user message (= one "cycle")
function countIndependentMessagesSinceLastUser(messages, characterId) {
  // Find the index of the last user message
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender_type === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return 0;
  // Count character messages after that index
  let count = 0;
  for (let i = lastUserIdx + 1; i < messages.length; i++) {
    if (messages[i].sender_type === 'character' && messages[i].character_id === characterId) {
      count++;
    }
  }
  return count;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { messageId } = await req.json();

    if (!messageId) {
      return Response.json({ error: 'messageId required' }, { status: 400 });
    }

    const messages_result = await base44.entities.Message.filter({ id: messageId });
    const message = messages_result?.[0];
    if (!message || message.sender_type !== 'user') {
      return Response.json({ error: 'Invalid message' }, { status: 400 });
    }

    const convos = await base44.entities.Conversation.filter({ id: message.conversation_id });
    const conversation = convos?.[0];
    if (!conversation || conversation.type !== 'group') {
      return Response.json({ error: 'Invalid conversation' }, { status: 400 });
    }

    // Ownership-scoped character load — use conversation's owner context
    // Fall back to asServiceRole only to match by character_ids (already scoped by IDs from this convo)
    const characters = await base44.asServiceRole.entities.Character.filter({
      id: { $in: conversation.character_ids || [] }
    }).catch(() => base44.entities.Character.list());
    const convoCharacters = characters.filter(c => conversation.character_ids?.includes(c.id));

    const messages = await base44.entities.Message.filter(
      { conversation_id: conversation.id },
      'created_date',
      200
    );

    const debugLog = [];

    for (const character of convoCharacters) {
      // --- SLEEP ENFORCEMENT (GROUP TEXT - STRICT) ---
      if (isCharacterAsleepServer(character)) {
        debugLog.push({ character: character.name, status: 'BLOCKED', reason: 'asleep', independentCount: 'N/A', limitReached: false });
        console.log(`[GROUP-CHAT] ${character.name} BLOCKED — asleep. No message sent.`);
        continue;
      }

      // --- BLOCKING ACTIVITY CHECK ---
      if (isCharacterBlocked(character)) {
        debugLog.push({ character: character.name, status: 'BLOCKED', reason: 'blocking_activity', independentCount: 'N/A', limitReached: false });
        console.log(`[GROUP-CHAT] ${character.name} BLOCKED — blocking activity: ${character.current_activity}`);
        continue;
      }

      // --- 3-MESSAGE INDEPENDENT LIMIT (STRICT) ---
      const independentCount = countIndependentMessagesSinceLastUser(messages, character.id);
      const limitReached = independentCount >= INDEPENDENT_MSG_LIMIT;

      console.log(`[GROUP-CHAT] ${character.name} | status=awake | independent_messages=${independentCount}/${INDEPENDENT_MSG_LIMIT} | limit_reached=${limitReached}`);

      if (limitReached) {
        debugLog.push({ character: character.name, status: 'BLOCKED', reason: '3_message_limit_reached', independentCount, limitReached: true });
        console.log(`[GROUP-CHAT] ${character.name} BLOCKED — 3-message independent limit reached (${independentCount}/${INDEPENDENT_MSG_LIMIT}). Waiting for user interaction.`);
        continue;
      }

      // --- EXACT TIMING: 0–60 seconds for group text ---
      const delayMs = Math.random() * 60 * 1000;
      console.log(`[GROUP-CHAT] ${character.name} | delay=${Math.round(delayMs / 1000)}s | comm_type=group_text`);
      await new Promise(r => setTimeout(r, delayMs));

      const historyLines = messages
        .map(m => `${m.sender_type === 'user' ? 'User' : m.character_name}: ${m.content}`)
        .join('\n');

      const otherParticipants = convoCharacters
        .filter(c => c.id !== character.id)
        .map(c => c.name)
        .join(', ');

      // Fetch cross-page memory for this character (Chat, Scene, Text history + stored memories)
      let crossPageMemoryBlock = '';
      try {
        const memRes = await base44.functions.invoke('retrieveCrossPageMemory', {
          characterId: character.id,
          limitMessages: 12,
        });
        if (memRes?.contextText) {
          crossPageMemoryBlock = `\n=== MEMORY ACROSS ALL PAGES (Chat, Scene, Text, Group) ===\nYou MUST use this to maintain continuity. Do NOT act like you're meeting the user for the first time if prior conversations exist.\n${memRes.contextText}\n===`;
        }
      } catch {
        // non-blocking
      }

      // Resolve pronouns from character profile — never infer from name or appearance
      const charGender = character.gender || '';
      const charPronouns = charGender === 'male' ? 'he/him' : charGender === 'female' ? 'she/her' : 'they/them';

      // ── CANONICAL CONTEXT: pull from shared truth service ─────────────────
      let canonicalSystemPrompt = '';
      let canonicalLoaded = false;
      let canonicalFallbackUsed = false;
      try {
        const ctxRes = await base44.functions.invoke('buildCanonicalCharacterContext', {
          characterId: character.id,
          interactionContext: 'group_chat',
          topKMemories: 10,
        });
        const ctxData = ctxRes?.data || ctxRes;
        if (ctxData?.systemPrompt) {
          canonicalSystemPrompt = ctxData.systemPrompt;
          canonicalLoaded = true;
          console.log(
            `[generateGroupChatResponse] ✓ route=group_chat` +
            ` | character=${character.name} (${character.id})` +
            ` | canonical_loaded=true` +
            ` | hard_facts_loaded=${!!ctxData.hardFacts}` +
            ` | memory_count=${ctxData.memories?.length ?? 0}` +
            ` | relationship_context_loaded=${!!ctxData.relationshipContext}` +
            ` | fallback_used=false`
          );
        }
      } catch (ctxErr) {
        canonicalFallbackUsed = true;
        console.warn(`[generateGroupChatResponse] Canonical context unavailable for ${character.name} (${character.id}): ${ctxErr.message}`);
      }

      // Fallback only if canonical context service fails — log visibly
      if (!canonicalSystemPrompt) {
        canonicalFallbackUsed = true;
        console.warn(
          `[generateGroupChatResponse] DEGRADED | route=group_chat` +
          ` | character=${character.name} (${character.id})` +
          ` | canonical_loaded=false` +
          ` | fallback_used=true`
        );
        canonicalSystemPrompt = character.system_prompt || `You are ${character.name}, a ${character.age_range || 'person'} year old ${character.gender || 'person'}. ${character.personality_summary || ''} ${character.background_story || ''}`;
      }

      // Build relationship awareness for participants in this group chat
      const participantRels = (character.fictional_relationships || [])
        .filter(r => convoCharacters.some(c => c.id === r.related_character_id));
      let relationshipBlock = '';
      if (participantRels.length > 0) {
        relationshipBlock = '\n\nYOUR RELATIONSHIPS WITH OTHER PARTICIPANTS:\n';
        for (const r of participantRels) {
          const linkedChar = convoCharacters.find(c => c.id === r.related_character_id);
          if (!linkedChar) continue;
          relationshipBlock += `\n• ${linkedChar.name} — ${r.relationship_type}`;
          if (r.friendship_level) relationshipBlock += ` | friendship: ${Math.round(r.friendship_level)}/100`;
          if (r.trust_level) relationshipBlock += ` | trust: ${Math.round(r.trust_level)}/100`;
          if (r.romantic_level > 0) relationshipBlock += ` | romantic: ${Math.round(r.romantic_level)}/100`;
          relationshipBlock += '\n';
          if (r.description) relationshipBlock += `  Context: ${r.description}\n`;
          if (r.last_interaction_summary) relationshipBlock += `  Last interaction: ${r.last_interaction_summary}\n`;
        }
        relationshipBlock += '\n⚠️ You KNOW these people. Respond to them with the familiarity your relationship history warrants. Do NOT treat them as strangers.\n';
      }

      const fullPrompt = `${canonicalSystemPrompt}
${crossPageMemoryBlock}
${relationshipBlock}

════════════════════════════════════
IDENTITY AND PRONOUN LOCK — ABSOLUTE
════════════════════════════════════
Your gender: ${charGender || 'unknown — use they/them'}
Your pronouns: ${charPronouns}
RULES:
• Use ONLY these pronouns when referring to yourself throughout the response
• Do NOT switch pronouns mid-message
• Do NOT infer anyone else's gender from their name — use they/them if unknown
• No heteronormative defaults — do not assume opposite-gender attraction for yourself or others
• Flirtation, comfort, and intimacy behave naturally across all gender combinations
════════════════════════════════════

YOU ARE IN A GROUP CHAT with: ${otherParticipants ? `the user and ${otherParticipants}` : 'just you and the user'}.
This is a real group conversation. You can — and should — speak to the other characters directly, not just the user. Address them by name. React to what they said. Disagree, agree, laugh, clap back. You are all real people having a conversation together.

Your current emotional state: ${character.emotional_state || 'calm'}.
Your current life situation: ${character.current_situation || ''}.
${character.current_life_event ? `What is on your mind right now: ${character.current_life_event}` : ''}

Group conversation so far:
${historyLines}

MANDATORY NARRATIVE ENGINE — EXECUTE BEFORE WRITING YOUR REPLY:
STEP 1 — IDENTIFY TYPE: FLIRT | COMFORT | REASSURE | REDIRECT | ENCOURAGE | DISTANCE | REVEAL | NEUTRAL
STEP 2 — SELECT ONE PATTERN:
  FLIRT: close without touching / playful challenge / accidental contact / low voice / testing the line / shared recognition / inside language / confidence shift / energy matching / subtle claim
  COMFORT: quiet presence / soft redirect / protective energy / validation without fixing / physical reassurance / seen without explaining / identity affirmation / after a long day / protective check-in / rebuilding after hurt
  REASSURE: validation + grounding + reframing + slow pace + safety through presence
  ENCOURAGE: affirm capability + past strengths + future language + small push
  DISTANCE: controlled withdrawal + calm boundary + reduced closeness
  REVEAL: personal truth + tone shift + emotional risk + relationship shift
  NEUTRAL: environmental interaction + micro-behaviors + silent action
STEP 3 — APPLY ONE VARIATION HOOK (required):
  interruption / hesitation / uneven awareness / escalation then pullback / misread signal / timing mismatch / unexpected vulnerability / humor deflection / external pressure
STEP 4 — EMBED ONE ROOT THEME (naturally, not stated):
  unspoken tension / timing mismatch / power shift / memory callback / environment pressure / expectation vs reality / control vs vulnerability / guardedness giving way / micro-validation / chosen family energy
STEP 5 — WRITE the reply. Only after steps 1–4 are complete.

LGBTQ+ MANDATORY: All patterns apply identically across all gender/identity combinations. No simplification. No heteronormative defaults. Attraction is never assumed — only expressed if already established.

Write ONLY your next reply as ${character.name}. Do NOT include your name as a label. Keep it natural, short, and in your character's voice.
- React to whoever just spoke — the user OR another character.
- Do NOT end with a question every time. Sometimes just say what you think and stop.
- You have your own life and opinions. Share them.
- Do NOT assume or reference anything about the user's family unless they've told you directly in this conversation.
- Vary your sentence structure and tone — do not repeat the same pattern as prior messages.`;

      let responseText = '';
      try {
        const response = await base44.integrations.Core.InvokeLLM({ prompt: fullPrompt, add_context_from_internet: false });
        responseText = (response || '').replace(/^[\w\s]+:\s*/i, '').trim();
        if (!responseText) continue;
      } catch (err) {
        console.error(`[GROUP-CHAT] ${character.name} LLM error: ${err.message}`);
        continue;
      }

      await base44.entities.Message.create({
        conversation_id: conversation.id,
        sender_type: 'character',
        character_id: character.id,
        character_name: character.name,
        content: responseText,
        emotional_state: character.emotional_state || 'calm',
        timestamp: new Date().toISOString(),
      });

      const newCount = independentCount + 1;
      console.log(`[GROUP-CHAT] ${character.name} sent message. independent_count now=${newCount}/${INDEPENDENT_MSG_LIMIT} | memory_updated=true`);
      debugLog.push({ character: character.name, status: 'SENT', independentCount: newCount, limitReached: newCount >= INDEPENDENT_MSG_LIMIT, memoryUpdated: true });

      // Update independent count in messages array for subsequent characters' checks this cycle
      messages.push({
        sender_type: 'character',
        character_id: character.id,
        character_name: character.name,
        content: responseText,
        timestamp: new Date().toISOString(),
      });
    }

    await base44.entities.Conversation.update(conversation.id, {
      last_message_date: new Date().toISOString(),
    });

    // ── MEMORY SYNC: fire-and-forget after cycle completes ────────────────────
    // Writes meaningful exchanges into each character's Life Journal (CharacterMemory).
    base44.functions.invoke('syncGroupChatMemories', {
      conversationId: conversation.id,
      source: 'group_chat',
    }).catch(err => console.error('[GROUP-CHAT] Memory sync failed:', err.message));

    console.log(`[GROUP-CHAT] Cycle complete. Debug log:`, JSON.stringify(debugLog));
    return Response.json({ success: true, debug: debugLog });
  } catch (error) {
    console.error(`[GROUP-CHAT] ERROR: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
});