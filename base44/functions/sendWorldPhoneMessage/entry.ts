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
 * - Conversation type: "direct" for active_created↔active_created, "npc" otherwise — matches WorldContactsPopup
 * - Conversation lookup: canonical key first, then participant_character_ids, then character_ids
 * - ONE outbound Message record only (no mirrored duplicate) — WorldContactsPopup reads by conversation_id
 * - Memory + LifeEvent + fictional_relationships updates delegated to syncBilateralCharacterConversation
 * - If Message write fails → return success:false → caller must not let character claim it was sent
 * - owner_email scoping only — never created_by
 *
 * RETURNS proof object with:
 *   conversation_id, message_id, sender, recipient, shared_key, sync_result, warnings[]
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
    // Priority: exact ID → sender's fictional_relationships by ID → sender's family_members by ID
    //           → account-wide exact name match → account-wide partial name match (ambiguity-blocked)
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

      // Exact full-name match
      const exactMatches = allChars.filter(c =>
        c.name?.toLowerCase() === nameLower ||
        c.display_name?.toLowerCase() === nameLower ||
        c.primary_name?.toLowerCase() === nameLower
      );
      if (exactMatches.length === 1) {
        recipient = exactMatches[0];
        recipientResolutionPath = 'account_exact_name';
      } else if (exactMatches.length > 1) {
        // Ambiguity — fail visible, do not guess
        return Response.json({
          success: false,
          error: `Ambiguous recipient: "${recipient_identifier}" matches ${exactMatches.length} characters. Use a character ID to be precise.`,
          ambiguous_matches: exactMatches.map(c => ({ id: c.id, name: c.name })),
        });
      } else {
        // Partial match — only accept if exactly one result
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

    // Cannot send to self
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
    // MUST match WorldContactsPopup format exactly: world_phone::sortedA::sortedB
    const sortedIds = [sender_character_id, recipient.id].sort();
    const canonicalKey = `world_phone::${sortedIds[0]}::${sortedIds[1]}`;
    const participantIds = sortedIds; // already sorted

    // ── FIND OR CREATE CONVERSATION ────────────────────────────────────────────
    // Lookup order: canonical key → participant_character_ids → character_ids (both present)
    // Matches WorldContactsPopup resolution chain exactly.
    let conversationId = null;

    const [byCanonical, byParticipant] = await Promise.all([
      base44.entities.Conversation.filter({ shared_conversation_key: canonicalKey }, '-updated_date', 5).catch(() => []),
      base44.entities.Conversation.filter({ participant_character_ids: [sender_character_id] }, '-updated_date', 100).catch(() => []),
    ]);

    // Merge + deduplicate candidates
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
      // Upgrade legacy thread to canonical fields if needed
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
      // Create new canonical thread — type matches WorldContactsPopup logic
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
    // ONE message record only. WorldContactsPopup reads via Message.filter({ conversation_id })
    // and determines direction from sender_character_id vs the active character's ID.
    // Required fields proven from WorldContactsPopup lines 572–588 and 833–855:
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

    // ── DELEGATE SYNC TO CANONICAL syncWorldPhoneMemory ─────────────────────
    // This function handles Memory creation + fictional_relationships updates.
    // Called non-blocking after message creation (UI already updated).
    let syncResult = null;

    base44.functions.invoke('syncWorldPhoneMemory', {
      senderCharacterId: sender_character_id,
      receiverCharacterId: recipient.id,
      messageContent: `${sender.name}: "${rewrittenMessage}" | ${recipient.name}: [awaiting reply in World Contacts]`,
      context: 'world_phone',
      conversationId: conversationId,
    })
      .then(res => {
        syncResult = res?.data || res;
        console.log(`[sendWorldPhoneMessage] syncWorldPhoneMemory complete | result=${JSON.stringify(syncResult)}`);
        // Update conversation sync status on success
        base44.entities.Conversation.update(conversationId, {
          sync_status: 'complete',
        }).catch(() => {});
      })
      .catch(err => {
        console.warn(`[sendWorldPhoneMessage] syncWorldPhoneMemory failed: ${err.message}`);
        syncResult = { success: false, error: err.message };
        // Mark message as failed sync
        base44.entities.Message.update(savedMessage.id, {
          sync_status: 'failed',
          sync_error: err.message,
        }).catch(() => {});
      });

    console.log(`[sendWorldPhoneMessage] ✅ ${sender.name} → ${recipient.name} | conv=${conversationId} | msg=${savedMessage.id} | key=${canonicalKey} | source=${source} | path=${recipientResolutionPath}`);

    return Response.json({
      success: true,
      proof: {
        sender: { id: sender_character_id, name: sender.name },
        recipient: { id: recipient.id, name: recipient.name },
        original_request: requested_message,
        rewritten_message: rewrittenMessage,
        message_id: savedMessage.id,
        conversation_id: conversationId,
        shared_conversation_key: canonicalKey,
        participant_character_ids: participantIds,
        recipient_resolution_path: recipientResolutionPath,
        source,
        sync_result: syncResult,
        warnings: warnings.length > 0 ? warnings : null,
      },
    });

  } catch (error) {
    console.error('[sendWorldPhoneMessage]', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});