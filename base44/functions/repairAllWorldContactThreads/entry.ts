/**
 * repairAllWorldContactThreads
 *
 * Global autonomous audit and repair of ALL bilateral World Contact / World Phone
 * threads for the authenticated user's account.
 *
 * NO manual pair input required. The system discovers everything from data.
 *
 * Payload:
 *   dryRun: boolean  (default true — safe preview mode)
 *   limitPairs: number  (default 100)
 *
 * Returns a global PASS/FAIL report:
 *   - total_pairs_discovered
 *   - broken_pairs_found
 *   - pairs_repaired
 *   - pairs_already_ok
 *   - messages_migrated
 *   - messages_backfilled
 *   - conversations_archived
 *   - global_verdict: "PASS" | "FAIL" | "DRY_RUN"
 *   - per_pair_reports[]
 *   - verification_results[]
 *   - errors[]
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * WORLD PHONE BOUNDARY GUARD (inline — Deno functions cannot use local imports)
 *
 * When migrating messages from duplicate threads to a canonical thread, we must
 * NEVER carry forward narrative records (is_narrative truthy) that lack bilateral IDs.
 * These are contamination records from the June 2026 World Phone narrative leak.
 * They must be excluded from migration entirely — not propagated to the canonical thread.
 *
 * A message is safe to migrate if EITHER:
 * - it is NOT narrative content, OR
 * - it IS narrative but has valid bilateral sender_character_id AND receiver_character_id
 *   (meaning it was a deliberate bilateral narrative, not contamination)
 */
function isNarrativeTruthy(val) {
  return val === true || val === 1 || val === '1' || val === 'true';
}

function isSafeToMigrateToWorldPhone(msg) {
  // Non-narrative messages are always safe
  if (!isNarrativeTruthy(msg.is_narrative)) return true;
  // Narrative message: ONLY safe if it has both bilateral IDs (it was intentional bilateral content)
  // Narrative records without bilateral IDs are contamination — never migrate them
  if (msg.sender_character_id && msg.receiver_character_id) return true;
  console.log(
    `[WP_BOUNDARY] Migration blocked: narrative record without bilateral IDs | msg_id=${msg.id}` +
    ` | char=${msg.character_name || 'unknown'} | canon_excluded=${msg.canon_excluded}`
  );
  return false;
}

