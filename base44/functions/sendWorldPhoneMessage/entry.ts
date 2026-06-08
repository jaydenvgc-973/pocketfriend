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
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const {
      sender_character_id,
      recipient_identifier,       // character ID or name string — may be null for pronoun intents
      requested_message,          // raw message content to send
      image_url,                  // optional: image URL for image sends
      image_description,          // optional: caption/description for image
      image_analysis_status,      // optional: 'complete' | 'pending' | 'failed'
      image_analysis_is_transport_metadata, // true = description is routing metadata, not image analysis
      message_type,               // optional: 'text' | 'image' (default: 'text')
      source,                     // "user_instruction" | "character_action"
      user_instruction_context,   // optional: the raw user command (e.g. "text him") — used when requested_message is null to generate content
      recent_conversation_context, // optional: last N messages of the chat — used to recover pending intent (e.g. "send the message" after "I need the photos")
      current_chat_message_id,    // source message ID in the active chat conversation
      current_conversation_id,    // active chat conversation ID (not the WP thread)
      owner_email,
      generate_recipient_response, // optional: if true, generate Character B's response now
      // Pronoun resolution: when user says "text him/her/them", pass recent message text
      // so we can resolve the pronoun to a known contact name
      pronoun_context,            // optional: recent conversation text to resolve pronoun recipient
      // Media Gallery send tracking (non-destructive, written to new message only)
      needs_detailed_visual_analysis, // true = no original context, trigger detailed visual analysis
      source_media_message_id,    // original gallery message ID
      source_media_url,           // original gallery image URL
      source_media_had_prompt,    // was original context present
      source_media_had_generation_context,
    } = await req.json();

    // Allow null recipient_identifier when pronoun_context is provided — will be resolved below
    if (!sender_character_id || (!recipient_identifier && !pronoun_context)) {
      return Response.json({
        success: false,
        error: 'Missing required fields: sender_character_id, and either recipient_identifier or pronoun_context',
      }, { status: 400 });
    }

    // Image sends must have image_url; text sends must have requested_message OR user_instruction_context
    const isImageSend = message_type === 'image';
    if (isImageSend && !image_url) {
      return Response.json({
        success: false,
        error: 'Image send requires image_url',
      }, { status: 400 });
    }
    if (!isImageSend && !requested_message && !user_instruction_context) {
      return Response.json({
        success: false,
        error: 'Text send requires requested_message or user_instruction_context',
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

    // ── RESOLVE RECIPIENT FROM PRONOUN CONTEXT ────────────────────────────────
    // When recipient_identifier is null but pronoun_context is provided,
    // use the LLM to extract the most likely recipient from recent conversation text.
    let effectiveRecipientIdentifier = recipient_identifier;
    if (!effectiveRecipientIdentifier && pronoun_context) {
      try {
        const knownNames = (sender.fictional_relationships || [])
          .map(r => r.person_name).filter(Boolean)
          .concat((sender.family_members || []).map(f => f.name).filter(Boolean))
          .join(', ');

        const extractedName = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: `Recent conversation:
${pronoun_context}

Known contacts of ${sender.name}: ${knownNames || 'none listed'}

Based on the conversation above, who is the person being referred to by "him", "her", or "them" in the most recent user message?
If you can identify the person from the conversation context or known contacts list, return their exact name.
If you cannot determine who they are, return the word "UNKNOWN".
Return ONLY the person's name or "UNKNOWN" — nothing else.`,
        });
        const resolved = (typeof extractedName === 'string' ? extractedName : '').trim();
        if (resolved && resolved !== 'UNKNOWN' && resolved.length > 1) {
          effectiveRecipientIdentifier = resolved;
          console.log(`[sendWorldPhoneMessage] Pronoun resolved to: "${resolved}" via LLM context`);
        } else {
          return Response.json({
            success: false,
            error: 'Could not resolve pronoun (him/her/them) to a known contact from conversation context.',
            pronoun_resolution: 'failed',
          });
        }
      } catch (pronErr) {
        return Response.json({
          success: false,
          error: `Pronoun resolution failed: ${pronErr.message}`,
        });
      }
    }

    // ── RESOLVE RECIPIENT ──────────────────────────────────────────────────────
    let recipient = null;
    let recipientResolutionPath = null;

    // 1. Direct character ID
    if (effectiveRecipientIdentifier.length > 15 && !effectiveRecipientIdentifier.includes(' ')) {
      const byId = await base44.entities.Character.filter({ id: effectiveRecipientIdentifier }, null, 1).catch(() => []);
      if (byId?.[0]) {
        recipient = byId[0];
        recipientResolutionPath = 'direct_id';
      }
    }

    // 2. sender's fictional_relationships — use related_character_id (stable ID), fall back to name
    if (!recipient && sender.fictional_relationships?.length > 0) {
      const nameLower = effectiveRecipientIdentifier.toLowerCase().trim();
      const relMatch = sender.fictional_relationships.find(r =>
        r.related_character_id === effectiveRecipientIdentifier ||
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
      const nameLower = effectiveRecipientIdentifier.toLowerCase().trim();
      const famMatch = sender.family_members.find(f =>
        f.character_id === effectiveRecipientIdentifier ||
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
      const nameLower = effectiveRecipientIdentifier.toLowerCase().trim();
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
          error: `Ambiguous recipient: "${effectiveRecipientIdentifier}" matches ${exactMatches.length} characters. Use a character ID to be precise.`,
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
          warnings.push(`Recipient resolved via partial name match ("${effectiveRecipientIdentifier}" → "${recipient.name}"). Use character ID for precision.`);
        } else if (partialMatches.length > 1) {
          return Response.json({
            success: false,
            error: `Ambiguous partial name: "${effectiveRecipientIdentifier}" matches ${partialMatches.length} characters. Provide a more specific name or character ID.`,
            ambiguous_matches: partialMatches.map(c => ({ id: c.id, name: c.name })),
          });
        }
      }
    }

    if (!recipient) {
      return Response.json({
        success: false,
        error: `Recipient not found: "${effectiveRecipientIdentifier}". Character must exist in the app with owner_email=${ownerEmail}.`,
        resolution_paths_tried: ['direct_id', 'fictional_relationships', 'family_members', 'account_exact_name', 'account_partial_name'],
      });
    }

    if (recipient.id === sender_character_id) {
      return Response.json({ success: false, error: 'Sender and recipient are the same character.' });
    }

    // ── GENERATE MESSAGE IN SENDER'S VOICE (text only) ───────────────────────────
    // Two modes:
    // A) requested_message has actual content to relay → rewrite it in sender's voice
    // B) requested_message is null (bare intent like "text him") → generate an appropriate
    //    outreach message from scratch based on relationship, context, and instruction intent
    let rewrittenMessage = requested_message || '';

    if (!isImageSend) {
      const personalityHint = [sender.personality_summary, sender.communication_style, sender.archetype]
        .filter(Boolean).join(', ');
      const traitHints = ['dry_humor','blunt','flirty','oversharer','night_owl']
        .filter(t => sender[`trait_${t}`])
        .slice(0, 3).join(', ');

      // Find the relationship context between sender and recipient
      const relContext = (sender.fictional_relationships || []).find(r =>
        r.related_character_id === recipient.id || r.person_name?.toLowerCase() === recipient.name?.toLowerCase()
      );
      const relLabel = relContext?.relationship_type || relContext?.label_from_source_perspective || 'known contact';

      try {
        let llmPrompt;

        if (requested_message) {
          // Mode A: relay actual content — rewrite in sender's voice, never output a meta-instruction
          llmPrompt = `You are ${sender.name}.${personalityHint ? ` Personality: ${personalityHint}.` : ''}${traitHints ? ` Traits: ${traitHints}.` : ''}${sender.emotional_state ? ` Mood: ${sender.emotional_state}.` : ''}

You need to communicate the following to ${recipient.name} (your ${relLabel}): "${requested_message}"

Write what you would actually TEXT to ${recipient.name}. Express the same meaning in your own natural voice.
This must be an actual text message — not a command, not a description of what to say, not a prompt fragment.
1–3 sentences max. Casual, authentic. Return ONLY the message text, no quotes, no labels.`;
        } else {
          // Mode B: bare intent (no message content) — generate a natural outreach.
          // If recent_conversation_context is provided, scan it to recover the pending intent
          // (e.g. user said "I need the photos" 2 messages ago, then said "send the message").
          // This ensures "send the message" produces a photo-request text, not generic outreach.
          const conversationHint = recent_conversation_context
            ? `\n\nRecent conversation context (to understand what needs to be communicated):\n${recent_conversation_context}`
            : '';
          const instructionHint = user_instruction_context
            ? `The user just said: "${user_instruction_context}". This is a confirmation/command, not the message itself.`
            : `The user wants you to reach out to ${recipient.name}.`;
          llmPrompt = `You are ${sender.name}.${personalityHint ? ` Personality: ${personalityHint}.` : ''}${traitHints ? ` Traits: ${traitHints}.` : ''}${sender.emotional_state ? ` Mood: ${sender.emotional_state}.` : ''}
${conversationHint}

${instructionHint}

Based on the conversation context above, determine what specific thing needs to be communicated to ${recipient.name} (your ${relLabel}).
If the conversation shows a specific pending request or topic (e.g. photos, an item, a task), that is what the message should be about.
If there is no clear pending topic, write a brief natural check-in.

Write the actual text message you would send to ${recipient.name}. Sound like yourself.
This must be a real message — not a command, not a description, not a meta-instruction.
1–2 sentences max. Return ONLY the message text, no quotes, no labels.`;
        }

        const rewriteRes = await base44.integrations.Core.InvokeLLM({ prompt: llmPrompt });
        if (typeof rewriteRes === 'string' && rewriteRes.trim().length > 0) {
          rewrittenMessage = rewriteRes.trim();
        } else if (!requested_message) {
          // Fallback if LLM returns nothing for bare intent
          rewrittenMessage = `Hey, just reaching out.`;
        }
      } catch (e) {
        warnings.push(`Message generation failed (non-fatal): ${e.message}`);
        // For bare intents with no fallback content, use a safe default
        if (!requested_message) {
          rewrittenMessage = `Hey, just checking in.`;
        }
      }
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
    const messagePayload = {
      conversation_id: conversationId,
      sender_type: 'character',
      character_id: sender_character_id,
      character_name: sender.name,
      sender_character_id: sender_character_id,
      receiver_character_id: recipient.id,
      participant_character_ids: participantIds,
      shared_conversation_key: canonicalKey,
      content: isImageSend ? '' : rewrittenMessage,
      channel: 'world_phone',
      timestamp: now,
      // Outgoing messages (sent BY Character A) are always read — they are not incoming notifications.
      // Only Character B's incoming reply should be is_read: false to trigger the badge.
      is_read: true,
      typed_by_user: source === 'user_instruction',
      user_operated: source === 'user_instruction',
      source_message_id: current_chat_message_id || null,
      sync_status: 'pending',
      recovery_signal: false,
      memory_eligible: true,
      relationship_eligible: true,
      message_type: message_type || 'text',
    };

    // Add image fields if this is an image send
    if (isImageSend && image_url) {
      messagePayload.image_url = image_url;
      messagePayload.image_description = image_description || undefined;
      // If no description and needs_detailed_visual_analysis=true, mark pending so the LLM context
      // builder knows to wait for / use the inferred description when it arrives.
      messagePayload.image_analysis_status = image_analysis_status || (image_description ? 'complete' : 'pending');
      messagePayload.image_analysis_is_transport_metadata = false;
      // Source tracking — written only to this new message, never to original gallery record
      if (source_media_message_id) messagePayload.source_media_message_id = source_media_message_id;
      if (source_media_url) messagePayload.source_media_url = source_media_url;
      if (source_media_had_prompt !== undefined) messagePayload.source_media_had_prompt = source_media_had_prompt;
      if (source_media_had_generation_context !== undefined) messagePayload.source_media_had_generation_context = source_media_had_generation_context;
    }

    const savedMessage = await base44.entities.Message.create(messagePayload);

    // HARD STOP: if message write failed, return failure — caller must not fake success
    if (!savedMessage?.id) {
      return Response.json({
        success: false,
        error: 'Message write to database failed — character may not claim message was sent.',
        conversation_id: conversationId,
        shared_key: canonicalKey,
      });
    }

    // ── DETAILED VISUAL ANALYSIS FOR PROMPTLESS GALLERY IMAGE SENDS ────────────────
    // For World Phone character-to-character sends of gallery images without original context,
    // run rich visual analysis (not just transport metadata).
    // Stores inferred_image_description + image_analysis_status on THIS new message only.
    // Never modifies the original gallery record.
    if (isImageSend && image_url && needs_detailed_visual_analysis && !image_description) {
      try {
        console.log(`[sendWorldPhoneMessage] Running detailed visual analysis on promptless gallery image for msg=${savedMessage.id}`);
        const analysisRes = await base44.integrations.Core.InvokeLLM({
          prompt: `Provide a rich, detailed visual description of this image.
Include ALL of the following that are visible:
- People shown: apparent age range, gender presentation, clothing details, expressions, poses
- Objects visible: food, drinks, furniture, decorations, vehicles, any notable items
- Setting and environment: indoor/outdoor, type of location (restaurant, home, park, etc.)
- Lighting and atmosphere: warm/cool, time of day, mood
- Relationship or context clues: are people together? What are they doing?
- Any text, signs, or notable details visible

Be specific, factual, and thorough. Minimum 3-5 sentences.
Do NOT speculate beyond what is literally visible.
Return ONLY the description text, nothing else.`,
          file_urls: [image_url],
        });
        const inferred = (typeof analysisRes === 'string' ? analysisRes : '').trim();
        
        // CRITICAL: Reject transport metadata — only accept real visual descriptions
        const TRANSPORT_REJECT = /image sent to|photo shared|sent to [A-Z]|shared with [A-Z]|image attachment/i;
        if (TRANSPORT_REJECT.test(inferred)) {
          console.error(`[sendWorldPhoneMessage] LLM returned transport metadata: "${inferred}"`);
          await base44.asServiceRole.entities.Message.update(savedMessage.id, {
            image_analysis_status: 'failed',
            image_analysis_error: 'LLM returned transport metadata, not visual description',
            image_analysis_is_transport_metadata: true,
          }).catch(() => {});
        } else if (inferred && inferred.length > 40) {
          // Store as inferred_image_description — signals it came from post-send visual analysis
          await base44.asServiceRole.entities.Message.update(savedMessage.id, {
            inferred_image_description: inferred,
            image_analysis_status: 'complete',
            image_analysis_source: 'media_gallery_send_visual_analysis',
            image_analysis_is_inferred: true,
            image_analysis_is_transport_metadata: false,
            source_media_had_prompt: false,
          }).catch(e => console.warn(`[sendWorldPhoneMessage] Failed to store visual analysis: ${e.message}`));
          console.log(`[sendWorldPhoneMessage] Detailed visual analysis stored on msg=${savedMessage.id} len=${inferred.length}`);
        } else {
          await base44.asServiceRole.entities.Message.update(savedMessage.id, {
            image_analysis_status: 'failed',
            image_analysis_error: 'Visual analysis returned insufficient detail',
          }).catch(() => {});
        }
      } catch (analysisErr) {
        console.warn(`[sendWorldPhoneMessage] Detailed visual analysis failed (non-fatal): ${analysisErr.message}`);
        await base44.asServiceRole.entities.Message.update(savedMessage.id, {
          image_analysis_status: 'failed',
          image_analysis_error: analysisErr.message,
        }).catch(() => {});
      }
    }

    // ── READ-BACK VERIFICATION for image sends ──────────────────────────────────
    // After create, read the record back to confirm image_url was persisted.
    // This catches silent field-drop issues (e.g. entity schema not accepting image_url).
    let savedImageUrl = savedMessage.image_url || null;
    let savedMessageType = savedMessage.message_type || null;
    if (isImageSend) {
      try {
        const readBack = await base44.asServiceRole.entities.Message.filter({ id: savedMessage.id }, null, 1).catch(() => []);
        const rb = readBack?.[0];
        if (rb) {
          savedImageUrl = rb.image_url || null;
          savedMessageType = rb.message_type || null;
          console.log(`[sendWorldPhoneMessage] READ-BACK | msg=${savedMessage.id} | image_url=${savedImageUrl ? 'PRESENT' : 'MISSING'} | message_type=${savedMessageType}`);
          if (!savedImageUrl) {
            console.error(`[sendWorldPhoneMessage] IMAGE_URL_NOT_PERSISTED | msg=${savedMessage.id} | payload_had_image_url=${!!image_url}`);
          }
        }
      } catch (rbErr) {
        warnings.push(`Read-back verification failed (non-fatal): ${rbErr.message}`);
      }
    }

    // Update conversation preview
    const previewText = isImageSend
      ? '📷 Photo'
      : rewrittenMessage.substring(0, 100);
    
    await base44.entities.Conversation.update(conversationId, {
      last_message_preview: previewText,
      last_message_date: now,
    }).catch(e => warnings.push(`Conversation preview update failed (non-fatal): ${e.message}`));

    // ── GENERATE CHARACTER B's REAL RESPONSE ───────────────────────────────────
    // CRITICAL: Character B responds using their own LLM pipeline — not guessed by Character A.
    // Uses a lightweight direct LLM call with recipient's personality — no canonical context
    // fetch needed here (that's too slow when chained after pronoun+rewrite calls).
    let recipientResponse = null;
    let recipientResponseMessageId = null;

    try {
      // Load recent conversation history
      const recentHistory = await base44.entities.Message.filter(
        { conversation_id: conversationId },
        'created_date',
        10
      ).catch(() => []);

      const conversationLog = [
        ...recentHistory.slice(-8).map(m => {
          const speakerName = m.sender_character_id === recipient.id ? recipient.name : sender.name;
          return `${speakerName}: ${m.content}`;
        }),
        `${sender.name}: ${rewrittenMessage}`,
      ].join('\n');

      const personalityHint = [
        recipient.personality_summary,
        recipient.communication_style,
        recipient.archetype,
        (recipient.personality_traits || []).slice(0, 3).join(', '),
      ].filter(Boolean).join('. ');

      const traitHints = ['dry_humor','blunt','flirty','oversharer','night_owl','loud','rude','competitive','toxic']
        .filter(t => recipient[`trait_${t}`]).slice(0, 3).join(', ');

      const rawReply = await base44.asServiceRole.integrations.Core.InvokeLLM({
        prompt: `You are ${recipient.name}.${personalityHint ? ` Personality: ${personalityHint}.` : ''}${traitHints ? ` Traits: ${traitHints}.` : ''}${recipient.emotional_state ? ` Current mood: ${recipient.emotional_state}.` : ''}

${sender.name} just texted you. This is a World Phone / text message exchange.
Do NOT start with your name. Do NOT say "I'm an AI". Respond naturally as you would in a real text.
Keep it to 1-3 sentences max.

Conversation:
${conversationLog}

Reply as ${recipient.name} — casual, authentic, in your voice:`,
      });

      const replyText = (typeof rawReply === 'string' ? rawReply : '').trim();

      // ── VICK CHARACTER BOUNDARY ─────────────────────────────────────────────
      // If recipient is Vick (world service), apply the diagnostic boundary.
      // Vick must respond as a real person — no diagnostic language to characters.
      let finalReplyText = replyText;
      if (finalReplyText && (recipient.character_type === 'npc_world_service' || recipient.is_world_service === true)) {
        // Run a synchronous in-world rewrite using inline substitution (Deno — no lib imports)
        const VICK_FORBIDDEN = [
          [/\bthe\s+app\b/gi, 'this place'],
          [/\bBase44\b/gi, 'the yard'],
          [/\bran\s+a\s+diagnostic\b/gi, 'looked into it'],
          [/\bdiagnostic\s+results?\b/gi, 'what I found'],
          [/\bdeleted\s+files?\b/gi, 'missing paperwork'],
          [/\bfile\s+headers?\b/gi, 'what was left at the top of the stack'],
          [/\bmemory\s+records?\b/gi, 'what was recorded'],
          [/\bdatabase(?:\s+entries?|\s+records?|\s+files?)?\b/gi, 'the logbooks'],
          [/\bmetadata\b/gi, 'the details attached to it'],
          [/\bcharacter\s+(?:profile|record|data)\b/gi, 'their history'],
          [/\bbackend\b/gi, 'behind the scenes'],
          [/\bthe\s+logs?\b/gi, 'the records'],
          [/\bAccount\s+Help\s+(?:&|and)\s+Repair\b/gi, 'my work here'],
          [/\buser\s+settings?\b/gi, 'the preferences on file'],
        ];
        const rewritten = VICK_FORBIDDEN.reduce((text, [pat, sub]) => text.replace(pat, sub), finalReplyText);
        finalReplyText = rewritten;
        console.log(`[sendWorldPhoneMessage] Vick boundary applied | recipient=${recipient.name} | target=${sender.name}`);
      }

      if (finalReplyText && finalReplyText.length > 2 && !finalReplyText.startsWith('{')) {
        recipientResponse = finalReplyText;
        const responseTimestamp = new Date(Date.now() + 2000).toISOString();
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
          await base44.entities.Conversation.update(conversationId, {
            last_message_preview: recipientResponse.substring(0, 100),
            last_message_date: responseTimestamp,
          }).catch(() => {});
          console.log(`[sendWorldPhoneMessage] ✅ Recipient response saved | msg=${recipientMsg.id} | from=${recipient.name}`);
        }
      }
    } catch (respErr) {
      warnings.push(`Recipient response generation failed (non-fatal): ${respErr.message}`);
      console.warn(`[sendWorldPhoneMessage] Recipient response error: ${respErr.message}`);
    }

    // ── BILATERAL SYNC: memory + relationship for BOTH characters ──────────────
    // Only write if we have a real exchange (both messages exist)
    const memoryContent = isImageSend
      ? (image_description ? `sent a photo: ${image_description}` : 'sent a photo')
      : rewrittenMessage;
    const fullExchangeContent = recipientResponse
      ? `${sender.name}: ${memoryContent} | ${recipient.name}: "${recipientResponse}"`
      : `${sender.name}: ${memoryContent}`;

    base44.functions.invoke('syncWorldPhoneMemory', {
      senderCharacterId: sender_character_id,
      receiverCharacterId: recipient.id,
      messageContent: fullExchangeContent,
      context: 'world_phone',
      conversationId: conversationId,
      receiverMessageId: recipientResponseMessageId || null,
    }).catch(err => {
      warnings.push(`Bilateral sync failed (non-fatal): ${err.message}`);
      console.warn(`[sendWorldPhoneMessage] Bilateral sync error: ${err.message}`);
    });

    console.log(`[sendWorldPhoneMessage] ✅ msg=${savedMessage.id} | conv=${conversationId} | key=${canonicalKey} | source=${source} | type=${message_type || 'text'} | image=${isImageSend ? image_url : 'none'} | recipient_response=${recipientResponseMessageId || 'none'}`);

    return Response.json({
      success: true,
      message_id: savedMessage.id,
      conversation_id: conversationId,
      shared_conversation_key: canonicalKey,
      sender_character_id,
      receiver_character_id: recipient.id,
      channel: 'world_phone',
      image_url_saved: isImageSend ? !!image_url : false,
      proof: {
        message_id: savedMessage.id,
        recipient_response_message_id: recipientResponseMessageId,
        recipient_response_text: recipientResponse,
        conversation_id: conversationId,
        shared_conversation_key: canonicalKey,
        participant_character_ids: participantIds,
        recipient_response_generated: !!recipientResponseMessageId,
        recipient_resolution_path: recipientResolutionPath,
        message_type: message_type || 'text',
        image_url_saved: isImageSend ? (savedImageUrl === image_url) : false,
        image_url_readback: savedImageUrl || null,
        message_type_readback: savedMessageType || null,
        source,
        warnings: warnings.length > 0 ? warnings : null,
      },
    });

  } catch (error) {
    console.error('[sendWorldPhoneMessage]', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});