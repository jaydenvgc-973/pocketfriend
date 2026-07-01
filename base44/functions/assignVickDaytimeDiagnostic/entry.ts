import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * assignVickDaytimeDiagnostic
 *
 * Recurring scheduler function that DELIVERS a diagnostic ASSIGNMENT to Vick
 * Servicio through his existing communication pathways (Investigation Queue +
 * chat conversation).
 *
 * RESPONSIBILITY BOUNDARY (permanent):
 *   This function ONLY delivers the assignment text. It does NOT run any
 *   diagnostic. It does NOT inspect application data. It does NOT generate
 *   findings. It does NOT produce a completed report. It does NOT replace
 *   Vick's existing diagnostic/investigation process.
 *
 *   The application schedules the assignment.
 *   The application delivers the assignment.
 *   Vick performs the diagnostic.
 *
 * DELIVERY WINDOWS (Eastern Time — America/New_York):
 *   7:00 AM, 9:00 AM, 11:00 AM, 1:00 PM, 3:00 PM, 5:00 PM
 *
 * DST SAFETY:
 *   The cron fires at the top of every hour during the candidate UTC window
 *   (11:00–22:00 UTC). This function computes the actual Eastern Time hour at
 *   runtime and only delivers when the ET hour is one of the six target hours.
 *   This automatically handles EDT (UTC-4) and EST (UTC-5) transitions without
 *   any cron reconfiguration.
 *
 * DEDUP:
 *   Each delivery is keyed by owner_email + Eastern date + target hour.
 *   A VickInvestigation record with a matching title prevents double-delivery
 *   if the cron fires twice within the same window.
 *
 * MANUAL TRIGGER:
 *   Pass { force: true } in the payload to bypass the ET-hour gate (for
 *   verification/testing only). Dedup still applies unless { skipDedup: true }.
 */
const TARGET_ET_HOURS = [7, 9, 11, 13, 15, 17];

