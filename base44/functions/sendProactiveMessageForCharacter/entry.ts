import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * sendProactiveMessageForCharacter
 * 
 * Sends a single proactive message from a character.
 * Designed to be called individually per character to avoid rate limits.
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
  const start = parseInt(char.work_start_time.split(':')[0]) * 60 + parseInt(char.work_start_time.split(':')[1]);
  const end = parseInt(char.work_end_time.split(':')[0]) * 60 + parseInt(char.work_end_time.split(':')[1]);
  return now >= start && now <= end;
}

function isSleepTime(char) {
  if (!char.sleep_start_time || !char.wake_up_time) return false;
  const et = getEasternTime();
  const now = getTimeMinutes(et);
  const sleep = parseInt(char.sleep_start_time.split(':')[0]) * 60 + parseInt(char.sleep_start_time.split(':')[1]);
  const wake = parseInt(char.wake_up_time.split(':')[0]) * 60 + parseInt(char.wake_up_time.split(':')[1]);
  
  if (sleep > wake) {
    return now >= sleep || now <= wake;
  }
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

async function getRecentConversationContext(base44, characterId, ownerEmail) {
  if (!ownerEmail) return null;
  const convos = await base44.entities.Conversation.filter({
    owner_email: ownerEmail,
    character_ids: [characterId],
  });
  
  if (convos.length === 0) return null;
  
  const messages = await base44.entities.Message.filter(
    { conversation_id: convos[0].id },
    '-timestamp',
    5
  );
  
  if (messages.length === 0) return null;
  
  const recentTopics = messages
    .map(m => m.content)
    .slice(0, 3)
    .join(' | ');
  
  return recentTopics;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId } = await req.json();
    if (!characterId) return Response.json({ error: 'characterId required' }, { status: 400 });

    // Use user-scoped filter — asServiceRole.get() has a platform visibility gap for
    // user-owned characters and will return null or 403 on accounts where the caller
    // is not the record owner. User-scoped filter({ id }) uses the same RLS path as Chat.
    const charList = await base44.entities.Character.filter({ id: characterId }, null, 1);
    const char = charList?.[0];
    if (!char) return Response.json({ error: 'Character not found', characterId }, { status: 404 });

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    // owner_email is required — fail visible if missing
    if (!char.owner_email) {
      return Response.json({ error: `Character id=${char.id} missing owner_email — cannot scope conversation query` }, { status: 422 });
    }

    // Check daily limit
    const todaysConvo = await base44.entities.Conversation.filter({
      owner_email: char.owner_email,
      character_ids: [char.id],
    });

    if (todaysConvo.length > 0) {
      const todaysMessages = await base44.entities.Message.filter({
        conversation_id: todaysConvo[0].id,
        sender_type: 'character',
      });

      const todayCount = todaysMessages.filter(m => 
        m.created_date?.startsWith(today)
      ).length;

      if (todayCount >= 7) {
        return Response.json({
          success: false,
          reason: '7 messages already sent today',
        });
      }
    }

    // Check if appropriate time
    const relationshipLevel = char.friendship_level || 50;
    if (!shouldMessageNow(char, relationshipLevel)) {
      return Response.json({
        success: false,
        reason: 'not the right time to message',
      });
    }

    // Get context and generate
    const recentContext = await getRecentConversationContext(base44, char.id, char.owner_email);
    const et = getEasternTime();
    const hour = et.getHours();
    
    let timeContext = '';
    if (hour >= 7 && hour < 9) timeContext = 'morning (good morning message)';
    else if (hour >= 12 && hour < 13) timeContext = 'lunch break';
    else if (hour >= 18 && hour < 20) timeContext = 'evening';
    else if (hour >= 21 && hour < 23) timeContext = 'late night (good night message)';

    // ── CANONICAL CONTEXT: pull from shared truth service ─────────────────
    let canonicalSystemPrompt = null;
    let canonicalLoaded = false;
    let canonicalHardFacts = '';
    let memoryCount = 0;
    let relationshipLoaded = false;
    try {
      const ctxRes = await base44.functions.invoke('buildCanonicalCharacterContext', {
        characterId: char.id,
        interactionContext: 'proactive',
        topKMemories: 8,
      });
      const ctxData = ctxRes?.data || ctxRes;
      if (ctxData?.systemPrompt) {
        canonicalSystemPrompt = ctxData.systemPrompt;
        canonicalLoaded = true;
        canonicalHardFacts = ctxData.hardFacts || '';
        memoryCount = ctxData.memories?.length ?? 0;
        relationshipLoaded = !!ctxData.relationshipContext;
        console.log(
          `[sendProactiveMessageForCharacter] ✓ route=proactive` +
          ` | character=${char.name} (${char.id})` +
          ` | owner=${char.owner_email}` +
          ` | canonical_loaded=true` +
          ` | hard_facts_loaded=${!!canonicalHardFacts}` +
          ` | memory_count=${memoryCount}` +
          ` | relationship_context_loaded=${relationshipLoaded}` +
          ` | fallback_used=false`
        );
      }
    } catch (ctxErr) {
      console.warn(`[sendProactiveMessageForCharacter] Canonical context service error: ${ctxErr.message}`);
    }

    // Fallback only if canonical context service fails — log visibly with all diagnostic fields
    if (!canonicalSystemPrompt) {
      console.warn(
        `[sendProactiveMessageForCharacter] DEGRADED | route=proactive` +
        ` | character=${char.name} (${char.id})` +
        ` | owner=${char.owner_email}` +
        ` | canonical_loaded=false` +
        ` | hard_facts_loaded=false` +
        ` | memory_count=0` +
        ` | relationship_context_loaded=false` +
        ` | fallback_used=true`
      );
      canonicalSystemPrompt = `You are ${char.name}. ${char.personality_summary || 'A real person with your own life and personality.'}`;
    }

    const proactivePrompt = `${canonicalSystemPrompt}

━━━━━━━━━━━━━━━━━━━━
PROACTIVE MESSAGE TASK
━━━━━━━━━━━━━━━━━━━━
Generate a natural, spontaneous proactive message RIGHT NOW (1-3 sentences max).
${recentContext ? `Recent conversation context: "${recentContext}". Follow up on what you were discussing or reference it naturally.` : 'Start a new topic about what you are doing or feeling right now.'}
Time context: ${timeContext}
Friendship level with user: ${relationshipLevel}/100 — adjust tone accordingly (higher = more casual, lower = more respectful).

RULES:
- Write like a real person texting. Short. Human. Imperfect.
- NEVER use em dashes (—), en dashes (–), or spaced hyphens ( - ).
- Be authentic. Not overly cheerful. Not assistant-like.
- Do NOT start with your own name or a label.
- Max 2-3 sentences. Often 1 is better.`;

    let messageContent;
    try {
      messageContent = await base44.integrations.Core.InvokeLLM({
        prompt: proactivePrompt,
      });
    } catch (llmErr) {
      console.warn(`[sendProactiveMessageForCharacter] LLM failed for ${char.name}: ${llmErr.message}`);
      // ── CIRCUIT BREAKER: Record durable fallback state — do NOT save generic text ──
      // Proactive messages must NEVER use "Sorry, got pulled away..." as character speech.
      // If LLM fails, skip this proactive message entirely.
      const todayConvos = await base44.entities.Conversation.filter({
        type: 'direct', owner_email: char.owner_email, character_ids: [char.id],
      }).catch(() => []);
      if (todayConvos.length > 0) {
        base44.functions.invoke('generationLock', {
          action: 'record_fallback',
          conversation_id: todayConvos[0].id,
          character_id: char.id,
          owner_email: char.owner_email,
          fallback_text: `[proactive_llm_failure] ${llmErr.message?.substring(0, 60)}`,
        }).catch(() => {});
      }
      return Response.json({ success: false, reason: 'llm_failure_no_fallback_saved' });
    }

    // Find or create conversation — owner_email required on both filter and create
    const convos = await base44.entities.Conversation.filter({
      type: 'direct',
      owner_email: char.owner_email,
      character_ids: [char.id],
    });

    let conversationId;
    if (convos.length > 0) {
      conversationId = convos[0].id;
    } else {
      const newConvo = await base44.entities.Conversation.create({
        title: char.name,
        type: 'direct',
        character_ids: [char.id],
        owner_email: char.owner_email,
      });
      conversationId = newConvo.id;
    }

    // Create message
    const msg = await base44.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: char.id,
      character_name: char.name,
      content: messageContent,
      emotional_state: char.emotional_state || 'calm',
      timestamp: now.toISOString(),
    });

    return Response.json({
      success: true,
      messageId: msg.id,
      characterName: char.name,
      content: messageContent,
    });
  } catch (error) {
    console.error('[sendProactiveMessageForCharacter]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});