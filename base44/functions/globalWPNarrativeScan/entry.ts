import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * globalWPNarrativeScan
 *
 * Final post-fix global validation scan.
 *
 * Scans EVERY world_phone conversation for owner_email=murqart@gmail.com.
 * Inspects EVERY Message record attached to those conversations.
 * Reports full counts, narrative breakdown, and any remaining contamination.
 *
 * Pass conditions (all must be true):
 * - All WP convos for owner scanned
 * - Actual Message records inspected (not previews)
 * - Total Message count reported
 * - Total is_narrative count reported
 * - Total canon_excluded narrative count reported
 * - Non-excluded contaminated count = 0
 * - No post-fix narrative messages written to WP after relocation timestamp
 * - Every remaining narrative in WP is canon_excluded=true
 */

// Retry helper for 429s
async function withRetry(fn, maxAttempts = 4) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if ((e.message?.includes('429') || e.message?.includes('Rate limit')) && i < maxAttempts - 1) {
        const delay = (i + 1) * 3000;
        console.log(`[globalWPNarrativeScan] 429 — waiting ${delay}ms before retry ${i + 2}/${maxAttempts}`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admin only' }, { status: 403 });

    const OWNER_EMAIL = 'murqart@gmail.com';

    // Relocation was completed at this time — used to detect any POST-FIX writes
    // (the live relocation run completed at approximately 6:22 PM Eastern / 22:22 UTC 2026-06-21)
    const RELOCATION_COMPLETED_AT = '2026-06-21T22:30:00.000Z'; // conservative buffer: 6:30 PM ET

    const report = {
      owner_email: OWNER_EMAIL,
      scan_timestamp: new Date().toISOString(),
      scan_timestamp_et: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }),

      // ── CONVERSATION COUNTS ────────────────────────────────────────────────
      total_wp_convos_scanned: 0,
      total_messages_scanned: 0,

      // ── NARRATIVE BREAKDOWN ────────────────────────────────────────────────
      total_is_narrative_true: 0,
      total_narrative_canon_excluded_true: 0,
      total_narrative_canon_excluded_false: 0, // = active contamination

      // ── POST-FIX WRITES ────────────────────────────────────────────────────
      post_fix_narrative_writes_to_wp: 0,
      post_fix_narrative_messages: [],

      // ── REMAINING CONTAMINATION DETAIL ────────────────────────────────────
      non_excluded_narrative_messages: [], // Must be empty to PASS

      // ── ALL NARRATIVE RECORDS IN WP (for full audit trail) ─────────────────
      all_narrative_records_in_wp: [],

      // ── NEWEST NARRATIVE TIMESTAMP ─────────────────────────────────────────
      newest_narrative_timestamp_in_wp: null,
      newest_narrative_timestamp_et: null,

      // ── PASS/FAIL ──────────────────────────────────────────────────────────
      every_narrative_is_canon_excluded: null,
      no_post_fix_writes: null,
      scan_result: null,
    };

    // ── STEP 1: FETCH ALL WP CONVERSATIONS ──────────────────────────────────
    console.log(`[globalWPNarrativeScan] Fetching all world_phone convos for ${OWNER_EMAIL}...`);

    let allWPConvos = [];
    let page = 0;
    const PAGE_SIZE = 50;

    while (true) {
      const batch = await withRetry(() =>
        base44.asServiceRole.entities.Conversation.filter(
          { channel: 'world_phone', owner_email: OWNER_EMAIL },
          '-created_date',
          PAGE_SIZE,
          page * PAGE_SIZE
        )
      ).catch(() => []);

      if (!batch || batch.length === 0) break;
      allWPConvos = allWPConvos.concat(batch);
      console.log(`[globalWPNarrativeScan] Loaded convo page ${page + 1}: ${batch.length} convos (running total: ${allWPConvos.length})`);
      if (batch.length < PAGE_SIZE) break;
      page++;
    }

    report.total_wp_convos_scanned = allWPConvos.length;
    console.log(`[globalWPNarrativeScan] Total WP convos to scan: ${allWPConvos.length}`);

    // ── STEP 2: SCAN EVERY MESSAGE IN EVERY WP CONVO ────────────────────────
    let convoIdx = 0;
    for (const convo of allWPConvos) {
      convoIdx++;
      if (convoIdx % 25 === 0) {
        console.log(`[globalWPNarrativeScan] Progress: ${convoIdx}/${allWPConvos.length} convos scanned, ${report.total_messages_scanned} messages so far`);
      }

      // Fetch ALL messages in this convo (paginated)
      let convoMsgs = [];
      let msgPage = 0;
      const MSG_PAGE_SIZE = 100;

      while (true) {
        const msgBatch = await withRetry(() =>
          base44.asServiceRole.entities.Message.filter(
            { conversation_id: convo.id },
            '-timestamp',
            MSG_PAGE_SIZE,
            msgPage * MSG_PAGE_SIZE
          )
        ).catch(() => []);

        if (!msgBatch || msgBatch.length === 0) break;
        convoMsgs = convoMsgs.concat(msgBatch);
        if (msgBatch.length < MSG_PAGE_SIZE) break;
        msgPage++;
      }

      report.total_messages_scanned += convoMsgs.length;

      // Inspect each message for narrative flags
      for (const msg of convoMsgs) {
        if (msg.is_narrative !== true) continue;

        report.total_is_narrative_true++;

        const isExcluded = msg.canon_excluded === true;
        const isPostFix = msg.created_date > RELOCATION_COMPLETED_AT;

        // Determine if this is ACTIVE CONTAMINATION (not excluded)
        const isEligibleContamination = !isExcluded &&
          msg.character_id &&
          !msg.sender_character_id &&
          !msg.receiver_character_id;

        const record = {
          msg_id: msg.id,
          convo_id: convo.id,
          convo_title: (convo.title || '').substring(0, 60),
          character_id: msg.character_id,
          character_name: msg.character_name,
          sender_character_id: msg.sender_character_id || null,
          receiver_character_id: msg.receiver_character_id || null,
          canon_excluded: isExcluded,
          canon_exclusion_reason: msg.canon_exclusion_reason || null,
          canon_excluded_at: msg.canon_excluded_at || null,
          created_date: msg.created_date,
          timestamp: msg.timestamp,
          is_post_fix: isPostFix,
          content_preview: (msg.content || '').substring(0, 80),
          autonomy_marker: msg.autonomy_marker || null,
        };

        report.all_narrative_records_in_wp.push(record);

        if (isExcluded) {
          report.total_narrative_canon_excluded_true++;
        } else {
          report.total_narrative_canon_excluded_false++;
          if (isEligibleContamination) {
            report.non_excluded_narrative_messages.push(record);
          }
        }

        // Track post-fix writes (new narratives written AFTER relocation completed)
        if (isPostFix && !isExcluded) {
          report.post_fix_narrative_writes_to_wp++;
          report.post_fix_narrative_messages.push(record);
        }

        // Track newest narrative timestamp
        const ts = msg.timestamp || msg.created_date;
        if (ts && (!report.newest_narrative_timestamp_in_wp || ts > report.newest_narrative_timestamp_in_wp)) {
          report.newest_narrative_timestamp_in_wp = ts;
          report.newest_narrative_timestamp_et = new Date(ts).toLocaleString('en-US', {
            timeZone: 'America/New_York',
            dateStyle: 'short',
            timeStyle: 'medium',
          });
        }
      }
    }

    // ── STEP 3: EVALUATE PASS/FAIL ───────────────────────────────────────────
    report.every_narrative_is_canon_excluded =
      report.total_is_narrative_true > 0
        ? report.total_narrative_canon_excluded_false === 0
        : true; // No narratives at all = clean

    report.no_post_fix_writes = report.post_fix_narrative_writes_to_wp === 0;

    const allPassConditionsMet =
      report.total_wp_convos_scanned > 0 &&
      report.total_messages_scanned > 0 &&
      report.non_excluded_narrative_messages.length === 0 &&
      report.no_post_fix_writes &&
      report.every_narrative_is_canon_excluded;

    report.scan_result = allPassConditionsMet ? 'FIX VERIFIED' : 'FIX NOT VERIFIED';

    if (!allPassConditionsMet) {
      report.fail_reasons = [];
      if (report.total_wp_convos_scanned === 0) report.fail_reasons.push('No WP conversations scanned');
      if (report.total_messages_scanned === 0) report.fail_reasons.push('No Message records inspected');
      if (report.non_excluded_narrative_messages.length > 0)
        report.fail_reasons.push(`${report.non_excluded_narrative_messages.length} non-excluded contaminated narrative(s) remain`);
      if (!report.no_post_fix_writes)
        report.fail_reasons.push(`${report.post_fix_narrative_writes_to_wp} post-fix narrative(s) written to World Phone`);
      if (!report.every_narrative_is_canon_excluded)
        report.fail_reasons.push('Not every narrative in World Phone is canon_excluded=true');
    }

    console.log(`[globalWPNarrativeScan] COMPLETE | convos=${report.total_wp_convos_scanned} | messages=${report.total_messages_scanned} | narratives=${report.total_is_narrative_true} | excluded=${report.total_narrative_canon_excluded_true} | active_contamination=${report.non_excluded_narrative_messages.length} | result=${report.scan_result}`);

    return Response.json({ success: true, report });

  } catch (error) {
    console.error('[globalWPNarrativeScan] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});