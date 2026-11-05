import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * processOverdueWorldPhoneMessages
 *
 * WORLD PHONE / WORLD CONTACTS RESPONSE ENFORCEMENT
 *
 * Finds bilateral World Phone messages that have been unanswered for more than
 * the configured threshold (default: 48 hours) and generates a response from
 * the receiving character using the canonical sendWorldPhoneMessage path.
 *
 * RULES:
 * - Only processes bilateral World Phone conversations (channel='world_phone' with
 *   both sender_character_id and receiver_character_id populated)
 * - Receiver must be awake, not jailed, not house_arrested
 * - Only generates one catch-up response per unanswered message
 * - If no valid non-World Phone direct conversation exists for the response,
 *   it is generated into the canonical WP thread (NOT into a user's direct chat)
 * - Unanswered is defined as: last message was FROM Character A to Character B,
 *   and Character B has NOT replied since
 * - Valid blocking conditions (no response required):
 *     - receiver is jailed
 *     - receiver has house_arrest_active
 *     - relationship tension_level > 85 (effectively blocked sender)
 *     - receiver is sleeping (response deferred until awake)
 *
 * Called by a scheduled automation every 6 hours.
 */

const OVERDUE_HOURS = 48;
const MAX_RESPONSES_PER_RUN = 5; // cap to avoid rate limit per production run
const MAX_CONVOS_TO_SCAN = 50; // limit conversation scan per run to avoid 429s on message fetch

// ── IMAGE UNDERSTANDING (WORLD PHONE RECIPIENT) ─────────────────────────────
// Reuses the SAME established image-understanding mechanism the Chat and Text
// pages use: vision analysis of the actual attachment via InvokeLLM
// (prompt identical to src/lib/analyzeImageForCharacterContext.js), result stored
// durably on the Message record so later turns keep the image in context.
// Deno functions cannot import src/lib — this is the same enforced duplication
// pattern already used by the Story Event generators. No parallel vision system.
const IMAGE_ANALYSIS_PROMPT = `Provide a rich, detailed visual description of this image.
Include ALL of the following that are visible:
- People shown: apparent age range, gender presentation, clothing details, expressions, poses
- Objects visible: food, drinks, furniture, decorations, vehicles, any notable items
- Setting and environment: indoor/outdoor, type of location (restaurant, home, park, etc.)
- Lighting and atmosphere: warm/cool, time of day, mood
- Relationship or context clues: are people together? What are they doing?
- Any text, signs, or notable details visible

Be specific, factual, and thorough. Minimum 3-5 sentences.
Do NOT speculate beyond what is literally visible.
Return ONLY the description text, nothing else.`;

// A routing label like "Image sent to X" is NOT image analysis.
const TRANSPORT_REJECT = /image sent to|photo shared|sent to [A-Z]|shared with [A-Z]|uploaded image|image attachment|photo attachment/i;

// An apology that the image could not be read is NOT image analysis either.
// Storing it as a successful description would report a failed read as a success.
const UNREADABLE_REJECT = /unable to (?:provide|describe|analy[sz]e|see|view|access|open|process)|cannot (?:see|view|access|open|process)|can't (?:see|view|access|open|process)|could not be opened|couldn't be opened|could not be (?:loaded|accessed|found)|no image (?:was )?(?:provided|attached)|please (?:re-?upload|upload (?:the|an|a) (?:image|file|photo))|not a valid image|image (?:is |appears )?(?:blank|corrupt|unreadable)|i (?:don't|do not) have (?:access|the ability) to (?:see|view)/i;

function isUsableDescription(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length < 40) return false;
  if (TRANSPORT_REJECT.test(trimmed)) return false;
  if (UNREADABLE_REJECT.test(trimmed)) return false;
  return true;
}

/**
 * Resolve what a received image actually shows.
 * 1. Use the description already stored on the message (written by sendWorldPhoneMessage
 *    or by a previous pass of this function).
 * 2. Otherwise run the established vision analysis on the real attachment and store it.
 * Never returns invented content: a failure yields description = null.
 */
async function resolveReceivedImageUnderstanding(base44, message) {
  const stored = message.image_description || message.inferred_image_description || null;
  if (isUsableDescription(stored)) {
    return { description: stored.trim(), status: 'stored' };
  }
  if (!message.image_url) return { description: null, status: 'no_image' };

  try {
    const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: IMAGE_ANALYSIS_PROMPT,
      file_urls: [message.image_url],
    });
    const description = (typeof res === 'string' ? res : '').trim();

    if (!isUsableDescription(description)) {
      await base44.asServiceRole.entities.Message.update(message.id, {
        image_analysis_status: 'failed',
        image_analysis_error: TRANSPORT_REJECT.test(description)
          ? 'Vision returned transport metadata, not a visual description'
          : UNREADABLE_REJECT.test(description)
            ? 'Attachment could not be read — vision reported no usable image content'
            : 'Vision returned insufficient visual detail',
      }).catch(() => {});
      return { description: null, status: 'failed' };
    }

    await base44.asServiceRole.entities.Message.update(message.id, {
      inferred_image_description: description,
      image_analysis_status: 'complete',
      image_analysis_source: 'world_phone_recipient_visual_analysis',
      image_analysis_is_inferred: true,
      image_analysis_is_transport_metadata: false,
    }).catch((e) => console.warn(`[processOverdueWorldPhoneMessages] Failed to store image description: ${e.message}`));

    return { description, status: 'analyzed' };
  } catch (err) {
    await base44.asServiceRole.entities.Message.update(message.id, {
      image_analysis_status: 'failed',
      image_analysis_error: err.message || 'Vision analysis failed',
    }).catch(() => {});
    return { description: null, status: 'failed' };
  }
}

