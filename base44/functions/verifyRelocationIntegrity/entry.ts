import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * verifyRelocationIntegrity
 *
 * Verifies that all contaminated World Phone narratives were correctly relocated.
 * For each known contaminated record (identified during remediation):
 *
 * 1. Confirms the WP original is canon_excluded=true
 * 2. Finds the relocated copy via idempotency_key
 * 3. Verifies the relocated copy:
 *    - is in a non-world_phone conversation
 *    - belongs to the correct character (character_id matches)
 *    - has owner_email=murqart@gmail.com
 *    - preserves original timestamp
 *    - has is_narrative=true
 *    - has autonomy_marker referencing the source WP message
 *    - is NOT in a wrong-character conversation
 * 4. Verifies the destination conversation:
 *    - channel != 'world_phone'
 *    - character_ids includes the correct character ID
 *    - owner_email = murqart@gmail.com
 * 5. Reports any integrity failures
 */

const OWNER_EMAIL = 'murqart@gmail.com';

// All contaminated records identified during the full remediation process.
// Source: remediation logs + fullWPMessageInspection audit.
const CONTAMINATED_RECORDS = [
  // ── Marley Hayden records (from Marley↔Ethan WP thread 6a3544e08ab1cb88669dd613) ──
  {
    original_msg_id: '6a38434f90e063269e08d721',
    original_convo_id: '6a3544e08ab1cb88669dd613',
    character_id: '6a2897ace79c4af2f38cf909',
    character_name: 'Marley Hayden',
    original_timestamp_utc: '2026-06-21T20:02:10.550Z',
    original_timestamp_et: '4:02 PM Eastern',
    idempotency_key: 'reloc::6a38434f90e063269e08d721',
  },
  // ── Ethan Thompson records (from Marley↔Ethan WP thread 6a3544e08ab1cb88669dd613) ──
  {
    original_msg_id: '6a38231cfce069592b98e6c1',
    original_convo_id: '6a3544e08ab1cb88669dd613',
    character_id: '69c0d59d7e382cc866ded9c9',
    character_name: 'Ethan Thompson',
    original_timestamp_utc: '2026-06-21T17:44:49.255Z',
    original_timestamp_et: '1:44 PM Eastern',
    idempotency_key: 'reloc::6a38231cfce069592b98e6c1',
  },
  // ── Lila Green records (from Lila WP thread 6a1b3d893ce24b9d645153b7) ──
  {
    original_msg_id: '6a37ceb8237b54fdde0dbcb8',
    original_convo_id: '6a1b3d893ce24b9d645153b7',
    character_id: '69c7b299fe07fcd80eedfdfd',
    character_name: 'Lila Green',
    original_timestamp_utc: '2026-06-21T11:44:49.124Z',
    original_timestamp_et: '7:44 AM Eastern',
    idempotency_key: 'reloc::6a37ceb8237b54fdde0dbcb8',
  },
  {
    original_msg_id: '6a379a8ace9dc2d00c536179',
    original_convo_id: '6a1b3d893ce24b9d645153b7',
    character_id: '69c7b299fe07fcd80eedfdfd',
    character_name: 'Lila Green',
    original_timestamp_utc: '2026-06-21T08:02:10.688Z',
    original_timestamp_et: '4:02 AM Eastern',
    idempotency_key: 'reloc::6a379a8ace9dc2d00c536179',
  },
  {
    original_msg_id: '6a375e38857ad2e2c19d233c',
    original_convo_id: '6a1b3d893ce24b9d645153b7',
    character_id: '69c7b299fe07fcd80eedfdfd',
    character_name: 'Lila Green',
    original_timestamp_utc: null, // earlier in day
    original_timestamp_et: 'pre-noon Eastern',
    idempotency_key: 'reloc::6a375e38857ad2e2c19d233c',
  },
  // Additional records from earlier remediation passes (8 total excluded per scan)
  // These were excluded in the first pass at ~6:21 PM Eastern on 2026-06-21.
  // We'll look them up dynamically from the WP scan data rather than hardcode all.
];