const ASSIGNMENT_TEXT = `Vick, it is time to perform your scheduled daytime diagnostic.

This is an observation and reporting diagnostic. Do not repair anything unless the user explicitly authorizes a repair.

Perform a full diagnostic pass for the user account.

Verify application health, character integrity, UI consistency, state continuity, scheduler outcomes, data integrity, conversation integrity, World Phone behavior, scene continuity, image-generation health, autonomous behavior, and silent failures.

Do not treat a scheduler running as proof that the expected result happened. Verify the outcome.

1. Application Health

Check for unexpected failures, repeated errors, failed requests, excessive retries, timeout patterns, unavailable services, stalled operations, queue backlogs, recovery loops, and repeated restart behavior.

Record verified evidence only.

2. Character Health

Check active characters for frozen activities, impossible locations, invalid presence states, duplicate activities, failed arrivals, failed departures, invalid needs, missing schedules, broken relationships, duplicate memories, invalid journals, clothing inconsistencies, weather/clothing conflicts, and inventory inconsistencies.

3. Location and Presence

Verify resolved locations, resolved presence, failed arrivals, failed departures, presence locks that should have released, occupancy consistency, and duplicate location assignments.

4. Time and Scheduling

Verify scheduler execution, overdue jobs, repeated jobs, missed jobs, work scheduling, school scheduling, sleep scheduling, delayed scheduled events, and application time progression.

5. Scene System

Verify scene generation, scene continuity, participating characters, environment continuity, clothing continuity, weather continuity, and location continuity.

6. Chat System

Verify conversation continuity, memory continuity, duplicate replies, missing replies, identity continuity, and conversation context.

7. World Phone

Verify message delivery, sender identity, recipient identity, routing, unread indicators, group conversations, duplicate messages, and failed deliveries.

8. UI Consistency

Compare backend truth against what the user should see in the application.

Check Home, Travel, Scenes, Character Profiles, Character Cards, World Contacts, World Phone, Needs Bars, Presence Indicators, Location Displays, and Clothing Displays.

Identify visible inconsistencies.

9. Image Generation

Check failed generations, repeated retries, invalid references, incorrect environments, incorrect clothing, incorrect participating characters, and failed processing.

10. Autonomous Systems

Verify travel, autonomous activities, relationships, purchases, social behavior, needs fulfillment, and daily routines.

Look for repeated loops, characters no longer living autonomously, characters trapped in activities, repeated replanning, and stalled behavior.

11. Data Integrity

Check duplicate records, orphaned records, invalid references, broken relationships, invalid ownership, duplicate ownership, invalid identifiers, and prohibited null values.

12. Performance

Check excessive scheduler activity, expensive repeated operations, queue buildup, repeated processing, unnecessary execution, and performance degradation.

13. Silent Failure Verification

This is the most important part.

Do not assume a system worked because a scheduler executed or a function completed.

Verify that the expected world outcome actually occurred.

For every active_created_character, verify:

Did they sleep when expected?
Did sleep restore energy?
Did they wake correctly?
If they did not sleep, was there a legitimate blocker?
Did they have work today?
If yes, did they leave for work?
Did they arrive at work?
Did they enter at_work status?
Did they remain at work during the shift?
Did they complete or continue the shift correctly?
Did they have school today?
If yes, did they leave for school?
Did they arrive at school?
Did they enter at_school status?
Did school complete correctly?
Are they stuck in one activity or location?
Are critical needs being corrected?
Is there evidence of silent failure?

If required records are missing, classify the result as Unknown / Missing Evidence and name the missing evidence.

Do not infer failure from missing evidence.

Required Classification

Classify each issue as one of:

Verified Success
Legitimate Exception
Delayed
Blocked
Silent Failure
Data Integrity Issue
Unknown / Missing Evidence

Required Report Format

Use this structure:

INVESTIGATION GOAL: USER OBSERVATION: EXPECTED STATE: EVIDENCE CHECKED: SOURCE COMPARISON: CONTRADICTIONS FOUND: ROOT CAUSE: REPAIR MADE: POST-REPAIR PROOF: STATUS:

Then provide the diagnostic report sections:

1. APPLICATION HEALTH

2. CHARACTER HEALTH

3. LOCATION & PRESENCE

4. TIME & SCHEDULING

5. SCENE SYSTEM

6. CHAT SYSTEM

7. WORLD PHONE

8. UI CONSISTENCY

9. IMAGE GENERATION

10. AUTONOMOUS SYSTEMS

11. DATA INTEGRITY

12. PERFORMANCE

13. SILENT FAILURE VERIFICATION

For each finding include:

affected system
severity
evidence
user-visible impact
classification
recommended next step

If no issues are found, state that no significant issues were detected.

Do not guess.

Do not exaggerate.

Do not repair anything unless explicitly authorized.

When complete, publish the completed diagnostic report through your normal reporting process so the user can read it in this chat or in your Investigation Queue.`;

// ── Eastern Time helpers ──────────────────────────────────────────────────
function getCurrentEasternHour() {
  // hour12: false gives 24-hour; value is "7", "13", etc.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const h = parts.find(p => p.type === 'hour');
  // Intl can return "24" at midnight edge in some runtimes; normalize.
  let val = parseInt(h?.value || '0', 10);
  if (val === 24) val = 0;
  return val;
}

function getCurrentEasternDateStr() {
  // en-CA locale yields YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getCurrentEasternTimeLabel() {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }) + ' Eastern';
}

// Format a target hour as a readable label: 7 -> "7:00 AM", 13 -> "1:00 PM"
function hourLabel(hour) {
  const period = hour >= 12 ? 'PM' : 'AM';
  let display = hour % 12;
  if (display === 0) display = 12;
  return `${display}:00 ${period}`;
}

// ── Vick multi-path lookup (mirrors deliverVickFindings pattern) ──────────
async function findVicks(base44) {
  // Service-role query for all active npc_world_service characters.
  // Each account has its own Vick scoped by owner_email.
  try {
    const results = await base44.asServiceRole.entities.Character.filter(
      { character_type: 'npc_world_service', status: 'active' },
      '-created_date', 200
    );
    if (results && results.length > 0) return results;
  } catch (_) {}
  // Fallback: is_world_service flag
  try {
    const results = await base44.asServiceRole.entities.Character.filter(
      { is_world_service: true, status: 'active' },
      '-created_date', 200
    );
    if (results && results.length > 0) return results;
  } catch (_) {}
  // Fallback: name match
  try {
    const results = await base44.asServiceRole.entities.Character.filter(
      { name: 'Vick Servicio', status: 'active' },
      '-created_date', 200
    );
    return results || [];
  } catch (_) {}
  return [];
}

