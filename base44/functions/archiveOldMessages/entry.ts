import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * FAIR-SHARE ARCHIVE SYSTEM
 *
 * ARCHITECTURE RULES (non-negotiable):
 *
 * 1. KEEP_RECENT = 500 — every conversation keeps its 500 newest messages visible.
 * 2. ARCHIVE_THRESHOLD = 600 — a conversation must have MORE than 600 unarchived messages before
 *    it becomes eligible at all.
 * 3. RECENT_ACTIVITY_WINDOW_MS = 45 min — any conversation with a message in the last 45 minutes
 *    is FULLY SKIPPED. User may be actively chatting.
 * 4. GLOBAL_TARGET_PER_RUN = 200 — the run archives at most 200 messages TOTAL across ALL
 *    conversations. The burden is shared. No single conversation can absorb the entire budget.
 * 5. MAX_PER_CONVERSATION = 25 — no conversation may lose more than 25 messages per run,
 *    regardless of size. Continuity is preserved incrementally.
 * 6. FAIR-SHARE DISTRIBUTION — the budget is distributed proportionally across all eligible
 *    conversations. Larger conversations get a proportionally larger (but still capped) share.
 *    No "largest conversation first" sweep.
 * 7. Skip world_phone / bilateral threads (shared_conversation_key present).
 * 8. Archive oldest messages first (lowest created_date).
 * 9. Memory extraction is fire-and-forget — never blocks the archive loop.
 *
 * PROOF FIELDS RETURNED:
 * - global_target: the total budget for this run
 * - eligible_conversations: how many qualified for archiving
 * - per_conversation_allocations: each conversation's fair-share allocation
 * - total_archived: actual messages archived
 * - conversations_processed: conversations that had messages archived
 * - conversations_skipped_active: conversations skipped due to recent activity
 * - conversations_skipped_below_threshold: conversations with too few messages
 */

