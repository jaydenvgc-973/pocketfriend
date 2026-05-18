/**
 * Generation Lock — Durable server-side idempotency gate for character replies.
 *
 * Scope: owner_email + conversation_id + character_id + channel
 *
 * Stores state on Conversation entity's generation_lock field (additionalProperties).
 * Eliminates duplicate replies across:
 *   - Chat, Text, World Phone, World Contacts, Group Chat, Confinement Text,
 *     autonomous messages, scheduled replies, background processors.
 *
 * API:
 *   POST { action: "acquire",  ... }  → { acquired, lock_id, existing_reply_id? }
 *   POST { action: "release",  ... }  → { released }
 *   POST { action: "check",    ... }  → { locked, stale, lock_data }
 *   POST { action: "cleanup",  ... }  → { cleaned }
 *   POST { action: "record_fallback", ... }  → { recorded }
 *   POST { action: "record_recovery", ... }  → { recorded }
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const LOCK_TTL_MS = 2 * 60 * 1000; // 2 minutes — stale after this

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Allow service-role callers (scheduled tasks) without user session
  let callerEmail = null;
  try {
    const me = await base44.auth.me();
    callerEmail = me?.email;
  } catch { /* service-role or scheduled */ }

  const body = await req.json().catch(() => ({}));
  const {
    action,
    conversation_id,
    character_id,
    channel = 'direct',
    source_message_id,
    owner_email,
    fallback_text,
    blocking_stage,
    recovery_stages,
    real_pipeline_restored,
  } = body;

  const effectiveEmail = owner_email || callerEmail;
  if (!action) {
    return Response.json({ error: 'action required' }, { status: 400 });
  }
  // cleanup is a global scan — does not require conversation_id
  if (!conversation_id && action !== 'cleanup') {
    return Response.json({ error: 'conversation_id required' }, { status: 400 });
  }

  try {
    // ── LOAD CONVERSATION ──────────────────────────────────────────────────────
    const convos = await base44.asServiceRole.entities.Conversation.filter(
      { id: conversation_id }, null, 1
    ).catch(() => []);

    if (convos.length === 0) {
      return Response.json({ error: `Conversation ${conversation_id} not found` }, { status: 404 });
    }

    const convo = convos[0];
    // Use conversation.generation_lock as our durable lock store
    // generation_lock is a JSON object stored on the conversation record
    let lock = (typeof convo.generation_lock === 'object' && convo.generation_lock !== null)
      ? { ...convo.generation_lock }
      : {};

    const now = Date.now();

    // ── STALE LOCK CLEANUP (runs automatically before every check) ──────────
    const isStale = (l) => l.generation_in_progress && l.generation_started_at &&
      (now - new Date(l.generation_started_at).getTime()) > LOCK_TTL_MS;

    if (isStale(lock)) {
      console.warn(`[generationLock] Stale lock detected for convo=${conversation_id} char=${lock.character_id} started_at=${lock.generation_started_at} — releasing`);
      lock.generation_in_progress = false;
      lock.stale_lock = true;
      lock.stale_released_at = new Date().toISOString();
      lock.recovery_required = true;
      await base44.asServiceRole.entities.Conversation.update(conversation_id, {
        generation_lock: lock
      }).catch(() => {});
    }

    // ────────────────────────────────────────────────────────────────────────
    // ACTION: acquire
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'acquire') {
      if (!character_id) return Response.json({ error: 'character_id required' }, { status: 400 });

      // ── IDEMPOTENCY CHECK: does a reply already exist for this source message? ──
      if (source_message_id) {
        const existingReplies = await base44.asServiceRole.entities.Message.filter({
          conversation_id,
          source_message_id,
        }, null, 5).catch(() => []);

        // Filter: replies from the responding character to this source message
        const myReplies = existingReplies.filter(m =>
          m.source_message_id === source_message_id &&
          (m.character_id === character_id || m.sender_character_id === character_id) &&
          m.sender_type === 'character' &&
          // Exclude fallback/recovery messages
          !isFallbackContent(m.content)
        );

        if (myReplies.length > 0) {
          console.log(`[generationLock] IDEMPOTENT: reply already exists for source_msg=${source_message_id} char=${character_id} reply_id=${myReplies[0].id}`);
          return Response.json({
            acquired: false,
            reason: 'idempotent_reply_exists',
            existing_reply_id: myReplies[0].id,
            existing_reply_content: myReplies[0].content,
          });
        }
      }

      // ── LOCK CHECK: is another generation already in progress? ──────────────
      if (lock.generation_in_progress && !isStale(lock)) {
        console.warn(`[generationLock] BLOCKED: generation already in progress for convo=${conversation_id} char=${lock.character_id}`);
        return Response.json({
          acquired: false,
          reason: 'generation_in_progress',
          locked_by_character: lock.character_id,
          started_at: lock.generation_started_at,
        });
      }

      // ── ACQUIRE ─────────────────────────────────────────────────────────────
      const lockId = `lock_${character_id}_${now}`;
      lock = {
        ...lock,
        lock_id: lockId,
        generation_in_progress: true,
        generation_started_at: new Date().toISOString(),
        character_id,
        channel,
        source_message_id: source_message_id || null,
        owner_email: effectiveEmail,
        stale_lock: false,
      };

      await base44.asServiceRole.entities.Conversation.update(conversation_id, {
        generation_lock: lock
      });

      console.log(`[generationLock] Acquired lock_id=${lockId} convo=${conversation_id} char=${character_id}`);
      return Response.json({ acquired: true, lock_id: lockId });
    }

    // ────────────────────────────────────────────────────────────────────────
    // ACTION: release
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'release') {
      lock = {
        ...lock,
        generation_in_progress: false,
        generation_released_at: new Date().toISOString(),
      };

      await base44.asServiceRole.entities.Conversation.update(conversation_id, {
        generation_lock: lock
      });

      console.log(`[generationLock] Released lock for convo=${conversation_id}`);
      return Response.json({ released: true });
    }

    // ────────────────────────────────────────────────────────────────────────
    // ACTION: check
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'check') {
      return Response.json({
        locked: !!lock.generation_in_progress,
        stale: isStale(lock),
        lock_data: lock,
      });
    }

    // ────────────────────────────────────────────────────────────────────────
    // ACTION: record_fallback
    // Durably records that a fallback was detected in this conversation.
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'record_fallback') {
      const fallbackCount = (lock.fallback_count || 0) + 1;
      const wasBlocked = fallbackCount > 1;

      lock = {
        ...lock,
        fallback_detected: true,
        fallback_count: fallbackCount,
        fallback_blocked: wasBlocked,
        recovery_required: true,
        recovery_started_at: wasBlocked ? (lock.recovery_started_at || new Date().toISOString()) : new Date().toISOString(),
        last_fallback_text: (fallback_text || '').substring(0, 80),
        last_fallback_at: new Date().toISOString(),
      };

      await base44.asServiceRole.entities.Conversation.update(conversation_id, {
        generation_lock: lock
      });

      console.log(`[generationLock] Fallback recorded convo=${conversation_id} count=${fallbackCount} blocked=${wasBlocked}`);
      return Response.json({
        recorded: true,
        fallback_count: fallbackCount,
        fallback_blocked: wasBlocked,
        recovery_required: true,
      });
    }

    // ────────────────────────────────────────────────────────────────────────
    // ACTION: record_recovery
    // Durably records recovery diagnostic results.
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'record_recovery') {
      lock = {
        ...lock,
        recovery_required: !real_pipeline_restored,
        recovery_completed_at: real_pipeline_restored ? new Date().toISOString() : null,
        last_recovery_attempt_at: new Date().toISOString(),
        last_blocking_stage: blocking_stage || null,
        real_pipeline_restored: !!real_pipeline_restored,
        recovery_stages: recovery_stages || {},
      };

      await base44.asServiceRole.entities.Conversation.update(conversation_id, {
        generation_lock: lock
      });

      console.log(`[generationLock] Recovery recorded convo=${conversation_id} success=${real_pipeline_restored} blocking=${blocking_stage}`);
      return Response.json({ recorded: true, lock });
    }

    // ────────────────────────────────────────────────────────────────────────
    // ACTION: cleanup
    // Scans all locked conversations for stale locks older than 2 min.
    // ────────────────────────────────────────────────────────────────────────
    if (action === 'cleanup') {
      // Scan conversations with active locks (up to 100)
      const allConvos = await base44.asServiceRole.entities.Conversation.filter(
        {}, '-updated_date', 100
      ).catch(() => []);

      let cleaned = 0;
      for (const c of allConvos) {
        const l = c.generation_lock;
        if (!l || typeof l !== 'object') continue;
        if (isStale(l)) {
          await base44.asServiceRole.entities.Conversation.update(c.id, {
            generation_lock: {
              ...l,
              generation_in_progress: false,
              stale_lock: true,
              stale_released_at: new Date().toISOString(),
              recovery_required: true,
            }
          }).catch(() => {});
          cleaned++;
          console.log(`[generationLock] Cleaned stale lock for convo=${c.id}`);
        }
      }

      return Response.json({ cleaned });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });

  } catch (err) {
    console.error(`[generationLock] Error: ${err.message}`);
    return Response.json({ error: err.message }, { status: 500 });
  }
});

// Matches the same fallback strings used in chatFallbackIntegration.js
function isFallbackContent(text) {
  if (!text) return false;
  const t = text.toLowerCase().trim();
  const patterns = [
    'sorry, got pulled away',
    'give me a moment',
    'hey sorry',
    'my bad, got distracted',
    'sorry, lost you',
    'reconnecting',
    'reconnecting to character',
  ];
  return patterns.some(p => t.startsWith(p) || t.includes(p));
}