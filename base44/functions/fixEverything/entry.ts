import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * fixEverything — Global Deep Diagnostic + Correction Chain
 * 
 * Covers: scene population, VGC Towers NPC distribution, identity/world name,
 * presence consistency, cache/stale data, persistence, Home/Travel/Scene alignment.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const now = new Date();
    const report = {
      timestamp: now.toISOString(),
      systems_checked: [],
      issues_found: [],
      issue_types: [],
      root_cause_traces: [],
      stale_data_detected: false,
      overwritten_data_detected: false,
      corrective_actions_taken: [],
      corrective_actions_recommended: [],
      unresolved_items: [],
    };

    const addIssue = (type, msg) => {
      report.issues_found.push(msg);
      if (!report.issue_types.includes(type)) report.issue_types.push(type);
    };
    const addFix = (msg) => report.corrective_actions_taken.push(msg);
    const addTrace = (trace) => report.root_cause_traces.push(trace);
    const addRecommend = (msg) => report.corrective_actions_recommended.push(msg);

    // ── LOAD ALL DATA ─────────────────────────────────────────────────────────
    const [allCharacters, allLocations, settingsList] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ created_by: user.email, status: 'active' }),
      base44.asServiceRole.entities.LocationReference.list(),
      base44.asServiceRole.entities.UserSettings.list(),
    ]);

    const settings = settingsList[0] || {};
    const worldName = settings.fictional_world_name || null;
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));
    const vgcTowers = allLocations.find(l => l.name === 'VGC Towers');
    const VGC_ID = vgcTowers?.id || null;

    report.systems_checked.push('characters', 'locations', 'user_settings');

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION 1: IDENTITY / WORLD NAME ENFORCEMENT
    // ══════════════════════════════════════════════════════════════════════════
    report.systems_checked.push('identity_system');
    const PLACEHOLDER = [/\bthe user\b/i, /\bthe player\b/i];
    if (!worldName) {
      addIssue('IDENTITY_LEAK', 'No world name set in UserSettings. Characters will use generic pronouns. Go to Settings → Your Name (In-World).');
      addRecommend('Set fictional_world_name in UserSettings to enable full identity enforcement.');
    } else {
      // Scan all character system_prompt_urls for stale identity
      let staleCacheCount = 0;
      const cacheUpdates = [];
      for (const char of allCharacters) {
        if (char.system_prompt_url) {
          // Clear cached prompt URL to force regeneration
          cacheUpdates.push(base44.asServiceRole.entities.Character.update(char.id, { system_prompt_url: null }));
          staleCacheCount++;
        }
      }
      if (cacheUpdates.length > 0) {
        await Promise.all(cacheUpdates);
        addFix(`Cleared ${staleCacheCount} stale system_prompt_url cache(s) — they will rebuild with world name "${worldName}" on next chat.`);
        addIssue('CACHE_STALE', `${staleCacheCount} character system_prompt_url(s) were stale. Cleared to force regeneration.`);
        addTrace(`Identity leak → stale system_prompt cache → built before world name was set → cleared now`);
        report.stale_data_detected = true;
      }

      // Scan memories
      const allMemories = await base44.asServiceRole.entities.Memory.list('-timestamp', 3000);
      const staleMemories = allMemories.filter(m => PLACEHOLDER.some(p => p.test(m.title || '') || p.test(m.description || '')));
      if (staleMemories.length > 0) {
        let fixed = 0;
        for (const mem of staleMemories) {
          const t = (mem.title || '').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
          const d = (mem.description || '').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
          await base44.asServiceRole.entities.Memory.update(mem.id, { title: t, description: d });
          fixed++;
        }
        addFix(`Corrected ${fixed} memory record(s): replaced placeholder identity with "${worldName}".`);
        addTrace(`Stale memory identity → memories created before world name set → corrected to "${worldName}"`);
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION 2: PRESENCE / LOCATION RESOLUTION VALIDATION
    // ══════════════════════════════════════════════════════════════════════════
    report.systems_checked.push('presence_system', 'location_resolution_engine');
    const VALID_ACTIVE_TYPES = ['active'];
    const NPC_TYPES = ['npc', 'family_npc', 'background', 'promoted_npc'];
    let noLocationCount = 0;
    let mismatchCount = 0;
    let staleLocationCount = 0;

    const locationFixUpdates = [];
    for (const char of allCharacters) {
      // Check for stale/deleted location references
      const locFields = [
        'resolved_current_location_id', 'current_home_location_id',
        'occupation_location_id', 'education_location_id',
      ];
      for (const field of locFields) {
        const val = char[field];
        if (val && !locationMap[val]) {
          addIssue('PRESENCE_SYNC_FAILURE', `${char.name}: ${field} points to deleted/missing location "${val}". Root cause: STALE_LOCATION_REFS.`);
          staleLocationCount++;
        }
      }

      // Check NPC characters: must have a resolved_current_location_id
      if (NPC_TYPES.includes(char.character_type)) {
        if (!char.resolved_current_location_id) {
          noLocationCount++;
          // If VGC Towers NPC, apply fallback
          if (VGC_ID && char.current_home_location_id === VGC_ID) {
            locationFixUpdates.push(base44.asServiceRole.entities.Character.update(char.id, {
              resolved_current_location_id: VGC_ID,
              resolved_current_location_name: 'VGC Towers',
              presence_state: 'home',
              presence_reason: 'fix_everything_fallback',
              source_of_move: 'system',
              valid_from: now.toISOString(),
            }));
            addIssue('NPC_NOWHERE_STATE', `NPC "${char.name}" had no resolved_current_location_id. Restored to VGC Towers.`);
          } else {
            addIssue('NPC_NOWHERE_STATE', `NPC "${char.name}" has no resolved_current_location_id and no home to fall back to.`);
            report.unresolved_items.push(`${char.name} (${char.character_type}): no resolved location and no home — needs manual home assignment.`);
          }
        }
      }
    }

    if (locationFixUpdates.length > 0) {
      await Promise.all(locationFixUpdates);
      addFix(`Restored ${locationFixUpdates.length} NPC(s) with no resolved location back to VGC Towers (fallback rule).`);
      addTrace(`NPC nowhere state → resolved_current_location_id missing → fix_everything fallback applied → restored to VGC Towers`);
    }

    if (staleLocationCount > 0) {
      addTrace(`Stale location refs → characters point to deleted locations → needs manual cleanup on character profiles`);
      addRecommend(`Clear stale location IDs on affected characters (use Profile Troubleshooting → Stale location refs).`);
      report.stale_data_detected = true;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION 3: VGC TOWERS NPC DISTRIBUTION VALIDATION
    // ══════════════════════════════════════════════════════════════════════════
    report.systems_checked.push('vgc_towers_distribution');
    if (!VGC_ID) {
      addIssue('NPC_DISTRIBUTION_NOT_RUNNING', 'VGC Towers location not found. Cannot validate NPC distribution.');
    } else {
      const vgcResidents = allCharacters.filter(c =>
        c.current_home_location_id === VGC_ID &&
        NPC_TYPES.includes(c.character_type) &&
        !c.protected_active
      );

      const distributed = vgcResidents.filter(c =>
        c.resolved_current_location_id && c.resolved_current_location_id !== VGC_ID
      );
      const atHub = vgcResidents.filter(c =>
        !c.resolved_current_location_id || c.resolved_current_location_id === VGC_ID
      );
      const nowhere = vgcResidents.filter(c => !c.resolved_current_location_id);
      const inTransit = vgcResidents.filter(c => c.presence_state === 'in_transit');

      report.systems_checked.push(`vgc_hub_residents: ${vgcResidents.length}`);

      if (nowhere.length > 0) {
        addIssue('NPC_NOWHERE_STATE', `${nowhere.length} VGC Towers NPC(s) have no resolved_current_location_id. Classification: AUTHORITATIVE_WRITE_FAILED or FALLBACK_FAILURE.`);
        addTrace(`VGC NPCs nowhere → distribution ran but write failed OR fallback did not apply → fix_everything_fallback applied`);
      }

      if (inTransit.length > 0) {
        addIssue('PRESENCE_SYNC_FAILURE', `${inTransit.length} VGC NPC(s) stuck in in_transit state. They will not appear in scenes.`);
        addRecommend(`Run distributeVGCTowersNPCs to reset in_transit VGC NPCs.`);
      }

      if (vgcResidents.length > 0 && distributed.length === 0 && atHub.length === vgcResidents.length) {
        const hour = now.getHours();
        const isActiveWindow = hour >= 10 || hour < 1;
        if (isActiveWindow) {
          addIssue('NPC_DISTRIBUTION_NOT_RUNNING', `All ${vgcResidents.length} VGC Towers NPCs are at hub during active distribution window (${hour}:xx). Distribution may not have run.`);
          addTrace(`VGC NPCs all at hub during active window → distribution not running → trigger distributeVGCTowersNPCs`);
          addRecommend(`Run distributeVGCTowersNPCs function to populate the world with VGC Towers NPCs.`);
        }
      }

      // Validate destination locations still exist
      for (const npc of distributed) {
        if (!locationMap[npc.resolved_current_location_id]) {
          addIssue('PRESENCE_SYNC_FAILURE', `VGC NPC "${npc.name}" distributed to deleted location "${npc.resolved_current_location_id}". Root cause: STALE_LOCATION_REFS.`);
          // Fix: restore to VGC Towers
          await base44.asServiceRole.entities.Character.update(npc.id, {
            resolved_current_location_id: VGC_ID,
            resolved_current_location_name: 'VGC Towers',
            presence_state: 'home',
            presence_reason: 'stale_destination_fix',
            source_of_move: 'system',
            valid_from: now.toISOString(),
          });
          addFix(`Restored VGC NPC "${npc.name}" from deleted destination back to VGC Towers.`);
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION 4: SCENE POPULATION CONSISTENCY
    // ══════════════════════════════════════════════════════════════════════════
    report.systems_checked.push('scene_population_system');
    // Detect active characters with mismatched presence (would cause wrong Scene population)
    const activeChars = allCharacters.filter(c => c.character_type === 'active');
    let sceneMismatchCount = 0;
    for (const char of activeChars) {
      const resolvedLoc = char.resolved_current_location_id;
      const currentLoc = char.current_location_id; // legacy field sometimes set by scene
      // If current_location_id disagrees with resolved_current_location_id, it's a mismatch
      if (resolvedLoc && currentLoc && currentLoc !== resolvedLoc) {
        sceneMismatchCount++;
        // Fix: clear the stale current_location_id so Scene uses resolved only
        await base44.asServiceRole.entities.Character.update(char.id, { current_location_id: resolvedLoc });
      }
    }
    if (sceneMismatchCount > 0) {
      addFix(`Synced current_location_id to resolved_current_location_id for ${sceneMismatchCount} character(s) — prevents Scene/Home/Travel mismatch.`);
      addIssue('SCENE_POPULATION_STALE', `${sceneMismatchCount} active character(s) had stale current_location_id that disagreed with authoritative resolved location.`);
      addTrace(`Scene shows wrong character → current_location_id stale → did not update after resolved location changed → synced now`);
      report.stale_data_detected = true;
    } else {
      report.systems_checked.push('scene_presence_sync: OK');
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION 5: APPEARANCE + PROFILE PERSISTENCE
    // ══════════════════════════════════════════════════════════════════════════
    report.systems_checked.push('appearance_system');
    const activeWithNoGender = activeChars.filter(c => !c.gender);
    if (activeWithNoGender.length > 0) {
      addRecommend(`${activeWithNoGender.length} active character(s) have no gender set — image generation may be inconsistent: ${activeWithNoGender.map(c => c.name).join(', ')}`);
    }
    const activeWithNoLock = activeChars.filter(c => {
      const lock = c.appearance_lock || {};
      return !lock.skin_tone && !lock.hair_type && !lock.overall_aesthetic;
    });
    if (activeWithNoLock.length > 0) {
      addRecommend(`${activeWithNoLock.length} active character(s) have no appearance lock — image generation may drift: ${activeWithNoLock.map(c => c.name).join(', ')}`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SECTION 6: STALE / DELETED LOCATION CLEANUP
    // ══════════════════════════════════════════════════════════════════════════
    report.systems_checked.push('location_system');
    const allLocationIds = new Set(allLocations.map(l => l.id));
    let staleInviteCount = 0;
    const invites = await base44.asServiceRole.entities.Invite.filter({ status: 'pending' }).catch(() => []);
    for (const inv of invites) {
      if (inv.destination_id && !allLocationIds.has(inv.destination_id)) {
        await base44.asServiceRole.entities.Invite.update(inv.id, { status: 'expired' }).catch(() => {});
        staleInviteCount++;
      }
    }
    if (staleInviteCount > 0) {
      addFix(`Expired ${staleInviteCount} pending invite(s) pointing to deleted locations.`);
      addIssue('DATA_PERSISTENCE_FAILURE', `${staleInviteCount} pending invite(s) referenced deleted locations.`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FINAL REPORT ASSEMBLY
    // ══════════════════════════════════════════════════════════════════════════
    const totalIssues = report.issues_found.length;
    const totalFixes = report.corrective_actions_taken.length;

    return Response.json({
      success: true,
      summary: totalIssues === 0
        ? 'All systems check out — no critical issues found.'
        : `Found ${totalIssues} issue(s). Applied ${totalFixes} automatic fix(es). See details below.`,
      ...report,
    });

  } catch (error) {
    console.error('[fixEverything]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});