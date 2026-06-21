import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * fullWPMessageInspection
 *
 * COMPLETE, UNFILTERED World Phone message inspection for murqart@gmail.com.
 *
 * DESIGN PRINCIPLES:
 * - No is_narrative filter at DB level — fetches ALL messages, inspects client-side
 * - Paginated message fetch per conversation (100 per page)
 * - Emits every narrative record individually to logs (not truncated by response size)
 * - Accepts optional { start_convo_index } for resumable operation if needed
 * - Returns full audit: counts, per-record details, classification of every narrative
 *
 * NARRATIVE DETECTION:
 *   Truthy check: is_narrative === true || === 1 || === '1' || === 'true'
 *   NOT a DB filter — applies after fetch.
 *
 * BILATERAL PROOF:
 *   A record is classified as "legitimate_bilateral" only if BOTH
 *   sender_character_id AND receiver_character_id are non-null non-empty strings.
 *   Otherwise it is classified as "contamination" (no bilateral claim can be made).
 *
 * CONTAMINATION DEFINITION:
 *   is_narrative truthy
 *   AND canon_excluded !== true
 *   AND NOT bilateral
 *   AND character_id is present
 */

const OWNER_EMAIL = 'murqart@gmail.com';
const MSG_PAGE_SIZE = 100;
const CONVO_PAGE_SIZE = 50;