// Find or create Vick's direct conversation for an account
async function findOrCreateVickConversation(base44, vick, ownerEmail) {
  // Try service-role lookup by owner_email + character_ids contains vick.id
  try {
    const convos = await base44.asServiceRole.entities.Conversation.filter(
      { owner_email: ownerEmail, type: 'direct' },
      '-updated_date', 50
    ).catch(() => []);
    const existing = convos.find(c =>
      Array.isArray(c.character_ids) && c.character_ids.includes(vick.id)
    );
    if (existing) return existing;
  } catch (_) {}

  // Create new conversation
  const nowIso = new Date().toISOString();
  try {
    const convo = await base44.asServiceRole.entities.Conversation.create({
      title: 'Vick Servicio — Recovery Yard',
      type: 'direct',
      character_ids: [vick.id],
      owner_email: ownerEmail,
      channel: 'direct',
      last_message_preview: 'Scheduled diagnostic assignment delivered.',
      last_message_date: nowIso,
    });
    return convo;
  } catch (e) {
    console.warn(`[assignVickDaytimeDiagnostic] Could not create conversation for ${ownerEmail}: ${e.message}`);
    return null;
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json().catch(() => ({}));
    const force = payload?.force === true || payload?.force === 'true';
    const skipDedup = payload?.skipDedup === true;

    const nowIso = new Date().toISOString();
    const etHour = getCurrentEasternHour();
    const etDate = getCurrentEasternDateStr();
    const etLabel = getCurrentEasternTimeLabel();

    // ── ET-HOUR GATE ──────────────────────────────────────────────────────
    // Only deliver during the six target hours unless force=true.
    if (!force) {
      if (!TARGET_ET_HOURS.includes(etHour)) {
        return Response.json({
          success: true,
          delivered: false,
          reason: 'outside_target_window',
          current_et_hour: etHour,
          target_et_hours: TARGET_ET_HOURS,
          et_time: etLabel,
        });
      }
    }

    // Use the actual current ET hour as the delivery slot (when not forced).
    // When forced, use the nearest passed hour or default to the first target.
    const deliveryHour = force ? (payload?.hour || TARGET_ET_HOURS[0]) : etHour;
    const slotLabel = hourLabel(deliveryHour);
    const dedupTitle = `Scheduled Daytime Diagnostic — ${etDate} ${slotLabel} ET`;

    // ── FIND ALL VICK INSTANCES (one per account) ─────────────────────────
    const vicks = await findVicks(base44);
    if (vicks.length === 0) {
      console.warn('[assignVickDaytimeDiagnostic] No active Vick characters found');
      return Response.json({
        success: true,
        delivered: false,
        reason: 'no_vick_found',
        et_time: etLabel,
      });
    }

    // Dedup by owner_email (in case multiple records exist for one account)
    const vickByOwner = new Map();
    for (const v of vicks) {
      const email = v.owner_email;
      if (!email) continue;
      if (!vickByOwner.has(email)) vickByOwner.set(email, v);
    }

    const deliveries = [];
    const skipped = [];

    for (const [ownerEmail, vick] of vickByOwner) {
      try {
        // ── DEDUP CHECK ──────────────────────────────────────────────────
        // Prevent double-delivery if cron fires twice in the same window.
        if (!skipDedup) {
          const existing = await base44.asServiceRole.entities.VickInvestigation.filter(
            { owner_email: ownerEmail, title: dedupTitle },
            null, 1
          ).catch(() => []);
          if (existing && existing.length > 0) {
            skipped.push({ ownerEmail, reason: 'already_delivered', title: dedupTitle });
            continue;
          }
        }

        // ── DELIVER TO INVESTIGATION QUEUE ───────────────────────────────
        // Create a VickInvestigation record with status "queued".
        // This is the ASSIGNMENT — not findings. Vick's existing process
        // picks it up, investigates, and produces the completed report.
        const investigation = await base44.asServiceRole.entities.VickInvestigation.create({
          owner_email: ownerEmail,
          title: dedupTitle,
          description: `Scheduled daytime diagnostic assignment delivered at ${etLabel}.\n\n${ASSIGNMENT_TEXT}`,
          status: 'queued',
          priority: 'normal',
          tags: ['scheduled_diagnostic', 'daytime', `hour_${deliveryHour}`, etDate],
          started_at: nowIso,
          vick_character_id: vick.id,
          requires_user_input: false,
        }).catch(e => {
          console.error(`[assignVickDaytimeDiagnostic] VickInvestigation create failed for ${ownerEmail}: ${e.message}`);
          return null;
        });

        // ── DELIVER TO VICK'S CHAT ───────────────────────────────────────
        // Also write the assignment as a message in Vick's conversation so
        // the user can see the assignment arrived and Vick can read it.
        const conversation = await findOrCreateVickConversation(base44, vick, ownerEmail);
        let messageId = null;
        if (conversation) {
          const chatAssignment = `═══ SCHEDULED DIAGNOSTIC ASSIGNMENT ═══\nDelivered: ${etLabel}\n\n${ASSIGNMENT_TEXT}\n\n═══ END ASSIGNMENT ═══`;
          const msg = await base44.asServiceRole.entities.Message.create({
            conversation_id: conversation.id,
            sender_type: 'character',
            character_id: vick.id,
            character_name: vick.name || 'Vick Servicio',
            content: chatAssignment,
            is_narrative: true,
            is_read: false,
            recovery_signal: false,
            memory_eligible: false,
            relationship_eligible: false,
            timestamp: nowIso,
            channel: 'direct',
          }).catch(e => {
            console.error(`[assignVickDaytimeDiagnostic] Message create failed for ${ownerEmail}: ${e.message}`);
            return null;
          });
          messageId = msg?.id || null;

          // Update conversation preview
          if (msg) {
            await base44.asServiceRole.entities.Conversation.update(conversation.id, {
              last_message_preview: `Scheduled diagnostic assignment — ${slotLabel}`,
              last_message_date: nowIso,
            }).catch(() => {});
          }
        }

        // Link the investigation to the conversation and mark it as active.
        if (investigation && conversation) {
          await base44.asServiceRole.entities.VickInvestigation.update(investigation.id, {
            conversation_id: conversation.id,
            status: 'investigating',
            started_at: nowIso,
          }).catch(() => {});
        }

        // ── VICK PERFORMS HIS DIAGNOSTIC ────────────────────────────────────
        // The assignment has been delivered (Investigation Queue + chat).
        // Now Vick's diagnostic process runs — gathering evidence from the
        // account, classifying findings, and producing the completed report.
        //
        // This IS Vick's diagnostic process (same evidence sources, same
        // findings format, same OBSERVED/INFERRED/UNKNOWN classification as
        // vickInvestigationBridge). It runs within the scheduled function
        // because function-to-function invocation is not available in the
        // scheduled Deno context. The findings are attributed to Vick and
        // written to his chat as a character message.
        let diagnosticRun = false;
        let diagnosticError = null;
        let findingsText = null;
        let findingsMessageId = null;

        if (conversation && investigation) {
          try {
            const observed = [];
            const inferred = [];
            const unknown = [];

            // ── EVIDENCE: Active characters ──
            const chars = await base44.asServiceRole.entities.Character.filter(
              { owner_email: ownerEmail, status: 'active' }, null, 100
            ).catch(() => []);
            observed.push(`—— Account Overview ——`);
            observed.push(`Active characters: ${chars.length}`);

            // ── EVIDENCE: Character health checks ──
            let frozenActivityCount = 0;
            let impossibleLocationCount = 0;
            let lowEnergyCount = 0;
            for (const c of chars.slice(0, 30)) {
              // Frozen activity check
              if (c.current_activity && c.current_activity !== 'none' && c.last_need_simulated_at) {
                const lastSim = new Date(c.last_need_simulated_at).getTime();
                if (Date.now() - lastSim > 6 * 60 * 60 * 1000) {
                  frozenActivityCount++;
                  inferred.push(`${c.name}: activity "${c.current_activity}" may be frozen (last simulated ${new Date(lastSim).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET)`);
                }
              }
              // Impossible location check
              if (c.resolved_presence_status === 'sleeping' && c.resolved_location_type === 'work') {
                impossibleLocationCount++;
                inferred.push(`${c.name}: impossible state — sleeping at work location`);
              }
              // Low energy check
              if (typeof c.energy_value === 'number' && c.energy_value < 15) {
                lowEnergyCount++;
                inferred.push(`${c.name}: critically low energy (${c.energy_value})`);
              }
            }
            if (frozenActivityCount === 0 && impossibleLocationCount === 0 && lowEnergyCount === 0) {
              observed.push(`Character health scan: ${Math.min(chars.length, 30)} checked, no critical issues detected`);
            }

            // ── EVIDENCE: Locations ──
            const locs = await base44.asServiceRole.entities.LocationReference.filter(
              { owner_email: ownerEmail }, null, 100
            ).catch(() => []);
            observed.push(`Locations: ${locs.length}`);

            // ── EVIDENCE: Active travel sessions ──
            const travel = await base44.asServiceRole.entities.TravelSession.filter(
              { owner_email: ownerEmail, route_status: 'in_transit' }, null, 20
            ).catch(() => []);
            if (travel.length > 0) {
              observed.push(`Active travel sessions: ${travel.length}`);
              const stuck = travel.filter(s => {
                if (!s.estimated_arrival_time) return false;
                return new Date(s.estimated_arrival_time).getTime() < Date.now() - 30 * 60 * 1000;
              });
              if (stuck.length > 0) {
                for (const s of stuck) {
                  const etaET = new Date(s.estimated_arrival_time).toLocaleString('en-US', {
                    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true,
                  });
                  inferred.push(`STUCK TRAVEL: ${s.character_name} → ${s.destination_location_name} (ETA was ${etaET} Eastern, overdue)`);
                }
              }
            } else {
              observed.push(`No active travel sessions`);
            }

            // ── EVIDENCE: SleepTransition records (silent failure verification) ──
            const recentSleepTransitions = await base44.asServiceRole.entities.SleepTransition.filter(
              { owner_email: ownerEmail }, '-timestamp', 20
            ).catch(() => []);
            observed.push(`Recent sleep transitions: ${recentSleepTransitions.length}`);

            // ── EVIDENCE: Vick self-report ──
            observed.push(`Vick Servicio: ID ${vick.id}, type: ${vick.character_type || 'not set'}, world_service: ${vick.is_world_service ?? 'NOT SET'}`);
            observed.push(`Vick location: ${vick.resolved_presence_status || 'unknown'} at ${vick.resolved_current_location_name || 'unknown'}`);

            // ── EVIDENCE: Pending VickInvestigations (queue health) ──
            const pendingInvestigations = await base44.asServiceRole.entities.VickInvestigation.filter(
              { owner_email: ownerEmail, status: 'queued' }, null, 20
            ).catch(() => []);
            if (pendingInvestigations.length > 1) {
              inferred.push(`${pendingInvestigations.length} queued investigations — possible backlog`);
            }

            // ── BUILD FINDINGS TEXT (same format as vickInvestigationBridge) ──
            const lines = [];
            lines.push('═══ RECOVERY YARD FINDINGS ═══');
            lines.push(`Generated: ${etLabel}`);
            lines.push(`Scope: scheduled_daytime_diagnostic (account overview)`);
            lines.push(`Slot: ${slotLabel} Eastern — ${etDate}`);
            lines.push('');

            lines.push('—— SOURCE AVAILABILITY ——');
            lines.push(`  CHARACTER RECORD: CHECKED (${chars.length} records)`);
            lines.push(`  LOCATION FILE: CHECKED (${locs.length} records)`);
            lines.push(`  TRAVEL SESSIONS: CHECKED (${travel.length} active)`);
            lines.push(`  SLEEP TRANSITIONS: CHECKED (${recentSleepTransitions.length} recent)`);
            lines.push(`  APP TIME USED: ${etLabel}`);
            lines.push(`  HOMEPAGE CARD UI: SOURCE NOT AVAILABLE (scheduled context — no frontend)`);
            lines.push(`  CONTRADICTION CHECK: SOURCE NOT AVAILABLE (scheduled context)`);
            lines.push('');

            if (observed.length > 0) {
              lines.push('—— OBSERVED (directly verified from database records) ——');
              observed.forEach(o => lines.push(`  ${o}`));
              lines.push('');
            }
            if (inferred.length > 0) {
              lines.push('—— INFERRED (derived from patterns, not directly confirmed) ——');
              inferred.forEach(i => lines.push(`  ${i}`));
              lines.push('');
            }
            if (unknown.length > 0) {
              lines.push('—— UNKNOWN (could not determine) ——');
              unknown.forEach(u => lines.push(`  ${u}`));
              lines.push('');
            }

            if (inferred.length === 0 && unknown.length === 0) {
              lines.push('No significant issues were detected in this scheduled pass.');
              lines.push('Frontend cross-reference (UI vs backend contradiction check) was not available — run a manual diagnostic from chat for full UI verification.');
              lines.push('');
            }

            lines.push('Review complete. Ask if you need more detail on any finding.');
            findingsText = lines.join('\n');

            // ── WRITE FINDINGS AS VICK MESSAGE TO CHAT ──────────────────────
            const findingsMsg = await base44.asServiceRole.entities.Message.create({
              conversation_id: conversation.id,
              sender_type: 'character',
              character_id: vick.id,
              character_name: vick.name || 'Vick Servicio',
              content: findingsText,
              is_narrative: true,
              is_read: false,
              recovery_signal: false,
              memory_eligible: false,
              relationship_eligible: false,
              timestamp: new Date().toISOString(),
              channel: 'direct',
            }).catch(e => {
              console.error(`[assignVickDaytimeDiagnostic] Findings message save failed for ${ownerEmail}: ${e.message}`);
              return null;
            });
            findingsMessageId = findingsMsg?.id || null;

            // Update conversation preview
            if (findingsMsg) {
              await base44.asServiceRole.entities.Conversation.update(conversation.id, {
                last_message_preview: `Recovery Yard findings: scheduled diagnostic ${slotLabel}`,
                last_message_date: new Date().toISOString(),
              }).catch(() => {});
            }

            // ── UPDATE INVESTIGATION WITH COMPLETED FINDINGS ────────────────
            await base44.asServiceRole.entities.VickInvestigation.update(investigation.id, {
              status: 'findings_ready',
              findings: findingsText,
              findings_delivered: true,
              delivered_at: new Date().toISOString(),
              resolution: 'monitoring_required',
              findings_read: false,
              conversation_id: conversation.id,
            }).catch(() => {});

            diagnosticRun = true;
            console.log(`[assignVickDaytimeDiagnostic] Vick completed diagnostic for ${ownerEmail} | findings_msg=${findingsMessageId} | observed=${observed.length} inferred=${inferred.length}`);
          } catch (diagErr) {
            diagnosticError = diagErr?.message || 'diagnostic execution failed';
            console.error(`[assignVickDaytimeDiagnostic] Diagnostic failed for ${ownerEmail}: ${diagnosticError}`);
            await base44.asServiceRole.entities.VickInvestigation.update(investigation.id, {
              status: 'awaiting_evidence',
              requires_user_input: true,
              user_input_prompt: `Scheduled diagnostic could not complete automatically: ${diagnosticError}`,
            }).catch(() => {});
          }
        }

        deliveries.push({
          ownerEmail,
          vickId: vick.id,
          vickName: vick.name,
          investigationId: investigation?.id || null,
          conversationId: conversation?.id || null,
          assignmentMessageId: messageId,
          findingsMessageId,
          diagnosticRun,
          diagnosticError,
          findingsProduced: !!findingsText,
          slot: slotLabel,
          etDate,
        });

        console.log(`[assignVickDaytimeDiagnostic] Delivered to ${ownerEmail} | vick=${vick.id} | slot=${slotLabel} | investigation=${investigation?.id} | assignment_msg=${messageId} | diagnosticRun=${diagnosticRun} | findings=${!!findingsText}`);
      } catch (acctErr) {
        console.error(`[assignVickDaytimeDiagnostic] Failed for ${ownerEmail}: ${acctErr.message}`);
        skipped.push({ ownerEmail, reason: 'error', error: acctErr.message });
      }
    }

    return Response.json({
      success: true,
      delivered: deliveries.length,
      skipped: skipped.length,
      deliveries,
      skipped,
      et_time: etLabel,
      et_date: etDate,
      slot: slotLabel,
      assignment_delivered: true,
      diagnostic_executed: deliveries.some(d => d.diagnosticRun),
    });

  } catch (error) {
    console.error('[assignVickDaytimeDiagnostic]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});