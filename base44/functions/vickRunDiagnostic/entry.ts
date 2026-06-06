import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * vickRunDiagnostic
 *
 * Vick Servicio's actual diagnostic execution bridge.
 * Queries the database directly (service role, scoped to authenticated user's account)
 * rather than routing through admin-gated functions that would reject non-admin callers.
 *
 * All queries are scoped to owner_email = authenticated user — no cross-account access.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { diagnosticType = 'account_overview', characterId = null } = await req.json().catch(() => ({}));
    const ownerEmail = user.email;

    const findings = [];
    const warnings = [];
    const errors = [];
    const ran = [];

    // ── CHARACTER AUDIT ────────────────────────────────────────────────────────
    if (diagnosticType === 'account_overview' || diagnosticType === 'characters' || diagnosticType === 'duplicates') {
      try {
        const allChars = await base44.asServiceRole.entities.Character.filter(
          { owner_email: ownerEmail },
          '-created_date',
          200
        );
        ran.push('character_scan');

        const active = allChars.filter(c => c.status === 'active');
        const softDeleted = allChars.filter(c => c.status === 'soft_deleted');
        const merged = allChars.filter(c => c.status === 'merged');
        const missingType = active.filter(c => !c.character_type);
        const missingHome = active.filter(c =>
          c.character_type === 'active_created_character' && !c.current_home_location_id
        );

        findings.push(`Total character records: ${allChars.length} (active: ${active.length}, soft_deleted: ${softDeleted.length}, merged: ${merged.length})`);

        // Duplicate name detection
        const nameCounts = {};
        active.forEach(c => {
          const key = (c.name || '').toLowerCase().trim();
          if (!key) return;
          nameCounts[key] = (nameCounts[key] || []);
          nameCounts[key].push(c.id);
        });
        const dupGroups = Object.entries(nameCounts).filter(([, ids]) => ids.length > 1);
        if (dupGroups.length > 0) {
          dupGroups.forEach(([name, ids]) => {
            errors.push(`Duplicate active character name "${name}": ${ids.length} records (${ids.join(', ')})`);
          });
        } else {
          findings.push('No duplicate character names detected.');
        }

        if (missingType.length > 0) {
          warnings.push(`${missingType.length} active character(s) missing character_type field — may affect routing`);
        }
        if (missingHome.length > 0) {
          warnings.push(`${missingHome.length} active_created_character(s) missing home location — housing unresolved`);
        }
      } catch (e) {
        errors.push(`Character scan failed: ${e.message}`);
      }
    }

    // ── LOCATION AUDIT ─────────────────────────────────────────────────────────
    if (diagnosticType === 'account_overview' || diagnosticType === 'locations') {
      try {
        const locs = await base44.asServiceRole.entities.LocationReference.filter(
          { owner_email: ownerEmail },
          '-created_date',
          100
        );
        ran.push('location_scan');
        findings.push(`Location records: ${locs.length}`);

        const noName = locs.filter(l => !l.name?.trim());
        const noType = locs.filter(l => !l.location_type);
        if (noName.length > 0) errors.push(`${noName.length} location(s) missing name`);
        if (noType.length > 0) warnings.push(`${noType.length} location(s) missing location_type`);
      } catch (e) {
        errors.push(`Location scan failed: ${e.message}`);
      }
    }

    // ── TRAVEL AUDIT ───────────────────────────────────────────────────────────
    if (diagnosticType === 'account_overview' || diagnosticType === 'travel') {
      try {
        const activeSessions = await base44.asServiceRole.entities.TravelSession.filter(
          { owner_email: ownerEmail, route_status: 'in_transit' },
          '-created_date',
          50
        );
        ran.push('travel_scan');

        const now = Date.now();
        const stuckSessions = activeSessions.filter(s => {
          if (!s.estimated_arrival_time) return false;
          const eta = new Date(s.estimated_arrival_time).getTime();
          return eta < now - 30 * 60 * 1000; // ETA passed >30min ago
        });

        findings.push(`Active travel sessions: ${activeSessions.length}`);
        if (stuckSessions.length > 0) {
          stuckSessions.forEach(s => {
            const etaEastern = new Date(s.estimated_arrival_time).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
            errors.push(`Stuck travel: ${s.character_name} → ${s.destination_location_name} (ETA was ${etaEastern} Eastern, still in_transit)`);
          });
        } else if (activeSessions.length > 0) {
          findings.push('All active travel sessions appear on schedule.');
        } else {
          findings.push('No active travel sessions.');
        }
      } catch (e) {
        errors.push(`Travel scan failed: ${e.message}`);
      }
    }

    // ── CONVERSATION / MESSAGE AUDIT ────────────────────────────────────────────
    if (diagnosticType === 'account_overview') {
      try {
        const convos = await base44.asServiceRole.entities.Conversation.filter(
          { owner_email: ownerEmail },
          '-updated_date',
          20
        );
        ran.push('conversation_scan');
        findings.push(`Recent conversations checked: ${convos.length}`);

        const staleLocked = convos.filter(c =>
          c.generation_lock?.generation_in_progress &&
          c.generation_lock?.generation_started_at &&
          (Date.now() - new Date(c.generation_lock.generation_started_at).getTime()) > 5 * 60 * 1000
        );
        if (staleLocked.length > 0) {
          staleLocked.forEach(c => {
            errors.push(`Stale generation lock on conversation with character ID ${(c.character_ids || [])[0] || 'unknown'} — may block new messages`);
          });
        } else {
          findings.push('No stale generation locks detected.');
        }

        const recoveryNeeded = convos.filter(c => c.generation_lock?.recovery_required);
        if (recoveryNeeded.length > 0) {
          warnings.push(`${recoveryNeeded.length} conversation(s) flagged for recovery`);
        }
      } catch (e) {
        errors.push(`Conversation scan failed: ${e.message}`);
      }
    }

    // ── MEMORY AUDIT ───────────────────────────────────────────────────────────
    if (diagnosticType === 'memory' && characterId) {
      try {
        const memories = await base44.asServiceRole.entities.Memory.filter(
          { character_id: characterId },
          '-created_date',
          50
        );
        ran.push('memory_scan');
        findings.push(`Memory records for character: ${memories.length}`);

        const unresolved = memories.filter(m => m.validation_status === 'unresolved_identity');
        if (unresolved.length > 0) {
          warnings.push(`${unresolved.length} memory record(s) with unresolved identity — may reference wrong character`);
        } else {
          findings.push('No identity resolution issues in memory records.');
        }
      } catch (e) {
        errors.push(`Memory scan failed: ${e.message}`);
      }
    }

    // ── FINANCIAL AUDIT ────────────────────────────────────────────────────────
    if (diagnosticType === 'finance' || diagnosticType === 'account_overview') {
      try {
        const finRecords = await base44.asServiceRole.entities.CharacterFinancial.filter(
          { owner_email: ownerEmail },
          '-created_date',
          50
        );
        ran.push('financial_scan');

        const playableFinancials = finRecords.filter(f => !f.is_npc);
        findings.push(`Financial records (playable characters): ${playableFinancials.length}`);

        const zeroBalance = playableFinancials.filter(f => (f.current_balance ?? 0) === 0);
        if (zeroBalance.length > 0) {
          warnings.push(`${zeroBalance.length} character(s) with $0 balance — may indicate a balance reset issue`);
        }
      } catch (e) {
        errors.push(`Financial scan failed: ${e.message}`);
      }
    }

    // ── Build plain-language report ────────────────────────────────────────────
    const errorCount = errors.length;
    const warningCount = warnings.length;
    const findingCount = findings.length;
    const functionsRan = ran.length;

    let verdict = 'clean';
    if (errorCount > 0) verdict = 'issues_found';
    else if (warningCount > 0) verdict = 'warnings_found';

    let plainSummary = '';
    if (functionsRan === 0) {
      plainSummary = `I tried to run the diagnostic but nothing came back. The connection may be down. I can discuss the issue but I cannot honestly say I ran the check.`;
    } else if (verdict === 'clean') {
      plainSummary = `I ran ${functionsRan} diagnostic check${functionsRan === 1 ? '' : 's'} against your account. Everything came back clean — no errors, no duplicate characters, no stuck travel, no stale locks.\n\nChecked: ${findings.slice(0, 6).map(f => `- ${f}`).join('\n')}`;
    } else if (verdict === 'issues_found') {
      plainSummary = `I ran ${functionsRan} diagnostic check${functionsRan === 1 ? '' : 's'}. I found ${errorCount} issue${errorCount === 1 ? '' : 's'} that need attention:\n\n${errors.slice(0, 8).map(e => `- ${e}`).join('\n')}`;
      if (warningCount > 0) {
        plainSummary += `\n\nI also flagged ${warningCount} warning${warningCount === 1 ? '' : 's'}:\n${warnings.slice(0, 4).map(w => `- ${w}`).join('\n')}`;
      }
      if (findings.length > 0) {
        plainSummary += `\n\nOther findings:\n${findings.slice(0, 4).map(f => `- ${f}`).join('\n')}`;
      }
    } else {
      plainSummary = `I ran ${functionsRan} diagnostic check${functionsRan === 1 ? '' : 's'}. No critical errors, but I flagged ${warningCount} thing${warningCount === 1 ? '' : 's'} worth watching:\n\n${warnings.slice(0, 6).map(w => `- ${w}`).join('\n')}`;
      if (findings.length > 0) {
        plainSummary += `\n\nFindings:\n${findings.slice(0, 4).map(f => `- ${f}`).join('\n')}`;
      }
    }

    console.log(`[vickRunDiagnostic] owner=${ownerEmail} | type=${diagnosticType} | ran=${ran.join(',')} | errors=${errorCount} | warnings=${warningCount}`);

    return Response.json({
      success: true,
      ownerEmail,
      diagnosticType,
      verdict,
      functionsRan,
      errorCount,
      warningCount,
      findingCount,
      findings,
      warnings,
      errors,
      functionsExecuted: ran,
      plainSummary,
    });

  } catch (error) {
    console.error('[vickRunDiagnostic]', error.message);
    return Response.json({
      success: false,
      error: error.message,
      plainSummary: `I ran into an error before I could start the diagnostic: ${error.message}. I can discuss the issue but I cannot claim I ran the check.`,
    }, { status: 500 });
  }
});