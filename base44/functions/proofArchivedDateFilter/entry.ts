/**
 * proofArchivedDateFilter
 *
 * Determine the correct filter syntax to exclude archived messages in Base44.
 *
 * The problem: messages with archived_date=null are being excluded by { $exists: false }
 * because Base44/MongoDB treats null as "field exists with null value", not "field absent".
 *
 * Test all candidate filter syntaxes to find which one correctly returns
 * messages where archived_date is null (not archived).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const convoId = body.conversation_id || '6a1f7be287bcb73fe95bdc4d';

    // Baseline: unfiltered count (we know all 50 have archived_date=null)
    const baseline = await base44.entities.Message.filter(
      { conversation_id: convoId },
      '-created_date', 50
    ).catch(e => ({ _error: e.message }));
    const baselineCount = Array.isArray(baseline) ? baseline.length : `error:${baseline?._error}`;

    // Candidate 1: { archived_date: { $exists: false } } — KNOWN TO FAIL (returns 0)
    const c1 = await base44.entities.Message.filter(
      { conversation_id: convoId, archived_date: { $exists: false } },
      '-created_date', 50
    ).catch(e => ({ _error: e.message }));

    // Candidate 2: { archived_date: null } — MongoDB: matches null OR absent
    const c2 = await base44.entities.Message.filter(
      { conversation_id: convoId, archived_date: null },
      '-created_date', 50
    ).catch(e => ({ _error: e.message }));

    // Candidate 3: No archived filter at all — rely on client-side filter
    const c3 = await base44.entities.Message.filter(
      { conversation_id: convoId },
      '-created_date', 50
    ).catch(e => ({ _error: e.message }));
    const c3ClientFiltered = Array.isArray(c3) ? c3.filter(m => !m.archived_date) : c3;

    // Candidate 4: { archived_date: { $in: [null] } } — explicit null match
    const c4 = await base44.entities.Message.filter(
      { conversation_id: convoId, archived_date: { $in: [null] } },
      '-created_date', 50
    ).catch(e => ({ _error: e.message }));

    // Candidate 5: { archived_date: { $eq: null } }
    const c5 = await base44.entities.Message.filter(
      { conversation_id: convoId, archived_date: { $eq: null } },
      '-created_date', 50
    ).catch(e => ({ _error: e.message }));

    // Candidate 6: { archived_date: { $not: { $exists: true } } }
    const c6 = await base44.entities.Message.filter(
      { conversation_id: convoId, archived_date: { $not: { $exists: true } } },
      '-created_date', 50
    ).catch(e => ({ _error: e.message }));

    const count = x => Array.isArray(x) ? x.length : (x?._error ? `error: ${x._error}` : 'unknown');
    const correct = x => count(x) === baselineCount;

    return Response.json({
      success: true,
      conversation_id: convoId,
      baseline_count: baselineCount,
      note: 'All baseline messages have archived_date=null. Correct filter should return all 50.',
      candidates: {
        c1_exists_false: { count: count(c1), correct: correct(c1), error: c1?._error || null },
        c2_null_direct: { count: count(c2), correct: correct(c2), error: c2?._error || null },
        c3_no_filter_client_side: { count: count(c3ClientFiltered), correct: count(c3ClientFiltered) === baselineCount, note: 'No server filter — client filters out archived_date truthy' },
        c4_in_null: { count: count(c4), correct: correct(c4), error: c4?._error || null },
        c5_eq_null: { count: count(c5), correct: correct(c5), error: c5?._error || null },
        c6_not_exists_true: { count: count(c6), correct: correct(c6), error: c6?._error || null },
      },
      recommendation: (() => {
        if (correct(c2)) return 'USE { archived_date: null } — matches null values correctly';
        if (correct(c4)) return 'USE { archived_date: { $in: [null] } }';
        if (correct(c5)) return 'USE { archived_date: { $eq: null } }';
        return 'USE client-side filter: fetch all, filter m => !m.archived_date';
      })(),
    });

  } catch (error) {
    console.error('[proofArchivedDateFilter]:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});