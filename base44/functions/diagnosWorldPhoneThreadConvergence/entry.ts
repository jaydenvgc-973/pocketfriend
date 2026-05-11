/**
 * diagnosWorldPhoneThreadConvergence
 *
 * Verifies that Character A → Character B and Character B → Character A
 * resolve to the EXACT SAME conversation_id using the canonical shared key.
 *
 * Payload:
 *   charIdA: string  (Character A's ID)
 *   charIdB: string  (Character B's ID)
 *
 * Returns a PASS/FAIL report with the actual conversation IDs found.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { charIdA, charIdB } = await req.json();
    if (!charIdA || !charIdB) {
      return Response.json({ error: 'charIdA and charIdB are required' }, { status: 400 });
    }

    // ── CANONICAL KEY: same regardless of direction ──────────────────────────
    const sorted = [charIdA, charIdB].sort();
    const canonicalKey = `world_phone::${sorted[0]}::${sorted[1]}`;
    const legacyKey = `bilateral_${sorted.join('_')}_world_phone`;

    console.log(`[ConvergenceDiag] Testing A=${charIdA} ↔ B=${charIdB}`);
    console.log(`[ConvergenceDiag] Expected canonical key: ${canonicalKey}`);

    // ── FETCH ALL RELEVANT CONVERSATIONS ────────────────────────────────────
    const [byCanonical, byLegacy, byParticipant, byCharIdsA, byCharIdsB] = await Promise.all([
      base44.asServiceRole.entities.Conversation.filter({ shared_conversation_key: canonicalKey }, '-updated_date', 10).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ shared_conversation_key: legacyKey }, '-updated_date', 10).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ participant_character_ids: [charIdA] }, '-updated_date', 100).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ character_ids: [charIdA] }, '-updated_date', 100).catch(() => []),
      base44.asServiceRole.entities.Conversation.filter({ character_ids: [charIdB] }, '-updated_date', 100).catch(() => []),
    ]);

    // ── SIMULATE DIRECTION A→B RESOLUTION ───────────────────────────────────
    const resolveDirection = (ownerCharId, otherCharId, label) => {
      const seenIds = new Set();
      const allCandidates = [...byCanonical, ...byLegacy, ...byParticipant, ...byCharIdsA, ...byCharIdsB].filter(c => {
        if (seenIds.has(c.id)) return false;
        seenIds.add(c.id);
        return true;
      });

      const found =
        allCandidates.find(c => c.shared_conversation_key === canonicalKey) ||
        allCandidates.find(c => c.shared_conversation_key === legacyKey) ||
        allCandidates.find(c =>
          Array.isArray(c.participant_character_ids) &&
          [ownerCharId, otherCharId].every(id => c.participant_character_ids.includes(id))
        ) ||
        allCandidates.find(c =>
          Array.isArray(c.character_ids) &&
          [ownerCharId, otherCharId].every(id => c.character_ids.includes(id))
        );

      return {
        direction: label,
        resolved_conversation_id: found?.id || null,
        resolved_key: found?.shared_conversation_key || null,
        candidate_count: allCandidates.length,
      };
    };

    const directionAtoB = resolveDirection(charIdA, charIdB, `A(${charIdA.substring(0,8)}) → B(${charIdB.substring(0,8)})`);
    const directionBtoA = resolveDirection(charIdB, charIdA, `B(${charIdB.substring(0,8)}) → A(${charIdA.substring(0,8)})`);

    const sameConversation = directionAtoB.resolved_conversation_id &&
      directionAtoB.resolved_conversation_id === directionBtoA.resolved_conversation_id;

    const canonicalKeyMatches =
      directionAtoB.resolved_key === canonicalKey &&
      directionBtoA.resolved_key === canonicalKey;

    // ── MESSAGE COUNTS PER DIRECTION ─────────────────────────────────────────
    let messageDiag = null;
    const convoId = directionAtoB.resolved_conversation_id;
    if (convoId) {
      const msgs = await base44.asServiceRole.entities.Message.filter(
        { conversation_id: convoId }, 'created_date', 50
      ).catch(() => []);

      const sentByA = msgs.filter(m => m.sender_character_id === charIdA || (!m.sender_character_id && m.character_id === charIdA));
      const sentByB = msgs.filter(m => m.sender_character_id === charIdB || (!m.sender_character_id && m.character_id === charIdB));
      const missingCanonicalKey = msgs.filter(m => !m.shared_conversation_key);
      const missingParticipants = msgs.filter(m => !Array.isArray(m.participant_character_ids) || m.participant_character_ids.length < 2);

      messageDiag = {
        total_messages: msgs.length,
        sent_by_A: sentByA.length,
        sent_by_B: sentByB.length,
        missing_shared_conversation_key: missingCanonicalKey.length,
        missing_participant_character_ids: missingParticipants.length,
        sync_complete: msgs.filter(m => m.sync_status === 'complete').length,
        sync_pending: msgs.filter(m => m.sync_status === 'pending').length,
        sync_failed: msgs.filter(m => m.sync_status === 'failed').length,
        sample_messages: msgs.slice(-3).map(m => ({
          id: m.id.substring(0, 8),
          sender_character_id: m.sender_character_id?.substring(0, 8) || 'MISSING',
          shared_conversation_key: m.shared_conversation_key || 'MISSING',
          sync_status: m.sync_status || 'none',
        })),
      };
    }

    const verdict = sameConversation && canonicalKeyMatches ? 'PASS' : 'FAIL';

    const report = {
      verdict,
      canonical_key: canonicalKey,
      direction_A_to_B: directionAtoB,
      direction_B_to_A: directionBtoA,
      same_conversation_id: sameConversation,
      canonical_key_matches_both: canonicalKeyMatches,
      message_diagnostics: messageDiag,
      issues: [],
    };

    if (!sameConversation) {
      if (!directionAtoB.resolved_conversation_id && !directionBtoA.resolved_conversation_id) {
        report.issues.push('No conversation found in either direction — no World Phone thread exists yet for this pair');
      } else if (!directionAtoB.resolved_conversation_id) {
        report.issues.push(`Direction A→B resolved to NULL. Direction B→A resolved to ${directionBtoA.resolved_conversation_id}`);
      } else if (!directionBtoA.resolved_conversation_id) {
        report.issues.push(`Direction A→B resolved to ${directionAtoB.resolved_conversation_id}. Direction B→A resolved to NULL`);
      } else {
        report.issues.push(
          `SPLIT THREADS DETECTED: A→B=${directionAtoB.resolved_conversation_id} vs B→A=${directionBtoA.resolved_conversation_id}. ` +
          `These are different conversations — shared reality is broken.`
        );
      }
    }

    if (!canonicalKeyMatches) {
      report.issues.push(
        `Canonical key mismatch: expected="${canonicalKey}" | A→B got="${directionAtoB.resolved_key}" | B→A got="${directionBtoA.resolved_key}"`
      );
    }

    if (messageDiag?.missing_shared_conversation_key > 0) {
      report.issues.push(`${messageDiag.missing_shared_conversation_key} messages missing shared_conversation_key — legacy messages need backfill`);
    }

    console.log(`[ConvergenceDiag] VERDICT=${verdict} | same_convo=${sameConversation} | canonical_key_ok=${canonicalKeyMatches}`);

    return Response.json(report);
  } catch (error) {
    console.error('[ConvergenceDiag] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});