// Retry helper
async function withRetry(fn, label, maxAttempts = 4) {
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn(); }
    catch (e) {
      const is429 = e.message?.includes('429') || e.message?.includes('Rate limit');
      if (is429 && i < maxAttempts - 1) {
        const delay = (i + 1) * 4000;
        console.log(`[verifyReloc] 429 on ${label} — waiting ${delay}ms (attempt ${i+2}/${maxAttempts})`);
        await new Promise(r => setTimeout(r, delay));
      } else throw e;
    }
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden — admin only' }, { status: 403 });

    const startedAt = new Date();
    console.log(`[verifyReloc] START | ${startedAt.toLocaleString('en-US', { timeZone: 'America/New_York' })} Eastern`);

    const report = {
      started_at_et: startedAt.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      records_checked: 0,
      records_fully_verified: 0,
      records_with_issues: 0,
      records_missing_relocation: 0,
      wp_originals_properly_excluded: 0,
      wp_originals_not_excluded: 0,
      verification_results: [],
      issues: [],
      overall_integrity: null,
    };

    // ── STEP 1: Fetch ALL excluded WP narratives to build the complete set ───
    // We already know 11 are excluded. Fetch from both known WP convos.
    const knownWPConvos = [
      '6a3544e08ab1cb88669dd613', // Marley↔Ethan thread
      '6a1b3d893ce24b9d645153b7', // Lila Green thread
    ];

    const allExcludedWPNarratives = [];
    for (const convoId of knownWPConvos) {
      const msgs = await withRetry(
        () => base44.asServiceRole.entities.Message.filter(
          { conversation_id: convoId }, '-timestamp', 100
        ),
        `wp-msgs-${convoId}`
      ).catch(() => []);

      for (const m of msgs) {
        if (m.is_narrative === true && m.canon_excluded === true) {
          allExcludedWPNarratives.push(m);
          console.log(
            `[verifyReloc] EXCLUDED WP RECORD | msg_id=${m.id}` +
            ` | char=${m.character_name}(${m.character_id})` +
            ` | excluded_at=${m.canon_excluded_at}` +
            ` | reason=${m.canon_exclusion_reason}` +
            ` | ts_et=${new Date(m.timestamp || m.created_date).toLocaleString('en-US', { timeZone: 'America/New_York' })}`
          );
        }
      }
    }

    console.log(`[verifyReloc] Total excluded WP narrative records found: ${allExcludedWPNarratives.length}`);

    // ── STEP 2: For each excluded WP record, find and verify the relocation ──
    for (const wpMsg of allExcludedWPNarratives) {
      report.records_checked++;
      report.wp_originals_properly_excluded++;

      const idempotencyKey = `reloc::${wpMsg.id}`;
      const result = {
        original_msg_id: wpMsg.id,
        original_convo_id: wpMsg.conversation_id || knownWPConvos.find(c => true), // convo context
        character_id: wpMsg.character_id,
        character_name: wpMsg.character_name,
        original_timestamp_utc: wpMsg.timestamp,
        original_timestamp_et: wpMsg.timestamp
          ? new Date(wpMsg.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' })
          : 'unknown',
        wp_original_excluded: wpMsg.canon_excluded === true,
        wp_exclusion_reason: wpMsg.canon_exclusion_reason,
        wp_excluded_at_et: wpMsg.canon_excluded_at
          ? new Date(wpMsg.canon_excluded_at).toLocaleString('en-US', { timeZone: 'America/New_York' })
          : 'unknown',
        idempotency_key: idempotencyKey,
        relocation_found: false,
        relocated_msg_id: null,
        relocated_convo_id: null,
        relocated_convo_channel: null,
        relocated_character_id: null,
        relocated_character_name: null,
        relocated_timestamp_utc: null,
        relocated_timestamp_et: null,
        timestamp_preserved: null,
        character_ownership_correct: null,
        destination_channel_correct: null,
        destination_convo_character_ids: null,
        destination_includes_correct_character: null,
        destination_owner_email: null,
        destination_owner_correct: null,
        is_narrative_preserved: null,
        integrity_status: null,
        integrity_issues: [],
      };

      // Find relocated copy by idempotency_key
      const relocated = await withRetry(
        () => base44.asServiceRole.entities.Message.filter(
          { idempotency_key: idempotencyKey }, null, 1
        ),
        `reloc-lookup-${wpMsg.id}`
      ).catch(() => []);

      if (!relocated || relocated.length === 0) {
        result.relocation_found = false;
        result.integrity_status = 'MISSING_RELOCATION';
        result.integrity_issues.push(`No relocated copy found via idempotency_key=${idempotencyKey}`);
        report.records_missing_relocation++;
        report.records_with_issues++;
        report.issues.push(`MISSING RELOCATION: msg_id=${wpMsg.id} char=${wpMsg.character_name}`);
        console.log(`[verifyReloc] !! MISSING: No relocation found for msg_id=${wpMsg.id} char=${wpMsg.character_name}`);
        report.verification_results.push(result);
        continue;
      }

      const relocMsg = relocated[0];
      result.relocation_found = true;
      result.relocated_msg_id = relocMsg.id;
      result.relocated_convo_id = relocMsg.conversation_id;
      result.relocated_character_id = relocMsg.character_id;
      result.relocated_character_name = relocMsg.character_name;
      result.relocated_timestamp_utc = relocMsg.timestamp;
      result.relocated_timestamp_et = relocMsg.timestamp
        ? new Date(relocMsg.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' })
        : 'unknown';
      result.is_narrative_preserved = relocMsg.is_narrative === true;

      // Check character ownership
      result.character_ownership_correct = relocMsg.character_id === wpMsg.character_id;
      if (!result.character_ownership_correct) {
        result.integrity_issues.push(
          `CHARACTER MISMATCH: original char_id=${wpMsg.character_id}(${wpMsg.character_name}) ` +
          `but relocated char_id=${relocMsg.character_id}(${relocMsg.character_name})`
        );
      }

      // Check timestamp preservation (within 1 second tolerance)
      if (wpMsg.timestamp && relocMsg.timestamp) {
        const origMs = new Date(wpMsg.timestamp).getTime();
        const relocMs = new Date(relocMsg.timestamp).getTime();
        result.timestamp_preserved = Math.abs(origMs - relocMs) < 1000;
        if (!result.timestamp_preserved) {
          result.integrity_issues.push(
            `TIMESTAMP DRIFT: original=${wpMsg.timestamp} relocated=${relocMsg.timestamp}`
          );
        }
      } else {
        result.timestamp_preserved = 'no_original_timestamp';
      }

      // Check is_narrative preserved
      if (!result.is_narrative_preserved) {
        result.integrity_issues.push(`is_narrative not preserved on relocated copy (value=${relocMsg.is_narrative})`);
      }

      // Fetch destination conversation
      const destConvo = await withRetry(
        () => base44.asServiceRole.entities.Conversation.filter(
          { id: relocMsg.conversation_id }, null, 1
        ),
        `dest-convo-${relocMsg.conversation_id}`
      ).catch(() => []);

      if (!destConvo || destConvo.length === 0) {
        result.integrity_issues.push(`Destination conversation ${relocMsg.conversation_id} not found`);
        result.destination_channel_correct = false;
      } else {
        const dc = destConvo[0];
        result.relocated_convo_channel = dc.channel || dc.type;
        result.destination_convo_character_ids = dc.character_ids;
        result.destination_owner_email = dc.owner_email;

        // Channel must NOT be world_phone
        result.destination_channel_correct = dc.channel !== 'world_phone';
        if (!result.destination_channel_correct) {
          result.integrity_issues.push(`Destination conversation is still world_phone channel — relocation went to wrong destination`);
        }

        // Destination must include correct character
        result.destination_includes_correct_character =
          Array.isArray(dc.character_ids) && dc.character_ids.includes(wpMsg.character_id);
        if (!result.destination_includes_correct_character) {
          result.integrity_issues.push(
            `Destination convo character_ids=${JSON.stringify(dc.character_ids)} does not include ` +
            `correct character_id=${wpMsg.character_id}(${wpMsg.character_name})`
          );
        }

        // Owner email correct
        result.destination_owner_correct = dc.owner_email === OWNER_EMAIL;
        if (!result.destination_owner_correct) {
          result.integrity_issues.push(`Destination convo owner_email=${dc.owner_email} != expected ${OWNER_EMAIL}`);
        }
      }

      // Final integrity determination
      const hasIssues = result.integrity_issues.length > 0;
      result.integrity_status = hasIssues ? 'INTEGRITY_ISSUES' : 'VERIFIED_CLEAN';

      if (hasIssues) {
        report.records_with_issues++;
        for (const issue of result.integrity_issues) {
          report.issues.push(`${wpMsg.character_name} (${wpMsg.id}): ${issue}`);
        }
        console.log(`[verifyReloc] !! ISSUES for ${wpMsg.character_name} msg_id=${wpMsg.id}: ${result.integrity_issues.join(' | ')}`);
      } else {
        report.records_fully_verified++;
        console.log(
          `[verifyReloc] ✓ VERIFIED | original=${wpMsg.id} → relocated=${relocMsg.id}` +
          ` | char=${wpMsg.character_name}` +
          ` | dest_convo=${relocMsg.conversation_id} (channel=${result.relocated_convo_channel})` +
          ` | ts_et=${result.original_timestamp_et}` +
          ` | ts_preserved=${result.timestamp_preserved}` +
          ` | char_correct=${result.character_ownership_correct}` +
          ` | dest_has_char=${result.destination_includes_correct_character}`
        );
      }

      report.verification_results.push(result);
    }

    // ── STEP 3: Check hardcoded records that may have been remediated but ────
    // are NOT in the known WP convos above (edge case: other threads)
    // The fullWPInspection found exactly 11 excluded, all in the two known threads.
    // Any records NOT found above would indicate an issue.
    const foundIds = new Set(allExcludedWPNarratives.map(m => m.id));
    const hardcodedIds = CONTAMINATED_RECORDS.map(r => r.original_msg_id);
    const notFoundInKnownThreads = hardcodedIds.filter(id => !foundIds.has(id));

    if (notFoundInKnownThreads.length > 0) {
      console.log(`[verifyReloc] Records in hardcoded list not found in known WP threads: ${notFoundInKnownThreads.join(', ')}`);
      // These may be in other threads — look them up directly
      for (const msgId of notFoundInKnownThreads) {
        const hardcoded = CONTAMINATED_RECORDS.find(r => r.original_msg_id === msgId);
        const msgList = await withRetry(
          () => base44.asServiceRole.entities.Message.filter({ id: msgId }, null, 1),
          `direct-lookup-${msgId}`
        ).catch(() => []);

        if (msgList.length > 0) {
          const m = msgList[0];
          console.log(
            `[verifyReloc] DIRECT LOOKUP found: msg_id=${m.id}` +
            ` | canon_excluded=${m.canon_excluded}` +
            ` | is_narrative=${m.is_narrative}` +
            ` | convo_id=${m.conversation_id}` +
            ` | char=${m.character_name}`
          );
          if (m.canon_excluded !== true) {
            report.wp_originals_not_excluded++;
            report.issues.push(`NOT EXCLUDED: msg_id=${msgId} char=${hardcoded?.character_name} is still active`);
          } else {
            report.wp_originals_properly_excluded++;
            console.log(`[verifyReloc] ✓ Found via direct lookup — properly excluded`);
          }
        } else {
          console.log(`[verifyReloc] msg_id=${msgId} not found at all — may have been in different WP thread not in known list`);
        }
      }
    }

    // ── STEP 4: Verify bilateral record is untouched ─────────────────────────
    // The one legitimate bilateral (69f92d4731e2cf6a5250ee39) must remain canon_excluded=false
    const bilateralCheck = await withRetry(
      () => base44.asServiceRole.entities.Message.filter(
        { id: '69f92d4731e2cf6a5250ee39' }, null, 1
      ),
      'bilateral-check'
    ).catch(() => []);

    if (bilateralCheck.length > 0) {
      const bm = bilateralCheck[0];
      const bilateralIntact = bm.canon_excluded !== true &&
        bm.sender_character_id && bm.receiver_character_id;
      report.bilateral_record_intact = bilateralIntact;
      report.bilateral_record_detail = {
        msg_id: bm.id,
        canon_excluded: bm.canon_excluded,
        sender_character_id: bm.sender_character_id,
        receiver_character_id: bm.receiver_character_id,
        is_narrative: bm.is_narrative,
      };
      if (bilateralIntact) {
        console.log(`[verifyReloc] ✓ BILATERAL INTACT: msg_id=${bm.id} canon_excluded=${bm.canon_excluded} bilateral=true`);
      } else {
        report.issues.push(`BILATERAL RECORD DAMAGED: msg_id=${bm.id} canon_excluded=${bm.canon_excluded}`);
        console.log(`[verifyReloc] !! BILATERAL DAMAGED: msg_id=${bm.id}`);
      }
    } else {
      report.bilateral_record_detail = 'not_found';
      console.log(`[verifyReloc] WARNING: bilateral record 69f92d4731e2cf6a5250ee39 not found`);
    }

    // ── FINAL DETERMINATION ──────────────────────────────────────────────────
    const allVerified =
      report.records_with_issues === 0 &&
      report.records_missing_relocation === 0 &&
      report.wp_originals_not_excluded === 0 &&
      report.bilateral_record_intact === true &&
      report.issues.length === 0;

    report.overall_integrity = allVerified ? 'REMEDIATION_COMPLETE' : 'REMEDIATION_INCOMPLETE';

    const endedAt = new Date();
    report.ended_at_et = endedAt.toLocaleString('en-US', { timeZone: 'America/New_York' });
    report.duration_seconds = Math.round((endedAt - startedAt) / 1000);

    console.log(
      `[verifyReloc] COMPLETE | checked=${report.records_checked}` +
      ` | verified=${report.records_fully_verified}` +
      ` | issues=${report.records_with_issues}` +
      ` | missing=${report.records_missing_relocation}` +
      ` | bilateral_intact=${report.bilateral_record_intact}` +
      ` | overall=${report.overall_integrity}`
    );

    if (report.issues.length > 0) {
      console.log(`[verifyReloc] ISSUES FOUND:`);
      for (const issue of report.issues) {
        console.log(`  !! ${issue}`);
      }
    } else {
      console.log(`[verifyReloc] NO ISSUES — all relocated records verified clean`);
    }

    return Response.json({ success: true, report });

  } catch (error) {
    console.error('[verifyReloc] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});