// What the received attachment is, expressed for the recipient character.
function buildReceivedImageBlock(imageUnderstanding, senderName) {
  if (!imageUnderstanding || imageUnderstanding.status === 'no_image') return '';
  if (!imageUnderstanding.description) {
    return `\n\n${senderName} sent you a photo, but you cannot make out what it shows. You may acknowledge that you got a photo — do NOT describe or invent its contents.`;
  }
  return `\n\n${senderName} also sent you a PHOTO. What the photo actually shows (this is what you see):
"${imageUnderstanding.description}"

WHAT YOU ARE LOOKING AT:
• This description is your own view of the photo — react to it naturally, in your own voice.
• You may notice people, objects, the setting, what they are doing, and how the moment feels.
• Do NOT invent anything that is not in the description above.
• Do NOT deliver a flat image summary — respond the way you actually would to a friend sending you this.`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Auth — works in scheduled context (no user token) and direct calls
    let callerEmail = null;
    try {
      const me = await base44.auth.me();
      callerEmail = me?.email || null;
    } catch { /* scheduled — no session */ }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun === true;
    const overdueHours = body.overdueHours || OVERDUE_HOURS;
    // Optional scope limit — processes only this conversation when provided.
    // Absent in the scheduled run, which keeps its existing full-scan behavior.
    const onlyConversationId = body.conversationId || null;

    const cutoff = new Date(Date.now() - overdueHours * 3600 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    const log = [];
    const processed = [];
    const skipped = [];

    log.push(`[processOverdueWorldPhoneMessages] START | dryRun=${dryRun} | overdueHours=${overdueHours} | cutoff=${cutoff}`);

    // ── STEP 1: FETCH WORLD PHONE CONVERSATIONS (sorted oldest-first for backlog drain) ─────────────────────────
    // Sort by last_message_date ascending so oldest conversations get processed first.
    // This drains the deepest backlog items before newer ones.
    // Limit scan to MAX_CONVOS_TO_SCAN to avoid rate limit on message fetches.
    const convos = await base44.asServiceRole.entities.Conversation.filter(
      onlyConversationId
        ? { channel: 'world_phone', id: onlyConversationId }
        : { channel: 'world_phone' },
      'last_message_date',  // ascending — oldest first for backlog drain
      onlyConversationId ? 1 : MAX_CONVOS_TO_SCAN
    ).catch(() => []);

    log.push(`[processOverdueWorldPhoneMessages] WP convos found: ${convos.length}`);

    let responsesGenerated = 0;

    for (const convo of convos) {
      if (responsesGenerated >= MAX_RESPONSES_PER_RUN) break;

      // Must have bilateral participants
      const participants = convo.participant_character_ids || convo.character_ids || [];
      if (participants.length !== 2) continue;

      // Fetch last few messages
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id },
        '-timestamp',
        10
      ).catch(() => []);

      // Filter to real bilateral messages (not narrative, not excluded).
      // An image sent with no caption is still a real message that expects a reply —
      // it must never be filtered out for having no text.
      const realMsgs = msgs.filter(m =>
        !m.is_narrative &&
        !m.canon_excluded &&
        (m.content?.trim() || m.image_url) &&
        m.sender_character_id &&
        m.receiver_character_id
      );

      if (realMsgs.length === 0) continue;

      const lastMsg = realMsgs[0]; // most recent
      const lastMsgTime = lastMsg.timestamp || lastMsg.created_date;
      if (!lastMsgTime) continue;

      const ageHours = (Date.now() - new Date(lastMsgTime).getTime()) / 3600000;
      if (ageHours < overdueHours) continue; // not yet overdue

      const senderId = lastMsg.sender_character_id;
      const receiverId = lastMsg.receiver_character_id;

      // Check if receiver already replied since this message
      const receiverReplied = realMsgs.some(m =>
        m.sender_character_id === receiverId &&
        new Date(m.timestamp || m.created_date) > new Date(lastMsgTime)
      );
      if (receiverReplied) continue;

      // ── FETCH RECEIVER CHARACTER ────────────────────────────────────────────
      const receiverArr = await base44.asServiceRole.entities.Character.filter(
        { id: receiverId }, null, 1
      ).catch(() => []);
      const receiver = receiverArr[0];
      if (!receiver) {
        skipped.push({ convo_id: convo.id, reason: 'receiver_not_found', receiver_id: receiverId });
        continue;
      }

      // ── BLOCKING CONDITIONS ─────────────────────────────────────────────────
      if (receiver.is_jailed) {
        skipped.push({ convo_id: convo.id, reason: 'receiver_jailed', receiver: receiver.name });
        continue;
      }
      if (receiver.house_arrest_active) {
        skipped.push({ convo_id: convo.id, reason: 'receiver_house_arrest', receiver: receiver.name });
        continue;
      }
      // Receiver sleeping — defer, don't skip permanently
      const isSleeping = receiver.resolved_presence_status === 'sleeping' ||
        receiver.resolved_presence_status === 'napping';
      if (isSleeping) {
        skipped.push({ convo_id: convo.id, reason: 'receiver_sleeping', receiver: receiver.name });
        continue;
      }

      // Check relationship tension in receiver's fictional_relationships
      const rel = (receiver.fictional_relationships || []).find(
        r => r.related_character_id === senderId
      );
      if (rel && (rel.tension_level ?? 0) > 85) {
        skipped.push({ convo_id: convo.id, reason: 'relationship_blocked_by_tension', receiver: receiver.name, tension: rel.tension_level });
        continue;
      }

      // ── FETCH SENDER ───────────────────────────────────────────────────────
      const senderArr = await base44.asServiceRole.entities.Character.filter(
        { id: senderId }, null, 1
      ).catch(() => []);
      const sender = senderArr[0];
      if (!sender) {
        skipped.push({ convo_id: convo.id, reason: 'sender_not_found', sender_id: senderId });
        continue;
      }

      log.push(`[processOverdueWorldPhoneMessages] Overdue: ${receiver.name} owes reply to ${sender.name} | age=${Math.round(ageHours)}h | msg="${lastMsg.content?.substring(0, 60)}"`);

      if (dryRun) {
        processed.push({
          dry_run: true,
          receiver: receiver.name,
          sender: sender.name,
          convo_id: convo.id,
          age_hours: Math.round(ageHours),
          original_msg: lastMsg.content?.substring(0, 80),
        });
        continue;
      }

      // ── GENERATE CATCH-UP RESPONSE ──────────────────────────────────────────
      // Build a contextual reply from receiver to sender's message
      const ownerEmail = receiver.owner_email || sender.owner_email || convo.owner_email;

      // Build minimal personality context for the receiver
      const receiverPersonality = [
        receiver.personality_summary,
        receiver.communication_style,
        receiver.emotional_state ? `Current emotional state: ${receiver.emotional_state}` : null,
        receiver.occupation ? `Occupation: ${receiver.occupation}` : null,
      ].filter(Boolean).join('. ');

      const relContext = rel
        ? `Your relationship with ${sender.name}: ${rel.relationship_type || 'contact'}, friendship ${rel.friendship_level ?? 50}/100, trust ${rel.trust_level ?? 50}/100.`
        : `${sender.name} is someone you know.`;

      const timeNote = ageHours > 72
        ? `It has been ${Math.round(ageHours / 24)} days since they sent this.`
        : `It has been about ${Math.round(ageHours)} hours since they sent this.`;

      // ── RECEIVED IMAGE UNDERSTANDING (same capability as Chat / Text) ────────
      // The attachment is analyzed from its actual pixels, never from its filename,
      // type, or the sender's caption. Result is stored on the message for continuity.
      const imageUnderstanding = await resolveReceivedImageUnderstanding(base44, lastMsg);
      const imageBlock = buildReceivedImageBlock(imageUnderstanding, sender.name);
      if (lastMsg.image_url) {
        log.push(`[processOverdueWorldPhoneMessages] Image understanding for msg=${lastMsg.id}: ${imageUnderstanding.status}`);
      }

      // ── RECENT EXCHANGE (continuity) ─────────────────────────────────────────
      // Earlier photos stay in context through their stored descriptions, so the
      // recipient can refer back to what was shown instead of losing it.
      const recentExchange = realMsgs.slice(0, 5).reverse().map(m => {
        const who = m.sender_character_id === receiverId ? 'You' : sender.name;
        const text = (m.content || '').trim();
        const storedDescription = (m.image_description || m.inferred_image_description || '').trim();
        if (m.image_url) {
          return storedDescription
            ? `${who}: [sent a photo — ${storedDescription}]${text ? ` with the message: "${text}"` : ''}`
            : `${who}: [sent a photo]${text ? ` with the message: "${text}"` : ''}`;
        }
        return `${who}: "${text}"`;
      }).join('\n');

      // ── PEOPLE THE RECIPIENT ACTUALLY KNOWS (identity must respect knowledge) ─
      // Only people this character already has a relationship with. Recognition is
      // never assumed: an unfamiliar face stays unfamiliar.
      const knownNames = [...new Set([
        sender.name,
        ...(receiver.fictional_relationships || [])
          .map(r => r.related_character_name || r.character_name || r.name)
          .filter(Boolean),
      ])].slice(0, 10);
      const knownPeopleBlock = knownNames.length > 0
        ? `\nPeople you already know: ${knownNames.join(', ')}. If someone in the photo is clearly one of them, you may recognise them by name. Otherwise they are a stranger to you — you do not know who they are, and it is natural to say so or ask.`
        : `\nYou do not have an established list of people you know by sight. Do not claim to recognise anyone in the photo unless ${sender.name} tells you who they are.`;

      const lastMsgBody = lastMsg.content?.trim()
        ? `"${lastMsg.content}"`
        : `(a photo, with no caption)`;

      const catchUpPrompt = `You are ${receiver.name}. ${receiverPersonality}

${relContext}

${sender.name} sent you this ${timeNote}:
${lastMsgBody}
${imageBlock}
${knownPeopleBlock}

--- Recent exchange, oldest to newest ---
${recentExchange}
--- End of exchange ---

You're just now getting around to responding. Write a short, natural reply in your own voice.
- If a photo was sent, react to what it actually shows. Do not ignore it, and do not reply as though you never saw it.
- Acknowledge the delay naturally if it was long (2+ days): "Sorry, been busy" / "Just seeing this" / "Heads up been slammed"
- If it was shorter (under 2 days), just reply normally without belaboring the delay
- 1-3 sentences max. Sound real. Sound like you.
- Never list or transcribe everything in a photo like a caption generator — respond the way you actually would.
- Return ONLY the message text.`;

      let replyText = null;
      // LLM call with retry on 429 rate limit
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const llmResult = await base44.asServiceRole.integrations.Core.InvokeLLM({
            prompt: catchUpPrompt,
          });
          replyText = (typeof llmResult === 'string' ? llmResult : '').trim();
          break;
        } catch (llmErr) {
          const is429 = llmErr.message?.includes('429') || llmErr.message?.includes('Rate limit');
          if (is429 && attempt < 2) {
            const waitMs = 3000 * (attempt + 1); // 3s, 6s
            log.push(`[processOverdueWorldPhoneMessages] 429 for ${receiver.name}, retry in ${waitMs}ms`);
            await new Promise(r => setTimeout(r, waitMs));
          } else {
            log.push(`[processOverdueWorldPhoneMessages] LLM failed for ${receiver.name}: ${llmErr.message}`);
            break;
          }
        }
      }

      if (!replyText) {
        // Safe fallback
        replyText = ageHours > 72
          ? `Hey, sorry I'm just seeing this. Been a lot going on.`
          : `Hey, sorry for the late reply.`;
      }

      // ── WRITE THE REPLY MESSAGE ─────────────────────────────────────────────
      const participantIds = [senderId, receiverId].sort();
      const sharedKey = convo.shared_conversation_key ||
        `world_phone::${participantIds[0]}::${participantIds[1]}`;

      const savedMsg = await base44.asServiceRole.entities.Message.create({
        conversation_id: convo.id,
        sender_type: 'character',
        character_id: receiverId,
        character_name: receiver.name,
        sender_character_id: receiverId,
        receiver_character_id: senderId,
        participant_character_ids: participantIds,
        shared_conversation_key: sharedKey,
        content: replyText,
        timestamp: nowIso,
        channel: 'world_phone',
        is_read: false,
        sync_status: 'complete',
        recovery_signal: false,
        memory_eligible: true,
        relationship_eligible: true,
        autonomy_marker: 'overdue_catch_up',
      }).catch(err => {
        log.push(`[processOverdueWorldPhoneMessages] Message.create failed: ${err.message}`);
        return null;
      });

      if (!savedMsg) continue;

      // Update conversation preview
      await base44.asServiceRole.entities.Conversation.update(convo.id, {
        last_message_preview: replyText.substring(0, 100),
        last_message_date: nowIso,
      }).catch(() => {});

      // Write bilateral memories
      await Promise.all([
        base44.asServiceRole.entities.CharacterMemory.create({
          character_id: receiverId,
          memory_type: 'relationship',
          memory_text: `Replied to ${sender.name} after a ${Math.round(ageHours)}-hour delay: "${replyText.substring(0, 150)}"`,
          memory_summary: `[overdue_reply] Caught up with ${sender.name}`,
          related_character_id: senderId,
          importance_score: 3,
          confidence_score: 0.9,
          permanence: 'long_term',
        }).catch(() => null),
        base44.asServiceRole.entities.CharacterMemory.create({
          character_id: senderId,
          memory_type: 'relationship',
          memory_text: `${receiver.name} finally replied after ${Math.round(ageHours)} hours: "${replyText.substring(0, 150)}"`,
          memory_summary: `[overdue_reply] Heard back from ${receiver.name}`,
          related_character_id: receiverId,
          importance_score: 3,
          confidence_score: 0.9,
          permanence: 'long_term',
        }).catch(() => null),
      ]);

      responsesGenerated++;
      processed.push({
        receiver: receiver.name,
        sender: sender.name,
        convo_id: convo.id,
        message_id: savedMsg.id,
        age_hours: Math.round(ageHours),
        reply_preview: replyText.substring(0, 80),
        original_msg: lastMsg.content?.substring(0, 80),
      });

      console.log(`[processOverdueWorldPhoneMessages] ✓ ${receiver.name} replied to ${sender.name} | age=${Math.round(ageHours)}h | msg=${savedMsg.id}`);

      // Throttle
      await new Promise(r => setTimeout(r, 500));
    }

    log.push(`[processOverdueWorldPhoneMessages] DONE | responses_generated=${responsesGenerated} | skipped=${skipped.length}`);

    return Response.json({
      success: true,
      dry_run: dryRun,
      responses_generated: responsesGenerated,
      skipped_count: skipped.length,
      processed,
      skipped,
      log,
      timestamp: nowIso,
    });

  } catch (error) {
    console.error('[processOverdueWorldPhoneMessages] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});