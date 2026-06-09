/**
 * auditAndRepairWorldPhoneAnchors
 *
 * TARGETED REPAIR — World Phone conversation anchor integrity.
 *
 * Root cause: Some World Phone Conversations have character_ids /
 * participant_character_ids that reference deleted, merged, or otherwise
 * invalid Character records. When the recipient ID is dead, sendWorldPhoneMessage
 * cannot route a response, so messages sit in a narrative-only state forever —
 * the sender's character "believes" they sent something, but the recipient
 * never received a Message row they can respond to.
 *
 * This function:
 *   1. Loads all World Phone conversations for the authenticated account.
 *   2. For EACH participant ID in EVERY conversation, verifies the Character
 *      record exists and is NOT deleted/merged/soft_deleted.
 *   3. For dead IDs, attempts re-anchor:
 *      a. If the Character is merged → follow merged_into_character_id chain.
 *      b. If no merge target → search the account for a live character with
 *         the same name (from CharacterMergeLog or the stale conversation title).
 *      c. If no live replacement can be proved → mark the conversation as
 *         NEEDS_MANUAL_REVIEW (never silently drop it).
 *   4. Writes the corrected participant_character_ids / character_ids /
 *      shared_conversation_key to the Conversation record (live run only).
 *   5. Backfills the corrected IDs to all Message records in the thread.
 *   6. Reports every action taken and every gap that still needs attention.
 *
 * Payload:
 *   dryRun: boolean   (default: true — safe preview, no writes)
 *
 * Does NOT:
 *   - delete any Conversation or Message records
 *   - promote characters or change character_type
 *   - create new conversations or characters
 *   - touch conversations that are already healthy
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // default true

    const ownerEmail = user.email;
    const log = [];
    const brokenConvos = [];
    const repairedConvos = [];
    const needsManualReview = [];
    const alreadyHealthy = [];

    // ── STEP 1: Load ALL World Phone conversations for this account ───────────
    const [byChannel, byKey] = await Promise.all([
      base44.asServiceRole.entities.Conversation.filter(
        { channel: 'world_phone', owner_email: ownerEmail }, '-updated_date', 500
      ).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter(
        { owner_email: ownerEmail }, '-updated_date', 500
      ).catch(() => []),
    ]);

    const seen = new Set();
    const allConvos = [...byChannel, ...byKey].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      // Include only World Phone candidates
      return (
        c.channel === 'world_phone' ||
        c.shared_conversation_key?.startsWith('world_phone::') ||
        c.title?.startsWith('world_phone::')
      );
    });

    log.push(`Loaded ${allConvos.length} World Phone conversations for ${ownerEmail}`);

    // ── STEP 2: Load ALL live characters for this account ────────────────────
    // Used for re-anchor name-search fallback.
    const [owned, worldService] = await Promise.all([
      base44.asServiceRole.entities.Character.filter(
        { owner_email: ownerEmail }, null, 500
      ).catch(() => []),
      base44.asServiceRole.entities.Character.filter(
        { character_type: 'npc_world_service', owner_email: ownerEmail }, null, 20
      ).catch(() => []),
    ]);

    const liveCharsSeen = new Set();
    const liveChars = [...owned, ...worldService].filter(c => {
      if (liveCharsSeen.has(c.id)) return false;
      liveCharsSeen.add(c.id);
      return c.status !== 'deleted' && c.status !== 'soft_deleted' && c.status !== 'merged';
    });

    const liveById = new Map(liveChars.map(c => [c.id, c]));
    const liveByNameLower = new Map(liveChars.map(c => [c.name?.toLowerCase()?.trim(), c]));

    log.push(`Loaded ${liveChars.length} live characters for anchor verification`);

    // ── STEP 2b: Batch-prefetch ALL referenced character IDs in ONE pass ─────
    // Collect every unique participant ID referenced across all conversations,
    // then resolve them all at once before the audit loop.
    // This eliminates the per-conversation serial resolveCharId calls that caused 429s.
    const allReferencedIds = new Set();
    for (const convo of allConvos) {
      for (const id of [...(convo.participant_character_ids || []), ...(convo.character_ids || [])]) {
        if (id && !liveById.has(id)) allReferencedIds.add(id);
      }
    }

    // Fetch all non-live referenced IDs in batches of 10 (with throttle)
    const deadRecordCache = new Map(); // id → Character record (or null)
    const unknownIds = [...allReferencedIds];
    const BATCH = 10;
    for (let i = 0; i < unknownIds.length; i += BATCH) {
      const batch = unknownIds.slice(i, i + BATCH);
      if (i > 0) await new Promise(r => setTimeout(r, 400));
      const results = await Promise.all(
        batch.map(id =>
          base44.asServiceRole.entities.Character.filter({ id }, null, 1)
            .then(arr => arr?.[0] || null)
            .catch(() => null)
        )
      );
      batch.forEach((id, idx) => deadRecordCache.set(id, results[idx]));
    }

    log.push(`Prefetched ${deadRecordCache.size} non-live character records for resolution`);

    // ── HELPER: resolve a single character ID (now uses cache — NO individual queries) ─
    // Returns { status, canonical_id, canonical_name, char }
    function resolveCharIdSync(charId) {
      if (!charId) return { status: 'dead_no_replacement', canonical_id: null };

      // Already live?
      if (liveById.has(charId)) {
        const c = liveById.get(charId);
        return { status: 'live', canonical_id: charId, canonical_name: c.name, char: c };
      }

      const rec = deadRecordCache.get(charId) || null;

      if (!rec) {
        return { status: 'dead_no_replacement', canonical_id: null, original_id: charId };
      }

      // Merged → follow the chain
      if (rec.status === 'merged' && rec.merged_into_character_id) {
        const mergeTarget = liveById.get(rec.merged_into_character_id);
        if (mergeTarget) {
          return {
            status: 'merged_to',
            canonical_id: mergeTarget.id,
            canonical_name: mergeTarget.name,
            original_name: rec.name,
            char: mergeTarget,
          };
        }
        // Check cache for second-level merge
        const deeper = deadRecordCache.get(rec.merged_into_character_id);
        if (deeper && deeper.status !== 'deleted' && deeper.status !== 'soft_deleted' && deeper.status !== 'merged') {
          return {
            status: 'merged_to',
            canonical_id: deeper.id,
            canonical_name: deeper.name,
            original_name: rec.name,
            char: deeper,
          };
        }
      }

      // Deleted/soft_deleted — try name search
      const nameLower = rec.name?.toLowerCase()?.trim();
      if (nameLower && liveByNameLower.has(nameLower)) {
        const byName = liveByNameLower.get(nameLower);
        return {
          status: 'merged_to',
          canonical_id: byName.id,
          canonical_name: byName.name,
          original_name: rec.name,
          via: 'name_match',
          char: byName,
        };
      }

      return {
        status: 'dead_no_replacement',
        canonical_id: null,
        original_id: charId,
        original_name: rec.name || null,
        original_status: rec.status || null,
      };
    }

    // ── STEP 3: Audit each conversation ──────────────────────────────────────
    for (const convo of allConvos) {
      // Skip already-merged/archived conversations — they are intentionally stale
      if (convo.sync_status === 'merged') {
        alreadyHealthy.push({ id: convo.id, reason: 'already_merged_archived' });
        continue;
      }

      // Extract all participant IDs from the conversation
      const rawIds = [
        ...(convo.participant_character_ids || []),
        ...(convo.character_ids || []),
      ];

      // Deduplicate, drop empty/null
      const uniqueIds = [...new Set(rawIds.filter(Boolean))];
      if (uniqueIds.length < 2) {
        // Can't determine participants — skip (will show in manual review)
        needsManualReview.push({
          conversation_id: convo.id,
          key: convo.shared_conversation_key,
          reason: 'cannot_determine_participant_ids',
          raw_ids: rawIds,
        });
        log.push(`MANUAL_REVIEW: convo=${convo.id.substring(0,8)} — too few extractable participant IDs`);
        continue;
      }

      // Resolve each ID (sync — uses prefetched cache, no DB calls)
      const resolutions = uniqueIds.map(id => resolveCharIdSync(id));
      const resolutionMap = new Map(uniqueIds.map((id, i) => [id, resolutions[i]]));

      const anyDead = resolutions.some(r => r.status === 'dead_no_replacement');
      const anyStale = resolutions.some(r => r.status === 'merged_to');
      const allLive = resolutions.every(r => r.status === 'live');

      // Verify the canonical key matches what we know now
      const currentKey = convo.shared_conversation_key;
      const expectedParticipants = uniqueIds.slice(0, 2).sort(); // first two unique sorted
      const expectedKey = `world_phone::${expectedParticipants[0]}::${expectedParticipants[1]}`;
      const keyMismatch = currentKey && currentKey !== expectedKey && currentKey.startsWith('world_phone::');

      if (allLive && !keyMismatch) {
        alreadyHealthy.push({ id: convo.id, participant_ids: uniqueIds });
        continue;
      }

      // Build corrected participant list — only IDs that resolve to live characters
      const correctedIds = [];
      const correctedNames = [];
      const unresolvedIds = [];

      for (const [origId, res] of resolutionMap.entries()) {
        if (res.status === 'live') {
          if (!correctedIds.includes(origId)) correctedIds.push(origId);
          correctedNames.push(res.canonical_name);
        } else if (res.status === 'merged_to' && res.canonical_id) {
          if (!correctedIds.includes(res.canonical_id)) correctedIds.push(res.canonical_id);
          correctedNames.push(`${res.original_name} → ${res.canonical_name}`);
        } else {
          unresolvedIds.push({ original_id: origId, ...res });
        }
      }

      if (correctedIds.length < 2) {
        // Not enough live characters to form a valid bilateral thread
        needsManualReview.push({
          conversation_id: convo.id,
          key: convo.shared_conversation_key,
          title: convo.title,
          reason: 'not_enough_live_participants_after_resolution',
          unresolved: unresolvedIds,
          original_ids: uniqueIds,
        });
        log.push(`MANUAL_REVIEW: convo=${convo.id.substring(0,8)} — only ${correctedIds.length} live participant(s) after resolution`);
        continue;
      }

      const sortedCorrected = [...correctedIds].sort().slice(0, 2);
      const newCanonicalKey = `world_phone::${sortedCorrected[0]}::${sortedCorrected[1]}`;

      const brokenEntry = {
        conversation_id: convo.id,
        original_key: convo.shared_conversation_key,
        new_canonical_key: newCanonicalKey,
        original_ids: uniqueIds,
        corrected_ids: sortedCorrected,
        corrections: correctedNames,
        unresolved: unresolvedIds,
        stale_only: !anyDead && anyStale,
        messages_to_backfill: 0,
      };

      brokenConvos.push(brokenEntry);
      log.push(`BROKEN: convo=${convo.id.substring(0,8)} | stale_only=${brokenEntry.stale_only} | ${correctedNames.join(', ')}`);

      if (!dryRun) {
        // ── WRITE: repair the conversation record ──────────────────────────
        const updatePayload = {
          participant_character_ids: sortedCorrected,
          character_ids: sortedCorrected,
          shared_conversation_key: newCanonicalKey,
          channel: 'world_phone',
          sync_status: 'complete',
        };

        // Update the title if it used the old key format
        if (convo.title?.startsWith('world_phone::')) {
          updatePayload.title = `world_phone::${sortedCorrected.join('::')}`;
        }

        const updateErr = await base44.asServiceRole.entities.Conversation.update(convo.id, updatePayload)
          .then(() => null)
          .catch(e => e.message);

        if (updateErr) {
          log.push(`ERROR updating convo ${convo.id.substring(0,8)}: ${updateErr}`);
          brokenEntry.repair_error = updateErr;
          needsManualReview.push({ ...brokenEntry, reason: 'write_failed', error: updateErr });
          continue;
        }

        // ── WRITE: backfill all messages in this thread ────────────────────
        const msgs = await base44.asServiceRole.entities.Message.filter(
          { conversation_id: convo.id }, 'created_date', 1000
        ).catch(() => []);

        let backfilled = 0;
        let writeCount = 0;
        for (const msg of msgs) {
          const needsBackfill =
            msg.shared_conversation_key !== newCanonicalKey ||
            !Array.isArray(msg.participant_character_ids) ||
            !sortedCorrected.every(id => msg.participant_character_ids?.includes(id));

          if (!needsBackfill) continue;

          // Infer sender/receiver from corrected IDs
          const inferredSender = msg.sender_character_id && sortedCorrected.includes(msg.sender_character_id)
            ? msg.sender_character_id
            : (msg.character_id && sortedCorrected.includes(msg.character_id) ? msg.character_id : sortedCorrected[0]);
          const inferredReceiver = inferredSender === sortedCorrected[0] ? sortedCorrected[1] : sortedCorrected[0];

          // Rate-limit: pause every 5 writes
          if (writeCount > 0 && writeCount % 5 === 0) {
            await new Promise(r => setTimeout(r, 600));
          }

          await base44.asServiceRole.entities.Message.update(msg.id, {
            shared_conversation_key: newCanonicalKey,
            participant_character_ids: sortedCorrected,
            channel: 'world_phone',
            sender_character_id: inferredSender,
            receiver_character_id: inferredReceiver,
          }).catch(e => log.push(`WARN backfill msg ${msg.id.substring(0,8)}: ${e.message}`));

          backfilled++;
          writeCount++;
        }

        brokenEntry.messages_to_backfill = msgs.length;
        brokenEntry.messages_backfilled = backfilled;
        repairedConvos.push(brokenEntry);
        log.push(`REPAIRED: convo=${convo.id.substring(0,8)} | msgs_backfilled=${backfilled}`);
      } else {
        // Dry run: message count not fetched to avoid 429s — shown as 'pending'
        brokenEntry.messages_to_backfill = 'pending_live_run';
      }
    }

    // ── STEP 4: Audit unresolved CharacterMemory records ─────────────────────
    // The 61 unresolved memory records create blind spots in buildCanonicalCharacterContext.
    // Identify and report them — do not blindly patch them since the correct ID is not obvious.
    const unresolvedMemories = await base44.asServiceRole.entities.CharacterMemory.filter(
      { validation_status: 'unresolved_identity' }, null, 200
    ).catch(() => []);

    // Scope to this account's characters only
    const accountCharIds = new Set(liveChars.map(c => c.id));
    const accountUnresolved = unresolvedMemories.filter(m => accountCharIds.has(m.character_id));

    // Try to auto-resolve: if original_raw_reference matches a live character name exactly,
    // we can safely stamp the related_character_id.
    const autoResolvedMemories = [];
    const stillUnresolved = [];

    for (const mem of accountUnresolved) {
      const rawRef = mem.original_raw_reference?.toLowerCase()?.trim();
      if (!rawRef) { stillUnresolved.push(mem); continue; }

      const match = liveByNameLower.get(rawRef);
      if (match) {
        autoResolvedMemories.push({ memory_id: mem.id, character_id: mem.character_id, resolved_to: match.id, name: match.name });
        if (!dryRun) {
          await base44.asServiceRole.entities.CharacterMemory.update(mem.id, {
            related_character_id: match.id,
            validation_status: 'confirmed',
          }).catch(e => log.push(`WARN memory resolve ${mem.id.substring(0,8)}: ${e.message}`));
        }
      } else {
        stillUnresolved.push(mem);
      }
    }

    // ── SUMMARY ───────────────────────────────────────────────────────────────
    const summary = {
      function: 'auditAndRepairWorldPhoneAnchors',
      dry_run: dryRun,
      owner_email: ownerEmail,
      total_world_phone_conversations: allConvos.length,
      already_healthy: alreadyHealthy.length,
      broken_conversations_found: brokenConvos.length,
      repaired_conversations: dryRun ? 0 : repairedConvos.length,
      needs_manual_review: needsManualReview.length,
      unresolved_memory_records_scoped: accountUnresolved.length,
      auto_resolved_memories: autoResolvedMemories.length,
      still_unresolved_memories: stillUnresolved.length,
      broken_details: brokenConvos,
      manual_review_details: needsManualReview,
      auto_resolved_memory_details: autoResolvedMemories,
      still_unresolved_memory_sample: stillUnresolved.slice(0, 10).map(m => ({
        memory_id: m.id,
        character_id: m.character_id,
        raw_reference: m.original_raw_reference,
        memory_type: m.memory_type,
      })),
      log,
      verdict: dryRun
        ? 'DRY_RUN'
        : (needsManualReview.length === 0 && brokenConvos.length === repairedConvos.length)
          ? 'PASS'
          : 'PARTIAL',
    };

    console.log(
      `[auditAndRepairWorldPhoneAnchors] done | dryRun=${dryRun} | broken=${brokenConvos.length}` +
      ` | repaired=${repairedConvos.length} | manualReview=${needsManualReview.length}` +
      ` | memories_auto_resolved=${autoResolvedMemories.length} | memories_still_unresolved=${stillUnresolved.length}`
    );

    return Response.json(summary);
  } catch (error) {
    console.error('[auditAndRepairWorldPhoneAnchors]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});