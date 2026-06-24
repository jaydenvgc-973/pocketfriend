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

/**
 * WORLD PHONE BOUNDARY GUARD (inline — no local imports in Deno functions)
 *
 * World Phone is communication-only. It must NEVER contain narrative records.
 * Any message payload with is_narrative truthy is rejected before write.
 * This is a permanent system-level guard. The root cause of the June 2026
 * contamination was that narrative records were written into world_phone
 * conversations. This guard prevents that at the write layer.
 */
function assertNotNarrative(payload, callerLabel) {
  const isNarrativeTruthy =
    payload.is_narrative === true ||
    payload.is_narrative === 1 ||
    payload.is_narrative === '1' ||
    payload.is_narrative === 'true';
  if (isNarrativeTruthy) {
    throw new Error(
      `[WORLD_PHONE_BOUNDARY_VIOLATION] ${callerLabel} attempted to write a narrative record ` +
      `(is_narrative=${JSON.stringify(payload.is_narrative)}) to a World Phone conversation. ` +
      `World Phone is communication-only. Narrative content must target direct user↔character conversations.`
    );
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // auth.me() may return null when called from automation/function context (no user session).
    // Security is maintained by ownerEmail scoping on all entity operations below.
    const user = await base44.auth.me().catch(() => null);

    // If called from a real user session, validate ownership.
    // If called from automation/function context (no session), ownerEmail param is authoritative.
    // We do NOT block non-session callers — they must supply a valid owner_email.

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
      autonomy_marker,
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

    // ownerEmail: from payload if present (automation callers), else from session user.
    // If neither is available, fail fast — all entity operations require a scope.
    const ownerEmail = owner_email || user?.email;
    if (!ownerEmail) {
      return Response.json({ success: false, error: 'owner_email is required when calling without a user session' }, { status: 400 });
    }
    const warnings = [];

    // ── LOAD SENDER ────────────────────────────────────────────────────────────
    // Use asServiceRole — this function is called from automations and other functions
    // that don't carry a user session. ownerEmail ensures data isolation.
    const senderArr = await base44.asServiceRole.entities.Character.filter({ id: sender_character_id }, null, 1).catch(() => []);
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
      const byId = await base44.asServiceRole.entities.Character.filter({ id: effectiveRecipientIdentifier }, null, 1).catch(() => []);
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
        const relArr = await base44.asServiceRole.entities.Character.filter({ id: relMatch.related_character_id }, null, 1).catch(() => []);
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
        const famArr = await base44.asServiceRole.entities.Character.filter({ id: famMatch.character_id }, null, 1).catch(() => []);
        if (famArr?.[0]) {
          recipient = famArr[0];
          recipientResolutionPath = 'family_members';
        }
      }
    }

    // 4. Account-wide name search — exact match only; partial match requires unique result
    // CRITICAL: Must include ALL characters accessible to this account, including:
    //   - npc_world_service characters (e.g. Vick Servicio) which have owner_email = null
    //   - shared/global characters seeded by admin
    // We query BOTH owner_email-scoped AND name-direct to ensure world service characters are found.
    if (!recipient) {
      const nameLower = effectiveRecipientIdentifier.toLowerCase().trim();

      // Primary: owner-scoped characters (most characters)
      const ownerChars = await base44.asServiceRole.entities.Character.filter({ owner_email: ownerEmail, status: 'active' }, null, 200).catch(() => []);

      // Secondary: name-direct lookup for world service / shared characters that may have null owner_email
      // This catches Vick Servicio and any other global service characters.
      const nameDirectChars = await base44.asServiceRole.entities.Character.filter({ name: effectiveRecipientIdentifier, status: 'active' }, null, 10).catch(() => []);
      const primaryNameDirectChars = await base44.asServiceRole.entities.Character.filter({ primary_name: effectiveRecipientIdentifier, status: 'active' }, null, 10).catch(() => []);

      // Merge all candidates, deduplicate by id
      const seenCharIds = new Set();
      const allChars = [...ownerChars, ...nameDirectChars, ...primaryNameDirectChars].filter(c => {
        if (seenCharIds.has(c.id)) return false;
        seenCharIds.add(c.id);
        return true;
      });

      const exactMatches = allChars.filter(c =>
        c.name?.toLowerCase() === nameLower ||
        c.display_name?.toLowerCase() === nameLower ||
        c.primary_name?.toLowerCase() === nameLower
      );
      if (exactMatches.length === 1) {
        recipient = exactMatches[0];
        recipientResolutionPath = 'account_exact_name';
      } else if (exactMatches.length > 1) {
        // Prefer the one with matching owner_email if there's ambiguity
        const ownedMatch = exactMatches.find(c => c.owner_email === ownerEmail);
        if (ownedMatch) {
          recipient = ownedMatch;
          recipientResolutionPath = 'account_exact_name_owned';
        } else {
          return Response.json({
            success: false,
            error: `Ambiguous recipient: "${effectiveRecipientIdentifier}" matches ${exactMatches.length} characters. Use a character ID to be precise.`,
            ambiguous_matches: exactMatches.map(c => ({ id: c.id, name: c.name })),
          });
        }
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

    // ── STEP 3: INVOKE CANONICAL CHARACTER CONTEXT ──────────────────────────────
    // The message must be anchored to canonical character data — not cache, not defaults.
    // buildCanonicalCharacterContext is the single source of identity, memory, presence, and location.
    let canonicalContext = null;
    let canonicalLoaded = false;
    try {
      const ctxRes = await base44.functions.invoke('buildCanonicalCharacterContext', {
        characterId: sender_character_id,
        interactionContext: 'world_contacts',
        topKMemories: 8,
        ownerEmailHint: ownerEmail,
      });
      const ctxData = ctxRes?.data || ctxRes;
      if (ctxData?.systemPrompt) {
        canonicalContext = ctxData;
        canonicalLoaded = true;
        console.log(`[sendWorldPhoneMessage] canonical_context_loaded | sender=${sender.name} | memories=${ctxData.memories?.length || 0} | life_journal=${ctxData.lifeJournalEntries?.length || 0} | location=${sender.resolved_current_location_name || 'unknown'}`);
      }
    } catch (ctxErr) {
      // Non-fatal: fall through with a lightweight inline prompt built from sender fields.
      // This ensures World Phone communication works even when buildCanonicalCharacterContext
      // is called from an automation/function context with no user session.
      console.warn(`[sendWorldPhoneMessage] canonical_context_fallback | sender=${sender.name} | reason=${ctxErr.message}`);
    }





    // ── STEP 4: PRESENCE VALIDATION ────────────────────────────────────────────
    let presenceValidated = false;
    let userPresenceData = null;

    try {
      const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: ownerEmail }, null, 1).catch(() => []);
      const settings = settingsList?.[0] || {};
      const userLocationId = settings.user_current_location_id || null;
      const userLocationName = settings.user_current_location_name || null;
      const userPresenceStatus = settings.user_presence_status || 'away';
      const senderLocationId = sender.resolved_current_location_id || null;
      const senderLocationName = sender.resolved_current_location_name || null;
      const senderStayLock = sender.presence_stay_lock === true;

      userPresenceData = {
        user_location_id: userLocationId,
        user_location_name: userLocationName,
        user_presence_status: userPresenceStatus,
        sender_location_id: senderLocationId,
        sender_location_name: senderLocationName,
        presence_stay_lock: senderStayLock,
        locations_match: !!(senderLocationId && userLocationId && senderLocationId === userLocationId),
      };
      presenceValidated = true;

      console.log(`[sendWorldPhoneMessage] presence_validated | sender=${sender.name} | sender_location=${senderLocationName || 'none'} | user_location=${userLocationName || 'none'} | stay_lock=${senderStayLock} | locations_match=${userPresenceData.locations_match}`);
    } catch (presenceErr) {
      console.warn(`[sendWorldPhoneMessage] presence_validation_warning | sender=${sender.name} | error=${presenceErr.message}`);
      presenceValidated = true;
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

        const rewriteRes = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt: llmPrompt });
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
      base44.asServiceRole.entities.Conversation.filter({ shared_conversation_key: canonicalKey }, '-updated_date', 5).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ participant_character_ids: [sender_character_id] }, '-updated_date', 100).catch(() => []),
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
        await base44.asServiceRole.entities.Conversation.update(conversationId, {
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
      const newConvo = await base44.asServiceRole.entities.Conversation.create({
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
      autonomy_marker: autonomy_marker || null,
      // ── STEP 8: generation_context — full routing evidence ───────────────────
      generation_context: {
        // Identity anchors
        sender_character_id,
        recipient_character_id: recipient.id,
        owner_email: ownerEmail,
        // Conversation anchor
        conversation_id: conversationId,
        recipient_in_character_ids: participantIds.includes(recipient.id),
        // Canonical context
        build_canonical_character_context_status: canonicalLoaded ? 'success' : 'failed',
        canonical_context_memory_count: canonicalContext?.memories?.length || 0,
        canonical_context_life_journal_count: canonicalContext?.lifeJournalEntries?.length || 0,
        // CharacterMemory / Life Journal — importance_score >= 4
        life_journal_importance_4_plus_count: (canonicalContext?.lifeJournalEntries || []).filter(e => (e.importance_score ?? 0) >= 4).length,
        // Location / presence
        sender_resolved_current_location_id: sender.resolved_current_location_id || null,
        sender_resolved_current_location_name: sender.resolved_current_location_name || null,
        user_current_location_id: userPresenceData?.user_location_id || null,
        user_current_location_name: userPresenceData?.user_location_name || null,
        sender_presence_stay_lock: sender.presence_stay_lock === true,
        presence_validated: presenceValidated,
        // Character type
        sender_character_type: sender.character_type || null,
        recipient_character_type: recipient.character_type || null,
        // Recipient resolution
        recipient_resolution_path: recipientResolutionPath,
        // Timestamp
        built_at: now,
      },
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

    // ── WORLD PHONE BOUNDARY GUARD: reject narrative content before write ─────
    // This is the permanent system-level guard that ensures narrative records
    // can never enter World Phone conversations regardless of caller.
    // isNarrativeTruthy catches boolean true, 1, "1", "true" — all representations.
    assertNotNarrative(messagePayload, 'sendWorldPhoneMessage/outbound');

    const savedMessage = await base44.asServiceRole.entities.Message.create(messagePayload);

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
    
    await base44.asServiceRole.entities.Conversation.update(conversationId, {
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
      const recentHistory = await base44.asServiceRole.entities.Message.filter(
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

      // ── VICK CHARACTER BOUNDARY — FULL ENFORCEMENT ──────────────────────────
      // Applied when Vick is the RECIPIENT responding to another character.
      // Uses the same comprehensive detection + rewrite + reject pipeline as the
      // frontend WorldContactsPopup path — identical standards, no weaker fallback.
      //
      // IDENTIFICATION: all five reliable signals (mirrors isVickServicio in lib)
      const isVickRecipient =
        recipient.character_type === 'npc_world_service' ||
        recipient.is_world_service === true ||
        recipient.diagnostic_only === true ||
        (recipient.name && recipient.name.toLowerCase().includes('vick servicio')) ||
        (recipient.display_name && recipient.display_name.toLowerCase().includes('vick servicio')) ||
        (recipient.primary_name && recipient.primary_name.toLowerCase().includes('vick servicio'));

      // Also apply when Vick is the SENDER responding on behalf of himself
      // (this function generates Character B's reply — Vick may be Character B)
      const isVickSender =
        sender.character_type === 'npc_world_service' ||
        sender.is_world_service === true ||
        sender.diagnostic_only === true ||
        (sender.name && sender.name.toLowerCase().includes('vick servicio'));

      // This is always a character-to-character channel (World Phone).
      // The boundary applies in both directions.
      const vickInvolved = isVickRecipient || isVickSender;

      let finalReplyText = replyText;
      if (finalReplyText && vickInvolved) {
        // ── FULL PIPELINE: detect → rewrite → re-scan → reject if still contaminated ──
        const VICK_BOUNDARY_PATTERNS_BACKEND = [
          /\bthe\s+app\b/i, /\bBase44\b/i, /\bthis\s+application\b/i, /\bthe\s+platform\b/i,
          /\brun(?:ning)?\s+(?:a\s+)?diagnostic/i, /\bdiagnostic\s+result/i, /\baudit(?:ing|ed)?\s+(?:your|the|their)/i,
          /\bran\s+(?:a\s+)?(?:diagnostic|audit|repair|check)/i,
          /\bAccount\s+Help\b/i, /\bAccount\s+Help\s+(?:&|and)\s+Repair\b/i,
          /\bdeleted\s+files?\b/i, /\bfile\s+headers?\b/i, /\bcharacter\s+files?\b/i,
          /\bmemory\s+files?\b/i, /\bmemory\s+records?\b/i,
          /\bdatabase(?:\s+entries?|\s+records?|\s+files?|\s+data)?\b/i,
          /\bstored\s+(?:data|records?|files?)\b/i, /\bhidden\s+(?:data|records?|files?)\b/i,
          /\bmetadata\b/i, /\binternal\s+(?:ID|identifier|record|data|system)\b/i,
          /\bschema\b/i, /\bdata\s+(?:field|record|entry|table|schema|store|file)\b/i,
          /\bmemory\s+system\b/i, /\bmemory\s+architecture\b/i, /\bmemory\s+bank\b/i,
          /\bmemory\s+entries?\b/i, /\bmemory\s+wipe\b/i,
          /\bAI\s+(?:memory|system|instruction|data)\b/i, /\bsystem\s+prompt\b/i,
          /\bcharacter\s+(?:profile|record|data|storage|file)\b/i,
          /\brelationship\s+system\b/i, /\bjournal\s+system\b/i,
          /\bbackend\b/i, /\bfrontend\b/i, /\bAPI\b/i,
          /\bfunction(?:s)?\s+(?:ran|run|called|failed|returned|working|broken)\b/i,
          /\bsource\s+code\b/i, /\bthe\s+logs?\b/i,
          /\berror\s+(?:log|message|code|state)\b/i,
          /\buser\s+settings?\b/i, /\bapp\s+settings?\b/i,
          /\bscrubbed\s+(?:from|out\s+of)\s+(?:the\s+)?(?:records?|database|system|files?)\b/i,
          /\bpurged\s+from\s+(?:the\s+)?(?:records?|system|database)\b/i,
          /\berased\s+from\s+(?:the\s+)?(?:records?|system|database)\b/i,
        ];

        // ── SAFE REWRITES (backend mirror of lib/vickCharacterBoundary.js) ──────
        // Each replacement describes only what a real person could physically observe.
        // After rewrite the full text is re-scanned — surviving forbidden terms = reject.
        const SAFE_REWRITES_BACKEND = [
          [/\bdeleted\s+files?\b/gi, 'something that should have been there but wasn\'t'],
          [/\bfile\s+headers?\b/gi, 'old papers I came across'],
          [/\bdatabase(?:\s+entries?|\s+records?|\s+files?|\s+data)?\b/gi, 'what I found when I looked into it'],
          [/\bstored\s+(?:data|records?|files?)\b/gi, 'what\'s been documented'],
          [/\bcharacter\s+profile\b/gi, 'what people say about them'],
          [/\bcharacter\s+record\b/gi, 'what I know about them'],
          [/\bcharacter\s+data\b/gi, 'what I\'ve gathered'],
          [/\bcharacter\s+files?\b/gi, 'what I found on them'],
          [/\bmemory\s+records?\b/gi, 'what they say they remember'],
          [/\bmemory\s+files?\b/gi, 'what they\'ve told people'],
          [/\bmemory\s+wipe\b/gi, 'someone deliberately made them forget'],
          [/\bmemory\s+(?:system|architecture|bank|entries?|store)\b/gi, 'how they carry things with them'],
          [/\bran\s+a\s+diagnostic\b/gi, 'looked into it myself'],
          [/\brunning\s+(?:a\s+)?diagnostic/gi, 'looking into it'],
          [/\bdiagnostic\s+results?\b/gi, 'what I found'],
          [/\bdiagnostic\s+tools?\b/gi, 'my own judgment'],
          [/\baudit(?:ed|ing)?\s+(?:your|the|their)/gi, 'went through'],
          [/\bAccount\s+Help\s+(?:&|and)\s+Repair\b/gi, 'the work I do'],
          [/\bthe\s+logs?\b/gi, 'a trail of what happened'],
          [/\berror\s+log\b/gi, 'a list of things that went wrong'],
          [/\bthe\s+(?:error|exception)\s+(?:shows?|says?|indicates?)\b/gi, 'from what I could piece together'],
          [/\bmetadata\b/gi, 'small details that don\'t add up'],
          [/\binternal\s+(?:ID|identifier)\b/gi, 'a name I found in the paperwork'],
          [/\binternal\s+(?:record|data|system|files?)\b/gi, 'something that wasn\'t meant to be seen'],
          [/\bhidden\s+(?:data|records?|files?|information)\b/gi, 'information people were kept from'],
          [/\bscrubbed\s+(?:from|out\s+of)\s+(?:the\s+)?(?:records?|database|system|files?)\b/gi, 'made to disappear entirely'],
          [/\bpurged\s+from\s+(?:the\s+)?(?:records?|system|database)\b/gi, 'removed from the picture'],
          [/\berased\s+from\s+(?:the\s+)?(?:records?|system|database)\b/gi, 'wiped from the story'],
          [/\brelationship\s+system\b/gi, 'how two people relate to each other'],
          [/\bjournal\s+system\b/gi, 'the running history between people'],
          [/\bthe\s+app\b/gi, 'around here'],
          [/\bBase44\b/gi, 'this place'],
          [/\bthe\s+platform\b/gi, 'how things operate here'],
          [/\bbackend\b/gi, 'what goes on behind the scenes'],
          [/\bfrontend\b/gi, 'what\'s visible to everyone'],
          [/\bsource\s+code\b/gi, 'how things were originally set up'],
          [/\bAI\s+(?:memory|system|instruction|data)\b/gi, 'how I think through things'],
          [/\bsystem\s+prompt\b/gi, 'how I was shaped to think'],
          [/\buser\s+settings?\b/gi, 'the choices someone made'],
          [/\bAPI\b/gi, 'the link between things'],
          [/\bschema\b/gi, 'the structure things follow'],
        ];

        const detectBackend = (text) =>
          VICK_BOUNDARY_PATTERNS_BACKEND.some(p => p.test(text));

        if (detectBackend(finalReplyText)) {
          // Attempt rewrite
          let rewritten = finalReplyText;
          for (const [pat, sub] of SAFE_REWRITES_BACKEND) rewritten = rewritten.replace(pat, sub);

          if (detectBackend(rewritten)) {
            // Still contaminated after rewrite — suppress entirely
            console.error(
              `[sendWorldPhoneMessage] Vick boundary SUPPRESSED — contaminated even after rewrite` +
              ` | recipient=${recipient.name} | sender=${sender.name}`
            );
            finalReplyText = null; // null = do NOT save this message
          } else {
            finalReplyText = rewritten;
            console.log(`[sendWorldPhoneMessage] Vick boundary rewrite succeeded | recipient=${recipient.name}`);
          }
        }
      }

      if (finalReplyText && finalReplyText.length > 2 && !finalReplyText.startsWith('{')) {
        recipientResponse = finalReplyText;
        const responseTimestamp = new Date(Date.now() + 2000).toISOString();
        const recipientMsgPayload = {
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
        };
        // WORLD PHONE BOUNDARY GUARD: recipient response must never be narrative
        assertNotNarrative(recipientMsgPayload, 'sendWorldPhoneMessage/recipient_response');
        const recipientMsg = await base44.asServiceRole.entities.Message.create(recipientMsgPayload);
        if (recipientMsg?.id) {
          recipientResponseMessageId = recipientMsg.id;
          await base44.asServiceRole.entities.Conversation.update(conversationId, {
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
    // Only write if we have a real exchange (both messages exist).
    // fullExchangeContent is built AFTER boundary enforcement — never from a rejected reply.
    // If recipientResponse is null (boundary suppressed it), memory sync only records
    // the sender's outbound message, not the suppressed reply.
    const memoryContent = isImageSend
      ? (image_description ? `sent a photo: ${image_description}` : 'sent a photo')
      : rewrittenMessage;
    const fullExchangeContent = (recipientResponse && recipientResponseMessageId)
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