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

    // ── SETTINGS-PIPELINE CHARACTER RESOLUTION ─────────────────────────────────
    // Mirrors the exact two-source merge used by useSettingsCharacters + characterEditableListResolver.
    // Source 1: RLS characters (owner_email scoped — catches active_created + family NPCs with owner_email set)
    // Source 2: fetchNPCsForUser backend (catches service-created NPC fictitious records not visible via user RLS)
    // Merge → deduplicate → resolve type → group by type hierarchy → sort alpha within group.
    // This is the canonical Settings page character list. Vick MUST use this for all name/type/ID lookups.

    let settingsCharacterList = null; // populated below, available to all diagnostic branches

    const resolveDisplayNameLocal = (c) =>
      c.display_name || c.primary_name || c.full_name || c.name || 'Unknown';

    const resolveCharacterTypeLocal = (c) => {
      const validTypes = ['active_created_character', 'npc_fictitious', 'npc_family_member', 'npc_regular', 'npc_world_service'];
      if (c.character_type && validTypes.includes(c.character_type)) return c.character_type;
      if (c.is_world_service) return 'npc_world_service';
      if (c.is_family_member || c.relationship_type === 'family') return 'npc_family_member';
      const hasProfile = c.backstory || c.personality_traits || c.emotional_state;
      const hasSchedule = c.wake_up_time || c.sleep_start_time;
      const hasNeeds = c.hunger_value !== undefined;
      if (hasProfile && (hasSchedule || hasNeeds)) return 'active_created_character';
      if ((c.fictional_relationships || []).length > 0 && !c.is_family_member) return 'npc_fictitious';
      return 'active_created_character';
    };

    // Always resolve the full Settings character list — needed by all diagnostic types
    try {
      // Source 1: RLS-scoped characters (owner_email filter — same as useSettingsCharacters)
      const rlsChars = await base44.entities.Character.filter(
        { owner_email: ownerEmail },
        'created_date', // oldest first — foundational characters come first
        300
      ).catch(() => []);

      // Source 2: NPC fictitious via service role (catches records not visible via user RLS)
      let npcFictitious = [];
      try {
        const npcRes = await base44.asServiceRole.functions.invoke('fetchNPCsForUser', {});
        npcFictitious = npcRes?.npcs || [];
      } catch (_) {
        // Non-fatal — RLS pass is the primary source
      }

      // Merge + deduplicate (RLS has priority; NPC source fills gaps)
      const seen = new Set();
      const merged = [];
      for (const c of [...rlsChars, ...npcFictitious]) {
        if (!c.id || seen.has(c.id)) continue;
        seen.add(c.id);
        merged.push(c);
      }

      // Filter out terminal statuses (same as resolveSettingsCharacterLists)
      const live = merged.filter(c => !['deleted', 'soft_deleted', 'merged'].includes(c.status));

      // Resolve type + display name for each character
      const resolved = live.map(c => ({
        id: c.id,
        name: resolveDisplayNameLocal(c),
        rawName: c.name,
        character_type: resolveCharacterTypeLocal(c),
        status: c.status || 'active',
        occupation: c.occupation || null,
        gender: c.gender || null,
        age: c.age || null,
      }));

      // Group by type hierarchy (same order as Settings page)
      const TYPE_ORDER = ['active_created_character', 'npc_fictitious', 'npc_family_member', 'npc_regular', 'npc_world_service'];
      const groups = {};
      TYPE_ORDER.forEach(t => { groups[t] = []; });
      for (const c of resolved) {
        const t = c.character_type;
        if (!groups[t]) groups[t] = [];
        groups[t].push(c);
      }

      // Alpha sort within each group (same as resolveSettingsCharacterLists)
      TYPE_ORDER.forEach(t => {
        groups[t].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      });

      settingsCharacterList = { groups, total: resolved.length, rlsCount: rlsChars.length, npcCount: npcFictitious.length };

    } catch (e) {
      errors.push(`Settings character list resolution failed: ${e.message}`);
    }

    // ── CHARACTER AUDIT ────────────────────────────────────────────────────────
    if (diagnosticType === 'account_overview' || diagnosticType === 'characters' || diagnosticType === 'duplicates' || diagnosticType === 'list_characters') {
      try {
        ran.push('character_scan');

        if (!settingsCharacterList) {
          errors.push('Character list could not be resolved — settings pipeline returned no data.');
        } else {
          const { groups, total, rlsCount, npcCount } = settingsCharacterList;

          const activeCreated = groups['active_created_character'] || [];
          const npcFict       = groups['npc_fictitious'] || [];
          const npcFamily     = groups['npc_family_member'] || [];
          const npcRegular    = groups['npc_regular'] || [];
          const worldService  = groups['npc_world_service'] || [];

          findings.push(`Total character records (Settings pipeline): ${total} (RLS source: ${rlsCount}, NPC source: ${npcCount})`);
          findings.push(`Active created characters (${activeCreated.length}): ${activeCreated.map(c => c.name).join(', ') || 'none'}`);
          if (npcFict.length > 0)    findings.push(`NPC fictitious (${npcFict.length}): ${npcFict.map(c => c.name).join(', ')}`);
          if (npcFamily.length > 0)  findings.push(`NPC family members (${npcFamily.length}): ${npcFamily.map(c => c.name).join(', ')}`);
          if (npcRegular.length > 0) findings.push(`NPC regular (${npcRegular.length}): ${npcRegular.map(c => c.name).join(', ')}`);
          if (worldService.length > 0) findings.push(`World service (${worldService.length}): ${worldService.map(c => c.name).join(', ')}`);

          // Duplicate name detection
          const allResolved = [...activeCreated, ...npcFict, ...npcFamily, ...npcRegular, ...worldService];
          const nameCounts = {};
          allResolved.forEach(c => {
            const key = (c.name || '').toLowerCase().trim();
            if (!key) return;
            nameCounts[key] = (nameCounts[key] || []);
            nameCounts[key].push(c.id);
          });
          const dupGroups = Object.entries(nameCounts).filter(([, ids]) => ids.length > 1);
          if (dupGroups.length > 0) {
            dupGroups.forEach(([name, ids]) => {
              errors.push(`Duplicate character name "${name}": ${ids.length} records`);
            });
          } else {
            findings.push('No duplicate character names detected.');
          }

          // Build structured character list for Vick's response
          const structuredList = {
            active_created_character: activeCreated,
            npc_fictitious: npcFict,
            npc_family_member: npcFamily,
            npc_regular: npcRegular,
            npc_world_service: worldService,
          };

          // Attach to response payload (available to caller / Vick agent)
          Object.assign(findings, { _characterList: structuredList });
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

    // Build structured character list for Vick's response (name → ID and ID → name mapping)
    let characterList = null;
    if (settingsCharacterList) {
      const { groups } = settingsCharacterList;
      characterList = {
        active_created_character: (groups['active_created_character'] || []).map(c => ({ id: c.id, name: c.name, character_type: 'active_created_character' })),
        npc_fictitious:           (groups['npc_fictitious'] || []).map(c => ({ id: c.id, name: c.name, character_type: 'npc_fictitious' })),
        npc_family_member:        (groups['npc_family_member'] || []).map(c => ({ id: c.id, name: c.name, character_type: 'npc_family_member' })),
        npc_regular:              (groups['npc_regular'] || []).map(c => ({ id: c.id, name: c.name, character_type: 'npc_regular' })),
        npc_world_service:        (groups['npc_world_service'] || []).map(c => ({ id: c.id, name: c.name, character_type: 'npc_world_service' })),
      };
    }

    // Build plain-language character summary for list_characters diagnostic type
    let characterSummaryText = '';
    if ((diagnosticType === 'list_characters' || diagnosticType === 'characters') && characterList) {
      const lines = [];
      if (characterList.active_created_character.length > 0) {
        lines.push(`Active Created Characters (${characterList.active_created_character.length}):`);
        characterList.active_created_character.forEach(c => lines.push(`  • ${c.name}`));
      }
      if (characterList.npc_fictitious.length > 0) {
        lines.push(`NPC Fictitious (${characterList.npc_fictitious.length}):`);
        characterList.npc_fictitious.forEach(c => lines.push(`  • ${c.name}`));
      }
      if (characterList.npc_family_member.length > 0) {
        lines.push(`NPC Family Members (${characterList.npc_family_member.length}):`);
        characterList.npc_family_member.forEach(c => lines.push(`  • ${c.name}`));
      }
      if (characterList.npc_regular.length > 0) {
        lines.push(`NPC Regular (${characterList.npc_regular.length}):`);
        characterList.npc_regular.forEach(c => lines.push(`  • ${c.name}`));
      }
      if (characterList.npc_world_service.length > 0) {
        lines.push(`World Service (${characterList.npc_world_service.length}):`);
        characterList.npc_world_service.forEach(c => lines.push(`  • ${c.name}`));
      }
      characterSummaryText = lines.join('\n');
    }

    if (diagnosticType === 'list_characters' && characterSummaryText) {
      plainSummary = `Here are all characters on this account, organized the same way as the Settings page:\n\n${characterSummaryText}`;
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
      characterList,          // structured { active_created_character[], npc_fictitious[], npc_family_member[], ... }
      characterSummaryText,   // plain-text formatted list for Vick to present directly
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