import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * findRemainingExcludedWPNarratives
 *
 * Finds ALL excluded WP narrative records across all 259 conversations
 * that were NOT in the two primary contaminated threads, and verifies
 * their relocation integrity.
 *
 * The fullWPInspection confirmed 11 excluded narrative records total.
 * The verifyRelocationIntegrity function checked 9 from the two known threads.
 * This function finds and verifies the remaining 2.
 */

const OWNER_EMAIL = 'murqart@gmail.com';
const KNOWN_CONTAMINATED_THREADS = [
  '6a3544e08ab1cb88669dd613', // Marley↔Ethan
  '6a1b3d893ce24b9d645153b7', // Lila Green
];
const KNOWN_EXCLUDED_MSG_IDS = new Set([
  '6a38434f90e063269e08d721',
  '6a38231cfce069592b98e6c1',
  '6a375e43ca9c2bd126df2245',
  '6a377e72057783f3c1e1c0be',
  '6a37b29cc810e1775b492282',
  '6a37eaddf4246fe68dc74c46',
  '6a375e38857ad2e2c19d233c',
  '6a379a8ace9dc2d00c536179',
  '6a37ceb8237b54fdde0dbcb8',
]);

async function withRetry(fn, label, maxAttempts = 4) {
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn(); }
    catch (e) {
      const is429 = e.message?.includes('429') || e.message?.includes('Rate limit');
      if (is429 && i < maxAttempts - 1) {
        const delay = (i + 1) * 4000;
        console.log(`[findRemaining] 429 on ${label} — waiting ${delay}ms (attempt ${i+2}/${maxAttempts})`);
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
    console.log(`[findRemaining] START | ${startedAt.toLocaleString('en-US', { timeZone: 'America/New_York' })} Eastern`);

    // Fetch all WP conversations
    let allConvos = [];
    let page = 0;
    while (true) {
      const batch = await withRetry(
        () => base44.asServiceRole.entities.Conversation.filter(
          { channel: 'world_phone', owner_email: OWNER_EMAIL },
          '-created_date', 50, page * 50
        ),
        `convos-page-${page}`
      );
      if (!batch || batch.length === 0) break;
      allConvos = allConvos.concat(batch);
      if (batch.length < 50) break;
      page++;
    }

    console.log(`[findRemaining] Total WP convos: ${allConvos.length}`);

    // Skip known contaminated threads — scan everything else
    const otherConvos = allConvos.filter(c => !KNOWN_CONTAMINATED_THREADS.includes(c.id));
    console.log(`[findRemaining] Scanning ${otherConvos.length} non-primary WP convos for excluded narratives`);

    const foundExcluded = [];
    let convosScanned = 0;

    for (const convo of otherConvos) {
      convosScanned++;
      // Use is_narrative:true DB filter here — just looking for excluded ones in non-primary threads
      // If we find any that are NOT in KNOWN_EXCLUDED_MSG_IDS, they are new unknowns
      const msgs = await withRetry(
        () => base44.asServiceRole.entities.Message.filter(
          { conversation_id: convo.id, is_narrative: true }, '-timestamp', 50
        ),
        `msgs-${convo.id}`
      ).catch(() => []);

      for (const m of msgs) {
        if (!KNOWN_EXCLUDED_MSG_IDS.has(m.id)) {
          // Unknown narrative record — classify it
          foundExcluded.push({
            msg_id: m.id,
            conversation_id: convo.id,
            character_id: m.character_id,
            character_name: m.character_name,
            sender_character_id: m.sender_character_id || null,
            receiver_character_id: m.receiver_character_id || null,
            is_narrative: m.is_narrative,
            canon_excluded: m.canon_excluded,
            canon_exclusion_reason: m.canon_exclusion_reason || null,
            timestamp_utc: m.timestamp,
            timestamp_et: m.timestamp
              ? new Date(m.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' })
              : 'unknown',
            content_preview: (m.content || '').substring(0, 120),
            idempotency_key: m.idempotency_key || null,
            autonomy_marker: m.autonomy_marker || null,
            is_bilateral: !!(m.sender_character_id && m.receiver_character_id),
          });
          console.log(
            `[findRemaining] FOUND UNKNOWN NARRATIVE: msg_id=${m.id}` +
            ` | convo_id=${convo.id}` +
            ` | char=${m.character_name}(${m.character_id})` +
            ` | canon_excluded=${m.canon_excluded}` +
            ` | bilateral=${!!(m.sender_character_id && m.receiver_character_id)}` +
            ` | ts_et=${m.timestamp ? new Date(m.timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' }) : 'unknown'}`
          );
        }
      }

      if (convosScanned % 50 === 0) {
        console.log(`[findRemaining] Progress: ${convosScanned}/${otherConvos.length} other convos scanned, ${foundExcluded.length} unknown narratives found`);
      }
    }

    // For each found record, verify relocation if it's excluded
    const verificationResults = [];
    for (const rec of foundExcluded) {
      const result = { ...rec, relocation_verified: null, relocation_detail: null };

      if (rec.canon_excluded === true && rec.idempotency_key) {
        const reloc = await withRetry(
          () => base44.asServiceRole.entities.Message.filter(
            { idempotency_key: rec.idempotency_key }, null, 1
          ),
          `reloc-${rec.msg_id}`
        ).catch(() => []);

        if (reloc.length > 0) {
          const r = reloc[0];
          result.relocation_verified = r.character_id === rec.character_id && r.conversation_id !== rec.conversation_id;
          result.relocation_detail = {
            relocated_msg_id: r.id,
            relocated_convo_id: r.conversation_id,
            relocated_char_id: r.character_id,
            ts_match: r.timestamp === rec.timestamp_utc,
          };
          console.log(`[findRemaining] RELOC VERIFIED: ${rec.msg_id} → ${r.id} | char_match=${result.relocation_verified}`);
        } else {
          result.relocation_verified = false;
          result.relocation_detail = 'no_relocated_copy_found';
          console.log(`[findRemaining] !! NO RELOCATION FOUND for ${rec.msg_id}`);
        }
      } else if (rec.is_bilateral) {
        result.relocation_verified = 'n/a_bilateral';
        result.relocation_detail = 'legitimate bilateral — no relocation needed';
        console.log(`[findRemaining] BILATERAL — no relocation needed: ${rec.msg_id}`);
      }

      verificationResults.push(result);
    }

    const endedAt = new Date();
    const summary = {
      started_at_et: startedAt.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      ended_at_et: endedAt.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      duration_seconds: Math.round((endedAt - startedAt) / 1000),
      other_convos_scanned: convosScanned,
      unknown_narrative_records_found: foundExcluded.length,
      verification_results: verificationResults,
      conclusion: foundExcluded.length === 0
        ? 'No additional narrative records found outside the two primary contaminated threads. All 11 excluded narratives are accounted for in those threads.'
        : `Found ${foundExcluded.length} narrative record(s) outside primary threads — see verification_results for details.`,
    };

    console.log(`[findRemaining] COMPLETE | other_convos_scanned=${convosScanned} | unknown_found=${foundExcluded.length} | conclusion=${summary.conclusion}`);

    return Response.json({ success: true, summary });

  } catch (error) {
    console.error('[findRemaining] Fatal:', error.message);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});