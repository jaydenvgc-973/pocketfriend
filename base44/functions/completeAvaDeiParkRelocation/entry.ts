import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * completeAvaDeiParkRelocation
 *
 * Completes the relocation of 2 Ava Dei Park narrative records that were
 * excluded from World Phone but never relocated to their correct destination.
 *
 * Records:
 *   6a377e6eb6cbff777a1b8bea — ts: 2:02 AM Eastern, June 21 2026
 *   6a375e3da71cd4e727db8904 — ts: 11:44 PM Eastern, June 20 2026
 *
 * Both belong to Ava Dei Park (character_id: 69c0c0e2945e5649ef6e72f8)
 * Both are in WP thread: 6a29be0a0b09de314b3d7963
 * Both are already canon_excluded=true (WP copy is clean)
 * Both lack idempotency_key (prior relocation was skipped)
 *
 * Action:
 *   1. Find Ava Dei Park's direct (non-WP) conversation for owner murqart@gmail.com
 *   2. If none exists, create one
 *   3. Copy each narrative to the direct conversation with idempotency_key
 *   4. Update the WP copy's autonomy_marker to reference the relocation
 *   5. Verify both copies
 */

const OWNER_EMAIL = 'murqart@gmail.com';
const AVA_CHARACTER_ID = '69c0c0e2945e5649ef6e72f8';
const AVA_CHARACTER_NAME = 'Ava Dei Park';
const WP_CONVO_ID = '6a29be0a0b09de314b3d7963';

const RECORDS_TO_RELOCATE = [
  {
    msg_id: '6a377e6eb6cbff777a1b8bea',
    timestamp_utc: '2026-06-21T06:02:10.792Z',
    timestamp_et: '2:02 AM Eastern, June 21 2026',
    idempotency_key: 'reloc::6a377e6eb6cbff777a1b8bea',
  },
  {
    msg_id: '6a375e3da71cd4e727db8904',
    timestamp_utc: '2026-06-21T03:44:49.244Z',
    timestamp_et: '11:44 PM Eastern, June 20 2026',
    idempotency_key: 'reloc::6a375e3da71cd4e727db8904',
  },
];

