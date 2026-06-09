import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Current valid character_type values per schema
const VALID_CHARACTER_TYPES = ['active', 'npc', 'family_npc', 'background', 'promoted_npc'];
const VALID_STATUSES = ['active', 'moved_away', 'deleted', 'soft_deleted', 'merged'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { selectedIssues = [] } = await req.json();

    const results = {
      summary: '',
      checks: [],
      fixes_applied: [],
      issues_found: [],
    };

    // Always scope to this user's account — never global lists
    const allUserChars = await base44.asServiceRole.entities.Character.filter({ created_by: user.email }, '-created_date', 300);
    const activeChars = allUserChars.filter(c => !c.status || c.status === 'active');

    // ── ORPHANED / INCOMPLETE CHARACTER RECORDS ──────────────────────────────
    if (selectedIssues.includes('orphaned_characters')) {
      const orphaned = [];
      for (const char of allUserChars) {
        const missing = [];
        if (!char.name?.trim()) missing.push('name');
        if (!char.character_type) missing.push('character_type');
        if (!char.status) missing.push('status (will default to active but should be explicit)');
        if (!char.created_by) missing.push('created_by');

        // Visibility flags that affect list inclusion
        if (char.exclude_from_homepage === true && !char.is_test_character) {
          missing.push('exclude_from_homepage=true (hidden from home)');
        }

        if (missing.length > 0) {
          orphaned.push({ char, missing });
          results.issues_found.push(`"${char.name || char.id}": missing/flagged fields: ${missing.join(', ')}`);
        }
      }

      // Safe fix: only set missing default values, never change existing valid data
      for (const { char, missing } of orphaned) {
        const update = {};
        if (!char.emotional_state) update.emotional_state = 'calm';
        if (Object.keys(update).length > 0) {
          await base44.asServiceRole.entities.Character.update(char.id, update);
          results.fixes_applied.push(`"${char.name}": filled missing default fields (${Object.keys(update).join(', ')})`);
        }
      }

      results.checks.push({
        name: 'Orphaned / Incomplete Character Records',
        status: orphaned.length === 0 ? 'passed' : 'warning',
        message: orphaned.length === 0
          ? `All ${allUserChars.length} characters have required fields`
          : `${orphaned.length} character(s) have missing or flagged fields that may affect list inclusion. Review above.`
      });
    }

    // ── CHARACTER TYPE AUDIT ─────────────────────────────────────────────────
    if (selectedIssues.includes('character_type_audit')) {
      const invalidType = allUserChars.filter(c => !c.character_type || !VALID_CHARACTER_TYPES.includes(c.character_type));
      const invalidStatus = allUserChars.filter(c => c.status && !VALID_STATUSES.includes(c.status));

      if (invalidType.length > 0) {
        invalidType.forEach(c => {
          results.issues_found.push(`"${c.name}": character_type="${c.character_type || 'not set'}" is not valid. Valid values: ${VALID_CHARACTER_TYPES.join(', ')}`);
        });
      }

      if (invalidStatus.length > 0) {
        invalidStatus.forEach(c => {
          results.issues_found.push(`"${c.name}": status="${c.status}" is not valid. Valid values: ${VALID_STATUSES.join(', ')}`);
        });
      }

      // Type distribution report
      const typeCounts = {};
      allUserChars.forEach(c => {
        typeCounts[c.character_type || 'not_set'] = (typeCounts[c.character_type || 'not_set'] || 0) + 1;
      });
      const typeReport = Object.entries(typeCounts).map(([t, n]) => `${t}: ${n}`).join(' | ');

      results.checks.push({
        name: 'Character Type Audit',
        status: invalidType.length === 0 && invalidStatus.length === 0 ? 'passed' : 'failed',
        message: invalidType.length === 0 && invalidStatus.length === 0
          ? `All character types and statuses are valid. Distribution: ${typeReport}`
          : `${invalidType.length} invalid character_type(s), ${invalidStatus.length} invalid status(es). Distribution: ${typeReport}`
      });
    }

    // ── WORLD NAME GLOBAL SCAN ───────────────────────────────────────────────
    if (selectedIssues.includes('world_name_global')) {
      const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: user.email });
      const worldName = settingsList?.[0]?.fictional_world_name || null;
      const PLACEHOLDER_PATTERNS = [/\bthe user\b/i, /\bthe player\b/i, /\bplayer\b/i];

      if (!worldName) {
        results.checks.push({
          name: 'World Name Identity — Global',
          status: 'warning',
          message: 'No world name set. Go to Settings > Your Name (In-World) to set one. Characters will use generic pronouns until then.'
        });
      } else {
        let staleCacheCount = 0;
        let staleMemoryTotal = 0;

        for (const char of activeChars) {
          // Clear stale system_prompt caches with placeholder identity
          if (char.system_prompt && PLACEHOLDER_PATTERNS.some(p => p.test(char.system_prompt))) {
            await base44.asServiceRole.entities.Character.update(char.id, { system_prompt: null });
            results.fixes_applied.push(`"${char.name}": cleared stale system_prompt cache containing placeholder identity`);
            staleCacheCount++;
          }

          // Scan memories for this character (limit per char to avoid timeout)
          const memories = await base44.asServiceRole.entities.Memory.filter({ character_id: char.id }, '-timestamp', 100);
          const staleMemories = memories.filter(m => PLACEHOLDER_PATTERNS.some(p => p.test(m.title || '') || p.test(m.description || '')));
          for (const mem of staleMemories) {
            const newTitle = (mem.title || '').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
            const newDesc = (mem.description || '').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
            await base44.asServiceRole.entities.Memory.update(mem.id, { title: newTitle, description: newDesc });
            staleMemoryTotal++;
          }
        }

        if (staleCacheCount > 0) results.fixes_applied.push(`Cleared ${staleCacheCount} stale system_prompt cache(s) across all characters`);
        if (staleMemoryTotal > 0) results.fixes_applied.push(`Corrected ${staleMemoryTotal} memory record(s): replaced placeholder identity with "${worldName}"`);

        results.checks.push({
          name: 'World Name Identity — Global',
          status: staleCacheCount === 0 && staleMemoryTotal === 0 ? 'passed' : 'fixed',
          message: staleCacheCount === 0 && staleMemoryTotal === 0
            ? `No placeholder identity found across ${activeChars.length} active characters. World name "${worldName}" is correctly propagated.`
            : `Fixed: ${staleCacheCount} stale prompt cache(s), ${staleMemoryTotal} memory record(s) corrected to use "${worldName}"`
        });
      }
    }

    // ── WORK SCHEDULE SYNC ───────────────────────────────────────────────────
    if (selectedIssues.includes('work_schedule_sync')) {
      // Get current time in ET (as the app uses ET for schedules)
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const currentDay = nowET.getDay(); // 0=Sun, 6=Sat
      const currentHour = nowET.getHours();
      const currentMin = nowET.getMinutes();
      const currentTime = currentHour * 60 + currentMin;

      const violations = [];
      for (const char of activeChars) {
        if (!char.work_start_time || !char.work_end_time || !char.work_days?.length) continue;
        const [startH, startM] = char.work_start_time.split(':').map(Number);
        const [endH, endM] = char.work_end_time.split(':').map(Number);
        const startMin = startH * 60 + startM;
        const endMin = endH * 60 + endM;

        const isWorkDay = char.work_days.includes(currentDay);
        const isDuringShift = currentTime >= startMin && currentTime < endMin;
        const shouldBeAtWork = isWorkDay && isDuringShift;

        const presenceStatus = char.resolved_presence_status || '';
        const isMarkedAtWork = presenceStatus === 'at_work';
        const isSleeping = presenceStatus === 'sleeping' || presenceStatus === 'napping';

        // Only flag if clearly wrong (not sleeping, not at work during scheduled shift)
        if (shouldBeAtWork && !isMarkedAtWork && !isSleeping) {
          violations.push(`"${char.name}": should be at work (${char.work_start_time}–${char.work_end_time}) but resolved_presence_status="${presenceStatus || 'not set'}"`);
        }
      }

      violations.forEach(v => results.issues_found.push(v));
      results.checks.push({
        name: 'Work Schedule Adherence',
        status: violations.length === 0 ? 'passed' : 'warning',
        message: violations.length === 0
          ? `All characters with work schedules are correctly placed (checked ${activeChars.length} characters at ${nowET.toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET)`
          : `${violations.length} character(s) may not be correctly marked at work during their scheduled shift`
      });
    }

    // ── CLOSED VENUE PRESENCE ────────────────────────────────────────────────
    if (selectedIssues.includes('closed_venue_presence')) {
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const currentDay = nowET.getDay();
      const currentHour = nowET.getHours();
      const currentMin = nowET.getMinutes();
      const currentTimeMin = currentHour * 60 + currentMin;

      // Load all accessible locations
      const userLocs = await base44.asServiceRole.entities.LocationReference.filter({ created_by: user.email });
      const sharedLocs = await base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' });
      const allLocs = [...userLocs, ...sharedLocs];
      const locById = {};
      allLocs.forEach(l => { locById[l.id] = l; });

      const closedViolations = [];
      for (const char of activeChars) {
        if (!char.resolved_current_location_id) continue;
        const loc = locById[char.resolved_current_location_id];
        if (!loc?.operating_hours?.length) continue;

        const todayHours = loc.operating_hours.find(h => h.day_of_week === currentDay);
        if (!todayHours) {
          // Location closed today entirely
          closedViolations.push(`"${char.name}" is at "${loc.name}" which has no operating hours for today (day ${currentDay})`);
          continue;
        }

        const [openH, openM] = todayHours.open_time.split(':').map(Number);
        const [closeH, closeM] = todayHours.close_time.split(':').map(Number);
        const openMin = openH * 60 + openM;
        const closeMin = closeH * 60 + closeM;

        if (currentTimeMin < openMin || currentTimeMin >= closeMin) {
          closedViolations.push(`"${char.name}" is at "${loc.name}" which is currently closed (open ${todayHours.open_time}–${todayHours.close_time})`);
        }
      }

      closedViolations.forEach(v => results.issues_found.push(v));
      results.checks.push({
        name: 'Closed Venue Presence',
        status: closedViolations.length === 0 ? 'passed' : 'warning',
        message: closedViolations.length === 0
          ? `No characters found at closed venues`
          : `${closedViolations.length} character(s) are at venues outside operating hours`
      });
    }

    // ── WORLD PHONE ANCHOR INTEGRITY ─────────────────────────────────────────
    // Checks for World Phone conversations referencing deleted/merged character IDs.
    // These are the "wires cut" cases: the character believes it sent a message but
    // the recipient never received a Message row because the Conversation anchor is stale.
    // This runs a DRY RUN of auditAndRepairWorldPhoneAnchors and surfaces the findings.
    if (selectedIssues.includes('world_phone_anchors')) {
      try {
        const anchorRes = await base44.asServiceRole.functions.invoke('auditAndRepairWorldPhoneAnchors', { dryRun: true });
        const anchorData = anchorRes?.data || anchorRes;
        const broken = anchorData?.broken_conversations_found ?? 0;
        const manualReview = anchorData?.needs_manual_review ?? 0;
        const unresolvedMems = anchorData?.still_unresolved_memories ?? 0;
        const autoResolved = anchorData?.auto_resolved_memories ?? 0;

        if (broken > 0) {
          results.issues_found.push(
            `${broken} World Phone conversation(s) reference deleted or merged character IDs — these recipients will never receive messages until re-anchored.`
          );
          (anchorData?.broken_details || []).slice(0, 5).forEach(b => {
            results.issues_found.push(`  → Conversation ${b.conversation_id?.substring(0,8)} | ${b.corrections?.join(', ') || 'unknown'}`);
          });
        }
        if (manualReview > 0) {
          results.issues_found.push(`${manualReview} World Phone conversation(s) need manual review — participant IDs could not be automatically resolved.`);
        }
        if (unresolvedMems > 0) {
          results.issues_found.push(`${unresolvedMems} character memory record(s) are still waiting for identity resolution (blind spots in character context).`);
        }
        if (autoResolved > 0) {
          results.issues_found.push(`${autoResolved} memory record(s) could be auto-resolved by name match — run a live repair to fix them.`);
        }

        results.checks.push({
          name: 'World Phone Anchor Integrity',
          status: broken === 0 && manualReview === 0 ? 'passed' : 'warning',
          message: broken === 0 && manualReview === 0
            ? `All World Phone conversations reference valid live character IDs. Unresolved memories: ${unresolvedMems}.`
            : `${broken} broken anchor(s), ${manualReview} manual review required. Run "auditAndRepairWorldPhoneAnchors" with dryRun:false to repair.`,
        });
      } catch (anchorErr) {
        results.checks.push({
          name: 'World Phone Anchor Integrity',
          status: 'warning',
          message: `Audit could not complete: ${anchorErr.message}`,
        });
      }
    }

    const totalIssues = results.issues_found.length;
    const totalFixes = results.fixes_applied.length;
    if (totalIssues === 0 && totalFixes === 0) {
      results.summary = `No system issues found across ${allUserChars.length} characters on this account.`;
    } else if (totalFixes > 0) {
      results.summary = `Found ${totalIssues} issue(s), applied ${totalFixes} auto-fix(es).`;
    } else {
      results.summary = `Found ${totalIssues} system issue(s) — review details above.`;
    }

    return Response.json({ success: true, data: results });
  } catch (error) {
    console.error('[troubleshootSystemData]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});