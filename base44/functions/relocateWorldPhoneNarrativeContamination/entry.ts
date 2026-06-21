import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * relocateWorldPhoneNarrativeContamination
 *
 * REMEDIATION FUNCTION — one-time operation to repair the World Phone narrative leak.
 *
 * ROOT CAUSE (2026-06-21):
 *   triggerCharacterNarratives selected conversations using { type: 'direct' }.
 *   World Phone conversations are stored as type='direct', channel='world_phone'.
 *   This caused narrative messages (is_narrative=true) to be written into bilateral
 *   character↔character World Phone threads instead of user↔character direct conversations.
 *
 * THIS FUNCTION:
 *   1. Scans all world_phone conversations for is_narrative=true messages
 *   2. Identifies the owning character from character_id
 *   3. Locates or creates the correct user↔character direct conversation (channel != world_phone)
 *   4. Copies each narrative message to the correct destination
 *   5. Marks the original World Phone copy as canon_excluded + stamps it with audit metadata
 *   6. Returns a full proof report
 *
 * RELOCATION RULE:
 *   A message is eligible for relocation if ALL of the following are true:
 *   - is_narrative === true
 *   - conversation resides in channel='world_phone'
 *   - character_id is present (identifies the owning character)
 *   - sender_character_id is null (not a valid bilateral message)
 *   - receiver_character_id is null (not a valid bilateral message)
 *
 * SAFETY:
 *   - Never deletes original messages — marks them canon_excluded
 *   - Never places Marley's narrative in Ethan's chat (strict char_id scoping)
 *   - Never modifies legitimate bilateral World Phone messages
 *   - Idempotent — safe to re-run (checks for existing relocation by idempotency_key)
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admin only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run !== false; // Default to dry_run=true for safety
    const targetConvoIds = body?.target_convo_ids || null; // Optional: limit to specific convos
    const ownerEmail = body?.owner_email || null; // Optional: limit to specific account

    console.log(`[relocateWorldPhoneNarrativeContamination] START | dry_run=${dryRun} | owner=${ownerEmail || 'all'}`);

    const proof = {
      dry_run: dryRun,
      owner_email: ownerEmail,
      scanned_convos: 0,
      contaminated_messages_found: 0,
      relocations_attempted: 0,
      relocations_succeeded: 0,
      relocations_skipped_already_done: 0,
      world_phone_copies_excluded: 0,
      errors: [],
      records: [],
    };

    // ── STEP 1: FIND ALL WORLD PHONE CONVERSATIONS ──────────────────────────
    const wpFilter = { channel: 'world_phone' };
    if (ownerEmail) wpFilter.owner_email = ownerEmail;

    let wpConvos = [];
    let page = 0;
    const PAGE_SIZE = 50;
    while (true) {
      const batch = await base44.asServiceRole.entities.Conversation.filter(
        wpFilter, '-created_date', PAGE_SIZE, page * PAGE_SIZE
      ).catch(() => []);
      if (!batch || batch.length === 0) break;
      wpConvos = wpConvos.concat(batch);
      if (batch.length < PAGE_SIZE) break;
      page++;
    }

    // Optionally limit to specific conversation IDs
    if (targetConvoIds?.length > 0) {
      wpConvos = wpConvos.filter(c => targetConvoIds.includes(c.id));
    }

    proof.scanned_convos = wpConvos.length;
    console.log(`[relocateWorldPhoneNarrativeContamination] Found ${wpConvos.length} world_phone convos to scan`);

    // ── STEP 2: COLLECT ALL CONTAMINATED MESSAGES ───────────────────────────
    // CRITICAL: Do NOT use { is_narrative: true } as a DB filter.
    // Some records may store is_narrative as 1, "true", or other truthy non-boolean values
    // that a strict DB equality filter misses. We fetch ALL messages per conversation and
    // apply client-side truthy detection to catch every possible stored representation.

    const contaminatedMessages = [];

    // Retry helper for 429s
    const withRetry = async (fn, maxAttempts = 4) => {
      for (let i = 0; i < maxAttempts; i++) {
        try { return await fn(); }
        catch (e) {
          if ((e.message?.includes('429') || e.message?.includes('Rate limit')) && i < maxAttempts - 1) {
            const delay = (i + 1) * 3000;
            console.log(`[relocate] 429 — retrying in ${delay}ms (attempt ${i + 2}/${maxAttempts})`);
            await new Promise(r => setTimeout(r, delay));
          } else throw e;
        }
      }
    };

    for (const convo of wpConvos) {
      // Fetch ALL messages — no is_narrative filter — then detect truthy client-side
      let allMsgs = [];
      let msgPage = 0;
      const MSG_PAGE = 100;
      while (true) {
        const batch = await withRetry(() =>
          base44.asServiceRole.entities.Message.filter(
            { conversation_id: convo.id }, '-timestamp', MSG_PAGE, msgPage * MSG_PAGE
          )
        ).catch(() => []);
        if (!batch || batch.length === 0) break;
        allMsgs = allMsgs.concat(batch);
        if (batch.length < MSG_PAGE) break;
        msgPage++;
      }

      for (const m of allMsgs) {
        // CLIENT-SIDE TRUTHY CHECK: catches boolean true, 1, "true", "1", etc.
        const isNarrativeTruthy = m.is_narrative === true ||
          m.is_narrative === 1 ||
          m.is_narrative === '1' ||
          m.is_narrative === 'true' ||
          (m.is_narrative && typeof m.is_narrative === 'object');

        if (!isNarrativeTruthy) continue;

        // RELOCATION ELIGIBILITY:
        // - is_narrative must be truthy (checked above)
        // - Must have a character_id (identifies owner)
        // - sender_character_id and receiver_character_id must be null (not a valid bilateral WP msg)
        // - Must not already be canon_excluded (already remediated)
        if (!m.character_id) {
          console.log(`[relocate] SKIP msg ${m.id} — no character_id (is_narrative=${JSON.stringify(m.is_narrative)})`);
          continue;
        }
        if (m.sender_character_id || m.receiver_character_id) {
          console.log(`[relocate] SKIP msg ${m.id} — bilateral (valid WP message)`);
          continue;
        }
        if (m.canon_excluded === true) {
          console.log(`[relocate] SKIP msg ${m.id} — already canon_excluded`);
          continue;
        }

        console.log(`[relocate] ELIGIBLE: msg ${m.id} | char=${m.character_name} | is_narrative=${JSON.stringify(m.is_narrative)} (type=${typeof m.is_narrative})`);
        contaminatedMessages.push({ msg: m, convo });
      }
    }

    proof.contaminated_messages_found = contaminatedMessages.length;
    console.log(`[relocateWorldPhoneNarrativeContamination] Found ${contaminatedMessages.length} eligible contaminated messages`);

    if (contaminatedMessages.length === 0) {
      proof.summary = 'No eligible contaminated narrative messages found — World Phone is clean.';
      return Response.json({ success: true, proof });
    }

    // ── STEP 3: RELOCATE EACH MESSAGE ───────────────────────────────────────
    for (const { msg, convo } of contaminatedMessages) {
      const record = {
        original_msg_id: msg.id,
        original_convo_id: convo.id,
        original_convo_channel: convo.channel,
        character_id: msg.character_id,
        character_name: msg.character_name,
        content_preview: (msg.content || '').substring(0, 100),
        original_timestamp: msg.timestamp,
        idempotency_key: `reloc::${msg.id}`,
        relocation_status: null,
        destination_convo_id: null,
        new_msg_id: null,
        wp_copy_excluded: false,
        error: null,
      };

      proof.relocations_attempted++;

      try {
        // ── IDEMPOTENCY: Check if this message was already relocated ──────────
        const existingRelocation = await base44.asServiceRole.entities.Message.filter(
          { idempotency_key: record.idempotency_key }, null, 1
        ).catch(() => []);

        if (existingRelocation.length > 0) {
          record.relocation_status = 'already_relocated';
          record.new_msg_id = existingRelocation[0].id;
          record.destination_convo_id = existingRelocation[0].conversation_id;
          proof.relocations_skipped_already_done++;
          console.log(`[relocate] ALREADY DONE: msg ${msg.id} → ${existingRelocation[0].id}`);
          proof.records.push(record);
          continue;
        }

        // ── FIND THE CORRECT DESTINATION CONVERSATION ─────────────────────
        // The owning character's direct user↔character chat:
        //   type: 'direct', character_ids includes character_id, channel != 'world_phone', owner_email matches
        const ownerEmailForChar = convo.owner_email;

        let destinationConvo = null;

        // First try: find existing direct (non-world_phone) conversation for this character + owner
        // Retry on 429 up to 3 times with increasing back-off
        let candidateConvos = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            candidateConvos = await base44.asServiceRole.entities.Conversation.filter(
              { type: 'direct', owner_email: ownerEmailForChar }, '-last_message_date', 50
            );
            break; // success
          } catch (e) {
            if (e.message?.includes('429') || e.message?.includes('Rate limit')) {
              const delay = (attempt + 1) * 2000; // 2s, 4s, 6s
              console.log(`[relocate] 429 on convo lookup, retrying in ${delay}ms (attempt ${attempt + 1})`);
              await new Promise(r => setTimeout(r, delay));
            } else throw e;
          }
        }

        const validDirect = candidateConvos.filter(c =>
          Array.isArray(c.character_ids) &&
          c.character_ids.includes(msg.character_id) &&
          c.channel !== 'world_phone'
        );

        if (validDirect.length > 0) {
          destinationConvo = validDirect[0];
          console.log(`[relocate] Found direct convo for ${msg.character_name}: ${destinationConvo.id}`);
        } else {
          // No direct conversation exists — create one
          if (!dryRun) {
            // Fetch the character record to build the conversation properly
            const charList = await base44.asServiceRole.entities.Character.filter(
              { id: msg.character_id }, null, 1
            ).catch(() => []);
            const character = charList[0];

            destinationConvo = await base44.asServiceRole.entities.Conversation.create({
              title: msg.character_name || 'Character',
              type: 'direct',
              character_ids: [msg.character_id],
              owner_email: ownerEmailForChar,
              channel: 'direct',
            });
            console.log(`[relocate] Created new direct convo for ${msg.character_name}: ${destinationConvo.id}`);
          } else {
            record.relocation_status = 'dry_run_would_create_convo';
            record.destination_convo_id = 'would_be_created';
            proof.records.push(record);
            continue;
          }
        }

        record.destination_convo_id = destinationConvo.id;

        if (dryRun) {
          record.relocation_status = 'dry_run_would_relocate';
          proof.records.push(record);
          continue;
        }

        // ── STEP 4: COPY THE NARRATIVE TO THE CORRECT DESTINATION ────────────
        // Preserve: content, character_id, is_narrative, timestamp, source metadata
        const newMsg = await base44.asServiceRole.entities.Message.create({
          conversation_id: destinationConvo.id,
          sender_type: 'character',
          character_id: msg.character_id,
          character_name: msg.character_name,
          content: msg.content,
          is_narrative: true,
          is_read: false,
          timestamp: msg.timestamp || new Date().toISOString(),
          channel: 'direct',
          // Audit metadata
          idempotency_key: record.idempotency_key,
          autonomy_marker: `relocated_from_world_phone::${msg.id}::${convo.id}`,
          memory_eligible: msg.memory_eligible !== false,
          relationship_eligible: false, // Don't re-trigger relationship scoring
          recovery_signal: false,
        });

        record.new_msg_id = newMsg.id;
        proof.relocations_succeeded++;
        console.log(`[relocate] ✓ RELOCATED: ${msg.id} → ${newMsg.id} in convo ${destinationConvo.id}`);

        // ── STEP 5: MARK ORIGINAL AS CANON_EXCLUDED IN WORLD PHONE ───────────
        // We mark it canon_excluded so it's hidden from display without deleting the record.
        // This preserves audit trail while removing it from the World Phone view.
        await base44.asServiceRole.entities.Message.update(msg.id, {
          canon_excluded: true,
          canon_exclusion_reason: 'world_phone_narrative_contamination',
          canon_excluded_at: new Date().toISOString(),
        });

        record.wp_copy_excluded = true;
        proof.world_phone_copies_excluded++;
        console.log(`[relocate] ✓ EXCLUDED from WP: ${msg.id}`);

        // ── UPDATE DESTINATION CONVERSATION PREVIEW ───────────────────────
        await base44.asServiceRole.entities.Conversation.update(destinationConvo.id, {
          last_message_preview: (msg.content || '').substring(0, 100),
          last_message_date: msg.timestamp || new Date().toISOString(),
        }).catch(() => {});

        record.relocation_status = 'relocated_and_excluded';

      } catch (err) {
        record.relocation_status = 'error';
        record.error = err.message;
        proof.errors.push({ msg_id: msg.id, error: err.message });
        console.error(`[relocate] ERROR for msg ${msg.id}: ${err.message}`);
      }

      proof.records.push(record);
    }

    // ── STEP 6: FINAL VERIFICATION ──────────────────────────────────────────
    if (!dryRun) {
      // Verify no remaining non-excluded narrative messages in world_phone convos
      // Uses same client-side truthy detection — NOT { is_narrative: true } DB filter
      let remainingContamination = 0;
      for (const convo of wpConvos) {
        const remaining = await withRetry(() =>
          base44.asServiceRole.entities.Message.filter(
            { conversation_id: convo.id }, '-timestamp', 100
          )
        ).catch(() => []);
        const unexcluded = remaining.filter(m => {
          const isNarrativeTruthy = m.is_narrative === true || m.is_narrative === 1 ||
            m.is_narrative === '1' || m.is_narrative === 'true';
          return isNarrativeTruthy &&
            m.canon_excluded !== true &&
            m.character_id &&
            !m.sender_character_id &&
            !m.receiver_character_id;
        });
        remainingContamination += unexcluded.length;
      }
      proof.remaining_contamination_after_fix = remainingContamination;
      proof.world_phone_clean = remainingContamination === 0;
    }

    proof.summary = dryRun
      ? `DRY RUN: Would relocate ${proof.contaminated_messages_found} contaminated narrative(s) from World Phone to correct character direct conversations.`
      : `EXECUTED: ${proof.relocations_succeeded} narrative(s) relocated, ${proof.world_phone_copies_excluded} World Phone copies excluded. ${proof.remaining_contamination_after_fix} remaining contamination.`;

    console.log(`[relocateWorldPhoneNarrativeContamination] COMPLETE: ${proof.summary}`);
    return Response.json({ success: true, proof });

  } catch (error) {
    console.error('[relocateWorldPhoneNarrativeContamination] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});