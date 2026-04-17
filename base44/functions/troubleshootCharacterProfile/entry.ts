import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, selectedIssues = [] } = await req.json();
    if (!characterId) return Response.json({ error: 'Missing characterId' }, { status: 400 });

    const results = { summary: '', checks: [], fixes_applied: [], issues_found: [] };

    const chars = await base44.asServiceRole.entities.Character.filter({ id: characterId });
    if (chars.length === 0) {
      return Response.json({ success: false, data: { summary: 'Character not found', checks: [], fixes_applied: [], issues_found: ['Character record missing'] } });
    }
    const character = chars[0];

    // All characters visible to this user (for cross-contamination checks)
    const allChars = await base44.asServiceRole.entities.Character.filter({ created_by: user.email });

    // ── OWNERSHIP INTEGRITY ───────────────────────────────────────────────────
    // Ensures owner_email is set correctly. SAFE: only fixes missing owner_email.
    if (selectedIssues.includes('ownership_integrity')) {
      const expectedOwner = character.owner_email || character.created_by;
      if (!character.owner_email) {
        await base44.asServiceRole.entities.Character.update(characterId, { owner_email: character.created_by });
        results.fixes_applied.push(`owner_email was missing — set to created_by: ${character.created_by}`);
        results.checks.push({ name: 'Ownership Integrity', status: 'fixed', message: `owner_email was blank. Corrected to: ${character.created_by}` });
      } else if (character.owner_email !== character.created_by && character.character_type !== 'npc' && character.character_type !== 'family_npc') {
        results.checks.push({ name: 'Ownership Integrity', status: 'warning', message: `owner_email (${character.owner_email}) differs from created_by (${character.created_by}). For NPCs this is expected (NPC belongs to account of parent character). For active characters, review if this is intentional.` });
      } else {
        results.checks.push({ name: 'Ownership Integrity', status: 'passed', message: `owner_email: ${character.owner_email} | created_by: ${character.created_by}` });
      }
    }

    // ── FAMILY LIST INTEGRITY ────────────────────────────────────────────────
    // READ-ONLY: reports duplicates and title mismatches. Never removes family members.
    if (selectedIssues.includes('family_list') || selectedIssues.includes('wrong_titles')) {
      const familyMembers = character.family_members || [];
      const PARENT_TITLES = ['mother', 'mom', 'father', 'dad', 'parent'];
      const CHILD_TITLES = ['son', 'daughter', 'child', 'kid'];
      const SPOUSE_TITLES = ['wife', 'husband', 'spouse', 'partner'];

      const titleCounts = {};
      familyMembers.forEach(m => {
        const t = (m.relationship_type || '').toLowerCase();
        titleCounts[t] = (titleCounts[t] || 0) + 1;
      });

      let duplicatesFound = false;
      for (const [title, count] of Object.entries(titleCounts)) {
        if (count > 1 && (PARENT_TITLES.includes(title) || SPOUSE_TITLES.includes(title))) {
          results.issues_found.push(`Duplicate "${title}" entries (${count} total) in family list — only one expected. Review manually.`);
          duplicatesFound = true;
        }
      }

      const fictionalRels = character.fictional_relationships || [];
      familyMembers.forEach(fm => {
        const relTitle = (fm.relationship_type || '').toLowerCase();
        const matchingFictional = fictionalRels.find(r => r.person_name === fm.name);
        if (matchingFictional) {
          const fRelType = (matchingFictional.relationship_type || '').toLowerCase();
          const clash = (PARENT_TITLES.includes(relTitle) && CHILD_TITLES.includes(fRelType)) || (CHILD_TITLES.includes(relTitle) && PARENT_TITLES.includes(fRelType));
          if (clash) results.issues_found.push(`"${fm.name}" is listed as "${fm.relationship_type}" in family but "${matchingFictional.relationship_type}" in relationships — title mismatch. Review manually.`);
        }
      });

      if (!duplicatesFound && results.issues_found.length === 0) {
        results.checks.push({ name: 'Family List Integrity', status: 'passed', message: `${familyMembers.length} family member(s) — no obvious duplicates or title mismatches.` });
      }
    }

    // ── FAMILY SAVE CHECK ────────────────────────────────────────────────────
    if (selectedIssues.includes('family_save') || selectedIssues.includes('profile_save')) {
      try {
        const testVal = character.current_situation || '';
        await base44.asServiceRole.entities.Character.update(characterId, { current_situation: testVal });
        const recheck = (await base44.asServiceRole.entities.Character.filter({ id: characterId }))[0];
        if (recheck?.current_situation === testVal) {
          results.checks.push({ name: 'Profile Save Round-trip', status: 'passed', message: 'Profile saves are working correctly.' });
        } else {
          results.issues_found.push(`Profile save test failed — written value did not match on re-read.`);
        }
      } catch (saveErr) {
        results.issues_found.push(`Profile save test threw an error: ${saveErr.message}`);
      }
    }

    // ── STATUS / LOCATION CHECK ──────────────────────────────────────────────
    // READ-ONLY: reports location state. Never changes location or schedule.
    if (selectedIssues.includes('status_location')) {
      results.checks.push({
        name: 'Current Location / Status (Read-Only)',
        status: 'info',
        message: [
          `resolved_current_location_id: ${character.resolved_current_location_id || 'not set'}`,
          `resolved_presence_status: ${character.resolved_presence_status || 'not set'}`,
          `current_activity: ${character.current_activity || 'not set'}`,
          `location_status: ${character.location_status || 'not set'}`,
          `current_home_location_id: ${character.current_home_location_id || 'not set'}`,
          `current_work_location_id: ${character.current_work_location_id || 'not set'}`,
        ].join(' | ')
      });

      // Stale location check — report only, never clear
      if (character.resolved_current_location_id) {
        const locs = await base44.asServiceRole.entities.LocationReference.filter({ id: character.resolved_current_location_id });
        if (locs.length === 0) {
          results.issues_found.push(`resolved_current_location_id "${character.resolved_current_location_id}" points to a location that no longer exists. This may cause display errors. Re-assign this character's home or work location to correct it.`);
        }
      }
    }

    // ── CHARACTER IDENTITY / DUPLICATE RECORDS ───────────────────────────────
    // READ-ONLY: reports duplicates. Never merges or deletes.
    if (selectedIssues.includes('character_identity') || selectedIssues.includes('duplicate_records')) {
      const sameName = allChars.filter(c => c.id !== characterId && c.name?.toLowerCase().trim() === character.name?.toLowerCase().trim());
      if (sameName.length > 0) {
        results.issues_found.push(`Found ${sameName.length} other record(s) named "${character.name}": ${sameName.map(c => `ID:${c.id} status:${c.status||'active'} type:${c.character_type||'?'}`).join(' | ')} — review for recovery duplicates. Do NOT delete without verifying which is canonical.`);
      } else {
        results.checks.push({ name: 'Duplicate Records', status: 'passed', message: `No other records found with name "${character.name}".` });
      }

      const charConvos = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [characterId] }, '-updated_date', 30);
      const crossLinked = charConvos.filter(c => c.character_ids && c.character_ids.length > 1 && c.type !== 'group' && c.type !== 'npc');
      if (crossLinked.length > 0) {
        results.issues_found.push(`${crossLinked.length} non-group conversation(s) where ${character.name} shares character_ids with another character — possible routing issue.`);
      } else {
        results.checks.push({ name: 'Thread Isolation', status: 'passed', message: `All ${charConvos.length} conversation(s) are correctly isolated.` });
      }

      results.checks.push({ name: 'Character Identity Audit', status: 'info', message: `ID: ${character.id} | type: ${character.character_type||'?'} | status: ${character.status||'active'} | owner: ${character.owner_email||character.created_by} | created_by: ${character.created_by}` });
    }

    // ── NPC ROUTING CHECK ────────────────────────────────────────────────────
    // Checks if this NPC is properly a standalone record and has correct ownership.
    if (selectedIssues.includes('duplicate_relationships')) {
      const fictionalRels = character.fictional_relationships || [];
      const relNameMap = {};
      fictionalRels.forEach(r => {
        const key = r.person_name?.toLowerCase().trim();
        if (!key) return;
        relNameMap[key] = (relNameMap[key] || 0) + 1;
      });
      const dups = Object.entries(relNameMap).filter(([, count]) => count > 1);
      if (dups.length > 0) {
        dups.forEach(([name, count]) => results.issues_found.push(`"${name}" appears ${count} times in fictional_relationships — duplicate entry. Review manually.`));
      } else {
        results.checks.push({ name: 'Fictional Relationships', status: 'passed', message: `${fictionalRels.length} relationship(s) — no duplicates detected.` });
      }
    }

    // ── WORLD NAME ENFORCEMENT ───────────────────────────────────────────────
    if (selectedIssues.includes('world_name_enforcement')) {
      const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: user.email });
      const worldName = settingsList?.[0]?.fictional_world_name || null;
      const PLACEHOLDER = [/\bthe user\b/i, /\bthe player\b/i, /\bplayer\b/i];

      if (!worldName) {
        results.checks.push({ name: 'World Name', status: 'warning', message: 'No world name set — go to Settings > Your Name (In-World) to set one.' });
      } else {
        const memories = await base44.asServiceRole.entities.Memory.filter({ character_id: characterId }, '-timestamp', 300);
        const stale = memories.filter(m => PLACEHOLDER.some(p => p.test(m.title||'') || p.test(m.description||'')));
        if (stale.length > 0) {
          for (const mem of stale) {
            const newTitle = (mem.title||'').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
            const newDesc = (mem.description||'').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
            await base44.asServiceRole.entities.Memory.update(mem.id, { title: newTitle, description: newDesc });
          }
          results.fixes_applied.push(`Corrected ${stale.length} memory record(s): replaced placeholder identity with "${worldName}"`);
          results.checks.push({ name: 'World Name — Memory', status: 'fixed', message: `${stale.length} stale memory record(s) corrected.` });
        } else {
          results.checks.push({ name: 'World Name — Memory', status: 'passed', message: `All ${memories.length} memory record(s) are free of placeholder identity.` });
        }

        if (character.system_prompt && PLACEHOLDER.some(p => p.test(character.system_prompt))) {
          await base44.asServiceRole.entities.Character.update(characterId, { system_prompt: null });
          results.fixes_applied.push(`Cleared stale system_prompt cache — will regenerate with "${worldName}" on next chat.`);
          results.checks.push({ name: 'World Name — Cached Prompt', status: 'fixed', message: `system_prompt contained placeholder identity — cleared.` });
        } else {
          results.checks.push({ name: 'World Name — Cached Prompt', status: 'passed', message: 'No placeholder identity in cached system_prompt.' });
        }
      }
    }

    // ── APPEARANCE LOCK CHECK ────────────────────────────────────────────────
    if (selectedIssues.includes('appearance_lock_check')) {
      const lock = character.appearance_lock || {};
      const coreFields = ['skin_tone', 'hair_type', 'hairstyle', 'overall_aesthetic'];
      const filled = coreFields.filter(f => lock[f]?.trim());
      const empty = coreFields.filter(f => !lock[f]?.trim());

      if (filled.length === 0) {
        results.checks.push({ name: 'Appearance Lock', status: 'warning', message: `No appearance lock data set — image generation may drift. Set values in Character Profile > Appearance Lock.` });
        results.issues_found.push(`No appearance lock for ${character.name} — skin tone, hair, and aesthetic can change between images without this.`);
      } else {
        results.checks.push({ name: 'Appearance Lock', status: 'passed', message: `${filled.length}/${coreFields.length} core fields set. Empty: ${empty.join(', ') || 'none'}.` });
      }

      if (!character.gender) {
        results.checks.push({ name: 'Gender', status: 'warning', message: 'No gender set — can affect image generation consistency.' });
      } else {
        results.checks.push({ name: 'Gender', status: 'passed', message: `Gender: ${character.gender}` });
      }

      const appearanceAge = character.appearance_age;
      results.checks.push({ name: 'Appearance Age', status: appearanceAge ? 'passed' : 'info', message: appearanceAge ? `appearance_age override: ${appearanceAge}` : 'No appearance_age override set — using birthday or default.' });
    }

    // ── STALE LOCATION REFERENCES ────────────────────────────────────────────
    // READ-ONLY: reports stale location IDs. Never removes or changes them.
    if (selectedIssues.includes('stale_location_refs')) {
      const allLocsRes = await base44.asServiceRole.functions.invoke('fetchAllLocationsForUser', {}).catch(() => ({ locations: [] }));
      const validIds = new Set((allLocsRes?.data?.locations || allLocsRes?.locations || []).map(l => l.id));

      const locationFields = [
        { field: 'current_home_location_id', label: 'Home' },
        { field: 'current_work_location_id', label: 'Work' },
        { field: 'occupation_location_id', label: 'Occupation' },
        { field: 'education_location_id', label: 'Education' },
        { field: 'resolved_current_location_id', label: 'Resolved Current' },
      ];

      let staleCount = 0;
      for (const { field, label } of locationFields) {
        const val = character[field];
        if (val && !validIds.has(val)) {
          results.issues_found.push(`STALE: ${label} (${field}) = "${val}" points to a deleted or missing location. Reassign this in the character profile.`);
          staleCount++;
        }
      }

      if (staleCount === 0) {
        results.checks.push({ name: 'Stale Location References', status: 'passed', message: 'All location ID references are valid.' });
      } else {
        results.checks.push({ name: 'Stale Location References', status: 'failed', message: `${staleCount} stale location reference(s) found — review details above. Do NOT delete locations; re-assign the character.` });
      }
    }

    // ── FIX EVERYTHING ───────────────────────────────────────────────────────
    if (selectedIssues.includes('fix_everything')) {
      const res = await base44.asServiceRole.functions.invoke('fixEverything', {}).catch(e => ({ data: { error: e.message } }));
      const d = res?.data || {};
      results.checks.push(...(d.systems_checked || []).map(s => ({ name: s, status: 'info', message: '' })));
      results.fixes_applied.push(...(d.corrective_actions_taken || []));
      results.issues_found.push(...(d.issues_found || []));
      results.issues_found.push(...(d.corrective_actions_recommended || []).map(r => `RECOMMENDED: ${r}`));
      results.issues_found.push(...(d.unresolved_items || []).map(u => `UNRESOLVED: ${u}`));
      results.checks.push({ name: 'Fix Everything', status: 'info', message: d.summary || 'Master diagnostic complete.' });
    }

    const totalIssues = results.issues_found.length;
    const totalFixes = results.fixes_applied.length;
    results.summary = totalIssues === 0 && totalFixes === 0
      ? `No issues found for ${character.name}.`
      : totalFixes > 0
        ? `Found ${totalIssues} issue(s), applied ${totalFixes} fix(es) for ${character.name}.`
        : `Found ${totalIssues} issue(s) for ${character.name} — review details above.`;

    return Response.json({ success: true, data: results });
  } catch (error) {
    console.error('[troubleshootCharacterProfile]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});