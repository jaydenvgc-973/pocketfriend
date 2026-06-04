/**
 * proofExistsFilterScope
 *
 * Prove whether the $exists:false discrepancy is:
 * A) All messages in conversation truly have archived_date set
 * B) user-scoped filter behaves differently from service-role for $exists
 * C) The user-scoped filter doesn't support $exists at all (falls back to no filter)
 *
 * Uses the conversation from proofRegenMessageLookup: 6a1f7be287bcb73fe95bdc4d
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const convoId = body.conversation_id || '6a1f7be287bcb73fe95bdc4d';

    // Test 1: user-scoped filter WITHOUT $exists
    const userAll = await base44.entities.Message.filter(
      { conversation_id: convoId },
      '-created_date',
      50
    ).catch(e => ({ _error: e.message }));

    // Test 2: user-scoped filter WITH $exists:false
    const userNonArchived = await base44.entities.Message.filter(
      { conversation_id: convoId, archived_date: { $exists: false } },
      '-created_date',
      50
    ).catch(e => ({ _error: e.message }));

    // Test 3: service-role filter WITHOUT $exists
    const srAll = await base44.asServiceRole.entities.Message.filter(
      { conversation_id: convoId },
      '-created_date',
      50
    ).catch(e => ({ _error: e.message }));

    // Test 4: service-role filter WITH $exists:false
    const srNonArchived = await base44.asServiceRole.entities.Message.filter(
      { conversation_id: convoId, archived_date: { $exists: false } },
      '-created_date',
      50
    ).catch(e => ({ _error: e.message }));

    // Inspect: what do the actual messages look like?
    const userAllSample = Array.isArray(userAll)
      ? userAll.slice(0, 5).map(m => ({
          id: m.id,
          archived_date: m.archived_date ?? null,
          content_preview: (m.content || '').substring(0, 30),
        }))
      : [];

    const userNonArchivedSample = Array.isArray(userNonArchived)
      ? userNonArchived.slice(0, 5).map(m => ({
          id: m.id,
          archived_date: m.archived_date ?? null,
          content_preview: (m.content || '').substring(0, 30),
        }))
      : [];

    const userAllCount = Array.isArray(userAll) ? userAll.length : `error: ${userAll?._error}`;
    const userNonArchivedCount = Array.isArray(userNonArchived) ? userNonArchived.length : `error: ${userNonArchived?._error}`;
    const srAllCount = Array.isArray(srAll) ? srAll.length : `error: ${srAll?._error}`;
    const srNonArchivedCount = Array.isArray(srNonArchived) ? srNonArchived.length : `error: ${srNonArchived?._error}`;

    // Count messages with archived_date set in the user-scoped all-messages result
    const userArchivedCount = Array.isArray(userAll)
      ? userAll.filter(m => m.archived_date != null).length
      : null;

    const srArchivedCount = Array.isArray(srAll)
      ? srAll.filter(m => m.archived_date != null).length
      : null;

    // Verdict on what's happening
    let verdict = '';
    if (typeof userAllCount === 'number' && typeof userNonArchivedCount === 'number') {
      if (userArchivedCount === userAllCount) {
        verdict = 'ALL messages in this conversation have archived_date set — $exists:false correctly returns 0. The filter WORKS. The conversation is fully archived.';
      } else if (userNonArchivedCount === userAllCount) {
        verdict = '$exists:false filter returned same count as unfiltered — $exists filter may not be applied server-side (user-scoped). RISK: archived messages may appear in chat load.';
      } else if (userNonArchivedCount < userAllCount) {
        verdict = '$exists:false filter works correctly — filtered out archived messages as expected.';
      } else {
        verdict = 'Unexpected result — investigate further.';
      }
    }

    return Response.json({
      success: true,
      conversation_id: convoId,
      user_scoped: {
        all_count: userAllCount,
        non_archived_count: userNonArchivedCount,
        archived_in_all: userArchivedCount,
        non_archived_error: userNonArchived?._error || null,
        sample_all: userAllSample,
        sample_non_archived: userNonArchivedSample,
      },
      service_role: {
        all_count: srAllCount,
        non_archived_count: srNonArchivedCount,
        archived_in_all: srArchivedCount,
        non_archived_error: srNonArchived?._error || null,
      },
      verdict,
      conclusion: {
        exists_filter_syntax_supported: !userNonArchived?._error,
        exists_filter_actually_filters: typeof userNonArchivedCount === 'number' && userNonArchivedCount < userAllCount || userArchivedCount === userAllCount,
        chat_load_filter_safe_to_use: !userNonArchived?._error,
      },
    });

  } catch (error) {
    console.error('[proofExistsFilterScope]:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});