async function withRetry(fn, label, maxAttempts = 4) {
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn(); }
    catch (e) {
      const is429 = e.message?.includes('429') || e.message?.includes('Rate limit');
      if (is429 && i < maxAttempts - 1) {
        const delay = (i + 1) * 4000;
        console.log(`[avaReloc] 429 on ${label} — waiting ${delay}ms (attempt ${i+2}/${maxAttempts})`);
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

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true; // default: execute (not dry run)

    const startedAt = new Date();
    console.log(`[avaReloc] START | dry_run=${dryRun} | ${startedAt.toLocaleString('en-US', { timeZone: 'America/New_York' })} Eastern`);

    const report = {
      dry_run: dryRun,
      started_at_et: startedAt.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      character: AVA_CHARACTER_NAME,
      character_id: AVA_CHARACTER_ID,
      records_to_relocate: RECORDS_TO_RELOCATE.length,
      destination_convo_id: null,
      destination_convo_created: false,
      relocations: [],
      issues: [],
      overall_status: null,
    };

    // ── STEP 1: Fetch original WP messages to get content ───────────────────
    const wpMsgs = {};
    for (const rec of RECORDS_TO_RELOCATE) {
      const msgList = await withRetry(
        () => base44.asServiceRole.entities.Message.filter({ id: rec.msg_id }, null, 1),
        `fetch-${rec.msg_id}`
      ).catch(() => []);

      if (msgList.length === 0) {
        report.issues.push(`Original WP message not found: ${rec.msg_id}`);
        console.log(`[avaReloc] !! NOT FOUND: ${rec.msg_id}`);
        continue;
      }
      wpMsgs[rec.msg_id] = msgList[0];
      const m = msgList[0];
      console.log(
        `[avaReloc] Original WP message found: msg_id=${m.id}` +
        ` | canon_excluded=${m.canon_excluded}` +
        ` | is_narrative=${m.is_narrative}` +
        ` | ts_et=${new Date(m.timestamp || m.created_date).toLocaleString('en-US', { timeZone: 'America/New_York' })}`
      );
    }

    // ── STEP 2: Find or create Ava's direct conversation ────────────────────
    const candidateConvos = await withRetry(
      () => base44.asServiceRole.entities.Conversation.filter(
        { type: 'direct', owner_email: OWNER_EMAIL }, '-last_message_date', 50
      ),
      'find-ava-direct-convo'
    ).catch(() => []);

    const directConvos = candidateConvos.filter(c =>
      Array.isArray(c.character_ids) &&
      c.character_ids.includes(AVA_CHARACTER_ID) &&
      c.channel !== 'world_phone'
    );

    let destConvo = directConvos.length > 0 ? directConvos[0] : null;

    if (!destConvo) {
      console.log(`[avaReloc] No direct convo found for Ava Dei Park — ${dryRun ? 'would create' : 'creating'}`);
      if (!dryRun) {
        destConvo = await withRetry(
          () => base44.asServiceRole.entities.Conversation.create({
            title: AVA_CHARACTER_NAME,
            type: 'direct',
            character_ids: [AVA_CHARACTER_ID],
            owner_email: OWNER_EMAIL,
            channel: 'direct',
          }),
          'create-ava-direct-convo'
        );
        report.destination_convo_created = true;
        console.log(`[avaReloc] Created direct convo for Ava: ${destConvo.id}`);
      } else {
        report.destination_convo_id = 'would_be_created';
        report.overall_status = 'DRY_RUN_WOULD_CREATE_AND_RELOCATE';
        return Response.json({ success: true, report });
      }
    } else {
      console.log(`[avaReloc] Found existing direct convo for Ava: ${destConvo.id}`);
    }

    report.destination_convo_id = destConvo.id;

    // ── STEP 3: Relocate each record ─────────────────────────────────────────
    let allSucceeded = true;

    for (const rec of RECORDS_TO_RELOCATE) {
      const result = {
        original_msg_id: rec.msg_id,
        timestamp_et: rec.timestamp_et,
        idempotency_key: rec.idempotency_key,
        status: null,
        new_msg_id: null,
        error: null,
      };

      const wpMsg = wpMsgs[rec.msg_id];
      if (!wpMsg) {
        result.status = 'SKIPPED_ORIGINAL_NOT_FOUND';
        result.error = 'Original WP message not found — cannot relocate';
        allSucceeded = false;
        report.relocations.push(result);
        continue;
      }

      // Check idempotency — has this already been relocated by a previous attempt?
      const existing = await withRetry(
        () => base44.asServiceRole.entities.Message.filter(
          { idempotency_key: rec.idempotency_key }, null, 1
        ),
        `idempotency-${rec.msg_id}`
      ).catch(() => []);

      if (existing.length > 0) {
        result.status = 'ALREADY_RELOCATED';
        result.new_msg_id = existing[0].id;
        console.log(`[avaReloc] Already relocated: ${rec.msg_id} → ${existing[0].id}`);
        report.relocations.push(result);
        continue;
      }

      if (dryRun) {
        result.status = 'DRY_RUN_WOULD_RELOCATE';
        report.relocations.push(result);
        continue;
      }

      // Create the relocated copy in Ava's direct conversation
      const newMsg = await withRetry(
        () => base44.asServiceRole.entities.Message.create({
          conversation_id: destConvo.id,
          sender_type: 'character',
          character_id: AVA_CHARACTER_ID,
          character_name: AVA_CHARACTER_NAME,
          content: wpMsg.content,
          is_narrative: true,
          is_read: false,
          timestamp: wpMsg.timestamp || new Date().toISOString(),
          channel: 'direct',
          idempotency_key: rec.idempotency_key,
          autonomy_marker: `relocated_from_world_phone::${rec.msg_id}::${WP_CONVO_ID}`,
          memory_eligible: wpMsg.memory_eligible !== false,
          relationship_eligible: false,
          recovery_signal: false,
        }),
        `create-reloc-${rec.msg_id}`
      );

      result.new_msg_id = newMsg.id;
      result.status = 'RELOCATED';
      console.log(`[avaReloc] ✓ RELOCATED: ${rec.msg_id} → ${newMsg.id} in convo ${destConvo.id}`);

      // Update the WP original to stamp the relocation reference
      await withRetry(
        () => base44.asServiceRole.entities.Message.update(rec.msg_id, {
          autonomy_marker: `relocated_to::${newMsg.id}::${destConvo.id}`,
        }),
        `stamp-wp-${rec.msg_id}`
      ).catch(e => {
        console.log(`[avaReloc] Warning: could not stamp WP original ${rec.msg_id}: ${e.message}`);
      });

      report.relocations.push(result);
    }

    // Update destination convo preview with most recent narrative
    if (!dryRun && destConvo) {
      const latestMsg = Object.values(wpMsgs).sort((a, b) =>
        new Date(b.timestamp || 0) - new Date(a.timestamp || 0)
      )[0];
      if (latestMsg) {
        await withRetry(
          () => base44.asServiceRole.entities.Conversation.update(destConvo.id, {
            last_message_preview: (latestMsg.content || '').substring(0, 100),
            last_message_date: latestMsg.timestamp || new Date().toISOString(),
          }),
          'update-convo-preview'
        ).catch(() => {});
      }
    }

    // ── STEP 4: Verify both relocations ──────────────────────────────────────
    const verifyResults = [];
    if (!dryRun) {
      for (const rel of report.relocations) {
        if (rel.status === 'RELOCATED' || rel.status === 'ALREADY_RELOCATED') {
          const verifyMsg = await withRetry(
            () => base44.asServiceRole.entities.Message.filter({ id: rel.new_msg_id }, null, 1),
            `verify-${rel.new_msg_id}`
          ).catch(() => []);

          if (verifyMsg.length > 0) {
            const vm = verifyMsg[0];
            const verified = vm.character_id === AVA_CHARACTER_ID &&
              vm.conversation_id === destConvo.id &&
              vm.is_narrative === true;
            verifyResults.push({
              relocated_msg_id: rel.new_msg_id,
              character_correct: vm.character_id === AVA_CHARACTER_ID,
              destination_correct: vm.conversation_id === destConvo.id,
              is_narrative_preserved: vm.is_narrative === true,
              verified,
            });
            console.log(
              `[avaReloc] ✓ VERIFY: ${rel.new_msg_id}` +
              ` char_correct=${vm.character_id === AVA_CHARACTER_ID}` +
              ` dest_correct=${vm.conversation_id === destConvo.id}` +
              ` is_narrative=${vm.is_narrative}` +
              ` | ${verified ? 'PASS' : 'FAIL'}`
            );
          }
        }
      }
    }

    report.verification_results = verifyResults;

    const allVerified = verifyResults.every(v => v.verified);
    const anyIssues = report.issues.length > 0 || !allSucceeded;

    report.overall_status = dryRun
      ? 'DRY_RUN_COMPLETE'
      : (allVerified && !anyIssues ? 'RELOCATION_COMPLETE' : 'RELOCATION_PARTIAL');

    const endedAt = new Date();
    report.ended_at_et = endedAt.toLocaleString('en-US', { timeZone: 'America/New_York' });

    console.log(
      `[avaReloc] COMPLETE | relocations=${report.relocations.length}` +
      ` | verified=${verifyResults.filter(v => v.verified).length}` +
      ` | issues=${report.issues.length}` +
      ` | overall=${report.overall_status}`
    );

    return Response.json({ success: true, report });

  } catch (error) {
    console.error('[avaReloc] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});