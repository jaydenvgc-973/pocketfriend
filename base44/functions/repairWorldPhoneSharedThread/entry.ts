/**
 * repairWorldPhoneSharedThread
 *
 * Repairs split or legacy World Phone threads for a character pair into
 * one canonical shared conversation. Non-destructive: duplicate threads
 * are archived (sync_status: "merged"), never deleted.
 *
 * Payload:
 *   charIdA: string   — Character A's ID
 *   charIdB: string   — Character B's ID
 *   dryRun: boolean   — if true, report what WOULD happen without writing
 *
 * Steps:
 *   1. Compute canonical key
 *   2. Find ALL matching conversations (canonical, legacy key, participant IDs, character IDs, legacy titles)
 *   3. Choose canonical conversation (prefer existing canonical key → most messages → oldest)
 *   4. Upgrade canonical conversation fields
 *   5. Migrate messages from duplicate threads into canonical
 *   6. Backfill legacy messages in canonical (missing sender_character_id, shared_conversation_key, participant_character_ids)
 *   7. Archive duplicate conversations (sync_status: "merged", never deleted)
 *   8. Re-run diagnoseWorldPhoneThreadConvergence inline and return verdict
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { charIdA, charIdB, dryRun = true } = body;

    if (!charIdA || !charIdB) {
      return Response.json({ error: 'charIdA and charIdB are required' }, { status: 400 });
    }

    const log = [];
    const writes = [];
    const sorted = [charIdA, charIdB].sort();
    const canonicalKey = `world_phone::${sorted[0]}::${sorted[1]}`;
    const legacyKey = `bilateral_${sorted.join('_')}_world_phone`;
    const participantIds = sorted;

    // Legacy title patterns (both directions)
    const legacyTitleA = `npc_chat__${charIdA}__cid_${charIdB}`;
    const legacyTitleB = `npc_chat__${charIdB}__cid_${charIdA}`;
    const legacyTitleANoId = `npc_chat__${charIdA}__`;
    const legacyTitleBNoId = `npc_chat__${charIdB}__`;

    log.push(`[Repair] START | A=${charIdA.substring(0,8)} | B=${charIdB.substring(0,8)} | dryRun=${dryRun}`);
    log.push(`[Repair] canonical_key=${canonicalKey}`);

    // ── STEP 1: FETCH ALL CANDIDATE CONVERSATIONS ─────────────────────────────
    const [byCanonical, byLegacy, byParticipantA, byCharIdsA, byCharIdsB] = await Promise.all([
      base44.asServiceRole.entities.Conversation.filter({ shared_conversation_key: canonicalKey }, '-updated_date', 20).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ shared_conversation_key: legacyKey }, '-updated_date', 20).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ participant_character_ids: [charIdA] }, '-updated_date', 200).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ character_ids: [charIdA] }, '-updated_date', 200).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ character_ids: [charIdB] }, '-updated_date', 200).catch(() => []),
    ]);

    const seenIds = new Set();
    const allCandidates = [...byCanonical, ...byLegacy, ...byParticipantA, ...byCharIdsA, ...byCharIdsB].filter(c => {
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return true;
    });

    // ── STEP 2: FILTER TO RELEVANT CONVERSATIONS ──────────────────────────────
    // A conversation is relevant if it connects BOTH characters in any form
    const relevantConvos = allCandidates.filter(c => {
      const hasCanonical = c.shared_conversation_key === canonicalKey;
      const hasLegacy = c.shared_conversation_key === legacyKey;
      const hasParticipants = Array.isArray(c.participant_character_ids) &&
        [charIdA, charIdB].every(id => c.participant_character_ids.includes(id));
      const hasCharIds = Array.isArray(c.character_ids) &&
        [charIdA, charIdB].every(id => c.character_ids.includes(id));
      const hasLegacyTitle = c.title === legacyTitleA || c.title === legacyTitleB ||
        (c.title && (c.title.startsWith(legacyTitleANoId) || c.title.startsWith(legacyTitleBNoId)));
      return hasCanonical || hasLegacy || hasParticipants || hasCharIds || hasLegacyTitle;
    });

    log.push(`[Repair] Found ${relevantConvos.length} relevant conversation(s): ${relevantConvos.map(c => c.id.substring(0,8)).join(', ')}`);

    if (relevantConvos.length === 0) {
      return Response.json({
        verdict: 'NO_THREAD',
        message: 'No World Phone threads found for this pair — nothing to repair',
        canonical_key: canonicalKey,
        log,
      });
    }

    // ── STEP 3: CHOOSE CANONICAL CONVERSATION ────────────────────────────────
    // Priority: has canonical key → most messages → oldest created_date
    // Fetch message counts for all candidates
    const convoMessageCounts = await Promise.all(
      relevantConvos.map(async c => {
        const msgs = await base44.asServiceRole.entities.Message.filter(
          { conversation_id: c.id }, 'created_date', 500
        ).catch(() => []);
        return { convo: c, messages: msgs, count: msgs.length };
      })
    );

    // Sort: canonical key first, then by message count desc, then by created_date asc (oldest)
    convoMessageCounts.sort((a, b) => {
      const aIsCanonical = a.convo.shared_conversation_key === canonicalKey ? 1 : 0;
      const bIsCanonical = b.convo.shared_conversation_key === canonicalKey ? 1 : 0;
      if (aIsCanonical !== bIsCanonical) return bIsCanonical - aIsCanonical;
      if (b.count !== a.count) return b.count - a.count;
      return new Date(a.convo.created_date || 0) - new Date(b.convo.created_date || 0);
    });

    const canonicalEntry = convoMessageCounts[0];
    const canonicalConvo = canonicalEntry.convo;
    const duplicates = convoMessageCounts.slice(1);

    log.push(`[Repair] Canonical conversation chosen: id=${canonicalConvo.id.substring(0,8)} | messages=${canonicalEntry.count} | key=${canonicalConvo.shared_conversation_key || 'NONE'}`);
    duplicates.forEach(d => {
      log.push(`[Repair] Duplicate: id=${d.convo.id.substring(0,8)} | messages=${d.count} | key=${d.convo.shared_conversation_key || 'NONE'}`);
    });

    const repairActions = {
      canonical_conversation_id: canonicalConvo.id,
      canonical_upgrade: null,
      messages_migrated: 0,
      messages_backfilled: 0,
      duplicates_archived: [],
      errors: [],
    };

    // ── STEP 4: UPGRADE CANONICAL CONVERSATION ───────────────────────────────
    const canonicalNeedsUpgrade =
      canonicalConvo.shared_conversation_key !== canonicalKey ||
      !Array.isArray(canonicalConvo.participant_character_ids) ||
      !participantIds.every(id => canonicalConvo.participant_character_ids?.includes(id)) ||
      !Array.isArray(canonicalConvo.character_ids) ||
      !participantIds.every(id => canonicalConvo.character_ids?.includes(id)) ||
      canonicalConvo.channel !== 'world_phone';

    if (canonicalNeedsUpgrade) {
      const upgradePayload = {
        shared_conversation_key: canonicalKey,
        participant_character_ids: participantIds,
        character_ids: participantIds,
        channel: 'world_phone',
        sync_status: 'complete',
      };
      log.push(`[Repair] Upgrading canonical conversation ${canonicalConvo.id.substring(0,8)}`);
      repairActions.canonical_upgrade = upgradePayload;
      if (!dryRun) {
        await base44.asServiceRole.entities.Conversation.update(canonicalConvo.id, upgradePayload).catch(err => {
          repairActions.errors.push(`canonical upgrade failed: ${err.message}`);
        });
      }
    } else {
      log.push(`[Repair] Canonical conversation already correctly formed — no upgrade needed`);
    }

    // ── STEP 5: MIGRATE MESSAGES FROM DUPLICATES INTO CANONICAL ──────────────
    for (const dup of duplicates) {
      const dupMsgs = dup.messages;
      log.push(`[Repair] Migrating ${dupMsgs.length} messages from duplicate ${dup.convo.id.substring(0,8)} → canonical ${canonicalConvo.id.substring(0,8)}`);

      for (const msg of dupMsgs) {
        // Preserve all original fields; override conversation linkage + stamp canonical identity
        const inferredSenderCharId = msg.sender_character_id ||
          (msg.character_id === charIdA ? charIdA : msg.character_id === charIdB ? charIdB : null);
        const inferredReceiverCharId = msg.receiver_character_id ||
          (inferredSenderCharId === charIdA ? charIdB : inferredSenderCharId === charIdB ? charIdA : null);

        const migratedPayload = {
          conversation_id: canonicalConvo.id,
          sender_type: msg.sender_type || 'character',
          character_id: msg.character_id || null,
          character_name: msg.character_name || null,
          sender_character_id: inferredSenderCharId,
          receiver_character_id: inferredReceiverCharId,
          participant_character_ids: participantIds,
          shared_conversation_key: canonicalKey,
          content: msg.content || '',
          image_url: msg.image_url || undefined,
          audio_url: msg.audio_url || undefined,
          timestamp: msg.timestamp || msg.created_date || new Date().toISOString(),
          typed_by_user: msg.typed_by_user || false,
          user_operated: msg.user_operated || false,
          channel: 'world_phone',
          sync_status: 'complete',
          is_read: msg.is_read !== undefined ? msg.is_read : true,
          reactions: msg.reactions || undefined,
          emotional_state: msg.emotional_state || undefined,
          is_narrative: msg.is_narrative || false,
          generation_context: msg.generation_context || undefined,
          location_share: msg.location_share || undefined,
          money_transfer: msg.money_transfer || undefined,
          songs_heard: msg.songs_heard || undefined,
          videos_watched: msg.videos_watched || undefined,
        };

        // Strip undefined fields
        Object.keys(migratedPayload).forEach(k => {
          if (migratedPayload[k] === undefined) delete migratedPayload[k];
        });

        writes.push({ action: 'create_message', payload: migratedPayload });
        if (!dryRun) {
          await base44.asServiceRole.entities.Message.create(migratedPayload).catch(err => {
            repairActions.errors.push(`message migration failed for msg ${msg.id.substring(0,8)}: ${err.message}`);
          });
        }
        repairActions.messages_migrated++;
      }
    }

    // ── STEP 6: BACKFILL LEGACY MESSAGES IN CANONICAL ────────────────────────
    const canonicalMsgs = canonicalEntry.messages;
    let backfillCount = 0;
    for (const msg of canonicalMsgs) {
      const needsBackfill =
        !msg.shared_conversation_key ||
        !Array.isArray(msg.participant_character_ids) ||
        msg.participant_character_ids.length < 2 ||
        !msg.sender_character_id ||
        !msg.receiver_character_id ||
        msg.channel !== 'world_phone';

      if (!needsBackfill) continue;

      const inferredSenderCharId = msg.sender_character_id ||
        (msg.character_id === charIdA ? charIdA : msg.character_id === charIdB ? charIdB : null);
      const inferredReceiverCharId = msg.receiver_character_id ||
        (inferredSenderCharId === charIdA ? charIdB : inferredSenderCharId === charIdB ? charIdA : null);

      const backfillPayload = {
        shared_conversation_key: canonicalKey,
        participant_character_ids: participantIds,
        channel: 'world_phone',
        ...(inferredSenderCharId && !msg.sender_character_id ? { sender_character_id: inferredSenderCharId } : {}),
        ...(inferredReceiverCharId && !msg.receiver_character_id ? { receiver_character_id: inferredReceiverCharId } : {}),
      };

      writes.push({ action: 'backfill_message', id: msg.id, payload: backfillPayload });
      if (!dryRun) {
        await base44.asServiceRole.entities.Message.update(msg.id, backfillPayload).catch(err => {
          repairActions.errors.push(`backfill failed for msg ${msg.id.substring(0,8)}: ${err.message}`);
        });
      }
      backfillCount++;
    }
    repairActions.messages_backfilled = backfillCount;
    log.push(`[Repair] Backfilled ${backfillCount} legacy messages in canonical conversation`);

    // ── STEP 7: ARCHIVE DUPLICATE CONVERSATIONS ───────────────────────────────
    for (const dup of duplicates) {
      const archivePayload = {
        sync_status: 'merged',
        shared_conversation_key: canonicalKey,
        channel: 'world_phone',
        merged_into_conversation_id: canonicalConvo.id,
      };
      log.push(`[Repair] Archiving duplicate ${dup.convo.id.substring(0,8)} → merged_into=${canonicalConvo.id.substring(0,8)}`);
      repairActions.duplicates_archived.push({
        id: dup.convo.id,
        message_count: dup.count,
        archive_payload: archivePayload,
      });
      if (!dryRun) {
        await base44.asServiceRole.entities.Conversation.update(dup.convo.id, archivePayload).catch(err => {
          repairActions.errors.push(`archive failed for convo ${dup.convo.id.substring(0,8)}: ${err.message}`);
        });
      }
    }

    // ── STEP 8: POST-REPAIR CONVERGENCE VERIFICATION ─────────────────────────
    let postRepairVerdict = dryRun ? 'SKIPPED (dry run)' : null;
    let postRepairReport = null;

    if (!dryRun) {
      // Re-fetch after writes to verify convergence
      const [verifyCanonical, verifyByCharIdsA] = await Promise.all([
        base44.asServiceRole.entities.Conversation.filter({ shared_conversation_key: canonicalKey }, '-updated_date', 10).catch(() => []),
        base44.asServiceRole.entities.Conversation.filter({ character_ids: [charIdA] }, '-updated_date', 200).catch(() => []),
      ]);

      const verifySeenIds = new Set();
      const verifyCandidates = [...verifyCanonical, ...verifyByCharIdsA].filter(c => {
        if (verifySeenIds.has(c.id)) return false;
        verifySeenIds.add(c.id);
        return true;
      }).filter(c => c.sync_status !== 'merged');

      const resolveVerify = (ownerId, otherId) => {
        const found =
          verifyCandidates.find(c => c.shared_conversation_key === canonicalKey) ||
          verifyCandidates.find(c =>
            Array.isArray(c.participant_character_ids) &&
            [ownerId, otherId].every(id => c.participant_character_ids.includes(id))
          ) ||
          verifyCandidates.find(c =>
            Array.isArray(c.character_ids) &&
            [ownerId, otherId].every(id => c.character_ids.includes(id))
          );
        return found?.id || null;
      };

      const verifyAtoB = resolveVerify(charIdA, charIdB);
      const verifyBtoA = resolveVerify(charIdB, charIdA);
      const sameConvo = verifyAtoB && verifyAtoB === verifyBtoA && verifyAtoB === canonicalConvo.id;
      postRepairVerdict = sameConvo ? 'PASS' : 'FAIL';
      postRepairReport = {
        A_to_B: verifyAtoB,
        B_to_A: verifyBtoA,
        same_conversation: sameConvo,
        expected_conversation_id: canonicalConvo.id,
      };
      log.push(`[Repair] Post-repair verification: VERDICT=${postRepairVerdict} | A→B=${verifyAtoB?.substring(0,8)} | B→A=${verifyBtoA?.substring(0,8)}`);
    }

    const summary = {
      dryRun,
      verdict: dryRun ? 'DRY_RUN' : (postRepairVerdict === 'PASS' ? 'PASS' : 'FAIL'),
      canonical_key: canonicalKey,
      canonical_conversation_id: canonicalConvo.id,
      total_relevant_conversations: relevantConvos.length,
      duplicates_found: duplicates.length,
      repair_actions: repairActions,
      post_repair_verification: postRepairReport,
      planned_writes: dryRun ? writes.length : null,
      log,
    };

    console.log(`[RepairWorldPhone] DONE | dryRun=${dryRun} | verdict=${summary.verdict} | migrated=${repairActions.messages_migrated} | backfilled=${repairActions.messages_backfilled} | archived=${duplicates.length}`);

    return Response.json(summary);
  } catch (error) {
    console.error('[RepairWorldPhone] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});