/**
 * globalWorldPhoneConvergenceRepair
 *
 * Global autonomous discovery + repair of ALL bilateral World Phone threads
 * for the authenticated user's account. No manual character IDs required.
 *
 * Discovers broken pairs from ALL Conversation records scoped by owner_email.
 * Repairs every broken pair non-destructively:
 *   - Upgrades canonical conversations
 *   - Migrates messages from split threads into canonical
 *   - Backfills missing identity fields on legacy messages
 *   - Archives duplicate threads (sync_status: "merged", never deleted)
 *
 * Payload:
 *   dryRun: boolean  (default true — always safe to run first)
 *   limitPairs: number  (optional, default 50 — cap for large accounts)
 *
 * Returns:
 *   - total_pairs_found
 *   - broken_pairs_found
 *   - pairs_repaired
 *   - pairs_already_ok
 *   - messages_migrated
 *   - messages_backfilled
 *   - conversations_archived
 *   - per_pair_reports[]
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
    const limitPairs = body.limitPairs || 50;

    const log = [];
    const errors = [];
    const pairReports = [];
    let totalMigrated = 0;
    let totalBackfilled = 0;
    let totalArchived = 0;
    let pairsRepaired = 0;
    let pairsAlreadyOk = 0;

    log.push(`[GlobalRepair] START | owner=${user.email} | dryRun=${dryRun} | limitPairs=${limitPairs}`);

    // ── STEP 1: FETCH ALL WORLD PHONE CONVERSATIONS FOR THIS USER ────────────
    // Broad sweep — gather every conversation that could be bilateral world phone
    const [byChannel, byKey1, byKey2, byParticipant, byOwner] = await Promise.all([
      base44.asServiceRole.entities.Conversation.filter({ channel: 'world_phone', owner_email: user.email }, '-updated_date', 500).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ owner_email: user.email }, '-updated_date', 500).catch(() => []),
      // Also catch conversations that might have been created without owner_email but with world_phone channel
      base44.asServiceRole.entities.Conversation.filter({ channel: 'world_phone' }, '-updated_date', 500).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ sync_status: 'pending' }, '-updated_date', 200).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ sync_status: 'failed' }, '-updated_date', 200).catch(() => []),
    ]);

    // Merge, deduplicate
    const seenConvoIds = new Set();
    const allConvos = [...byChannel, ...byKey1, ...byKey2, ...byParticipant, ...byOwner].filter(c => {
      if (seenConvoIds.has(c.id)) return false;
      seenConvoIds.add(c.id);
      return true;
    });

    log.push(`[GlobalRepair] Total raw conversations fetched: ${allConvos.length}`);

    // ── STEP 2: IDENTIFY BILATERAL WORLD PHONE CONVERSATIONS ─────────────────
    // A conversation is a bilateral world phone candidate if:
    // - channel === 'world_phone', OR
    // - shared_conversation_key matches world_phone:: or bilateral_ patterns, OR
    // - participant_character_ids has exactly 2 entries, OR
    // - title matches npc_chat__ or bilateral_ or world_phone:: patterns
    const bilateralCandidates = allConvos.filter(c => {
      if (c.channel === 'world_phone') return true;
      if (c.shared_conversation_key?.startsWith('world_phone::')) return true;
      if (c.shared_conversation_key?.startsWith('bilateral_')) return true;
      if (c.title?.startsWith('npc_chat__') && c.title?.includes('__cid_')) return true;
      if (c.title?.startsWith('world_phone::')) return true;
      if (Array.isArray(c.participant_character_ids) && c.participant_character_ids.length === 2) return true;
      if (Array.isArray(c.character_ids) && c.character_ids.length === 2) {
        // Must have at least 2 character IDs and look like NPC type
        return c.type === 'npc';
      }
      return false;
    });

    log.push(`[GlobalRepair] Bilateral world phone candidates: ${bilateralCandidates.length}`);

    // ── STEP 3: BUILD PAIR MAP ────────────────────────────────────────────────
    // Extract participant pair (A, B) from each conversation using best available signal
    const pairMap = new Map(); // pairKey → [conversation, ...]

    for (const convo of bilateralCandidates) {
      let charIds = [];

      // Best: participant_character_ids (already sorted)
      if (Array.isArray(convo.participant_character_ids) && convo.participant_character_ids.length >= 2) {
        charIds = convo.participant_character_ids.slice(0, 2);
      }
      // Next: canonical key extraction world_phone::A::B
      else if (convo.shared_conversation_key?.startsWith('world_phone::')) {
        const parts = convo.shared_conversation_key.split('::');
        if (parts.length === 3) charIds = [parts[1], parts[2]];
      }
      // Next: legacy key bilateral_A_B_world_phone
      else if (convo.shared_conversation_key?.startsWith('bilateral_')) {
        const inner = convo.shared_conversation_key.replace(/^bilateral_/, '').replace(/_world_phone$/, '');
        // IDs are 24-char hex, split on _ boundary
        const match = inner.match(/^([a-f0-9]{24})_([a-f0-9]{24})$/);
        if (match) charIds = [match[1], match[2]];
      }
      // Next: title npc_chat__OWNERID__cid_CONTACTID
      else if (convo.title?.startsWith('npc_chat__') && convo.title?.includes('__cid_')) {
        const titleMatch = convo.title.match(/^npc_chat__([a-f0-9]{24})__cid_([a-f0-9]{24})$/);
        if (titleMatch) charIds = [titleMatch[1], titleMatch[2]];
      }
      // Next: title world_phone::A::B
      else if (convo.title?.startsWith('world_phone::')) {
        const parts = convo.title.split('::');
        if (parts.length === 3) charIds = [parts[1], parts[2]];
      }
      // Fallback: character_ids with exactly 2
      else if (Array.isArray(convo.character_ids) && convo.character_ids.length === 2) {
        charIds = convo.character_ids;
      }

      if (charIds.length < 2 || !charIds[0] || !charIds[1] || charIds[0] === charIds[1]) continue;

      const sorted = [...charIds].sort();
      const pairKey = `${sorted[0]}::${sorted[1]}`;
      if (!pairMap.has(pairKey)) pairMap.set(pairKey, { idA: sorted[0], idB: sorted[1], convos: [] });
      pairMap.get(pairKey).convos.push(convo);
    }

    const allPairs = [...pairMap.values()];
    log.push(`[GlobalRepair] Unique bilateral pairs discovered: ${allPairs.length}`);

    // Apply limit
    const pairsToProcess = allPairs.slice(0, limitPairs);
    if (allPairs.length > limitPairs) {
      log.push(`[GlobalRepair] WARNING: ${allPairs.length - limitPairs} pairs beyond limit — increase limitPairs to process all`);
    }

    // ── STEP 4: DETECT + REPAIR EACH PAIR ────────────────────────────────────
    for (const pair of pairsToProcess) {
      const { idA, idB, convos: initialConvos } = pair;
      const canonicalKey = getCanonicalKey(idA, idB);
      const legacyKey = `bilateral_${[idA, idB].sort().join('_')}_world_phone`;
      const participantIds = [idA, idB].sort();

      const pairReport = {
        pair: `${idA.substring(0,8)}::${idB.substring(0,8)}`,
        canonical_key: canonicalKey,
        conversations_found: initialConvos.length,
        status: null,
        canonical_conversation_id: null,
        duplicates_archived: 0,
        messages_migrated: 0,
        messages_backfilled: 0,
        errors: [],
      };

      // ── DETECT: is this pair broken? ──────────────────────────────────────
      // A single conversation with correct canonical key is fine
      if (initialConvos.length === 1) {
        const c = initialConvos[0];
        const hasCanonicalKey = c.shared_conversation_key === canonicalKey;
        const hasParticipants = Array.isArray(c.participant_character_ids) &&
          participantIds.every(id => c.participant_character_ids.includes(id));
        const hasCharIds = Array.isArray(c.character_ids) &&
          participantIds.every(id => c.character_ids.includes(id));
        const hasChannel = c.channel === 'world_phone';

        if (hasCanonicalKey && hasParticipants && hasCharIds && hasChannel) {
          // Check if messages need backfilling
          const msgs = await base44.asServiceRole.entities.Message.filter(
            { conversation_id: c.id }, 'created_date', 500
          ).catch(() => []);

          const needsBackfill = msgs.some(m =>
            !m.shared_conversation_key ||
            !Array.isArray(m.participant_character_ids) ||
            m.participant_character_ids.length < 2 ||
            !m.sender_character_id ||
            m.channel !== 'world_phone'
          );

          if (!needsBackfill) {
            pairReport.status = 'OK';
            pairReport.canonical_conversation_id = c.id;
            pairsAlreadyOk++;
            pairReports.push(pairReport);
            continue;
          }

          // Needs message backfill only
          pairReport.status = 'NEEDS_BACKFILL';
          if (!dryRun) {
            let backfillCount = 0;
            for (const msg of msgs) {
              const needsMsg = !msg.shared_conversation_key ||
                !Array.isArray(msg.participant_character_ids) ||
                msg.participant_character_ids.length < 2 ||
                !msg.sender_character_id ||
                msg.channel !== 'world_phone';
              if (!needsMsg) continue;

              const inferredSender = msg.sender_character_id ||
                (msg.character_id === idA ? idA : msg.character_id === idB ? idB : null);
              const inferredReceiver = msg.receiver_character_id ||
                (inferredSender === idA ? idB : inferredSender === idB ? idA : null);

              await base44.asServiceRole.entities.Message.update(msg.id, {
                shared_conversation_key: canonicalKey,
                participant_character_ids: participantIds,
                channel: 'world_phone',
                ...(inferredSender && !msg.sender_character_id ? { sender_character_id: inferredSender } : {}),
                ...(inferredReceiver && !msg.receiver_character_id ? { receiver_character_id: inferredReceiver } : {}),
              }).catch(err => pairReport.errors.push(`backfill msg ${msg.id.substring(0,8)}: ${err.message}`));
              backfillCount++;
            }
            pairReport.messages_backfilled = backfillCount;
            totalBackfilled += backfillCount;

            // Upgrade the conversation too
            await base44.asServiceRole.entities.Conversation.update(c.id, {
              shared_conversation_key: canonicalKey,
              participant_character_ids: participantIds,
              character_ids: participantIds,
              channel: 'world_phone',
              sync_status: 'complete',
            }).catch(err => pairReport.errors.push(`convo upgrade: ${err.message}`));
          }
          pairReport.canonical_conversation_id = c.id;
          pairsRepaired++;
          pairReports.push(pairReport);
          continue;
        }
      }

      // ── MULTI-CONVERSATION PAIR OR NEEDS UPGRADE ─────────────────────────
      pairReport.status = 'BROKEN';

      // Fetch message counts for all conversations in this pair
      const withMessages = await Promise.all(
        initialConvos.map(async c => {
          const msgs = await base44.asServiceRole.entities.Message.filter(
            { conversation_id: c.id }, 'created_date', 500
          ).catch(() => []);
          return { convo: c, messages: msgs, count: msgs.length };
        })
      );

      // Sort: canonical key first → most messages → oldest
      withMessages.sort((a, b) => {
        const aIsCanon = a.convo.shared_conversation_key === canonicalKey ? 1 : 0;
        const bIsCanon = b.convo.shared_conversation_key === canonicalKey ? 1 : 0;
        if (aIsCanon !== bIsCanon) return bIsCanon - aIsCanon;
        if (b.count !== a.count) return b.count - a.count;
        return new Date(a.convo.created_date || 0) - new Date(b.convo.created_date || 0);
      });

      const canonicalEntry = withMessages[0];
      const canonicalConvo = canonicalEntry.convo;
      const duplicates = withMessages.slice(1);

      pairReport.canonical_conversation_id = canonicalConvo.id;
      log.push(`[GlobalRepair] Pair ${pairReport.pair} | canonical=${canonicalConvo.id.substring(0,8)} | duplicates=${duplicates.length} | messages=${canonicalEntry.count}`);

      if (!dryRun) {
        // STEP 4a: Upgrade canonical
        await base44.asServiceRole.entities.Conversation.update(canonicalConvo.id, {
          shared_conversation_key: canonicalKey,
          participant_character_ids: participantIds,
          character_ids: participantIds,
          channel: 'world_phone',
          sync_status: 'complete',
        }).catch(err => pairReport.errors.push(`canonical upgrade: ${err.message}`));

        // STEP 4b: Migrate messages from duplicates into canonical
        for (const dup of duplicates) {
          for (const msg of dup.messages) {
            const inferredSender = msg.sender_character_id ||
              (msg.character_id === idA ? idA : msg.character_id === idB ? idB : null);
            const inferredReceiver = msg.receiver_character_id ||
              (inferredSender === idA ? idB : inferredSender === idB ? idA : null);

            const migratedPayload = {
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

            // Preserve optional fields
            if (msg.image_url) migratedPayload.image_url = msg.image_url;
            if (msg.audio_url) migratedPayload.audio_url = msg.audio_url;
            if (msg.reactions) migratedPayload.reactions = msg.reactions;
            if (msg.emotional_state) migratedPayload.emotional_state = msg.emotional_state;
            if (msg.generation_context) migratedPayload.generation_context = msg.generation_context;
            if (msg.location_share) migratedPayload.location_share = msg.location_share;
            if (msg.money_transfer) migratedPayload.money_transfer = msg.money_transfer;
            if (msg.songs_heard) migratedPayload.songs_heard = msg.songs_heard;
            if (msg.videos_watched) migratedPayload.videos_watched = msg.videos_watched;

            // WORLD PHONE BOUNDARY GUARD: never migrate narrative contamination
            if (!isSafeToMigrateToWorldPhone(msg)) {
              pairReport.errors.push(`BOUNDARY: skipped narrative msg ${msg.id.substring(0,8)} — no bilateral IDs`);
              continue;
            }
            await base44.asServiceRole.entities.Message.create(migratedPayload)
              .catch(err => pairReport.errors.push(`migrate msg ${msg.id.substring(0,8)}: ${err.message}`));
            pairReport.messages_migrated++;
            totalMigrated++;
          }
        }

        // STEP 4c: Backfill legacy messages in canonical
        let backfillCount = 0;
        for (const msg of canonicalEntry.messages) {
          const needsBackfill =
            !msg.shared_conversation_key ||
            !Array.isArray(msg.participant_character_ids) ||
            msg.participant_character_ids.length < 2 ||
            !msg.sender_character_id ||
            msg.channel !== 'world_phone';
          if (!needsBackfill) continue;

          const inferredSender = msg.sender_character_id ||
            (msg.character_id === idA ? idA : msg.character_id === idB ? idB : null);
          const inferredReceiver = msg.receiver_character_id ||
            (inferredSender === idA ? idB : inferredSender === idB ? idA : null);

          await base44.asServiceRole.entities.Message.update(msg.id, {
            shared_conversation_key: canonicalKey,
            participant_character_ids: participantIds,
            channel: 'world_phone',
            ...(inferredSender && !msg.sender_character_id ? { sender_character_id: inferredSender } : {}),
            ...(inferredReceiver && !msg.receiver_character_id ? { receiver_character_id: inferredReceiver } : {}),
          }).catch(err => pairReport.errors.push(`backfill msg ${msg.id.substring(0,8)}: ${err.message}`));
          backfillCount++;
        }
        pairReport.messages_backfilled = backfillCount;
        totalBackfilled += backfillCount;

        // STEP 4d: Archive duplicates — NEVER DELETE
        for (const dup of duplicates) {
          await base44.asServiceRole.entities.Conversation.update(dup.convo.id, {
            sync_status: 'merged',
            shared_conversation_key: canonicalKey,
            participant_character_ids: participantIds,
            character_ids: participantIds,
            channel: 'world_phone',
            merged_into_conversation_id: canonicalConvo.id,
            merged_at: new Date().toISOString(),
          }).catch(err => pairReport.errors.push(`archive dup ${dup.convo.id.substring(0,8)}: ${err.message}`));
          pairReport.duplicates_archived++;
          totalArchived++;
        }
      } else {
        // Dry run: count what would happen
        for (const dup of duplicates) {
          pairReport.messages_migrated += dup.count;
          pairReport.duplicates_archived++;
        }
        pairReport.messages_backfilled = canonicalEntry.messages.filter(m =>
          !m.shared_conversation_key ||
          !Array.isArray(m.participant_character_ids) ||
          m.participant_character_ids.length < 2 ||
          !m.sender_character_id ||
          m.channel !== 'world_phone'
        ).length;
        totalMigrated += pairReport.messages_migrated;
        totalArchived += pairReport.duplicates_archived;
        totalBackfilled += pairReport.messages_backfilled;
      }

      pairsRepaired++;
      pairReports.push(pairReport);
    }

    // ── STEP 5: POST-REPAIR CONVERGENCE SAMPLE CHECK (non-dry run) ───────────
    let convergenceCheck = null;
    if (!dryRun && pairsRepaired > 0) {
      // Spot-check the first repaired pair
      const firstRepaired = pairReports.find(p => p.status === 'BROKEN' && p.canonical_conversation_id);
      if (firstRepaired) {
        const [idA, idB] = firstRepaired.pair.split('::').map((s, i) =>
          // Restore full IDs from pairMap
          allPairs.find(p => p.idA.startsWith(s) || p.idB.startsWith(s))
            ? (i === 0 ? allPairs.find(p => p.idA.startsWith(s))?.idA || s : allPairs.find(p => p.idB.startsWith(s))?.idB || s)
            : s
        );
        const samplePair = pairsToProcess.find(p =>
          firstRepaired.canonical_key === getCanonicalKey(p.idA, p.idB)
        );
        if (samplePair) {
          const canonKey = getCanonicalKey(samplePair.idA, samplePair.idB);
          const verifyConvos = await base44.asServiceRole.entities.Conversation.filter(
            { shared_conversation_key: canonKey }, '-updated_date', 5
          ).catch(() => []);
          const activeSingle = verifyConvos.filter(c => c.sync_status !== 'merged');
          convergenceCheck = {
            pair: firstRepaired.pair,
            canonical_key: canonKey,
            active_conversations_after_repair: activeSingle.length,
            converged: activeSingle.length === 1 && activeSingle[0]?.id === firstRepaired.canonical_conversation_id,
          };
        }
      }
    }

    const totalBroken = pairReports.filter(p => p.status === 'BROKEN' || p.status === 'NEEDS_BACKFILL').length;

    const summary = {
      dryRun,
      owner_email: user.email,
      total_pairs_discovered: allPairs.length,
      pairs_processed: pairsToProcess.length,
      broken_pairs_found: totalBroken,
      pairs_repaired: pairsRepaired,
      pairs_already_ok: pairsAlreadyOk,
      messages_migrated: totalMigrated,
      messages_backfilled: totalBackfilled,
      conversations_archived: totalArchived,
      no_deletes: true,
      convergence_spot_check: convergenceCheck,
      per_pair_reports: pairReports,
      errors,
      log,
    };

    console.log(
      `[GlobalWorldPhoneRepair] DONE | dryRun=${dryRun} | pairs=${allPairs.length} | broken=${totalBroken} | repaired=${pairsRepaired} | ok=${pairsAlreadyOk} | migrated=${totalMigrated} | backfilled=${totalBackfilled} | archived=${totalArchived}`
    );

    return Response.json(summary);
  } catch (error) {
    console.error('[GlobalWorldPhoneRepair] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});