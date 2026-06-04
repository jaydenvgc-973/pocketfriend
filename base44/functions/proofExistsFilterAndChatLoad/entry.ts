/**
 * proofExistsFilterAndChatLoad
 *
 * Proof function to verify:
 * 1. Whether Base44 supports { field: { $exists: false } } filter syntax
 * 2. Whether { archived_date: { $exists: false } } actually excludes archived messages
 * 3. Whether simple { conversation_id: X } without the exists filter returns archived messages
 *
 * This directly answers the question: is the chat loading filter safe?
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { conversation_id } = await req.json().catch(() => ({}));

    if (!conversation_id) {
      // Find a conversation with at least one archived message for this user
      const convos = await base44.entities.Conversation.filter(
        { owner_email: user.email },
        '-last_message_date',
        20
      ).catch(() => []);

      // Check each for archived messages
      for (const convo of convos) {
        const msgs = await base44.entities.Message.filter(
          { conversation_id: convo.id },
          '-created_date',
          10
        ).catch(() => []);
        const archived = msgs.filter(m => m.archived_date);
        if (archived.length > 0) {
          return Response.json({
            hint: 'Found a conversation with archived messages — re-run with this conversation_id',
            conversation_id: convo.id,
            total_messages_fetched: msgs.length,
            archived_count: archived.length,
            archived_sample: archived[0]?.id,
          });
        }
      }
      return Response.json({
        hint: 'No conversations with archived messages found — test will use synthetic proof',
        conversations_checked: convos.length,
      });
    }

    // ── PROOF TEST: compare filter WITH vs WITHOUT $exists: false ──
    const [withoutFilter, withExistsFilter] = await Promise.all([
      // A: No archived_date filter — returns ALL messages including archived
      base44.entities.Message.filter(
        { conversation_id },
        '-created_date',
        200
      ).catch(() => []),
      // B: With $exists: false — should exclude archived messages
      base44.entities.Message.filter(
        { conversation_id, archived_date: { $exists: false } },
        '-created_date',
        200
      ).catch(e => ({ error: e.message })),
    ]);

    const withoutFilterError = withoutFilter?.error || null;
    const withExistsError = withExistsFilter?.error || null;

    const allCount = Array.isArray(withoutFilter) ? withoutFilter.length : 0;
    const archivedInAll = Array.isArray(withoutFilter)
      ? withoutFilter.filter(m => m.archived_date).length
      : 0;
    const filteredCount = Array.isArray(withExistsFilter) ? withExistsFilter.length : 0;
    const archivedInFiltered = Array.isArray(withExistsFilter)
      ? withExistsFilter.filter(m => m.archived_date).length
      : 0;

    // ── VERDICT ──
    const existsFilterWorked = !withExistsError && archivedInFiltered === 0 && (archivedInAll === 0 || filteredCount < allCount);
    const existsFilterFailed = !!withExistsError;
    const noArchivedToTest = archivedInAll === 0;

    return Response.json({
      proof_question: 'Does { archived_date: { $exists: false } } work in Base44 filters?',
      conversation_id,

      // Test A: without filter
      without_filter: {
        count: allCount,
        archived_count: archivedInAll,
        error: withoutFilterError,
      },

      // Test B: with $exists: false
      with_exists_false_filter: {
        count: filteredCount,
        archived_count: archivedInFiltered,
        error: withExistsError,
        syntax_accepted: !withExistsError,
      },

      // Verdict
      verdict: existsFilterFailed
        ? '❌ SYNTAX REJECTED — $exists: false caused an error. Chat load filter is BROKEN and must be reverted.'
        : noArchivedToTest
        ? '⚠️ INCONCLUSIVE — no archived messages in this conversation. Syntax was accepted (no error) but exclusion cannot be verified. Try a conversation with archived messages.'
        : existsFilterWorked
        ? '✅ FILTER WORKS — $exists: false successfully excluded all archived messages. Chat load is safe.'
        : '❌ FILTER BROKEN — $exists: false returned archived messages that should have been excluded.',

      // Impact analysis
      impact: {
        archived_excluded_by_filter: archivedInAll - archivedInFiltered,
        count_reduction: allCount - filteredCount,
        safe_to_use_in_chat_load: !existsFilterFailed,
      },
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});