// Retry helper — handles 429 with exponential back-off
async function withRetry(fn, label, maxAttempts = 5) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const is429 = e.message?.includes('429') || e.message?.includes('Rate limit');
      if (is429 && i < maxAttempts - 1) {
        const delay = Math.min((i + 1) * 4000, 20000); // 4s, 8s, 12s, 16s, 20s
        console.log(`[fullWPInspect] 429 on ${label} — waiting ${delay}ms (attempt ${i + 2}/${maxAttempts})`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
}

// Classify a single narrative record
function classifyRecord(msg) {
  const hasBilateralSender = msg.sender_character_id && typeof msg.sender_character_id === 'string' && msg.sender_character_id.trim().length > 0;
  const hasBilateralReceiver = msg.receiver_character_id && typeof msg.receiver_character_id === 'string' && msg.receiver_character_id.trim().length > 0;
  const isBilateral = hasBilateralSender && hasBilateralReceiver;
  const isExcluded = msg.canon_excluded === true;
  const hasCharacterId = msg.character_id && typeof msg.character_id === 'string' && msg.character_id.trim().length > 0;

  if (isExcluded) return 'excluded';
  if (isBilateral) return 'legitimate_bilateral';
  if (!hasCharacterId) return 'no_character_id_unknown';
  return 'contamination';
}

// Detect is_narrative truthiness without DB filter dependency
function isNarrativeTruthy(val) {
  return val === true || val === 1 || val === '1' || val === 'true' ||
    (val !== null && val !== undefined && val !== false && val !== 0 && val !== '' && val !== 'false');
}

// Get stored type description
function storedType(val) {
  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  return `${typeof val}(${JSON.stringify(val)})`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admin only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const startConvoIndex = body?.start_convo_index || 0;
    const maxConvos = body?.max_convos || 9999; // safety valve — set high to get all

    const startedAt = new Date();
    console.log(`[fullWPInspect] START | owner=${OWNER_EMAIL} | start_convo_index=${startConvoIndex} | ${startedAt.toISOString()}`);

    // ── STEP 1: FETCH ALL WP CONVERSATIONS ──────────────────────────────────
    let allWPConvos = [];
    let convoPage = 0;
    while (true) {
      const batch = await withRetry(
        () => base44.asServiceRole.entities.Conversation.filter(
          { channel: 'world_phone', owner_email: OWNER_EMAIL },
          '-created_date',
          CONVO_PAGE_SIZE,
          convoPage * CONVO_PAGE_SIZE
        ),
        `convo-page-${convoPage}`
      );
      if (!batch || batch.length === 0) break;
      allWPConvos = allWPConvos.concat(batch);
      console.log(`[fullWPInspect] Loaded convo batch ${convoPage + 1}: ${batch.length} (total so far: ${allWPConvos.length})`);
      if (batch.length < CONVO_PAGE_SIZE) break;
      convoPage++;
    }

    const totalConvos = allWPConvos.length;
    console.log(`[fullWPInspect] Total WP conversations for ${OWNER_EMAIL}: ${totalConvos}`);

    // Apply start index and max_convos for resumable operation
    const convosToScan = allWPConvos.slice(startConvoIndex, startConvoIndex + maxConvos);
    console.log(`[fullWPInspect] Scanning convos [${startConvoIndex}..${startConvoIndex + convosToScan.length - 1}] of ${totalConvos}`);

    // ── STEP 2: INSPECT EVERY MESSAGE IN EVERY CONVERSATION ─────────────────
    const audit = {
      owner_email: OWNER_EMAIL,
      scan_started_at_et: startedAt.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      scan_started_at_utc: startedAt.toISOString(),
      total_wp_convos_found: totalConvos,
      convos_scanned_this_pass: 0,
      convo_index_start: startConvoIndex,
      convo_index_end: startConvoIndex + convosToScan.length - 1,
      total_messages_fetched: 0,
      total_narrative_records: 0,
      total_narrative_excluded: 0,
      total_narrative_non_excluded: 0,
      total_contamination: 0,
      total_legitimate_bilateral: 0,
      total_unknown: 0,
      narrative_records: [],          // full detail on EVERY narrative record
      contaminated_records: [],       // subset: only contamination
      non_excluded_records: [],       // subset: non-excluded (contamination + bilateral)
      newest_narrative_timestamp: null,
      newest_narrative_timestamp_et: null,
      newest_non_excluded_narrative_timestamp: null,
      newest_non_excluded_narrative_timestamp_et: null,
      post_repair_narrative_writes: [],
      errors: [],
    };

    // Repair deployed at approximately 6:30 PM Eastern on June 21, 2026
    const REPAIR_TIMESTAMP = '2026-06-21T22:30:00.000Z';

    let convoIdx = startConvoIndex;
    for (const convo of convosToScan) {
      audit.convos_scanned_this_pass++;
      convoIdx++;

      // Fetch ALL messages — no filter — full pagination
      let allMessages = [];
      let msgPage = 0;
      while (true) {
        const msgBatch = await withRetry(
          () => base44.asServiceRole.entities.Message.filter(
            { conversation_id: convo.id },
            '-timestamp',
            MSG_PAGE_SIZE,
            msgPage * MSG_PAGE_SIZE
          ),
          `msgs-convo-${convo.id}-page-${msgPage}`
        ).catch(e => {
          audit.errors.push({ convo_id: convo.id, page: msgPage, error: e.message });
          return [];
        });

        if (!msgBatch || msgBatch.length === 0) break;
        allMessages = allMessages.concat(msgBatch);
        if (msgBatch.length < MSG_PAGE_SIZE) break;
        msgPage++;
      }

      audit.total_messages_fetched += allMessages.length;

      if (convoIdx % 50 === 0 || allMessages.length > 0) {
        console.log(`[fullWPInspect] Convo ${convoIdx}/${totalConvos} | id=${convo.id} | messages=${allMessages.length}`);
      }

      // Inspect each message client-side
      for (const msg of allMessages) {
        // Client-side narrative detection — no DB filter dependency
        if (!isNarrativeTruthy(msg.is_narrative)) continue;

        audit.total_narrative_records++;

        const classification = classifyRecord(msg);
        const isNarrativeStoredType = storedType(msg.is_narrative);
        const ts = msg.timestamp || msg.created_date;
        const tsET = ts ? new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' }) : 'unknown';

        const record = {
          // Identity
          msg_id: msg.id,
          conversation_id: convo.id,
          conversation_title: (convo.title || '').substring(0, 80),
          owner_email: convo.owner_email || OWNER_EMAIL,
          // Character
          character_id: msg.character_id || null,
          character_name: msg.character_name || null,
          sender_character_id: msg.sender_character_id || null,
          receiver_character_id: msg.receiver_character_id || null,
          // Narrative flags
          is_narrative_stored_value: msg.is_narrative,
          is_narrative_stored_type: isNarrativeStoredType,
          canon_excluded: msg.canon_excluded,
          canon_exclusion_reason: msg.canon_exclusion_reason || null,
          canon_excluded_at: msg.canon_excluded_at || null,
          // Timestamps
          timestamp_utc: msg.timestamp || null,
          timestamp_et: tsET,
          created_date: msg.created_date || null,
          is_post_repair: ts ? ts > REPAIR_TIMESTAMP : false,
          // Content
          content_preview: (msg.content || '').substring(0, 120),
          // Classification
          classification,
          classification_reason: (() => {
            if (classification === 'excluded') return 'canon_excluded=true — removed from canon by prior remediation';
            if (classification === 'legitimate_bilateral') return `Both sender_character_id=${msg.sender_character_id} and receiver_character_id=${msg.receiver_character_id} are populated — valid bilateral World Phone exchange`;
            if (classification === 'contamination') return `is_narrative truthy, canon_excluded!=true, character_id present, no bilateral IDs — matches contamination definition`;
            if (classification === 'no_character_id_unknown') return 'is_narrative truthy, canon_excluded!=true, but no character_id — cannot classify definitively';
            return 'unknown';
          })(),
          autonomy_marker: msg.autonomy_marker || null,
          sender_type: msg.sender_type || null,
          channel: msg.channel || null,
        };

        audit.narrative_records.push(record);

        // Tally
        if (msg.canon_excluded === true) {
          audit.total_narrative_excluded++;
        } else {
          audit.total_narrative_non_excluded++;
          audit.non_excluded_records.push(record);

          if (classification === 'contamination') {
            audit.total_contamination++;
            audit.contaminated_records.push(record);
          } else if (classification === 'legitimate_bilateral') {
            audit.total_legitimate_bilateral++;
          } else {
            audit.total_unknown++;
          }

          // Track newest non-excluded narrative
          if (ts && (!audit.newest_non_excluded_narrative_timestamp || ts > audit.newest_non_excluded_narrative_timestamp)) {
            audit.newest_non_excluded_narrative_timestamp = ts;
            audit.newest_non_excluded_narrative_timestamp_et = tsET;
          }

          // Track post-repair writes
          if (record.is_post_repair) {
            audit.post_repair_narrative_writes.push(record);
          }
        }

        // Track newest narrative overall
        if (ts && (!audit.newest_narrative_timestamp || ts > audit.newest_narrative_timestamp)) {
          audit.newest_narrative_timestamp = ts;
          audit.newest_narrative_timestamp_et = new Date(ts).toLocaleString('en-US', { timeZone: 'America/New_York' });
        }

        // Emit each narrative record to logs individually (never truncated)
        console.log(
          `[NARRATIVE] msg_id=${msg.id}` +
          ` | convo_id=${convo.id}` +
          ` | char=${msg.character_name || 'null'}(${msg.character_id || 'null'})` +
          ` | sender_char_id=${msg.sender_character_id || 'null'}` +
          ` | recv_char_id=${msg.receiver_character_id || 'null'}` +
          ` | is_narrative=${isNarrativeStoredType}` +
          ` | canon_excluded=${msg.canon_excluded}` +
          ` | ts_et=${tsET}` +
          ` | classification=${classification}` +
          ` | preview="${record.content_preview}"`
        );
      }
    }

    const endedAt = new Date();
    const durationSeconds = Math.round((endedAt - startedAt) / 1000);
    audit.scan_ended_at_et = endedAt.toLocaleString('en-US', { timeZone: 'America/New_York' });
    audit.scan_duration_seconds = durationSeconds;

    // ── PASS/FAIL DETERMINATION ──────────────────────────────────────────────
    const isFullScan = (startConvoIndex === 0) && (audit.convos_scanned_this_pass === totalConvos);
    audit.is_complete_full_scan = isFullScan;
    audit.resume_next_start_index = startConvoIndex + audit.convos_scanned_this_pass;

    const allConditionsMet = isFullScan &&
      audit.total_messages_fetched > 0 &&
      audit.total_contamination === 0 &&
      audit.post_repair_narrative_writes.length === 0;

    audit.scan_result = allConditionsMet ? 'FIX VERIFIED' : 'FIX NOT VERIFIED';

    if (!allConditionsMet) {
      audit.fail_reasons = [];
      if (!isFullScan) audit.fail_reasons.push(`Partial scan only: covered convos ${startConvoIndex}–${audit.convo_index_end} of ${totalConvos}`);
      if (audit.total_messages_fetched === 0) audit.fail_reasons.push('No messages were fetched');
      if (audit.total_contamination > 0) audit.fail_reasons.push(`${audit.total_contamination} contaminated non-excluded narrative(s) remain`);
      if (audit.post_repair_narrative_writes.length > 0) audit.fail_reasons.push(`${audit.post_repair_narrative_writes.length} narrative(s) written to WP after repair deployment`);
    }

    console.log(`[fullWPInspect] COMPLETE | convos_scanned=${audit.convos_scanned_this_pass}/${totalConvos} | messages_fetched=${audit.total_messages_fetched} | narratives=${audit.total_narrative_records} | excluded=${audit.total_narrative_excluded} | non_excluded=${audit.total_narrative_non_excluded} | contamination=${audit.total_contamination} | bilateral=${audit.total_legitimate_bilateral} | duration=${durationSeconds}s | result=${audit.scan_result}`);

    // Emit full contamination detail to logs
    if (audit.contaminated_records.length > 0) {
      console.log(`[fullWPInspect] !! CONTAMINATION REMAINING (${audit.contaminated_records.length} records) !!`);
      for (const r of audit.contaminated_records) {
        console.log(`[CONTAMINATED] msg_id=${r.msg_id} | char=${r.character_name}(${r.character_id}) | ts_et=${r.timestamp_et} | preview="${r.content_preview}"`);
      }
    } else {
      console.log(`[fullWPInspect] CLEAN: zero contamination records remain.`);
    }

    // Emit full bilateral proof to logs
    if (audit.total_legitimate_bilateral > 0) {
      console.log(`[fullWPInspect] BILATERAL PROOF (${audit.total_legitimate_bilateral} records):`);
      for (const r of audit.non_excluded_records.filter(x => x.classification === 'legitimate_bilateral')) {
        console.log(`[BILATERAL] msg_id=${r.msg_id} | convo_id=${r.conversation_id} | sender_char_id=${r.sender_character_id} | recv_char_id=${r.receiver_character_id} | char=${r.character_name} | ts_et=${r.timestamp_et} | preview="${r.content_preview}"`);
      }
    }

    return Response.json({ success: true, audit });

  } catch (error) {
    console.error('[fullWPInspect] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});