const KEEP_RECENT                = 500;   // messages to keep visible per conversation
const ARCHIVE_THRESHOLD          = 600;   // min unarchived count before a conversation is eligible
const RECENT_ACTIVITY_WINDOW_MS  = 45 * 60 * 1000; // 45 minutes — active session protection
const GLOBAL_TARGET_PER_RUN      = 200;  // max messages archived across ALL conversations per run
const MAX_PER_CONVERSATION       = 25;   // hard cap per conversation per run

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // ── STEP 1: Load all conversations (sorted by updated_date desc — most recently active first)
    // We intentionally do NOT use this sort order to pick archive targets.
    // It is only used to get a consistent snapshot of all conversations.
    const allConversations = await base44.asServiceRole.entities.Conversation.list('-updated_date', 500);

    const now = Date.now();

    // ── STEP 2: Build the eligible set ──────────────────────────────────────────
    // For each conversation, determine:
    //   - Is it skipped due to recent activity?
    //   - Is it below the archive threshold?
    //   - If eligible: how many messages COULD be archived (excess over KEEP_RECENT)?
    //
    // We collect (conversationId, excess) tuples. Excess = unarchived_count - KEEP_RECENT.
    // This requires a message count query per conversation — we use a capped fetch.

    const skippedActive = [];
    const skippedBelowThreshold = [];
    const eligibleConversations = []; // { convo, excess, messages }

    for (const convo of allConversations) {
      // Skip bilateral / world_phone threads
      if (convo.shared_conversation_key) continue;
      if (convo.channel === 'world_phone') continue;

      // RECENT ACTIVITY GUARD
      const lastMsgDate = convo.last_message_date ? new Date(convo.last_message_date).getTime() : 0;
      if (now - lastMsgDate < RECENT_ACTIVITY_WINDOW_MS) {
        skippedActive.push(convo.id);
        continue;
      }

      // Pace the per-conversation count queries — 200ms between each to avoid 429
      await new Promise(r => setTimeout(r, 200));

      // Fetch unarchived message count (capped — we only need to know if > ARCHIVE_THRESHOLD)
      const messages = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id, archived_date: { $exists: false } },
        'created_date',   // oldest first — archive from the bottom
        ARCHIVE_THRESHOLD + 50  // slightly more than threshold so we know the true excess
      ).catch(() => null);

      if (!messages) continue;

      if (messages.length <= ARCHIVE_THRESHOLD) {
        skippedBelowThreshold.push({ id: convo.id, count: messages.length });
        continue;
      }

      const excess = messages.length - KEEP_RECENT;
      if (excess <= 0) {
        skippedBelowThreshold.push({ id: convo.id, count: messages.length });
        continue;
      }

      eligibleConversations.push({ convo, excess, messages });
    }

    // ── STEP 3: FAIR-SHARE ALLOCATION ─────────────────────────────────────────
    // Distribute GLOBAL_TARGET_PER_RUN proportionally across eligible conversations.
    // Each conversation's share = (its_excess / total_excess) * GLOBAL_TARGET_PER_RUN.
    // Hard cap at MAX_PER_CONVERSATION regardless of share.
    //
    // This ensures:
    //   - A single large conversation CANNOT absorb the entire global budget.
    //   - Conversations with more excess get proportionally more (fair), but are still capped.
    //   - Small conversations are not penalized more than large ones per-run.

    const totalExcess = eligibleConversations.reduce((sum, e) => sum + e.excess, 0);

    const allocations = eligibleConversations.map(({ convo, excess, messages }) => {
      // Proportional share of the global budget
      const proportionalShare = totalExcess > 0
        ? Math.round((excess / totalExcess) * GLOBAL_TARGET_PER_RUN)
        : 0;

      // Never exceed the hard per-conversation cap
      const allocated = Math.min(proportionalShare, MAX_PER_CONVERSATION, excess);

      return {
        convo,
        messages,
        excess,
        allocated,
        proportionalShare,
      };
    });

    // ── STEP 4: Execute archives with a global budget tracker ─────────────────
    // Even after proportional allocation, we track against the global target.
    // If earlier conversations used their full allocation, later ones still get their share.
    // The global cap is a safety net — proportional allocation is the primary control.

    let globalBudgetRemaining = GLOBAL_TARGET_PER_RUN;
    let totalArchived = 0;
    let conversationsProcessed = 0;

    const perConversationReport = [];

    for (const { convo, messages, excess, allocated } of allocations) {
      if (globalBudgetRemaining <= 0) break;
      if (allocated <= 0) continue;

      // Respect global budget — take the smaller of allocated vs remaining budget
      const toArchiveCount = Math.min(allocated, globalBudgetRemaining);
      if (toArchiveCount <= 0) continue;

      // Archive from the OLDEST end (messages is already sorted oldest-first)
      const toArchive = messages.slice(0, toArchiveCount);

      console.log(
        `[archiveOldMessages] Conv=${convo.id} | ` +
        `unarchived=${messages.length} | excess=${excess} | ` +
        `proportional_share=${allocated} | archiving=${toArchive.length} | ` +
        `global_budget_remaining=${globalBudgetRemaining}`
      );

      let archivedThisConvo = 0;
      const archiveTimestamp = new Date().toISOString();

      for (const msg of toArchive) {
        // 150ms between writes — prevents 429 during burst archive operations
        await new Promise(r => setTimeout(r, 150));
        await base44.asServiceRole.entities.Message.update(msg.id, {
          archived_date: archiveTimestamp,
        }).catch(() => {});
        archivedThisConvo++;
        totalArchived++;
        globalBudgetRemaining--;
      }

      // Fire-and-forget memory extraction — never blocks or interferes with archive loop
      const characterId = convo.character_ids?.[0];
      if (characterId && archivedThisConvo > 0) {
        base44.asServiceRole.functions.invoke('extractMemoriesFromArchive', {
          conversationId: convo.id,
          characterId,
        }).catch(() => {});
      }

      perConversationReport.push({
        conversation_id: convo.id,
        unarchived_count: messages.length,
        excess,
        proportional_share: allocated,
        actually_archived: archivedThisConvo,
      });

      conversationsProcessed++;
    }

    // ── STEP 5: Return proof of fair-share distribution ────────────────────────
    const report = {
      success: true,

      // Global budget
      global_target_per_run: GLOBAL_TARGET_PER_RUN,
      global_budget_used: totalArchived,
      global_budget_remaining: globalBudgetRemaining,

      // Eligibility
      conversations_total_scanned: allConversations.length,
      conversations_skipped_active: skippedActive.length,
      conversations_skipped_below_threshold: skippedBelowThreshold.length,
      eligible_conversations: eligibleConversations.length,

      // Results
      conversations_processed: conversationsProcessed,
      total_archived: totalArchived,

      // Per-conversation breakdown (proof of fair-share distribution)
      per_conversation_allocations: perConversationReport,

      // Rules summary (for audit)
      rules: {
        keep_recent: KEEP_RECENT,
        archive_threshold: ARCHIVE_THRESHOLD,
        recent_activity_window_minutes: RECENT_ACTIVITY_WINDOW_MS / 60000,
        global_target_per_run: GLOBAL_TARGET_PER_RUN,
        max_per_conversation: MAX_PER_CONVERSATION,
        distribution_method: 'proportional_to_excess_capped_at_max_per_conversation',
      },
    };

    console.log(
      `[archiveOldMessages] DONE — ` +
      `eligible=${eligibleConversations.length} | ` +
      `processed=${conversationsProcessed} | ` +
      `archived=${totalArchived}/${GLOBAL_TARGET_PER_RUN} | ` +
      `skipped_active=${skippedActive.length} | ` +
      `skipped_below=${skippedBelowThreshold.length}`
    );

    return Response.json(report);

  } catch (error) {
    console.error('[archiveOldMessages] Error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});