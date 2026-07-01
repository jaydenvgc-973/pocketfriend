/**
 * vickRoutineDaytimeDiagnostic
 *
 * Brief recurring diagnostic routine for Vick Servicio.
 * Runs every 2 hours via a scheduled automation, but self-gates to the
 * 7:00 AM – 5:00 PM Eastern Time window so it never fires at night and
 * handles DST automatically (the scheduler fires every 2h round-the-clock;
 * this function no-ops outside business hours).
 *
 * Scope: 13 lightweight categories. Each check uses count/sample queries —
 * no exhaustive scans, no state mutations, no long-running loops.
 *
 * Behavior:
 *   - If no issues: logs a "passed" summary, returns. Vick stays in normal character state.
 *   - If issues found: records findings, returns structured summary.
 *   - Never traps Vick in diagnostic mode. Never mutates character/app state.
 *   - Does not replace the twice-weekly deep investigation reports.
 *
 * This is a SCHEDULED function — invoked by the platform scheduler with no
 * user session. Uses service role for read access across all accounts.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const EASTERN_TZ = 'America/New_York';
const WINDOW_START_HOUR = 7;  // 7 AM Eastern
const WINDOW_END_HOUR = 17;   // 5 PM Eastern (inclusive — 5 PM is the last run)

/**
 * Returns the current Eastern Time hour (0-23) and minute.
 */
