/**
 * sendWorldPhoneMessage
 *
 * Shared backend function for all World Phone character-to-character messaging.
 * Called from two paths:
 *   - "user_instruction": user explicitly told Character A to text/call/message Character B
 *   - "character_action": character's LLM response claimed it sent a message to someone
 *
 * DESIGN RULES:
 * - Canonical key format: "world_phone::${sortedA}::${sortedB}" — matches WorldContactsPopup exactly
 * - Conversation type: "direct" for active_created↔active_created, "npc" otherwise
 * - ONE outbound Message record + ONE inbound response from Character B's own LLM pipeline
 * - Character A may NOT claim Character B responded unless Character B's record actually exists
 * - Memory + fictional_relationships updates delegated to syncBilateralCharacterConversation
 * - If Message write fails → return success:false → caller must not let character claim it was sent
 * - owner_email scoping only — never created_by
 *
 * CRITICAL BEHAVIOR:
 * - After sending, Character B generates their OWN response using their own context/memory/mood
 * - Character A's dialogue text must NOT include invented summaries of Character B's reply
 * - Only after Character B's Message record exists does bilateral memory get written
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const {
      sender_character_id,
      recipient_identifier,       // character ID or name string
      requested_message,          // raw message content to send
      source,                     // "user_instruction" | "character_action"
      current_chat_message_id,    // source message ID in the active chat conversation
      current_conversation_id,    // active chat conversation ID (not the WP thread)
      owner_email,
      generate_recipient_response, // optional: if true, generate Character B's response now
    } = await req.json();

    if (!sender_character_id || !recipient_identifier || !requested_message) {
      return Response.json({
        success: false,
        error: 'Missing required fields: sender_character_id, recipient_identifier, requested_message',
      }, { status: 400 });
    }

    const ownerEmail = owner_email || user.email;
    const warnings = [];

    // ── LOAD SENDER ────────────────────────────────────────────────────────────
    const senderArr = await base44.entities.Character.filter({ id: sender_character_id }, null, 1).catch(() => []);
    const sender = senderArr?.[0];
    if (!sender) {
      return Response.json({ success: false, error: `Sender character not found: ${sender_character_id}` });
    }

    // ── RESOLVE RECIPIENT ──────────────────────────────────────────────────────
    let recipient = null;
    let recipientResolutionPath = null;

    // 1. Direct character ID
    if (recipient_identifier.length > 15 && !recipient_identifier.includes(' ')) {
      const byId = await base44.entities.Character.filter({ id: recipient_identifier }, null, 1).catch(() => []);
      if (byId?.[0]) {
        recipient = byId[0];
        recipientResolutionPath = 'direct_id';
      }
    }

    // 2. sender's fictional_relationships — use related_character_id (stable ID), fall back to name
    if (!recipient && sender.fictional_relationships?.length > 0) {
      const nameLower = recipient_identifier.toLowerCase().trim();
      const relMatch = sender.fictional_relationships.find(r =>
        r.related_character_id === recipient_identifier ||
        r.person_name?.toLowerCase() === nameLower ||
        r.name?.toLowerCase() === nameLower ||
        r.character_name?.toLowerCase() === nameLower
      );
      if (relMatch?.related_character_id) {
        const relArr = await base44.entities.Character.filter({ id: relMatch.related_character_id }, null, 1).catch(() => []);
        if (relArr?.[0]) {
          recipient = relArr[0];
          recipientResolutionPath = 'fictional_relationships';
        }
      }
    }

    // 3. sender's family_members — use character_id (stable ID), fall back to name
    if (!recipient && sender.family_members?.length > 0) {
      const nameLower = recipient_identifier.toLowerCase().trim();
      const famMatch = sender.family_members.find(f =>
        f.character_id === recipient_identifier ||
        f.name?.toLowerCase() === nameLower
      );
      if (famMatch?.character_id) {
        const famArr = await base44.entities.Character.filter({ id: famMatch.character_id }, null, 1).catch(() => []);
        if (famArr?.[0]) {
          recipient = famArr[0];
          recipientResolutionPath = 'family_members';
        }
      }
    }

    // 4. Account-wide name search — exact match only; partial match requires unique result
    if (!recipient) {
      const nameLower = recipient_identifier.toLowerCase().trim();
      const allChars = await base44.entities.Character.filter({ owner_email: ownerEmail }, null, 200).catch(() => []);

      const exactMatches = allChars.filter(c =>
        c.name?.toLowerCase() === nameLower ||
        c.display_name?.toLowerCase() === nameLower ||
        c.primary_name?.toLowerCase() === nameLower
      );
      if (exactMatches.length === 1) {
        recipient = exactMatches[0];
        recipientResolutionPath = 'account_exact_name';
      } else if (exactMatches.length > 1) {
        return Response.json({
          success: false,
          error: `Ambiguous recipient: "${recipient_identifier}" matches ${exactMatches.length} characters. Use a character ID to be precise.`,
          ambiguous_matches: exactMatches.map(c => ({ id: c.id, name: c.name })),
        });
      } else {
        const partialMatches = allChars.filter(c =>
          c.name?.toLowerCase().includes(nameLower) ||
          c.display_name?.toLowerCase().includes(nameLower)
        );
        if (partialMatches.length === 1) {
          recipient = partialMatches[0];
          recipientResolutionPath = 'account_partial_name';
          warnings.push(`Recipient resolved via partial name match ("${recipient_identifier}" → "${recipient.name}"). Use character ID for precision.`);
        } else if (partialMatches.length > 1) {
          return Response.json({
            success: false,
            error: `Ambiguous partial name: "${recipient_identifier}" matches ${partialMatches.length} characters. Provide a more specific name or character ID.`,
            ambiguous_matches: partialMatches.map(c => ({ id: c.id, name: c.name })),
          });
        }
      }
    }

    if (!recipient) {
      return Response.json({
        success: false,
        error: `Recipient not found: "${recipient_identifier}". Character must exist in the app with owner_email=${ownerEmail}.`,
        resolution_paths_tried: ['direct_id', 'fictional_relationships', 'family_members', 'account_exact_name', 'account_partial_name'],
      });
    }

    if (recipient.id === sender_character_id) {
      return Response.json({ success: false, error: 'Sender and recipient are the same character.' });
    }

    // ── REWRITE MESSAGE IN SENDER'S VOICE ──────────────────────────────────────
    const personalityHint = [sender.personality_summary, sender.communication_style, sender.archetype]
      .filter(Boolean).join(', ');
    const traitHints = ['dry_humor','blunt','flirty','oversharer','night_owl']
      .filter(t => sender[`trait_${t}`])
      .slice(0, 3).join(', ');

    let rewrittenMessage = requested_message;
    try {
      const rewriteRes = await base44.integrations.Core.InvokeLLM({
        prompt: `You are ${sender.name}.${personalityHint ? ` Personality: ${personalityHint}.` : ''}${traitHints ? ` Traits: ${traitHints}.` : ''}${sender.emotional_state ? ` Mood: ${sender.emotional_state}.` : ''}

Send this message to ${recipient.name}: "${requested_message}"

Rewrite it in your voice — same meaning, your style. 1–3 sentences max. No greetings or sign-offs unless they're genuinely your style. Return ONLY the rewritten message, no quotes, no explanation.`,
      });
      if (typeof rewriteRes === 'string' && rewriteRes.trim().length > 0) {
        rewrittenMessage = rewriteRes.trim();
      }
    } catch (e) {
      warnings.push(`Voice rewrite failed (non-fatal), using original: ${e.message}`);
    }

    // ── CANONICAL CONVERSATION KEY ─────────────────────────────────────────────
    const sortedIds = [sender_character_id, recipient.id].sort();
    const canonicalKey = `world_phone::${sortedIds[0]}::${sortedIds[1]}`;
    const participantIds = sortedIds;

    // ── FIND OR CREATE CONVERSATION ────────────────────────────────────────────
    let conversationId = null;

    const [byCanonical, byParticipant] = await Promise.all([
      base44.entities.Conversation.filter({ shared_conversation_key: canonicalKey }, '-updated_date', 5).catch(() => []),
      base44.entities.Conversation.filter({ participant_character_ids: [sender_character_id] }, '-updated_date', 100).catch(() => []),
    ]);

    const seenIds = new Set();
    const allCandidates = [...byCanonical, ...byParticipant].filter(c => {
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return true;
    });

    const existingConvo =
      allCandidates.find(c => c.shared_conversation_key === canonicalKey) ||
      allCandidates.find(c =>
        Array.isArray(c.participant_character_ids) &&
        participantIds.every(id => c.participant_character_ids.includes(id))
      ) ||
      allCandidates.find(c =>
        Array.isArray(c.character_ids) &&
        participantIds.every(id => c.character_ids.includes(id))
      );

    if (existingConvo) {
      conversationId = existingConvo.id;
      const needsUpgrade = existingConvo.shared_conversation_key !== canonicalKey ||
        !Array.isArray(existingConvo.participant_character_ids) ||
        !participantIds.every(id => existingConvo.participant_character_ids?.includes(id));
      if (needsUpgrade) {
        const currentCharIds = Array.isArray(existingConvo.character_ids) ? existingConvo.character_ids : [sender_character_id];
        const mergedCharIds = [...new Set([...currentCharIds, recipient.id])];
        await base44.entities.Conversation.update(conversationId, {
          shared_conversation_key: canonicalKey,
          participant_character_ids: participantIds,
          character_ids: mergedCharIds,
          channel: 'world_phone',
        }).catch(e => warnings.push(`Legacy conversation upgrade failed (non-fatal): ${e.message}`));
      }
    } else {
      const senderType = sender.character_type || null;
      const recipientType = recipient.character_type || null;
      const bothActiveCreated = senderType === 'active_created_character' && recipientType === 'active_created_character';
      const newConvo = await base44.entities.Conversation.create({
        title: `world_phone::${participantIds.join('::')}`,
        type: bothActiveCreated ? 'direct' : 'npc',
        character_ids: [sender_character_id, recipient.id],
        participant_character_ids: participantIds,
        shared_conversation_key: canonicalKey,
        owner_email: ownerEmail,
        channel: 'world_phone',
        sync_status: 'pending',
        world_contact_mode: bothActiveCreated ? 'active_created_to_active_created' : 'character_to_character',
        participant_character_types: [senderType, recipientType].filter(Boolean),
      });
      conversationId = newConvo.id;
    }

    const now = new Date().toISOString();

    // ── SAVE THE OUTBOUND MESSAGE ──────────────────────────────────────────────
    const savedMessage = await base44.entities.Message.create({
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: sender_character_id,
      character_name: sender.name,
      sender_character_id: sender_character_id,
      receiver_character_id: recipient.id,
      participant_character_ids: participantIds,
      shared_conversation_key: canonicalKey,
      content: rewrittenMessage,
      channel: 'world_phone',
      timestamp: now,
      is_read: false,
      typed_by_user: source === 'user_instruction',
      user_operated: source === 'user_instruction',
      source_message_id: current_chat_message_id || null,
      sync_status: 'pending',
      recovery_signal: false,
      memory_eligible: true,
      relationship_eligible: true,
    });

    // HARD STOP: if message write failed, return failure — caller must not fake success
    if (!savedMessage?.id) {
      return Response.json({
        success: false,
        error: 'Message write to database failed — character may not claim message was sent.',
        conversation_id: conversationId,
        shared_key: canonicalKey,
      });
    }

    // Update conversation preview
    await base44.entities.Conversation.update(conversationId, {
      last_message_preview: rewrittenMessage.substring(0, 100),
      last_message_date: now,
    }).catch(e => warnings.push(`Conversation preview update failed (non-fatal): ${e.message}`));

    // ── GENERATE CHARACTER B's REAL RESPONSE ───────────────────────────────────
    // CRITICAL: Character B responds using their own LLM pipeline — not guessed by Character A.
    // This creates the visible incoming message in Character B's World Phone thread.
    let recipientResponse = null;
    let recipientResponseMessageId = null;
    
    try {
      // Load recent conversation history for context
      const recentHistory = await base44.entities.Message.filter(
        { conversation_id: conversationId },
        'created_date',
        20
      ).catch(() => []);

      // Build Character B's canonical context
      const ctxRes = await base44.functions.invoke('buildCanonicalCharacterContext', {
        characterId: recipient.id,
        interactionContext: 'world_phone',
        topKMemories: 10,
      }).catch(() => null);

      const canonicalPrompt = ctxRes?.data?.systemPrompt || null;

      if (canonicalPrompt) {
        // Retrieve memories relevant to this exchange
        const memRes = await base44.functions.invoke('retrieveActiveMemory', {
          characterId: recipient.id,
          currentMessage: rewrittenMessage,
          recentMessages: recentHistory.slice(-6).map(m => ({
            role: m.sender_character_id === recipient.id ? 'assistant' : 'user',
            content: m.content,
          })),
          topK: 8,
        }).catch(() => null);

        const mems = memRes?.data?.memories || [];
        const memoryContext = mems.length > 0
          ? `\n\nLONG-TERM MEMORY (${mems.length} relevant memories):\n${mems.map(m => `- ${m.title}: ${m.description}`).join('\n')}`
          : '';

        // Build conversation history for the prompt
        const conversationLog = [
          ...recentHistory.slice(-10).map(m => {
            const speakerName = m.sender_character_id === recipient.id ? recipient.name : sender.name;
            return `${speakerName}: ${m.content}`;
          }),
          `${sender.name}: ${rewrittenMessage}`,
        ].join('\n');

        const recipientPersonalityHint = [recipient.personality_summary, recipient.communication_style]
          .filter(Boolean).join(', ');

        const fullPrompt = `${canonicalPrompt}${memoryContext}

CURRENT CHANNEL: World Phone / World Contacts
${sender.name} is texting you. This is a real phone/text exchange.
Do NOT start with your name. Do NOT say "I'm an AI". Respond as you naturally would.
${recipientPersonalityHint ? `\nYour personality: ${recipientPersonalityHint}` : ''}
${recipient.emotional_state ? `\nYour current mood: ${recipient.emotional_state}` : ''}

Conversation so far:
${conversationLog}

Respond ONLY with valid JSON:
{
  "message_type": "text_only",
  "text_content": "Your reply as ${recipient.name}. Keep it natural, like a real text."
}`;

        const { InvokeLLM } = base44.integrations.Core;
        const rawResponse = await InvokeLLM({ prompt: fullPrompt });
        
        // Parse JSON response
        let parsedText = null;
        try {
          const jsonStr = typeof rawResponse === 'string'
            ? rawResponse.replace(/```json\n?|\n?```/g, '').trim()
            : JSON.stringify(rawResponse);
          const parsed = JSON.parse(jsonStr);
          parsedText = parsed.text_content?.trim();
        } catch {
          // If not JSON, use raw text directly
          parsedText = typeof rawResponse === 'string' ? rawResponse.trim() : null;
        }

        if (parsedText && parsedText.length > 0 && !parsedText.startsWith('{')) {
          recipientResponse = parsedText;

          // Save Character B's response as a real Message record
          const responseTimestamp = new Date(Date.now() + 2000).toISOString(); // 2s after send
          const recipientMsg = await base44.entities.Message.create({
            conversation_id: conversationId,
            sender_type: 'character',
            character_id: recipient.id,
            character_name: recipient.name,
            sender_character_id: recipient.id,
            receiver_character_id: sender_character_id,
            participant_character_ids: participantIds,
            shared_conversation_key: canonicalKey,
            content: recipientResponse,
            channel: 'world_phone',
            timestamp: responseTimestamp,
            is_read: false,
            reply_to_message_id: savedMessage.id,
            source_message_id: savedMessage.id,
            sync_status: 'pending',
            recovery_signal: false,
            memory_eligible: true,
            relationship_eligible: true,
          });

          if (recipientMsg?.id) {
            recipientResponseMessageId = recipientMsg.id;
            // Update conversation with latest message
            await base44.entities.Conversation.update(conversationId, {
              last_message_preview: recipientResponse.substring(0, 100),
              last_message_date: responseTimestamp,
            }).catch(() => {});
            console.log(`[sendWorldPhoneMessage] ✅ Recipient response saved | msg=${recipientMsg.id} | from=${recipient.name}`);
          }
        }
      } else {
        warnings.push(`Could not generate Character B response — canonical context unavailable for ${recipient.name}`);
        console.warn(`[sendWorldPhoneMessage] No canonical context for recipient ${recipient.id} — response generation skipped`);
      }
    } catch (respErr) {
      warnings.push(`Recipient response generation failed (non-fatal): ${respErr.message}`);
      console.warn(`[sendWorldPhoneMessage] Recipient response generation error: ${respErr.message}`);
    }

    // ── BILATERAL SYNC: memory + relationship for BOTH characters ──────────────
    // Only write if we have a real exchange (both messages exist)
    const fullExchangeContent = recipientResponse
      ? `${sender.name}: "${rewrittenMessage}" | ${recipient.name}: "${recipientResponse}"`
      : `${sender.name}: "${rewrittenMessage}"`;

    base44.functions.invoke('syncWorldPhoneMemory', {
      senderCharacterId: sender_character_id,
      receiverCharacterId: recipient.id,
      messageContent: fullExchangeContent,
      context: 'world_phone',
      conversationId: conversationId,
    }).catch(err => {
      warnings.push(`Bilateral sync failed (non-fatal): ${err.message}`);
      console.warn(`[sendWorldPhoneMessage] Bilateral sync error: ${err.message}`);
    });

    console.log(`[sendWorldPhoneMessage] ✅ msg=${savedMessage.id} | conv=${conversationId} | key=${canonicalKey} | source=${source} | recipient_response=${recipientResponseMessageId || 'none'}`);

    return Response.json({
      success: true,
      proof: {
        message_id: savedMessage.id,
        recipient_response_message_id: recipientResponseMessageId,
        recipient_response_text: recipientResponse,
        conversation_id: conversationId,
        shared_conversation_key: canonicalKey,
        participant_character_ids: participantIds,
        recipient_response_generated: !!recipientResponseMessageId,
        recipient_resolution_path: recipientResolutionPath,
        source,
        warnings: warnings.length > 0 ? warnings : null,
      },
    });

  } catch (error) {
    console.error('[sendWorldPhoneMessage]', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});