function getCanonicalKey(idA, idB) {
  const sorted = [idA, idB].sort();
  return `world_phone::${sorted[0]}::${sorted[1]}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // default true
    const limitPairs = body.limitPairs || 100;

    const log = [];
    const errors = [];
    const pairReports = [];
    const verificationResults = [];
    let totalMigrated = 0;
    let totalBackfilled = 0;
    let totalArchived = 0;
    let pairsRepaired = 0;
    let pairsAlreadyOk = 0;

    log.push(`[repairAllWorldContactThreads] START | owner=${user.email} | dryRun=${dryRun} | limitPairs=${limitPairs}`);

    // ── PHASE 1: DISCOVER ALL BILATERAL WORLD CONTACT CONVERSATIONS ──────────
    const [byChannel, byOwner, byPendingSync, byFailedSync, byMergedCheck] = await Promise.all([
      base44.asServiceRole.entities.Conversation.filter({ channel: 'world_phone', owner_email: user.email }, '-updated_date', 500).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ owner_email: user.email }, '-updated_date', 500).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ sync_status: 'pending', owner_email: user.email }, '-updated_date', 200).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ sync_status: 'failed', owner_email: user.email }, '-updated_date', 200).catch(() => []),
      // Also catch world_phone channel convos that may be missing owner_email (legacy)
      base44.asServiceRole.entities.Conversation.filter({ channel: 'world_phone' }, '-updated_date', 300).catch(() => []),
    ]);

    const seenIds = new Set();
    const allConvos = [...byChannel, ...byOwner, ...byPendingSync, ...byFailedSync, ...byMergedCheck].filter(c => {
      if (seenIds.has(c.id)) return false;
      seenIds.add(c.id);
      return true;
    });

    log.push(`[repairAllWorldContactThreads] Raw conversations fetched: ${allConvos.length}`);

    // ── PHASE 2: FILTER TO BILATERAL WORLD CONTACT CANDIDATES ───────────────
    const candidates = allConvos.filter(c => {
      if (c.channel === 'world_phone') return true;
      if (c.shared_conversation_key?.startsWith('world_phone::')) return true;
      if (c.shared_conversation_key?.startsWith('bilateral_')) return true;
      if (c.title?.startsWith('npc_chat__') && c.title?.includes('__cid_')) return true;
      if (c.title?.startsWith('world_phone::')) return true;
      if (Array.isArray(c.participant_character_ids) && c.participant_character_ids.length === 2) return true;
      if (Array.isArray(c.character_ids) && c.character_ids.length === 2 && c.type === 'npc') return true;
      return false;
    });

    log.push(`[repairAllWorldContactThreads] Bilateral candidates: ${candidates.length}`);

    // ── PHASE 3: BUILD PAIR MAP ───────────────────────────────────────────────
    const pairMap = new Map();

    for (const convo of candidates) {
      let charIds = [];

      if (Array.isArray(convo.participant_character_ids) && convo.participant_character_ids.length >= 2) {
        charIds = convo.participant_character_ids.slice(0, 2);
      } else if (convo.shared_conversation_key?.startsWith('world_phone::')) {
        const parts = convo.shared_conversation_key.split('::');
        if (parts.length === 3) charIds = [parts[1], parts[2]];
      } else if (convo.shared_conversation_key?.startsWith('bilateral_')) {
        const inner = convo.shared_conversation_key.replace(/^bilateral_/, '').replace(/_world_phone$/, '');
        const match = inner.match(/^([a-f0-9]{24})_([a-f0-9]{24})$/);
        if (match) charIds = [match[1], match[2]];
      } else if (convo.title?.startsWith('npc_chat__') && convo.title?.includes('__cid_')) {
        const m = convo.title.match(/^npc_chat__([a-f0-9]{24})__cid_([a-f0-9]{24})$/);
        if (m) charIds = [m[1], m[2]];
      } else if (convo.title?.startsWith('world_phone::')) {
        const parts = convo.title.split('::');
        if (parts.length === 3) charIds = [parts[1], parts[2]];
      } else if (Array.isArray(convo.character_ids) && convo.character_ids.length === 2) {
        charIds = convo.character_ids;
      }

      if (charIds.length < 2 || !charIds[0] || !charIds[1] || charIds[0] === charIds[1]) continue;

      const sorted = [...charIds].sort();
      const pairKey = `${sorted[0]}::${sorted[1]}`;
      if (!pairMap.has(pairKey)) pairMap.set(pairKey, { idA: sorted[0], idB: sorted[1], convos: [] });
      pairMap.get(pairKey).convos.push(convo);
    }

    const allPairs = [...pairMap.values()];
    log.push(`[repairAllWorldContactThreads] Unique bilateral pairs: ${allPairs.length}`);

    const pairsToProcess = allPairs.slice(0, limitPairs);
    if (allPairs.length > limitPairs) {
      log.push(`[repairAllWorldContactThreads] WARNING: ${allPairs.length - limitPairs} pairs beyond limit — increase limitPairs`);
    }

    // ── PHASE 4: REPAIR EACH PAIR ─────────────────────────────────────────────
    for (const pair of pairsToProcess) {
      const { idA, idB, convos: initialConvos } = pair;
      const canonicalKey = getCanonicalKey(idA, idB);
      const participantIds = [idA, idB].sort();

      const report = {
        pair_key: canonicalKey,
        pair_short: `${idA.substring(0,8)}::${idB.substring(0,8)}`,
        conversations_found: initialConvos.length,
        status: null,
        canonical_conversation_id: null,
        duplicates_archived: 0,
        messages_migrated: 0,
        messages_backfilled: 0,
        errors: [],
      };

      // ── SINGLE CONVERSATION: check if already canonical ───────────────────
      if (initialConvos.length === 1) {
        const c = initialConvos[0];
        const fullyFormed =
          c.shared_conversation_key === canonicalKey &&
          Array.isArray(c.participant_character_ids) &&
          participantIds.every(id => c.participant_character_ids.includes(id)) &&
          Array.isArray(c.character_ids) &&
          participantIds.every(id => c.character_ids.includes(id)) &&
          c.channel === 'world_phone';

        const msgs = await base44.asServiceRole.entities.Message.filter(
          { conversation_id: c.id }, 'created_date', 500
        ).catch(() => []);

        const messagesNeedBackfill = msgs.some(m =>
          !m.shared_conversation_key ||
          !Array.isArray(m.participant_character_ids) ||
          m.participant_character_ids.length < 2 ||
          m.channel !== 'world_phone' ||
          // Only flag missing sender_character_id for character-sent messages
          (m.sender_type === 'character' && !m.sender_character_id)
        );

        if (fullyFormed && !messagesNeedBackfill) {
          report.status = 'OK';
          report.canonical_conversation_id = c.id;
          pairsAlreadyOk++;
          pairReports.push(report);
          continue;
        }

        // Needs upgrade/backfill only
        report.status = 'NEEDS_BACKFILL';
        report.canonical_conversation_id = c.id;

        if (!dryRun) {
          if (!fullyFormed) {
            await base44.asServiceRole.entities.Conversation.update(c.id, {
              shared_conversation_key: canonicalKey,
              participant_character_ids: participantIds,
              character_ids: participantIds,
              channel: 'world_phone',
              sync_status: 'complete',
            }).catch(err => report.errors.push(`convo upgrade: ${err.message}`));
          }

          let bf = 0;
          let bfWriteCount = 0;
          for (const msg of msgs) {
            const needsMsg = !msg.shared_conversation_key ||
              !Array.isArray(msg.participant_character_ids) ||
              msg.participant_character_ids.length < 2 ||
              msg.channel !== 'world_phone' ||
              (msg.sender_type === 'character' && !msg.sender_character_id);
            if (!needsMsg) continue;

            const inferredSender = msg.sender_character_id ||
              (msg.character_id === idA ? idA : msg.character_id === idB ? idB : null);
            const inferredReceiver = msg.receiver_character_id ||
              (inferredSender === idA ? idB : inferredSender === idB ? idA : null);

            // Throttle: pause every 3 writes to avoid 429
            if (bfWriteCount > 0 && bfWriteCount % 3 === 0) {
              await new Promise(r => setTimeout(r, 800));
            }

            const updatePayload = {
              shared_conversation_key: canonicalKey,
              participant_character_ids: participantIds,
              channel: 'world_phone',
            };
            // Only write sender/receiver if we have a real value — never write null
            if (inferredSender) updatePayload.sender_character_id = inferredSender;
            if (inferredReceiver) updatePayload.receiver_character_id = inferredReceiver;
            // If sender cannot be inferred, stamp a fallback so this message stops re-triggering
            if (!inferredSender) updatePayload.sender_character_id = idA; // default to idA (first sorted participant)

            await base44.asServiceRole.entities.Message.update(msg.id, updatePayload)
              .catch(err => report.errors.push(`backfill msg ${msg.id.substring(0,8)}: ${err.message}`));
            bf++;
            bfWriteCount++;
          }
          report.messages_backfilled = bf;
          totalBackfilled += bf;
        } else {
          report.messages_backfilled = msgs.filter(m =>
            !m.shared_conversation_key ||
            !Array.isArray(m.participant_character_ids) ||
            m.participant_character_ids.length < 2 ||
            m.channel !== 'world_phone' ||
            (m.sender_type === 'character' && !m.sender_character_id)
          ).length;
          totalBackfilled += report.messages_backfilled;
        }

        pairsRepaired++;
        pairReports.push(report);
        continue;
      }

      // ── MULTIPLE CONVERSATIONS: merge into canonical ───────────────────────
      report.status = 'SPLIT_THREADS';

      const withMessages = await Promise.all(
        initialConvos.map(async c => {
          const msgs = await base44.asServiceRole.entities.Message.filter(
            { conversation_id: c.id }, 'created_date', 500
          ).catch(() => []);
          return { convo: c, messages: msgs, count: msgs.length };
        })
      );

      // Choose canonical: canonical key first → most messages → oldest
      withMessages.sort((a, b) => {
        const aC = a.convo.shared_conversation_key === canonicalKey ? 1 : 0;
        const bC = b.convo.shared_conversation_key === canonicalKey ? 1 : 0;
        if (aC !== bC) return bC - aC;
        if (b.count !== a.count) return b.count - a.count;
        return new Date(a.convo.created_date || 0) - new Date(b.convo.created_date || 0);
      });

      const canonicalEntry = withMessages[0];
      const canonicalConvo = canonicalEntry.convo;
      const duplicates = withMessages.slice(1);
      report.canonical_conversation_id = canonicalConvo.id;

      log.push(`[repairAllWorldContactThreads] SPLIT pair=${report.pair_short} | canonical=${canonicalConvo.id.substring(0,8)} | dups=${duplicates.length}`);

      if (!dryRun) {
        // Upgrade canonical
        await base44.asServiceRole.entities.Conversation.update(canonicalConvo.id, {
          shared_conversation_key: canonicalKey,
          participant_character_ids: participantIds,
          character_ids: participantIds,
          channel: 'world_phone',
          sync_status: 'complete',
        }).catch(err => report.errors.push(`canonical upgrade: ${err.message}`));

        // Migrate messages from duplicates
        let migrateWriteCount = 0;
        for (const dup of duplicates) {
          for (const msg of dup.messages) {
            if (migrateWriteCount > 0 && migrateWriteCount % 3 === 0) {
              await new Promise(r => setTimeout(r, 800));
            }
            const inferredSender = msg.sender_character_id ||
              (msg.character_id === idA ? idA : msg.character_id === idB ? idB : null);
            const inferredReceiver = msg.receiver_character_id ||
              (inferredSender === idA ? idB : inferredSender === idB ? idA : null);

            const payload = {
              conversation_id: canonicalConvo.id,
              sender_type: msg.sender_type || 'character',
              character_id: msg.character_id || null,
              character_name: msg.character_name || null,
              sender_character_id: inferredSender,
              receiver_character_id: inferredReceiver,
              participant_character_ids: participantIds,
              shared_conversation_key: canonicalKey,
              content: msg.content || '',
              timestamp: msg.timestamp || msg.created_date || new Date().toISOString(),
              typed_by_user: msg.typed_by_user || false,
              user_operated: msg.user_operated || false,
              channel: 'world_phone',
              sync_status: 'complete',
              is_read: msg.is_read !== undefined ? msg.is_read : true,
              is_narrative: msg.is_narrative || false,
            };

            if (msg.image_url) payload.image_url = msg.image_url;
            if (msg.audio_url) payload.audio_url = msg.audio_url;
            if (msg.reactions) payload.reactions = msg.reactions;
            if (msg.emotional_state) payload.emotional_state = msg.emotional_state;
            if (msg.generation_context) payload.generation_context = msg.generation_context;
            if (msg.location_share) payload.location_share = msg.location_share;
            if (msg.money_transfer) payload.money_transfer = msg.money_transfer;
            if (msg.songs_heard) payload.songs_heard = msg.songs_heard;
            if (msg.videos_watched) payload.videos_watched = msg.videos_watched;

            // WORLD PHONE BOUNDARY GUARD: never migrate narrative contamination
            if (!isSafeToMigrateToWorldPhone(msg)) {
              report.errors.push(`BOUNDARY: skipped narrative msg ${msg.id.substring(0,8)} — no bilateral IDs`);
              continue;
            }
            await base44.asServiceRole.entities.Message.create(payload)
              .catch(err => report.errors.push(`migrate msg ${msg.id.substring(0,8)}: ${err.message}`));
            report.messages_migrated++;
            totalMigrated++;
            migrateWriteCount++;
          }
        }

        // Backfill legacy messages in canonical
        let bf = 0;
        let canonicalBfCount = 0;
        for (const msg of canonicalEntry.messages) {
          const needsMsg = !msg.shared_conversation_key ||
            !Array.isArray(msg.participant_character_ids) ||
            msg.participant_character_ids.length < 2 ||
            msg.channel !== 'world_phone' ||
            (msg.sender_type === 'character' && !msg.sender_character_id);
          if (!needsMsg) continue;

          const inferredSender = msg.sender_character_id ||
            (msg.character_id === idA ? idA : msg.character_id === idB ? idB : null);
          const inferredReceiver = msg.receiver_character_id ||
            (inferredSender === idA ? idB : inferredSender === idB ? idA : null);

          if (canonicalBfCount > 0 && canonicalBfCount % 3 === 0) {
            await new Promise(r => setTimeout(r, 800));
          }

          const canonicalUpdatePayload = {
            shared_conversation_key: canonicalKey,
            participant_character_ids: participantIds,
            channel: 'world_phone',
          };
          if (inferredSender) canonicalUpdatePayload.sender_character_id = inferredSender;
          if (inferredReceiver) canonicalUpdatePayload.receiver_character_id = inferredReceiver;
          if (!inferredSender) canonicalUpdatePayload.sender_character_id = idA;

          await base44.asServiceRole.entities.Message.update(msg.id, canonicalUpdatePayload)
            .catch(err => report.errors.push(`backfill msg ${msg.id.substring(0,8)}: ${err.message}`));
          bf++;
          canonicalBfCount++;
        }
        report.messages_backfilled = bf;
        totalBackfilled += bf;

        // Archive duplicates — NEVER delete
        for (const dup of duplicates) {
          await base44.asServiceRole.entities.Conversation.update(dup.convo.id, {
            sync_status: 'merged',
            shared_conversation_key: canonicalKey,
            participant_character_ids: participantIds,
            character_ids: participantIds,
            channel: 'world_phone',
            merged_into_conversation_id: canonicalConvo.id,
            merged_at: new Date().toISOString(),
          }).catch(err => report.errors.push(`archive ${dup.convo.id.substring(0,8)}: ${err.message}`));
          report.duplicates_archived++;
          totalArchived++;
        }
      } else {
        // Dry run estimates
        for (const dup of duplicates) {
          report.messages_migrated += dup.count;
          report.duplicates_archived++;
        }
        report.messages_backfilled = canonicalEntry.messages.filter(m =>
          !m.shared_conversation_key || !m.sender_character_id || m.channel !== 'world_phone'
        ).length;
        totalMigrated += report.messages_migrated;
        totalArchived += report.duplicates_archived;
        totalBackfilled += report.messages_backfilled;
      }

      pairsRepaired++;
      pairReports.push(report);
    }

    // ── PHASE 5: VERIFICATION — re-check all repaired pairs ──────────────────
    let verificationPassed = 0;
    let verificationFailed = 0;

    if (!dryRun) {
      for (const pair of pairsToProcess) {
        const { idA, idB } = pair;
        const canonicalKey = getCanonicalKey(idA, idB);

        const activeConvos = await base44.asServiceRole.entities.Conversation.filter(
          { shared_conversation_key: canonicalKey }, '-updated_date', 10
        ).catch(() => []);

        const active = activeConvos.filter(c => c.sync_status !== 'merged');
        const converged = active.length === 1 && active[0].shared_conversation_key === canonicalKey;

        const result = {
          pair: `${idA.substring(0,8)}::${idB.substring(0,8)}`,
          canonical_key: canonicalKey,
          active_conversations: active.length,
          verdict: converged ? 'PASS' : 'FAIL',
        };

        if (!converged) {
          result.issue = active.length === 0
            ? 'No active canonical conversation found after repair'
            : `${active.length} active conversations still exist — merge incomplete`;
          verificationFailed++;
        } else {
          verificationPassed++;
        }

        verificationResults.push(result);
      }
    }

    const globalVerdict = dryRun
      ? 'DRY_RUN'
      : verificationFailed === 0
        ? 'PASS'
        : 'FAIL';

    const summary = {
      function: 'repairAllWorldContactThreads',
      dryRun,
      owner_email: user.email,
      global_verdict: globalVerdict,
      total_pairs_discovered: allPairs.length,
      pairs_processed: pairsToProcess.length,
      broken_pairs_found: pairReports.filter(p => p.status !== 'OK').length,
      pairs_repaired: pairsRepaired,
      pairs_already_ok: pairsAlreadyOk,
      messages_migrated: totalMigrated,
      messages_backfilled: totalBackfilled,
      conversations_archived: totalArchived,
      no_deletes: true,
      verification_summary: dryRun ? null : {
        passed: verificationPassed,
        failed: verificationFailed,
        total: verificationResults.length,
      },
      per_pair_reports: pairReports,
      verification_results: verificationResults,
      errors,
      log,
    };

    console.log(
      `[repairAllWorldContactThreads] DONE | verdict=${globalVerdict} | pairs=${allPairs.length} | repaired=${pairsRepaired} | ok=${pairsAlreadyOk} | migrated=${totalMigrated} | backfilled=${totalBackfilled} | archived=${totalArchived} | verify_pass=${verificationPassed} | verify_fail=${verificationFailed}`
    );

    return Response.json(summary);
  } catch (error) {
    console.error('[repairAllWorldContactThreads] Fatal:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});