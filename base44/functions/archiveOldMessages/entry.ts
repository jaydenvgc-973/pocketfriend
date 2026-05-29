import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// This function is called by a scheduled automation every 3 hours.
// It archives old messages for ALL conversations across ALL users — no frontend involvement.
//
// CONTINUITY RULES (non-negotiable):
// 1. KEEP_RECENT = 500 — conversations keep 500 visible messages before any archiving begins.
// 2. ARCHIVE_THRESHOLD = 600 — only archive if the conversation has MORE than 600 unarchived messages.
// 3. RECENT_ACTIVITY_WINDOW_MS = 30 minutes — skip conversations with any message in the last 30 min
//    (user may be actively chatting; never archive during active sessions).
// 4. Archive oldest messages first (they have the lowest created_date).
// 5. BATCH_PER_RUN = 50 — archive at most 50 messages per conversation per run (gradual, not a sweep).
// 6. Skip all world_phone / bilateral conversations (shared_conversation_key present).
// 7. Only archive messages without archived_date already set (never double-archive).

const KEEP_RECENT = 500;           // How many unarchived messages a conversation can have before archiving starts
const ARCHIVE_THRESHOLD = 600;     // Only begin archiving when unarchived count EXCEEDS this
const BATCH_PER_RUN = 50;          // Max messages archived per conversation per 3-hour run (gradual)
const RECENT_ACTIVITY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes — skip active conversations

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Fetch all conversations (service role — scheduled task, no user auth needed)
    const allConversations = await base44.asServiceRole.entities.Conversation.list('-updated_date', 500);

    let totalArchived = 0;
    let conversationsProcessed = 0;
    let conversationsSkippedActive = 0;
    let conversationsSkippedBelowThreshold = 0;

    const now = Date.now();

    for (const convo of allConversations) {
      // Skip world_phone / bilateral / character-to-character conversations —
      // those are system-managed and have different continuity requirements.
      if (convo.shared_conversation_key) continue;
      if (convo.channel === 'world_phone') continue;

      // RECENT ACTIVITY GUARD: skip if any message was added in the last 30 minutes.
      // This protects actively-used conversations from being archived mid-session.
      const lastMsgDate = convo.last_message_date ? new Date(convo.last_message_date).getTime() : 0;
      if (now - lastMsgDate < RECENT_ACTIVITY_WINDOW_MS) {
        conversationsSkippedActive++;
        continue;
      }

      // Fetch only UNARCHIVED messages for this conversation — we want to count what's
      // currently visible, not total historical messages.
      // Sort oldest-first so we archive the oldest ones first (correct gradual behavior).
      const messages = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convo.id, archived_date: { $exists: false } },
        'created_date',  // oldest first — we archive from the oldest end
        ARCHIVE_THRESHOLD + 100  // fetch slightly more than threshold to check count accurately
      ).catch(() => null);

      if (!messages) continue;

      // THRESHOLD GUARD: only archive if unarchived count EXCEEDS ARCHIVE_THRESHOLD.
      // Never archive conversations below 600 unarchived messages.
      if (messages.length <= ARCHIVE_THRESHOLD) {
        conversationsSkippedBelowThreshold++;
        continue;
      }

      // How many need to be archived: (total unarchived) - KEEP_RECENT
      // But cap at BATCH_PER_RUN per run — gradual archiving, not a full sweep.
      const excessCount = messages.length - KEEP_RECENT;
      const toArchiveCount = Math.min(excessCount, BATCH_PER_RUN);

      if (toArchiveCount <= 0) continue;

      // Archive from the OLDEST end (messages is already sorted oldest-first)
      const toArchive = messages.slice(0, toArchiveCount);

      console.log(`[archiveOldMessages] Conv=${convo.id} | unarchived=${messages.length} | archiving oldest ${toArchive.length}`);

      for (const msg of toArchive) {
        await base44.asServiceRole.entities.Message.update(msg.id, {
          archived_date: new Date().toISOString()
        }).catch(() => {});
        totalArchived++;
      }

      // Extract memories from archived messages (fire-and-forget — non-blocking)
      const characterId = convo.character_ids?.[0];
      if (characterId && toArchive.length > 0) {
        base44.asServiceRole.functions.invoke('extractMemoriesFromArchive', {
          conversationId: convo.id,
          characterId
        }).catch(() => {});
      }

      conversationsProcessed++;
    }

    console.log(`[archiveOldMessages] Done — ${conversationsProcessed} conversations processed, ${totalArchived} messages archived | skipped_active=${conversationsSkippedActive} | skipped_below_threshold=${conversationsSkippedBelowThreshold}`);
    return Response.json({
      success: true,
      conversationsProcessed,
      totalArchived,
      conversationsSkippedActive,
      conversationsSkippedBelowThreshold,
    });

  } catch (error) {
    console.error('[archiveOldMessages] Error:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});