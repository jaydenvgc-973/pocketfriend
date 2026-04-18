import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

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

    // Fetch all characters belonging to this user for cross-contamination checks
    const allChars = await base44.asServiceRole.entities.Character.filter({ created_by: user.email });

    // --- FAMILY LIST CHECK ---
    if (selectedIssues.includes('family_list') || selectedIssues.includes('wrong_titles')) {
      const familyMembers = character.family_members || [];
      const PARENT_TITLES = ['mother', 'mom', 'father', 'dad', 'parent'];
      const CHILD_TITLES = ['son', 'daughter', 'child', 'kid'];
      const SPOUSE_TITLES = ['wife', 'husband', 'spouse', 'partner'];

      let duplicatesFound = [];
      let wrongTitlesFound = [];
      let fixes = [];

      // Detect duplicate relationship types (e.g., two entries with title "mother")
      const titleCounts = {};
      familyMembers.forEach(m => {
        const t = (m.relationship_type || '').toLowerCase();
        titleCounts[t] = (titleCounts[t] || 0) + 1;
      });

      for (const [title, count] of Object.entries(titleCounts)) {
        if (count > 1 && PARENT_TITLES.includes(title)) {
          duplicatesFound.push(`Duplicate "${title}" entries found (${count} total) — only one parent per title expected`);
        }
        if (count > 1 && SPOUSE_TITLES.includes(title)) {
          duplicatesFound.push(`Duplicate "${title}" entries found (${count} total) — only one spouse expected`);
        }
      }

      // Detect mismatched titles: e.g. a person listed as "mother" but their name appears in fictional_relationships as child
      const fictionalRels = character.fictional_relationships || [];
      familyMembers.forEach(fm => {
        const relTitle = (fm.relationship_type || '').toLowerCase();
        const matchingFictional = fictionalRels.find(r => r.person_name === fm.name);
        if (matchingFictional) {
          const fRelType = (matchingFictional.relationship_type || '').toLowerCase();
          const parentIsChild = PARENT_TITLES.includes(relTitle) && CHILD_TITLES.includes(fRelType);
          const childIsParent = CHILD_TITLES.includes(relTitle) && PARENT_TITLES.includes(fRelType);
          if (parentIsChild || childIsParent) {
            wrongTitlesFound.push(`${fm.name} is listed as "${fm.relationship_type}" in family but "${matchingFictional.relationship_type}" in relationships — title mismatch`);
          }
        }
      });

      // Check if a character from fictional_relationships who is another app character (related_character_id set)
      // is listed as "other" when they should have a specific title
      const ETHAN_ID = '69c0d59d7e382cc866ded9c9';
      fictionalRels.filter(r => r.related_character_id && r.related_character_id !== ETHAN_ID).forEach(rel => {
        if ((rel.relationship_type || '').toLowerCase() === 'other') {
          // Try to infer a better title
          const desc = (rel.description || rel.history_summary || '').toLowerCase();
          if (desc.includes('wife') || desc.includes('married')) {
            wrongTitlesFound.push(`${rel.person_name} is listed as "other" but description suggests "spouse/wife"`);
          } else if (desc.includes('husband')) {
            wrongTitlesFound.push(`${rel.person_name} is listed as "other" but description suggests "spouse/husband"`);
          }
        }
      });

      if (duplicatesFound.length > 0) {
        results.issues_found.push(...duplicatesFound);
      }
      if (wrongTitlesFound.length > 0) {
        results.issues_found.push(...wrongTitlesFound);
      }
      if (duplicatesFound.length === 0 && wrongTitlesFound.length === 0) {
        results.checks.push({ name: 'Family List Integrity', status: 'passed', message: `${familyMembers.length} family members found, no obvious duplicates or title mismatches` });
      }
    }

    // --- STATUS / LOCATION CHECK ---
    if (selectedIssues.includes('status_location')) {
      // Check scheduled events for active location
      const now = new Date();
      const recentEvents = await base44.asServiceRole.entities.ScheduledEvent.filter(
        { character_ids: [characterId] },
        '-trigger_time',
        20
      );

      const activeEvent = recentEvents.find(ev => {
        if (ev.status !== 'completed') return false;
        const triggerTime = new Date(ev.trigger_time);
        const hoursAgo = (now - triggerTime) / (1000 * 60 * 60);
        return hoursAgo < 4; // Event completed in last 4 hours = likely still active
      });

      const LOCATION_KEYWORDS = ['hospital', 'bar', 'gym', 'work', 'school', 'church', 'mosque', 'synagogue', 'temple', 'mall', 'restaurant', 'park', 'clinic'];
      let detectedLocation = null;

      if (activeEvent) {
        const desc = (activeEvent.description || '').toLowerCase();
        detectedLocation = LOCATION_KEYWORDS.find(loc => desc.includes(loc));
        if (detectedLocation) {
          results.issues_found.push(`Active event detected: "${activeEvent.description}" — character may currently be at ${detectedLocation}, but current_activity field is: "${character.current_activity || 'not set'}"`);
          // Auto-fix: set current_activity to the detected location
          await base44.asServiceRole.entities.Character.update(characterId, { current_activity: detectedLocation });
          results.fixes_applied.push(`Set current_activity to "${detectedLocation}" based on active scheduled event`);
        }
      }

      const currentActivity = character.current_activity || '';
      results.checks.push({
        name: 'Status / Location Source',
        status: detectedLocation ? 'warning' : 'passed',
        message: `current_activity = "${currentActivity || 'none'}" | Active scheduled event: ${activeEvent ? activeEvent.description : 'none in last 4h'}`
      });
    }

    // --- CHARACTER IDENTITY / CROSS-CONTAMINATION CHECK ---
    if (selectedIssues.includes('character_identity') || selectedIssues.includes('duplicate_records')) {
      // Look for other characters with the same name (potential duplicates from recovery)
      const sameName = allChars.filter(c => c.id !== characterId && c.name?.toLowerCase().trim() === character.name?.toLowerCase().trim());

      if (sameName.length > 0) {
        results.issues_found.push(`Found ${sameName.length} other character record(s) with the same name "${character.name}": IDs = ${sameName.map(c => c.id).join(', ')} — potential recovery duplicates`);
        sameName.forEach(dup => {
          results.issues_found.push(`Duplicate: "${dup.name}" (ID: ${dup.id}) status: ${dup.status || 'active'} | created: ${dup.created_date}`);
        });
      } else {
        results.checks.push({ name: 'Duplicate Character Records', status: 'passed', message: `No other characters found with name "${character.name}"` });
      }

      // Check for cross-linked conversations: conversations that contain this character's ID but also contain OTHER characters' IDs unexpectedly
      const charConvos = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [characterId] }, '-updated_date', 30);
      const crossLinked = charConvos.filter(c => c.character_ids && c.character_ids.length > 1 && c.type !== 'group' && c.type !== 'npc');

      if (crossLinked.length > 0) {
        results.issues_found.push(`Found ${crossLinked.length} non-group conversation(s) where ${character.name} is linked alongside another character. This can cause cross-routing.`);
        crossLinked.forEach(c => {
          results.issues_found.push(`Thread "${c.title}" (${c.type}) has character_ids: [${c.character_ids.join(', ')}]`);
        });
      } else {
        results.checks.push({ name: 'Thread Identity Separation', status: 'passed', message: `All ${charConvos.length} conversations are correctly isolated to ${character.name}` });
      }

      // Character ID report
      results.checks.push({
        name: 'Character Identity Audit',
        status: 'info',
        message: `Canonical ID for ${character.name}: ${character.id} | Status: ${character.status || 'active'} | Created: ${character.created_date}`
      });
    }

    // --- PROFILE SAVE CHECK ---
    if (selectedIssues.includes('profile_save') || selectedIssues.includes('family_save')) {
      // Verify that a test update round-trips correctly
      const testValue = character.current_situation || '';
      try {
        await base44.asServiceRole.entities.Character.update(characterId, { current_situation: testValue });
        const recheckArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
        const recheck = recheckArr[0];
        if (recheck?.current_situation === testValue) {
          results.checks.push({ name: 'Profile Save Round-trip', status: 'passed', message: 'Profile save is working — test update persisted and retrieved correctly' });
        } else {
          results.issues_found.push(`Profile save may have an issue — updated value did not match on re-read. Expected "${testValue}", got "${recheck?.current_situation}"`);
        }
      } catch (saveErr) {
        results.issues_found.push(`Profile save failed during test: ${saveErr.message}`);
      }
    }

    // --- WORLD NAME ENFORCEMENT ---
    if (selectedIssues.includes('world_name_enforcement')) {
      const settingsList = await base44.asServiceRole.entities.UserSettings.list();
      const worldName = settingsList?.[0]?.fictional_world_name || null;
      const PLACEHOLDER_PATTERNS = [/\bthe user\b/i, /\bthe player\b/i, /\bplayer\b/i];

      if (!worldName) {
        results.checks.push({ name: 'World Name Enforcement', status: 'warning', message: 'No world name set in UserSettings. Set one in Settings > Your Name (In-World). Characters will use pronouns until then.' });
      } else {
        // Check memories
        const memories = await base44.asServiceRole.entities.Memory.filter({ character_id: characterId }, '-timestamp', 300);
        const staleMemories = memories.filter(m => PLACEHOLDER_PATTERNS.some(p => p.test(m.title || '') || p.test(m.description || '')));
        if (staleMemories.length > 0) {
          let corrected = 0;
          for (const mem of staleMemories) {
            const newTitle = (mem.title || '').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
            const newDesc = (mem.description || '').replace(/\bthe user\b/gi, worldName).replace(/\bthe player\b/gi, worldName);
            await base44.asServiceRole.entities.Memory.update(mem.id, { title: newTitle, description: newDesc });
            corrected++;
          }
          results.fixes_applied.push(`Corrected ${corrected} memory record(s): replaced placeholder identity with "${worldName}"`);
          results.checks.push({ name: 'World Name — Memory', status: 'failed', message: `${staleMemories.length} memory record(s) had stale "the user" placeholder. Corrected to "${worldName}". Root cause: memories were created before world name was set.` });
        } else {
          results.checks.push({ name: 'World Name — Memory', status: 'passed', message: `All ${memories.length} memory record(s) are free of placeholder identity.` });
        }

        // Check system_prompt cache
        if (character.system_prompt && PLACEHOLDER_PATTERNS.some(p => p.test(character.system_prompt))) {
          await base44.asServiceRole.entities.Character.update(characterId, { system_prompt: null });
          results.fixes_applied.push(`Cleared stale system_prompt cache — will regenerate with world name "${worldName}" on next chat.`);
          results.checks.push({ name: 'World Name — Cached Prompt', status: 'failed', message: `system_prompt contained placeholder identity. Cleared. Root cause: CACHE_STALE. Prompt will rebuild on next chat with correct world name.` });
        } else {
          results.checks.push({ name: 'World Name — Cached Prompt', status: 'passed', message: 'No placeholder identity found in cached system_prompt.' });
        }

        // Check relationship labels / nickname
        const nickname = character.nickname_for_user;
        if (nickname && PLACEHOLDER_PATTERNS.some(p => p.test(nickname))) {
          await base44.asServiceRole.entities.Character.update(characterId, { nickname_for_user: worldName });
          results.fixes_applied.push(`Corrected nickname_for_user from placeholder to "${worldName}"`);
        }
        results.checks.push({ name: 'World Name — Nickname Override', status: 'info', message: nickname ? `Per-character nickname: "${nickname}"` : `No per-character nickname — uses global world name "${worldName}"` });
      }
    }

    // --- APPEARANCE LOCK CHECK ---
    if (selectedIssues.includes('appearance_lock_check')) {
      const lock = character.appearance_lock || {};
      const lockFields = ['skin_tone', 'hair_type', 'hairstyle', 'overall_aesthetic'];
      const filledFields = lockFields.filter(f => lock[f] && lock[f].trim());
      const emptyFields = lockFields.filter(f => !lock[f] || !lock[f].trim());

      if (filledFields.length === 0) {
        results.checks.push({ name: 'Appearance Lock', status: 'warning', message: `Appearance lock is empty — image generation will not have enforced identity anchors. Go to Character Profile > Appearance Lock to set values or use Auto-detect.` });
        results.issues_found.push(`No appearance lock data set for ${character.name}. Without this, skin tone, hair type, and aesthetic can drift between generated images.`);
      } else {
        results.checks.push({ name: 'Appearance Lock', status: 'passed', message: `${filledFields.length}/${lockFields.length} core appearance fields set. Empty: ${emptyFields.join(', ') || 'none'}.` });
      }

      const appearanceAge = character.appearance_age;
      const birthdayAge = character.birthday ? Math.floor((Date.now() - new Date(character.birthday).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
      if (appearanceAge != null) {
        results.checks.push({ name: 'Appearance Age', status: 'passed', message: `appearance_age override = ${appearanceAge}. Birthday age = ${birthdayAge ?? 'N/A'}. Image generation will use ${appearanceAge}.` });
      } else if (birthdayAge != null) {
        results.checks.push({ name: 'Appearance Age', status: 'info', message: `No appearance_age override. Image generation will use birthday-calculated age: ${birthdayAge}. If this looks wrong in images, set an appearance_age override.` });
      } else {
        results.checks.push({ name: 'Appearance Age', status: 'warning', message: `No appearance_age set and no birthday. Image generation has no age anchor — results may vary.` });
      }

      const gender = character.gender;
      if (!gender) {
        results.checks.push({ name: 'Gender', status: 'warning', message: `No gender set on character. This can affect image generation consistency. Go to Character Profile to set gender.` });
      } else {
        results.checks.push({ name: 'Gender', status: 'passed', message: `Gender: ${gender}` });
      }
    }

    // --- STALE LOCATION REFERENCES ---
    if (selectedIssues.includes('stale_location_refs')) {
      const allLocations = await base44.asServiceRole.functions.invoke('fetchAllLocationsForUser', {}).then(r => r?.locations || []).catch(() => []);
      const validLocationIds = new Set(allLocations.map(l => l.id));

      const locationFields = [
        { field: 'current_home_location_id', label: 'Home' },
        { field: 'current_work_location_id', label: 'Work' },
        { field: 'occupation_location_id', label: 'Occupation Location' },
        { field: 'education_location_id', label: 'Education Location' },
        { field: 'resolved_current_location_id', label: 'Resolved Location' },
      ];

      let staleCount = 0;
      for (const { field, label } of locationFields) {
        const val = character[field];
        if (val && !validLocationIds.has(val)) {
          results.issues_found.push(`STALE LOCATION: ${label} field (${field}) points to deleted/missing location ID "${val}". This character may be referencing a location that no longer exists.`);
          staleCount++;
        }
      }

      if (staleCount === 0) {
        results.checks.push({ name: 'Stale Location References', status: 'passed', message: `All location ID references are valid.` });
      } else {
        results.checks.push({ name: 'Stale Location References', status: 'failed', message: `${staleCount} stale location reference(s) found. Characters referencing deleted locations can cause broken invites and scene errors. Update location assignments on the character profile.` });
      }
    }

    const totalIssues = results.issues_found.length;
    const totalFixes = results.fixes_applied.length;
    if (totalIssues === 0 && totalFixes === 0) {
      results.summary = `No issues found for ${character.name} on the selected checks.`;
    } else if (totalFixes > 0) {
      results.summary = `Found ${totalIssues} issue(s), applied ${totalFixes} fix(es) for ${character.name}.`;
    } else {
      results.summary = `Found ${totalIssues} issue(s) for ${character.name} — review details above.`;
    }

    return Response.json({ success: true, data: results });
  } catch (error) {
    console.error('[troubleshootCharacterProfile]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});