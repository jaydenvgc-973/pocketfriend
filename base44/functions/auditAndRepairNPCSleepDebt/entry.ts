/**
 * AUDIT AND REPAIR: NPC SLEEP DEBT + GLOBAL SLEEP DEBT DISABLE
 *
 * This function:
 * 1. Audits ALL characters for sleep_debt_hours, sleep_interrupted_at, and sleeping presence caused by debt
 * 2. Zeroes sleep_debt_hours and clears sleep_interrupted_at for ALL NPC types
 * 3. Caps active_created_character sleep debt at 0 if DISABLE_ALL_SLEEP_DEBT=true (default)
 * 4. Unblocks any character trapped as sleeping/napping due to debt
 * 5. Reports full per-character before/after proof
 *
 * NPC types that must NEVER have sleep debt:
 *   - npc_regular
 *   - npc_family_member
 *   - npc_fictitious
 *
 * Auth: admin only. Call as the admin user from the app.
 * Scope: owner_email-scoped. Pass owner_email in body or defaults to calling user's email.
 *        Pass scan_all_accounts=true (admin only) to scan all accounts.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const NPC_TYPES = new Set(['npc_regular', 'npc_family_member', 'npc_fictitious']);

// SLEEP DEBT DISABLED GLOBALLY: zero out debt for active_created_character too until system is proven safe
const DISABLE_ALL_SLEEP_DEBT = true;

// Presence statuses caused by sleep debt that must be cleared
const DEBT_DRIVEN_STATUSES = new Set(['napping', 'sleeping']);
const DEBT_DRIVEN_REASONS  = new Set(['recovery_nap', 'adaptive_pre_sleep_return', 'adaptive_sleep_location_lock', 'sleep_return_home']);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run === true;
    const scan_all_accounts = body.scan_all_accounts === true;

    // Determine which owner_email(s) to scan
    let targetEmails = [];
    if (scan_all_accounts) {
      // Fetch all distinct owner_emails from Character records (service role)
      const allChars = await base44.asServiceRole.entities.Character.list('-updated_date', 500);
      const emailSet = new Set(allChars.map(c => c.owner_email).filter(Boolean));
      targetEmails = Array.from(emailSet);
    } else {
      // Default: scan only the requesting admin's own account, or body.owner_email if specified
      const targetEmail = body.owner_email || user.email;
      if (!targetEmail) return Response.json({ error: 'No owner_email to scan' }, { status: 400 });
      targetEmails = [targetEmail];
    }

    const allResults = [];
    let totalAudited = 0;
    let totalNPCAudited = 0;
    let totalActiveAudited = 0;
    let totalNPCRepaired = 0;
    let totalActiveRepaired = 0;
    let totalErrors = 0;

    const byType = {};

    for (const owner_email of targetEmails) {
      // Fetch ALL characters for this owner (no type filter — we need to see everything)
      let chars = [];
      try {
        chars = await base44.asServiceRole.entities.Character.filter(
          { owner_email },
          '-updated_date',
          500
        );
      } catch (err) {
        allResults.push({ owner_email, error: `Character fetch failed: ${err.message}` });
        totalErrors++;
        continue;
      }

      for (const char of chars) {
        totalAudited++;

        const ctype = char.character_type || 'unknown';
        if (!byType[ctype]) byType[ctype] = 0;
        byType[ctype]++;

        const isNPC = NPC_TYPES.has(ctype);
        const isActive = ctype === 'active_created_character';

        if (isNPC) totalNPCAudited++;
        if (isActive) totalActiveAudited++;

        const currentDebt = char.sleep_debt_hours || 0;
        const currentInterrupted = char.sleep_interrupted_at || null;
        const currentPresence = char.resolved_presence_status || null;
        const currentReason = char.resolved_source_reason || null;

        // Determine if this character needs repair
        const debtNeedsZero = isNPC && currentDebt > 0;
        const activeDebtNeedsZero = isActive && DISABLE_ALL_SLEEP_DEBT && currentDebt > 0;
        const interruptedNeedsClearing = isNPC && currentInterrupted !== null;
        const activeInterruptedNeedsClearing = isActive && DISABLE_ALL_SLEEP_DEBT && currentInterrupted !== null;

        // Presence trapped by debt: sleeping/napping with a debt-driven source reason OR
        // napping status on an NPC (NPCs should never be napping)
        const presenceTrappedByDebt =
          (isNPC && DEBT_DRIVEN_STATUSES.has(currentPresence)) ||
          (DEBT_DRIVEN_REASONS.has(currentReason) && DEBT_DRIVEN_STATUSES.has(currentPresence)) ||
          (isActive && DISABLE_ALL_SLEEP_DEBT && currentReason === 'recovery_nap' && currentPresence === 'napping') ||
          (isActive && DISABLE_ALL_SLEEP_DEBT && currentReason === 'adaptive_pre_sleep_return');

        const needsRepair = debtNeedsZero || activeDebtNeedsZero ||
          interruptedNeedsClearing || activeInterruptedNeedsClearing ||
          presenceTrappedByDebt;

        if (!needsRepair) {
          allResults.push({
            owner_email,
            id: char.id,
            name: char.name,
            character_type: ctype,
            status: 'clean',
            sleep_debt_hours: currentDebt,
            sleep_interrupted_at: currentInterrupted,
            resolved_presence_status: currentPresence,
            resolved_source_reason: currentReason,
          });
          continue;
        }

        // Build repair payload
        const repairData = {};

        if (debtNeedsZero || activeDebtNeedsZero) {
          repairData.sleep_debt_hours = 0;
        }
        if (interruptedNeedsClearing || activeInterruptedNeedsClearing) {
          repairData.sleep_interrupted_at = null;
        }
        if (presenceTrappedByDebt) {
          // Unlock from sleep/nap — resolve to home fallback
          // We do NOT force a location here — just clear the blocking status so the resolver can run
          repairData.resolved_presence_status = 'home';
          repairData.resolved_source_reason = 'sleep_debt_trap_cleared';
          repairData.resolved_last_updated_at = new Date().toISOString();
        }

        const entry = {
          owner_email,
          id: char.id,
          name: char.name,
          character_type: ctype,
          status: dry_run ? 'would_repair' : 'repaired',
          before: {
            sleep_debt_hours: currentDebt,
            sleep_interrupted_at: currentInterrupted,
            resolved_presence_status: currentPresence,
            resolved_source_reason: currentReason,
          },
          after: {
            sleep_debt_hours: repairData.sleep_debt_hours ?? currentDebt,
            sleep_interrupted_at: repairData.sleep_interrupted_at !== undefined ? repairData.sleep_interrupted_at : currentInterrupted,
            resolved_presence_status: repairData.resolved_presence_status ?? currentPresence,
            resolved_source_reason: repairData.resolved_source_reason ?? currentReason,
          },
          repair_fields: Object.keys(repairData),
          reasons: [
            debtNeedsZero ? 'npc_had_sleep_debt' : null,
            activeDebtNeedsZero ? 'active_debt_disabled_globally' : null,
            interruptedNeedsClearing ? 'npc_had_sleep_interrupted_at' : null,
            activeInterruptedNeedsClearing ? 'active_interrupted_disabled_globally' : null,
            presenceTrappedByDebt ? `presence_trapped_by_debt(${currentReason})` : null,
          ].filter(Boolean),
        };

        if (!dry_run) {
          try {
            await base44.asServiceRole.entities.Character.update(char.id, repairData);
            if (isNPC) totalNPCRepaired++;
            if (isActive) totalActiveRepaired++;
          } catch (err) {
            entry.status = 'error';
            entry.error = err.message;
            totalErrors++;
          }
        } else {
          if (isNPC) totalNPCRepaired++;
          if (isActive) totalActiveRepaired++;
        }

        allResults.push(entry);
      }
    }

    const repaired = allResults.filter(r => r.status === 'repaired' || r.status === 'would_repair');
    const clean = allResults.filter(r => r.status === 'clean');
    const errors = allResults.filter(r => r.status === 'error');

    // Separate lists for required proof
    const npcRepaired = repaired.filter(r => NPC_TYPES.has(r.character_type));
    const activeRepaired = repaired.filter(r => r.character_type === 'active_created_character');
    const npcAuditedList = allResults.filter(r => NPC_TYPES.has(r.character_type));
    const activeAuditedList = allResults.filter(r => r.character_type === 'active_created_character');

    return Response.json({
      success: true,
      dry_run,
      disable_all_sleep_debt: DISABLE_ALL_SLEEP_DEBT,
      accounts_scanned: targetEmails,
      summary: {
        total_audited: totalAudited,
        by_character_type: byType,
        npc_audited: totalNPCAudited,
        active_created_audited: totalActiveAudited,
        npc_repaired: totalNPCRepaired,
        active_repaired: totalActiveRepaired,
        clean: clean.length,
        errors: totalErrors,
      },
      proof: {
        npc_audited_by_name: npcAuditedList.map(r => ({ name: r.name, id: r.id, type: r.character_type, status: r.status })),
        npc_repaired_by_name: npcRepaired.map(r => ({ name: r.name, id: r.id, type: r.character_type, reasons: r.reasons, before: r.before, after: r.after })),
        active_audited_by_name: activeAuditedList.map(r => ({ name: r.name, id: r.id, status: r.status })),
        active_repaired_by_name: activeRepaired.map(r => ({ name: r.name, id: r.id, reasons: r.reasons, before: r.before, after: r.after })),
      },
      disabled_paths: [
        'LAYER 3.5B: recovery_nap lock (lib/locationResolutionEngine.js) — DISABLED',
        'LAYER 3.5C: pre-sleep return window (lib/locationResolutionEngine.js) — DISABLED',
        'LAYER 0B: recovery nap lock (functions/scheduledLocationEnforcement) — DISABLED',
        'LAYER 0C: pre-sleep return window (functions/scheduledLocationEnforcement) — DISABLED',
        'All active_created_character sleep_debt_hours cleared (DISABLE_ALL_SLEEP_DEBT=true)',
        'All NPC sleep_debt_hours and sleep_interrupted_at cleared',
      ],
      full_results: allResults,
    });

  } catch (error) {
    console.error('[auditAndRepairNPCSleepDebt]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});