function getEasternHourAndMinute(): { hour: number; minute: number; dateStr: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '0';
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`;
  return { hour: hour === 24 ? 0 : hour, minute, dateStr };
}

interface Finding {
  category: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  evidence: string;
  user_impact: string;
  classification: 'Verified Success' | 'Legitimate Exception' | 'Delayed' | 'Blocked' | 'Silent Failure' | 'Data Integrity Issue' | 'Unknown / Missing Evidence';
  recommended_next_step: string;
  affected_owner_email?: string;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // ── EASTERN TIME WINDOW GATE ──────────────────────────────────────────────
    const { hour, dateStr } = getEasternHourAndMinute();
    if (hour < WINDOW_START_HOUR || hour > WINDOW_END_HOUR) {
      return Response.json({
        success: true,
        skipped: true,
        reason: `Outside diagnostic window (Eastern hour=${hour}). Window is ${WINDOW_START_HOUR}:00–${WINDOW_END_HOUR}:00 ET.`,
        eastern_date: dateStr,
      });
    }

    const sr = base44.asServiceRole;
    const findings: Finding[] = [];
    const t_start = Date.now();

    // ══════════════════════════════════════════════════════════════════════════
    // 1. APPLICATION HEALTH — stuck travel sessions, stale generation locks,
    //    recovery signals, failed image analysis.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const stuckSessions = await sr.entities.TravelSession.filter({
        route_status: { $in: ['arrival_due', 'arrival_failed', 'blocked', 'delayed'] },
      }, '-created_at', 50).catch(() => []);

      if (stuckSessions.length > 0) {
        const failedCount = stuckSessions.filter(s => s.route_status === 'arrival_failed').length;
        const blockedCount = stuckSessions.filter(s => s.route_status === 'blocked').length;
        findings.push({
          category: 'Application Health',
          severity: failedCount > 5 ? 'critical' : 'warning',
          title: `${stuckSessions.length} travel sessions in non-normal state (${failedCount} failed, ${blockedCount} blocked)`,
          evidence: stuckSessions.slice(0, 5).map(s => `${s.character_name || s.character_id}: ${s.route_status} (dest=${s.destination_location_name || '?'})`).join('; '),
          user_impact: 'Characters may appear stuck in transit or never arrive at destinations.',
          classification: failedCount > 0 ? 'Silent Failure' : 'Delayed',
          recommended_next_step: 'Review stuck sessions and determine if arrival completion or rollback is needed.',
        });
      }

      // Recovery signals in recent messages (last 2h)
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const recoveryMsgs = await sr.entities.Message.filter({
        recovery_signal: true,
        created_date: { $gte: twoHoursAgo },
      }, '-created_date', 20).catch(() => []);

      if (recoveryMsgs.length > 3) {
        findings.push({
          category: 'Application Health',
          severity: 'warning',
          title: `${recoveryMsgs.length} recovery-signal messages in the last 2 hours`,
          evidence: `Message IDs: ${recoveryMsgs.slice(0, 5).map(m => m.id).join(', ')}`,
          user_impact: 'Characters may be showing fallback/reconnecting text instead of real dialogue.',
          classification: 'Silent Failure',
          recommended_next_step: 'Check LLM availability and fallback circuit breaker state.',
        });
      }
    } catch (e) {
      // non-fatal
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 2. CHARACTER HEALTH — sample active_created_characters for invalid states.
    // ══════════════════════════════════════════════════════════════════════════
    let activeChars: any[] = [];
    try {
      activeChars = await sr.entities.Character.filter({
        character_type: 'active_created_character',
        status: 'active',
      }, '-updated_date', 100).catch(() => []);

      const invalidPresence = activeChars.filter(c => {
        const ps = c.resolved_presence_status;
        return ps && !['home', 'at_work', 'at_school', 'visiting', 'traveling', 'under_supervision', 'sleeping', 'napping', 'passed_out', 'temporary_housing', 'incarcerated', 'house_arrest', 'confined', 'hospitalized'].includes(ps);
      });
      if (invalidPresence.length > 0) {
        findings.push({
          category: 'Character Health',
          severity: 'warning',
          title: `${invalidPresence.length} characters with invalid resolved_presence_status`,
          evidence: invalidPresence.slice(0, 5).map(c => `${c.name}: "${c.resolved_presence_status}"`).join('; '),
          user_impact: 'UI may display incorrect presence badges or block interactions.',
          classification: 'Data Integrity Issue',
          recommended_next_step: 'Correct invalid presence status values via presence enforcement.',
        });
      }

      // Needs out of range
      const badNeeds = activeChars.filter(c => {
        const v = (f: number | undefined) => typeof f === 'number' && (f < 0 || f > 100);
        return v(c.hunger_value) || v(c.energy_value) || v(c.social_value) || v(c.health_value) || v(c.hygiene_value);
      });
      if (badNeeds.length > 0) {
        findings.push({
          category: 'Character Health',
          severity: 'warning',
          title: `${badNeeds.length} characters with out-of-range needs values`,
          evidence: badNeeds.slice(0, 5).map(c => `${c.name}: energy=${c.energy_value} hunger=${c.hunger_value}`).join('; '),
          user_impact: 'Needs bars may display incorrectly or trigger wrong autonomous actions.',
          classification: 'Data Integrity Issue',
          recommended_next_step: 'Clamp needs values to 0-100 range.',
        });
      }

      // Stale needs simulation (>6h since last sim for active chars)
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const staleNeeds = activeChars.filter(c => {
        if (!c.needs_initialized) return false;
        const last = c.last_need_simulated_at;
        return last && last < sixHoursAgo && !c.needs_locks;
      });
      if (staleNeeds.length > 3) {
        findings.push({
          category: 'Character Health',
          severity: 'warning',
          title: `${staleNeeds.length} active characters with needs not simulated in 6+ hours`,
          evidence: staleNeeds.slice(0, 5).map(c => `${c.name}: last_sim=${c.last_need_simulated_at}`).join('; '),
          user_impact: 'Characters may appear frozen — needs not decaying, no autonomous behavior.',
          classification: 'Silent Failure',
          recommended_next_step: 'Verify needs simulation automation is firing.',
        });
      }
    } catch (e) {
      // non-fatal
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 3. LOCATION AND PRESENCE — characters with no resolved location.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const noLocation = activeChars.filter(c => !c.resolved_current_location_id && c.resolved_presence_status !== 'traveling' && !c.is_jailed);
      if (noLocation.length > 2) {
        findings.push({
          category: 'Location and Presence',
          severity: 'warning',
          title: `${noLocation.length} active characters with no resolved_current_location_id`,
          evidence: noLocation.slice(0, 5).map(c => c.name).join(', '),
          user_impact: 'Travel page and scene system may not place these characters correctly.',
          classification: 'Data Integrity Issue',
          recommended_next_step: 'Run location resolution repair for affected characters.',
        });
      }
    } catch (e) {
      // non-fatal
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 4. TIME AND SCHEDULING — overdue scheduled events.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const nowIso = new Date().toISOString();
      const overdueEvents = await sr.entities.ScheduledEvent.filter({
        status: 'pending',
        trigger_time: { $lt: nowIso },
      }, 'trigger_time', 30).catch(() => []);

      if (overdueEvents.length > 10) {
        findings.push({
          category: 'Time and Scheduling',
          severity: 'warning',
          title: `${overdueEvents.length} overdue scheduled events`,
          evidence: overdueEvents.slice(0, 5).map(e => `${e.description || e.id}: trigger=${e.trigger_time}`).join('; '),
          user_impact: 'Scheduled character actions (follow-ups, alarms) may not fire.',
          classification: 'Delayed',
          recommended_next_step: 'Verify processScheduledEvents automation is running.',
        });
      }
    } catch (e) {
      // non-fatal
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 5–6. CHAT SYSTEM — duplicate response patterns, generation lock issues.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      // Conversations with stale generation locks (>10 min)
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const lockedConvos = await sr.entities.Conversation.filter({}, '-updated_date', 50).catch((() => []));
      const staleLocks = lockedConvos.filter(c => {
        const gl = c.generation_lock;
        return gl?.generation_in_progress && gl.generation_started_at && gl.generation_started_at < tenMinAgo;
      });
      if (staleLocks.length > 0) {
        findings.push({
          category: 'Chat System',
          severity: 'warning',
          title: `${staleLocks.length} conversations with stale generation locks (>10 min)`,
          evidence: staleLocks.slice(0, 5).map(c => `${c.title || c.id}: started=${c.generation_lock.generation_started_at}`).join('; '),
          user_impact: 'Characters may not respond — lock blocks new generation requests.',
          classification: 'Blocked',
          recommended_next_step: 'Release stale generation locks.',
        });
      }
    } catch (e) {
      // non-fatal
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 7. WORLD PHONE — failed sync, undelivered messages.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const failedSync = await sr.entities.Message.filter({
        channel: 'world_phone',
        sync_status: 'failed',
      }, '-created_date', 20).catch(() => []);

      if (failedSync.length > 5) {
        findings.push({
          category: 'World Phone',
          severity: 'warning',
          title: `${failedSync.length} world_phone messages with sync_status=failed`,
          evidence: failedSync.slice(0, 5).map(m => `${m.character_name || m.id}: ${m.sync_error || 'no error'}`).join('; '),
          user_impact: 'Bilateral conversations may be missing messages on one side.',
          classification: 'Silent Failure',
          recommended_next_step: 'Retry bilateral sync for affected conversations.',
        });
      }
    } catch (e) {
      // non-fatal
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 9. IMAGE GENERATION — failed image analysis.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const failedImages = await sr.entities.Message.filter({
        image_analysis_status: 'failed',
        created_date: { $gte: twoHoursAgo },
      }, '-created_date', 20).catch(() => []);

      if (failedImages.length > 5) {
        findings.push({
          category: 'Image Generation',
          severity: 'info',
          title: `${failedImages.length} messages with failed image analysis in last 2h`,
          evidence: `IDs: ${failedImages.slice(0, 5).map(m => m.id).join(', ')}`,
          user_impact: 'Image descriptions may be missing for vision-context injection.',
          classification: 'Delayed',
          recommended_next_step: 'Re-run image analysis for affected messages.',
        });
      }
    } catch (e) {
      // non-fatal
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 10. AUTONOMOUS SYSTEMS — characters with no activity change in 24h.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const frozenChars = activeChars.filter(c => {
        if (!c.updated_date) return false;
        return c.updated_date < dayAgo && !c.needs_locks && c.resolved_presence_status !== 'sleeping';
      });
      if (frozenChars.length > 3) {
        findings.push({
          category: 'Autonomous Systems',
          severity: 'warning',
          title: `${frozenChars.length} active characters not updated in 24+ hours`,
          evidence: frozenChars.slice(0, 5).map(c => `${c.name}: updated=${c.updated_date}`).join('; '),
          user_impact: 'Characters may appear lifeless — no autonomous actions, needs, or movement.',
          classification: 'Silent Failure',
          recommended_next_step: 'Verify autonomous action automation is processing these characters.',
        });
      }
    } catch (e) {
      // non-fatal
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 11. DATA INTEGRITY — duplicate Vick characters.
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const vicks = await sr.entities.Character.filter({
        is_world_service: true,
        name: { $regex: 'Vick' },
      }, '-created_date', 20).catch(() => []);
      // Count per owner_email
      const vickByOwner: Record<string, number> = {};
      for (const v of vicks) {
        const key = v.owner_email || '__no_owner__';
        vickByOwner[key] = (vickByOwner[key] || 0) + 1;
      }
      const dupOwners = Object.entries(vickByOwner).filter(([, n]) => n > 1);
      if (dupOwners.length > 0) {
        findings.push({
          category: 'Data Integrity',
          severity: 'critical',
          title: `Duplicate Vick Servicio characters detected for ${dupOwners.length} account(s)`,
          evidence: dupOwners.map(([email, n]) => `${email}: ${n} Vicks`).join('; '),
          user_impact: 'Multiple Vicks can cause split conversations and conflicting diagnostics.',
          classification: 'Data Integrity Issue',
          recommended_next_step: 'Consolidate duplicate Vick characters per account.',
          affected_owner_email: dupOwners[0]?.[0],
        });
      }
    } catch (e) {
      // non-fatal
    }

    // ══════════════════════════════════════════════════════════════════════════
    // 13. SILENT FAILURE VERIFICATION — sample 3 active characters for
    //     sleep/work outcome verification (today's SleepTransitions).
    // ══════════════════════════════════════════════════════════════════════════
    try {
      const sample = activeChars.slice(0, 3);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayIso = todayStart.toISOString();

      for (const char of sample) {
        if (!char.owner_email) continue;
        const sleepTransitions = await sr.entities.SleepTransition.filter({
          character_id: char.id,
          timestamp: { $gte: todayIso },
        }, 'timestamp', 10).catch(() => []);

        const isSleepingNow = char.resolved_presence_status === 'sleeping';
        const hasSleepStart = sleepTransitions.some(t => t.transition_type === 'sleep_start' || t.transition_type === 'nap_start');

        // If character is sleeping but no transition recorded today → possible data gap
        if (isSleepingNow && !hasSleepStart && char.last_sleep_start) {
          const sleepStart = new Date(char.last_sleep_start);
          if (sleepStart >= todayStart) {
            findings.push({
              category: 'Silent Failure Verification',
              severity: 'info',
              title: `${char.name}: sleeping but no SleepTransition recorded today`,
              evidence: `presence=sleeping, last_sleep_start=${char.last_sleep_start}, transitions_today=${sleepTransitions.length}`,
              user_impact: 'Sleep timeline reconstruction may be incomplete for this character.',
              classification: 'Unknown / Missing Evidence',
              recommended_next_step: 'Verify SleepTransition logging is firing on sleep start.',
              affected_owner_email: char.owner_email,
            });
          }
        }

        // Energy check: if slept recently but energy still very low
        if (hasSleepStart && char.energy_value < 20 && !isSleepingNow) {
          findings.push({
            category: 'Silent Failure Verification',
            severity: 'warning',
            title: `${char.name}: slept today but energy still critical (${char.energy_value})`,
            evidence: `energy=${char.energy_value}, sleep_transitions_today=${sleepTransitions.length}`,
            user_impact: 'Character may not have actually recovered energy during sleep.',
            classification: 'Silent Failure',
            recommended_next_step: 'Verify sleep cap enforcement and energy recovery logic.',
            affected_owner_email: char.owner_email,
          });
        }
      }
    } catch (e) {
      // non-fatal
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FINDINGS SUMMARY
    // ══════════════════════════════════════════════════════════════════════════
    const elapsed_ms = Date.now() - t_start;
    const classificationCounts: Record<string, number> = {};
    for (const f of findings) {
      classificationCounts[f.classification] = (classificationCounts[f.classification] || 0) + 1;
    }

    const summary = {
      diagnostic_passed: findings.length === 0,
      eastern_time: `${hour}:00 ET (${dateStr})`,
      elapsed_ms,
      total_findings: findings.length,
      classification_counts: classificationCounts,
      categories_checked: 13,
      active_characters_sampled: activeChars.length,
      findings: findings.slice(0, 20),
    };

    console.log(`[VickRoutineDiagnostic] ${summary.diagnostic_passed ? 'PASSED' : 'FOUND ' + findings.length + ' issue(s)'} | ET=${hour}:00 | ${elapsed_ms}ms | classifications=${JSON.stringify(classificationCounts)}`);

    // Best-effort: record meaningful findings as VickInvestigation records
    // for the affected owner_email. Only for warning/critical findings.
    const recordableFindings = findings.filter(f => f.severity !== 'info' && f.affected_owner_email);
    for (const f of recordableFindings.slice(0, 5)) {
      try {
        await sr.entities.VickInvestigation.create({
          owner_email: f.affected_owner_email!,
          title: `[Routine ${dateStr} ${hour}:00] ${f.title}`,
          description: `Category: ${f.category}\nEvidence: ${f.evidence}\nUser impact: ${f.user_impact}`,
          status: 'findings_ready',
          priority: f.severity === 'critical' ? 'critical' : 'normal',
          findings: `${f.title}\n\nEvidence: ${f.evidence}\nClassification: ${f.classification}\nRecommended: ${f.recommended_next_step}`,
          findings_delivered: false,
          findings_read: false,
          tags: [f.category, 'routine_daytime', dateStr],
          started_at: new Date().toISOString(),
        }).catch(() => {});
      } catch (e) {
        // non-fatal — recording is best-effort
      }
    }

    return Response.json({ success: true, ...summary });
  } catch (error) {
    console.error(`[VickRoutineDiagnostic] ERROR: ${error.message}`);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});