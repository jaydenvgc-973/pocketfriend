import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  try {
    // Allow invocation by the scheduled runner (no user / service-role context) and
    // by admins. Non-admin interactive callers are blocked. All entity writes below
    // use asServiceRole, so no user context is required to process due events.
    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // PRIORITY RULE: processScheduledEvents must NOT yield during foreground activity.
    // Due events include communication_promise (user-facing message delivery) and
    // travel_arrival (character location commitment). These are Priority 4 — time-sensitive.
    // The user may be in chat specifically waiting for a promised message or arrival.
    // No foreground yield check here. Due events always run.

    const pendingEvents = await base44.asServiceRole.entities.ScheduledEvent.filter({ status: 'pending' });
    const dueEvents = pendingEvents.filter(e => e.trigger_time && e.trigger_time <= now);

    if (dueEvents.length === 0) {
      return Response.json({ success: true, processed: 0 });
    }

    const results = [];

    for (const event of dueEvents) {
      try {
        await base44.asServiceRole.entities.ScheduledEvent.update(event.id, { status: 'completed' });

        for (const charId of (event.character_ids || [])) {
          // Update character state
          await base44.asServiceRole.entities.Character.update(charId, {
            current_life_event: event.description,
            life_last_updated: new Date().toISOString(),
          });

          // Log to life event system — classify the event type from description
          const eventTypeClassification = classifyEventFromDescription(event.description);
          await base44.asServiceRole.entities.LifeEvent.create({
            character_id: charId,
            character_name: (event.character_names || [])[event.character_ids?.indexOf(charId)] || '',
            event_type: eventTypeClassification.event_type,
            valence: eventTypeClassification.valence,
            severity: 'significant',
            title: event.description.substring(0, 60),
            description: event.description,
            emotional_impact: 'This scheduled event has come to pass and affects the character.',
            triggered_by: 'scheduled_event',
            conversation_id: event.conversation_id || null,
            context_tags: ['scheduled', event.source || 'unknown'],
            systems_updated: ['mood', 'memory'],
            timestamp: new Date().toISOString(),
          });

          // Memory — always
          await base44.asServiceRole.entities.Memory.create({
            character_id: charId,
            title: `Event: ${event.description.substring(0, 60)}`,
            description: event.description,
            emotional_impact: `This was a ${eventTypeClassification.valence} moment that was anticipated and has now occurred.`,
            timestamp: new Date().toISOString(),
            source_context: `scheduled_event:${event.id}`,
          });

          // Mood — update based on event valence
          if (eventTypeClassification.valence === 'positive') {
            await base44.asServiceRole.entities.Character.update(charId, { emotional_state: 'excited' });
          } else if (eventTypeClassification.valence === 'negative') {
            await base44.asServiceRole.entities.Character.update(charId, { emotional_state: 'anxious' });
          }
        }

        // ── COMMUNICATION PROMISE FOLLOW-THROUGH ──────────────────────────────
        // When a character promised to text/call, fire the actual message at the scheduled time.
        if (event.type === 'communication_promise' && event.primary_character_id) {
          const payload = event.event_payload || {};
          const charId = payload.character_id || event.primary_character_id;
          const charName = payload.character_name || (event.character_names || [])[0] || '';
          const promisedAction = payload.promised_action || 'message';
          const convId = event.conversation_id;

          if (convId && charId) {
            // Generate the follow-through message text via LLM
            let followThroughText = promisedAction === 'call'
              ? `Hey, calling you like I said I would. 📞`
              : `Hey, checking in like I promised.`;

            try {
              const genRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
                prompt: `You are ${charName}. You promised earlier to ${promisedAction} someone. Now is the time you said you would. Write a short, natural 1-2 sentence follow-through message. Do NOT reference that a promise was made — just send the message naturally as if checking in. Be brief and authentic to how ${charName} would speak. Return only the message text, no quotes.`,
              });
              if (genRes && typeof genRes === 'string' && genRes.length > 3) {
                followThroughText = genRes.trim();
              }
            } catch (llmErr) {
              // ── CIRCUIT BREAKER: LLM failed for scheduled follow-through ──────────
              // Record durable fallback state. Do NOT substitute a generic "Sorry, got pulled away..."
              // message. Skip saving entirely — the promise will be retried on next scheduled run.
              base44.asServiceRole.functions.invoke('generationLock', {
                action: 'record_fallback',
                conversation_id: convId,
                character_id: charId,
                owner_email: null, // service-role context
                fallback_text: `[scheduled_communication_promise_llm_failure]`,
              }).catch(() => {});
              console.warn(`[processScheduledEvents] LLM failed for communication_promise char=${charId} — skipping message save`);
              continue; // Skip saving the fallback text
            }

            // ── IDEMPOTENCY KEY for scheduled communication_promise ─────────────
            // Format: owner_email? + character_id + channel + scheduled_event_id + time_bucket
            const schedTimeBucket = new Date().toISOString().substring(0, 13); // YYYY-MM-DDTHH
            const schedIdempotencyKey = `comm_promise::${charId}::direct::${event.id}::${schedTimeBucket}`;

            await base44.asServiceRole.entities.Message.create({
              conversation_id: convId,
              sender_type: 'character',
              character_id: charId,
              character_name: charName,
              sender_character_id: charId,
              receiver_character_id: null,
              content: followThroughText,
              timestamp: new Date().toISOString(),
              channel: 'direct',
              // ── IDEMPOTENCY FIELDS ──────────────────────────────────────────
              idempotency_key: schedIdempotencyKey,
              source_message_id: null,   // scheduled — no user source message
              reply_to_message_id: null, // scheduled — not a reply
              generation_lock_id: null,
            });

            await base44.asServiceRole.entities.Conversation.update(convId, {
              last_message_preview: followThroughText.substring(0, 100),
              last_message_date: new Date().toISOString(),
            });

            // Mark commitment as completed
            if (payload.commitment_id) {
              await base44.asServiceRole.entities.CharacterCommitment.update(payload.commitment_id, {
                status: 'completed',
                completion_result: `Followed through with: "${followThroughText.substring(0, 100)}"`,
              }).catch(() => {});
            }

            console.log(`[processScheduledEvents] ✓ Communication promise fired: char=${charId} convo=${convId}`);
          }
        }

        // ── TRAVEL ARRIVAL: invoke the sole canonical writer once ──────────────
        // A promised trip committed a ScheduledEvent (type 'travel_arrival') with an
        // exact trigger_time. On firing, route the move through
        // enforceCharacterLocationPresence — the sole canonical writer — exactly once.
        // It commits the authoritative location/presence and applies all existing
        // authoritative protections, including the absolute incarceration block (a
        // jailed character is forced to incarceration regardless of the requested
        // transition, so a promised trip cannot teleport them out of jail). The
        // ScheduledEvent was already marked completed above, so the trip is one-time
        // and a blocked trip does not run later.
        if (event.type === 'travel_arrival' && event.primary_character_id) {
          const travelPayload = event.event_payload || {};
          const destLocId = travelPayload.destination_location_id;
          const destLocName = travelPayload.destination_location_name;
          const charId = event.primary_character_id;
          const arrivalNow = new Date().toISOString();

          let authorityResponse = null;
          try {
            const invokeResult = await base44.asServiceRole.functions.invoke('enforceCharacterLocationPresence', {
              character_id: charId,
              owner_email: event.owner_email || travelPayload.owner_email || undefined,
              requested_presence_status: 'visiting',
              requested_location_id: destLocId || null,
              requested_location_type: 'visit',
              requested_source_reason: 'promised_travel_arrival',
              requested_relocation: true,
              clear_stay_lock: true,
            });
            authorityResponse = invokeResult?.data || invokeResult;
          } catch (invokeErr) {
            console.error(`[processScheduledEvents] travel_arrival authority invoke FAILED for ${charId}: ${invokeErr.message}`);
          }

          const disposition = authorityResponse?.disposition || (authorityResponse ? 'accepted' : 'failed');
          const committed = authorityResponse?.committed_result || null;
          const arrivedAtDestination = !!(committed && destLocId && committed.resolved_current_location_id === destLocId);
          const blockedByIncarceration = !!(committed && (committed.resolved_presence_status === 'incarcerated' || committed.resolved_location_type === 'incarcerated'));

          // Clear noncanonical travel state regardless of disposition (the one-time trip has been resolved)
          await base44.asServiceRole.entities.Character.update(charId, {
            travel_status: 'not_traveling',
            traveling_to_location_id: null,
            traveling_to_location_name: null,
            travel_destination_location_id: null,
            last_arrived_time: arrivedAtDestination ? arrivalNow : null,
          }).catch(() => {});

          // Mark the commitment completed (arrived) or failed (blocked/rejected) — never retry
          if (travelPayload.commitment_id) {
            try {
              if (arrivedAtDestination) {
                await base44.asServiceRole.entities.CharacterCommitment.update(travelPayload.commitment_id, {
                  status: 'completed',
                  travel_arrived_at: arrivalNow,
                  completion_result: destLocName ? `Arrived at ${destLocName}` : 'Arrived at destination',
                });
              } else {
                await base44.asServiceRole.entities.CharacterCommitment.update(travelPayload.commitment_id, {
                  status: 'failed',
                  completion_result: blockedByIncarceration ? 'blocked_by_incarceration' : `authority_disposition_${disposition}`,
                });
              }
            } catch (commitErr) {
              console.warn(`[processScheduledEvents] commitment update failed: ${commitErr.message}`);
            }
          }
          console.log(`[processScheduledEvents] ✓ Travel arrival: char=${charId} → "${destLocName || 'destination'}" | disposition=${disposition} | arrived=${arrivedAtDestination} | blocked_jail=${blockedByIncarceration}`);
        }

        // If narrative type, post in chat
        if (event.type !== 'internal' && event.conversation_id && event.primary_character_id) {
          const chars = await base44.asServiceRole.entities.Character.filter({ id: event.primary_character_id });
          const character = chars[0];

          if (character) {
            const narrativeTimeBucket = new Date().toISOString().substring(0, 13);
            const narrativeIdempotencyKey = `narrative::${event.primary_character_id}::${event.id}::${narrativeTimeBucket}`;
            await base44.asServiceRole.entities.Message.create({
              conversation_id: event.conversation_id,
              sender_type: 'character',
              character_id: event.primary_character_id,
              character_name: character.name,
              sender_character_id: event.primary_character_id,
              receiver_character_id: null,
              content: event.description,
              is_narrative: true,
              timestamp: new Date().toISOString(),
              channel: 'direct',
              // ── IDEMPOTENCY FIELDS ──────────────────────────────────────────
              idempotency_key: narrativeIdempotencyKey,
              source_message_id: null,
              reply_to_message_id: null,
              generation_lock_id: null,
            });

            await base44.asServiceRole.entities.Conversation.update(event.conversation_id, {
              last_message_preview: event.description.substring(0, 100),
              last_message_date: new Date().toISOString(),
            });
          }
        }

        results.push({ event_id: event.id, status: 'processed' });
      } catch (err) {
        console.error(`[processScheduledEvents] Failed for event ${event.id}:`, err.message);
        results.push({ event_id: event.id, status: 'error', error: err.message });
      }
    }

    return Response.json({ success: true, processed: results.length, results });
  } catch (error) {
    console.error('[processScheduledEvents] ERROR:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// Heuristic classifier for scheduled event descriptions
function classifyEventFromDescription(description) {
  const text = (description || '').toLowerCase();

  if (/accident|crash|injury|hospital|hurt|emergency|ambulance|911/.test(text)) {
    return { event_type: 'accident_event', valence: 'negative' };
  }
  if (/drunk|drinking|bar|party|high|substances/.test(text)) {
    return { event_type: 'substance_use_event', valence: 'negative' };
  }
  if (/fight|argument|confrontation|yell|scream|blow up/.test(text)) {
    return { event_type: 'fight_event', valence: 'negative' };
  }
  if (/arrested|police|legal|court|fine|charged/.test(text)) {
    return { event_type: 'legal_or_social_consequence_event', valence: 'negative' };
  }
  if (/died|death|funeral|passed away|grief|loss|mourning/.test(text)) {
    return { event_type: 'grief_event', valence: 'negative' };
  }
  if (/breakup|broke up|separated|divorce|ended/.test(text)) {
    return { event_type: 'setback_event', valence: 'negative' };
  }
  if (/promotion|hired|got the job|new job|raise/.test(text)) {
    return { event_type: 'life_milestone_event', valence: 'positive' };
  }
  if (/baby|born|birth|pregnant|graduation|engaged|married|wedding/.test(text)) {
    return { event_type: 'life_milestone_event', valence: 'positive' };
  }
  if (/reconcil|made up|forgave|forgiven|apologized/.test(text)) {
    return { event_type: 'reconciliation_event', valence: 'positive' };
  }
  if (/celebrat|party|win|won|achievement|accomplished/.test(text)) {
    return { event_type: 'celebration_event', valence: 'positive' };
  }
  if (/sick|ill|diagnosis|doctor|hospital|health/.test(text)) {
    return { event_type: 'medical_event', valence: 'negative' };
  }

  // Default
  return { event_type: 'routine_positive_event', valence: 'neutral' };
}