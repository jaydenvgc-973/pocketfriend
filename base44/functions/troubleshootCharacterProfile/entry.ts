import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * troubleshootCharacterProfile
 *
 * Safe profile-level diagnostic for a single character.
 * Rules:
 * - NEVER deletes characters, NPCs, family members, memories, or life events
 * - NEVER changes schedule, sleep times, work hours, work days, or location assignments
 * - NEVER changes character_type, status, or ownership
 * - Fixes are strictly: identity label corrections, broken image URLs, stale cached prompts,
 *   placeholder text in memories, save round-trip test
 * - Multi-user safe: uses owner_email + created_by to verify access
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, selectedIssues = [] } = await req.json();
    if (!characterId) return Response.json({ error: 'Missing characterId' }, { status: 400 });

    const results = {
      summary: '',
      checks: [],
      fixes_applied: [],
      issues_found: [],
    };

    // Fetch the target character
    const chars = await base44.asServiceRole.entities.Character.filter({ id: characterId });
    if (chars.length === 0) {
      return Response.json({ success: false, data: { summary: 'Character not found', checks: [], fixes_applied: [], issues_found: ['Character record missing'] } });
    }
    const character = chars[0];

    // Verify caller has access to this character
    const hasAccess = character.created_by === user.email || character.owner_email === user.email || user.role === 'admin';
    if (!hasAccess) {
      return Response.json({ error: 'Access denied — this character does not belong to your account' }, { status: 403 });
    }

    // Fetch all characters on this user's account for cross-contamination checks
    const allChars = await base44.asServiceRole.entities.Character.list('-created_date', 500);
    const accountChars = allChars.filter(c => c.created_by === user.email || c.owner_email === user.email);

    // ── FAMILY LIST / WRONG TITLES ───────────────────────────────────────
    if (selectedIssues.includes('family_list') || selectedIssues.includes('wrong_titles')) {
      const familyMembers = character.family_members || [];
      const PARENT_TITLES = ['mother', 'mom', 'father', 'dad', 'parent'];
      const CHILD_TITLES = ['son', 'daughter', 'child', 'kid'];
      const SPOUSE_TITLES = ['wife', 'husband', 'spouse', 'partner'];

      // Detect duplicate relationship types
      const titleCounts = {};
      familyMembers.forEach(m => {
        const t = (m.relationship_type || '').toLowerCase();
        titleCounts[t] = (titleCounts[t] || 0) + 1;
      });
      for (const [title, count] of Object.entries(titleCounts)) {
        if (count > 1 && (PARENT_TITLES.includes(title) || SPOUSE_TITLES.includes(title))) {
          results.issues_found.push(`Duplicate "${title}" entries (${count} total) — only one expected`);
        }
      }

      // Title mismatch with fictional_relationships
      const fictionalRels = character.fictional_relationships || [];
      familyMembers.forEach(fm => {
        const relTitle = (fm.relationship_type || '').toLowerCase();
        const matchingFictional = fictionalRels.find(r => r.person_name === fm.name);
        if (matchingFictional) {
          const fRelType = (matchingFictional.relationship_type || '').toLowerCase();
          const parentIsChild = PARENT_TITLES.includes(relTitle) && CHILD_TITLES.includes(fRelType);
          const childIsParent = CHILD_TITLES.includes(relTitle) && PARENT_TITLES.includes(fRelType);
          if (parentIsChild || childIsParent) {
            results.issues_found.push(`${fm.name}: listed as "${fm.relationship_type}" in family but "${matchingFictional.relationship_type}" in relationships — title conflict`);
          }
        }
      });

      if (results.issues_found.length === 0) {
        results.checks.push({ name: 'Family List Integrity', status: 'passed', message: `${familyMembers.length} family member(s) — no duplicates or title mismatches` });
      }
    }

    // ── STATUS / LOCATION ────────────────────────────────────────────────
    if (selectedIssues.includes('status_location')) {
      const now = new Date();
      const recentEvents = await base44.asServiceRole.entities.ScheduledEvent.filter(
        { character_ids: [characterId] }, '-trigger_time', 20
      );
      const LOCATION_KEYWORDS = ['hospital','bar','gym','work','school','church','mosque','synagogue','temple','mall','restaurant','park','clinic'];
      const activeEvent = recentEvents.find(ev => {
        if (ev.status !== 'completed') return false;
        const hoursAgo = (now - new Date(ev.trigger_time)) / (1000 * 60 * 60);
        return hoursAgo < 4;
      });

      let detectedLocation = null;
      if (activeEvent) {
        const desc = (activeEvent.description || '').toLowerCase();
        detectedLocation = LOCATION_KEYWORDS.find(loc => desc.includes(loc));
        if (detectedLocation) {
          results.issues_found.push(`Active event: "${activeEvent.description}" — character may be at ${detectedLocation}, but current_activity is: "${character.current_activity || 'not set'}"`);
          // Safe fix: only update current_activity, never location IDs or schedule
          await base44.asServiceRole.entities.Character.update(characterId, { current_activity: detectedLocation });
          results.fixes_applied.push(`Set current_activity to "${detectedLocation}" based on active scheduled event`);
        }
      }
      results.checks.push({
        name: 'Status / Location Source',
        status: detectedLocation ? 'warning' : 'passed',
        message: `current_activity = "${character.current_activity || 'none'}" | resolved_presence = "${character.resolved_presence_status || 'none'}" | Active event in last 4h: ${activeEvent ? activeEvent.description : 'none'}`
      });

      // Report resolved location fields — no changes
      results.checks.push({
        name: 'Location Fields',
        status: 'info',
        message: `resolved_current_location_name = "${character.resolved_current_location_name || 'none'}" | home_location_id = "${character.current_home_location_id || 'none'}" | work_location_id = "${character.current_work_location_id || 'none'}"`
      });
    }

    // ── CHARACTER IDENTITY / DUPLICATE RECORDS ───────────────────────────
    if (selectedIssues.includes('character_identity') || selectedIssues.includes('duplicate_records')) {
      // Duplicates — same name, same account
      const sameName = accountChars.filter(c =>
        c.id !== characterId &&
        c.name?.toLowerCase().trim() === character.name?.toLowerCase().trim() &&
        c.status !== 'deleted' && c.status !== 'soft_deleted'
      );
      if (sameName.length > 0) {
        results.issues_found.push(`Found ${sameName.length} other active record(s) with name "${character.name}": ${sameName.map(c => `ID ${c.id} (${c.character_type || 'untyped'}, ${c.status || 'active'})`).join(' | ')}`);
        sameName.forEach(dup => {
          results.issues_found.push(`Duplicate: ID ${dup.id} | type: ${dup.character_type} | status: ${dup.status} | owner_email: ${dup.owner_email || dup.created_by}`);
        });
      } else {
        results.checks.push({ name: 'Duplicate Records', status: 'passed', message: `No duplicate active records for "${character.name}"` });
      }

      // Cross-linked direct conversations
      const charConvos = await base44.asServiceRole.entities.Conversation.filter(
        { created_by: user.email }, '-updated_date', 50
      );
      const thisCharConvos = charConvos.filter(c => c.character_ids?.includes(characterId));
      const crossLinked = thisCharConvos.filter(c => c.character_ids?.length > 1 && c.type !== 'group' && c.type !== 'npc');
      if (crossLinked.length > 0) {
        results.issues_found.push(`${crossLinked.length} non-group conversation(s) contain multiple character IDs — potential cross-routing`);
        crossLinked.forEach(c => {
          results.issues_found.push(`Thread "${c.title}" (${c.type}): character_ids = [${c.character_ids.join(', ')}]`);
        });
      } else {
        results.checks.push({ name: 'Thread Isolation', status: 'passed', message: `All ${thisCharConvos.length} conversation(s) are correctly isolated` });
      }

      results.checks.push({
        name: 'Character Identity',
        status: 'info',
        message: `ID: ${character.id} | type: ${character.character_type || 'unset'} | status: ${character.status || 'active'} | owner_email: ${character.owner_email || 'not set'} | created_by: ${character.created_by}`
      });
    }

    // ── OWNERSHIP VERIFICATION ───────────────────────────────────────────
    if (selectedIssues.includes('character_identity') || selectedIssues.includes('duplicate_records')) {
      if (character.owner_email && character.created_by && character.owner_email !== character.created_by) {
        results.checks.push({
          name: 'Ownership Fields',
          status: 'warning',
          message: `owner_email "${character.owner_email}" ≠ created_by "${character.created_by}" — this is intentional if the character was transferred between accounts`
        });
      } else if (!character.owner_email) {
        results.issues_found.push(`owner_email is not set on ${character.name} — character may be misrouted in multi-user queries`);
      } else {
        results.checks.push({ name: 'Ownership Fields', status: 'passed', message: `owner_email and created_by are consistent (${character.owner_email})` });
      }
    }

    // ── DUPLICATE RELATIONSHIPS ──────────────────────────────────────────
    if (selectedIssues.includes('duplicate_relationships')) {
      const rels = character.fictional_relationships || [];
      const relNames = rels.map(r => r.person_name?.toLowerCase().trim()).filter(Boolean);
      const seen = new Set();
      const dupes = [];
      relNames.forEach(name => {
        if (seen.has(name)) dupes.push(name);
        else seen.add(name);
      });
      if (dupes.length > 0) {
        results.issues_found.push(`Duplicate relationship entries for: ${dupes.join(', ')}`);
      } else {
        results.checks.push({ name: 'Relationship Duplicates', status: 'passed', message: `${rels.length} relationship(s) — no duplicates` });
      }
    }

    // ── PROFILE SAVE ROUND-TRIP ──────────────────────────────────────────
    if (selectedIssues.includes('profile_save') || selectedIssues.includes('family_save')) {
      const testValue = character.current_situation || '';
      try {
        await base44.asServiceRole.entities.Character.update(characterId, { current_situation: testValue });
        const recheckArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
        const recheck = recheckArr[0];
        if (recheck?.current_situation === testValue) {
          results.checks.push({ name: 'Profile Save', status: 'passed', message: 'Save round-trip working correctly' });
        } else {
          results.issues_found.push(`Profile save mismatch — wrote "${testValue}", read back "${recheck?.current_situation}"`);
        }
      } catch (saveErr) {
        results.issues_found.push(`Profile save test failed: ${saveErr.message}`);
      }
    }

    // ── WORLD NAME ENFORCEMENT ───────────────────────────────────────────
    if (selectedIssues.includes('world_name_enforcement')) {
      const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: user.email });
      const worldName = settingsList?.[0]?.fictional_world_name || null;
      const PLACEHOLDER_PATTERNS = [/\bthe user\b/i, /\bthe player\b/i, /\bplayer\b/i];

      if (!worldName) {
        results.checks.push({ name: 'World Name Enforcement', status: 'warning', message: 'No world name set — go to Settings > Your Name (In-World)' });
      } else {
        const memories = await base44.asServiceRole.entities.Memory.filter({ character_id: characterId }, '-timestamp', 300);
        const staleMemories = memories.filter(m =>
          PLACEHOLDER_PATTERNS.some(p => p.test(m.title || '') || p.test(m.description || ''))
        );
        if (staleMemories.length > 0) {
          let corrected = 0;
          for (const mem of staleMemories) {
            const newTitle = (mem.title || '').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
            const newDesc = (mem.description || '').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
            await base44.asServiceRole.entities.Memory.update(mem.id, { title: newTitle, description: newDesc });
            corrected++;
          }
          results.fixes_applied.push(`Corrected ${corrected} memory record(s): replaced placeholder with "${worldName}"`);
          results.checks.push({ name: 'World Name — Memory', status: 'fixed', message: `${staleMemories.length} stale memories corrected to use "${worldName}"` });
        } else {
          results.checks.push({ name: 'World Name — Memory', status: 'passed', message: `All ${memories.length} memories free of placeholder identity` });
        }

        if (character.system_prompt && PLACEHOLDER_PATTERNS.some(p => p.test(character.system_prompt))) {
          await base44.asServiceRole.entities.Character.update(characterId, { system_prompt: null });
          results.fixes_applied.push(`Cleared stale system_prompt cache — will rebuild with "${worldName}" on next chat`);
          results.checks.push({ name: 'World Name — Cached Prompt', status: 'fixed', message: 'Stale system_prompt cleared' });
        } else {
          results.checks.push({ name: 'World Name — Cached Prompt', status: 'passed', message: 'No placeholder identity in cached prompt' });
        }

        const nickname = character.nickname_for_user;
        if (nickname && PLACEHOLDER_PATTERNS.some(p => p.test(nickname))) {
          await base44.asServiceRole.entities.Character.update(characterId, { nickname_for_user: worldName });
          results.fixes_applied.push(`Corrected nickname_for_user from placeholder to "${worldName}"`);
        }
        results.checks.push({ name: 'World Name — Nickname', status: 'info', message: nickname ? `Per-character nickname: "${nickname}"` : `No per-character nickname — uses global "${worldName}"` });
      }
    }

    // ── APPEARANCE LOCK CHECK ─────────────────────────────────────────────
    if (selectedIssues.includes('appearance_lock_check')) {
      const lock = character.appearance_lock || {};
      const coreFields = ['skin_tone', 'hair_type', 'hairstyle', 'overall_aesthetic'];
      const filled = coreFields.filter(f => lock[f]?.trim());
      const empty = coreFields.filter(f => !lock[f]?.trim());

      if (filled.length === 0) {
        results.checks.push({ name: 'Appearance Lock', status: 'warning', message: `No appearance lock data — images may drift. Set values in Character Profile > Appearance Lock.` });
        results.issues_found.push(`${character.name}: no appearance lock set — skin tone, hair type, and aesthetic can vary between images`);
      } else {
        results.checks.push({ name: 'Appearance Lock', status: 'passed', message: `${filled.length}/${coreFields.length} core fields set. Empty: ${empty.join(', ') || 'none'}` });
      }

      const appearanceAge = character.appearance_age;
      const birthdayAge = character.birthday
        ? Math.floor((Date.now() - new Date(character.birthday).getTime()) / (365.25 * 24 * 3600 * 1000))
        : null;
      if (appearanceAge != null) {
        results.checks.push({ name: 'Appearance Age', status: 'passed', message: `appearance_age override = ${appearanceAge} (birthday age = ${birthdayAge ?? 'N/A'})` });
      } else if (birthdayAge != null) {
        results.checks.push({ name: 'Appearance Age', status: 'info', message: `No override — using birthday age ${birthdayAge}. Set appearance_age if images look wrong.` });
      } else {
        results.checks.push({ name: 'Appearance Age', status: 'warning', message: 'No age anchor — images may be inconsistent' });
      }

      if (!character.gender) {
        results.checks.push({ name: 'Gender', status: 'warning', message: 'No gender set — can affect image generation consistency' });
      } else {
        results.checks.push({ name: 'Gender', status: 'passed', message: `Gender: ${character.gender}` });
      }
    }

    // ── STALE LOCATION REFERENCES ─────────────────────────────────────────
    if (selectedIssues.includes('stale_location_refs')) {
      const allLocsRes = await base44.asServiceRole.functions.invoke('fetchAllLocationsForUser', {}).catch(() => null);
      const allLocs = allLocsRes?.data?.locations || [];
      const validIds = new Set(allLocs.map(l => l.id));

      const locFields = [
        { field: 'current_home_location_id', label: 'Home' },
        { field: 'current_work_location_id', label: 'Work' },
        { field: 'occupation_location_id', label: 'Occupation Location' },
        { field: 'education_location_id', label: 'Education Location' },
        { field: 'resolved_current_location_id', label: 'Resolved Location' },
      ];

      let staleCount = 0;
      for (const { field, label } of locFields) {
        const val = character[field];
        if (val && !validIds.has(val)) {
          results.issues_found.push(`STALE: ${label} (${field}) = "${val}" — this location ID no longer exists. Update in Character Profile.`);
          staleCount++;
        }
      }
      if (staleCount === 0) {
        results.checks.push({ name: 'Stale Location References', status: 'passed', message: 'All location IDs are valid' });
      } else {
        results.checks.push({ name: 'Stale Location References', status: 'failed', message: `${staleCount} stale location reference(s) — update in Character Profile` });
      }
    }

    // ── NPC OWNERSHIP CHECK ───────────────────────────────────────────────
    if (selectedIssues.includes('character_identity')) {
      // Check fictional_relationships: any NPC referenced by related_character_id should still exist
      const relCharIds = (character.fictional_relationships || [])
        .map(r => r.related_character_id)
        .filter(Boolean);

      for (const relId of relCharIds) {
        const relCharArr = await base44.asServiceRole.entities.Character.filter({ id: relId });
        if (relCharArr.length === 0) {
          results.issues_found.push(`Fictional relationship references character ID "${relId}" which no longer exists — relationship entry is dangling`);
        } else {
          const relChar = relCharArr[0];
          // Verify the NPC belongs to the same account as the parent character
          const npcOwner = relChar.owner_email || relChar.created_by;
          const parentOwner = character.owner_email || character.created_by;
          if (npcOwner && parentOwner && npcOwner !== parentOwner) {
            results.issues_found.push(`NPC "${relChar.name}" (ID: ${relId}) is linked to ${character.name} but owned by a DIFFERENT account (${npcOwner} vs ${parentOwner}) — ownership mismatch`);
          }
        }
      }
    }

    const totalIssues = results.issues_found.length;
    const totalFixes = results.fixes_applied.length;
    if (totalIssues === 0 && totalFixes === 0) {
      results.summary = `No issues found for ${character.name} — all selected checks passed`;
    } else if (totalFixes > 0) {
      results.summary = `${character.name}: ${totalIssues} issue(s) found, ${totalFixes} fix(es) applied`;
    } else {
      results.summary = `${character.name}: ${totalIssues} issue(s) found — review details`;
    }

    return Response.json({ success: true, data: results });
  } catch (error) {
    console.error('[troubleshootCharacterProfile]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});