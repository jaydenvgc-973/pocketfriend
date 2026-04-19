import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Current valid character_type values per schema
const VALID_CHARACTER_TYPES = ['active', 'npc', 'family_npc', 'background', 'promoted_npc'];
// Current valid status values per schema
const VALID_STATUSES = ['active', 'moved_away', 'deleted', 'soft_deleted', 'merged'];

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

    // Fetch the target character — scoped to this user to prevent cross-account access
    const chars = await base44.asServiceRole.entities.Character.filter({ id: characterId, created_by: user.email });
    if (chars.length === 0) {
      return Response.json({ success: false, data: { summary: 'Character not found or access denied', checks: [], fixes_applied: [], issues_found: ['Character record missing or not owned by this account'] } });
    }
    const character = chars[0];

    // Fetch all characters for this user (scoped strictly by created_by)
    const allChars = await base44.asServiceRole.entities.Character.filter({ created_by: user.email });

    // --- FAMILY LIST CHECK ---
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

      const duplicatesFound = [];
      const wrongTitlesFound = [];

      for (const [title, count] of Object.entries(titleCounts)) {
        if (count > 1 && PARENT_TITLES.includes(title)) {
          duplicatesFound.push(`Duplicate "${title}" entries (${count} total) — only one per parent type expected`);
        }
        if (count > 1 && SPOUSE_TITLES.includes(title)) {
          duplicatesFound.push(`Duplicate "${title}" entries (${count} total) — only one spouse expected`);
        }
      }

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

      // Check generic "other" labels on linked active characters
      fictionalRels.filter(r => r.related_character_id).forEach(rel => {
        if ((rel.relationship_type || '').toLowerCase() === 'other') {
          const desc = (rel.description || rel.history_summary || '').toLowerCase();
          if (desc.includes('wife') || desc.includes('married')) {
            wrongTitlesFound.push(`${rel.person_name} is listed as "other" but description suggests "spouse/wife"`);
          } else if (desc.includes('husband')) {
            wrongTitlesFound.push(`${rel.person_name} is listed as "other" but description suggests "spouse/husband"`);
          }
        }
      });

      results.issues_found.push(...duplicatesFound, ...wrongTitlesFound);
      if (duplicatesFound.length === 0 && wrongTitlesFound.length === 0) {
        results.checks.push({ name: 'Family List Integrity', status: 'passed', message: `${familyMembers.length} family members — no obvious duplicates or title mismatches` });
      }
    }

    // --- STATUS / LOCATION CHECK ---
    if (selectedIssues.includes('status_location')) {
      const now = new Date();
      const recentEvents = await base44.asServiceRole.entities.ScheduledEvent.filter(
        { character_ids: [characterId], created_by: user.email }, '-trigger_time', 20
      );
      const activeEvent = recentEvents.find(ev => {
        if (ev.status !== 'completed') return false;
        const hoursAgo = (now - new Date(ev.trigger_time)) / 3600000;
        return hoursAgo < 4;
      });

      const LOCATION_KEYWORDS = ['hospital', 'bar', 'gym', 'work', 'school', 'church', 'mosque', 'synagogue', 'temple', 'mall', 'restaurant', 'park', 'clinic'];
      let detectedLocation = null;
      if (activeEvent) {
        const desc = (activeEvent.description || '').toLowerCase();
        detectedLocation = LOCATION_KEYWORDS.find(loc => desc.includes(loc));
        if (detectedLocation) {
          results.issues_found.push(`Active event detected: "${activeEvent.description}" — character may be at ${detectedLocation}, but current_activity is: "${character.current_activity || 'not set'}"`);
          await base44.asServiceRole.entities.Character.update(characterId, { current_activity: detectedLocation });
          results.fixes_applied.push(`Set current_activity to "${detectedLocation}" based on recent scheduled event`);
        }
      }

      // Report resolved location fields (current schema)
      results.checks.push({
        name: 'Status / Location Source',
        status: detectedLocation ? 'warning' : 'passed',
        message: [
          `current_activity = "${character.current_activity || 'none'}"`,
          `resolved_current_location_name = "${character.resolved_current_location_name || 'none'}"`,
          `resolved_presence_status = "${character.resolved_presence_status || 'none'}"`,
          `Active scheduled event: ${activeEvent ? activeEvent.description : 'none in last 4h'}`,
        ].join(' | ')
      });
    }

    // --- CHARACTER IDENTITY / CROSS-CONTAMINATION CHECK ---
    if (selectedIssues.includes('character_identity') || selectedIssues.includes('duplicate_records')) {
      // Only look within this user's characters — never global
      const sameName = allChars.filter(c => c.id !== characterId && c.name?.toLowerCase().trim() === character.name?.toLowerCase().trim());
      if (sameName.length > 0) {
        results.issues_found.push(`Found ${sameName.length} other record(s) with name "${character.name}" in this account: IDs = ${sameName.map(c => c.id).join(', ')}`);
        sameName.forEach(dup => {
          results.issues_found.push(`Duplicate: "${dup.name}" (ID: ${dup.id}) status: ${dup.status || 'active'} | created: ${dup.created_date}`);
        });
      } else {
        results.checks.push({ name: 'Duplicate Character Records', status: 'passed', message: `No other characters with name "${character.name}" found in this account` });
      }

      const charConvos = await base44.asServiceRole.entities.Conversation.filter({ character_ids: [characterId], created_by: user.email }, '-updated_date', 30);
      const crossLinked = charConvos.filter(c => c.character_ids && c.character_ids.length > 1 && c.type !== 'group' && c.type !== 'npc');
      if (crossLinked.length > 0) {
        results.issues_found.push(`Found ${crossLinked.length} non-group conversation(s) where ${character.name} is linked with another character — may cause cross-routing.`);
        crossLinked.forEach(c => {
          results.issues_found.push(`Thread "${c.title}" (${c.type}) has character_ids: [${c.character_ids.join(', ')}]`);
        });
      } else {
        results.checks.push({ name: 'Thread Identity Separation', status: 'passed', message: `All ${charConvos.length} conversations correctly isolated to ${character.name}` });
      }

      // Report current character type for awareness
      results.checks.push({
        name: 'Character Identity Audit',
        status: 'info',
        message: `ID: ${character.id} | Type: ${character.character_type || 'not set'} | Status: ${character.status || 'active'} | Created: ${character.created_date} | Owner: ${character.created_by}`
      });

      // Flag if character_type is missing or unrecognized
      if (!character.character_type || !VALID_CHARACTER_TYPES.includes(character.character_type)) {
        results.issues_found.push(`character_type is "${character.character_type || 'not set'}" — valid values are: ${VALID_CHARACTER_TYPES.join(', ')}. This may cause the character to be excluded from lists.`);
      }
    }

    // --- PROFILE SAVE CHECK ---
    if (selectedIssues.includes('profile_save') || selectedIssues.includes('family_save')) {
      const testValue = character.current_situation || '';
      try {
        await base44.asServiceRole.entities.Character.update(characterId, { current_situation: testValue });
        const recheckArr = await base44.asServiceRole.entities.Character.filter({ id: characterId });
        const recheck = recheckArr[0];
        if (recheck?.current_situation === testValue) {
          results.checks.push({ name: 'Profile Save Round-trip', status: 'passed', message: 'Profile save is working correctly' });
        } else {
          results.issues_found.push(`Profile save may have an issue — updated value did not match on re-read.`);
        }
      } catch (saveErr) {
        results.issues_found.push(`Profile save failed during test: ${saveErr.message}`);
      }
    }

    // --- DUPLICATE RELATIONSHIPS CHECK ---
    if (selectedIssues.includes('duplicate_relationships')) {
      const rels = character.fictional_relationships || [];
      const nameCount = {};
      rels.forEach(r => {
        const k = (r.person_name || '').toLowerCase().trim();
        if (k) nameCount[k] = (nameCount[k] || 0) + 1;
      });
      const dups = Object.entries(nameCount).filter(([, c]) => c > 1);
      if (dups.length > 0) {
        dups.forEach(([name, count]) => {
          results.issues_found.push(`Duplicate relationship entries for "${name}" (${count} entries) — may cause repeated people in profile views`);
        });
      } else {
        results.checks.push({ name: 'Duplicate Relationships', status: 'passed', message: `${rels.length} relationship entries — no duplicates found` });
      }
    }

    // --- WORLD NAME ENFORCEMENT ---
    if (selectedIssues.includes('world_name_enforcement')) {
      // Always scope UserSettings to this user's account
      const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ created_by: user.email });
      const worldName = settingsList?.[0]?.fictional_world_name || null;
      const PLACEHOLDER_PATTERNS = [/\bthe user\b/i, /\bthe player\b/i, /\bplayer\b/i];

      if (!worldName) {
        results.checks.push({ name: 'World Name Enforcement', status: 'warning', message: 'No world name set in Settings. Set one in Settings > Your Name (In-World). Characters will use pronouns until then.' });
      } else {
        const memories = await base44.asServiceRole.entities.Memory.filter({ character_id: characterId, created_by: user.email }, '-timestamp', 300);
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
          results.checks.push({ name: 'World Name — Memory', status: 'fixed', message: `${staleMemories.length} memory record(s) had stale placeholder. Corrected to "${worldName}".` });
        } else {
          results.checks.push({ name: 'World Name — Memory', status: 'passed', message: `All ${memories.length} memory record(s) are free of placeholder identity.` });
        }

        if (character.system_prompt && PLACEHOLDER_PATTERNS.some(p => p.test(character.system_prompt))) {
          await base44.asServiceRole.entities.Character.update(characterId, { system_prompt: null });
          results.fixes_applied.push(`Cleared stale system_prompt cache — will regenerate with world name "${worldName}" on next chat.`);
          results.checks.push({ name: 'World Name — Cached Prompt', status: 'fixed', message: `system_prompt contained placeholder identity. Cleared. Will rebuild on next chat with "${worldName}".` });
        } else {
          results.checks.push({ name: 'World Name — Cached Prompt', status: 'passed', message: 'No placeholder identity in cached system_prompt.' });
        }

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
        results.checks.push({ name: 'Appearance Lock', status: 'warning', message: `Appearance lock is empty — image generation has no identity anchors. Go to Character Profile > Appearance Lock to set values or use Auto-detect.` });
        results.issues_found.push(`No appearance lock data set for ${character.name}. Without this, skin tone, hair type, and aesthetic can drift between generated images.`);
      } else {
        results.checks.push({ name: 'Appearance Lock', status: 'passed', message: `${filledFields.length}/${lockFields.length} core appearance fields set. Empty: ${emptyFields.join(', ') || 'none'}.` });
      }

      const appearanceAge = character.appearance_age;
      const birthdayAge = character.birthday ? Math.floor((Date.now() - new Date(character.birthday).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
      if (appearanceAge != null) {
        results.checks.push({ name: 'Appearance Age', status: 'passed', message: `appearance_age override = ${appearanceAge}. Image generation will use ${appearanceAge}.` });
      } else if (birthdayAge != null) {
        results.checks.push({ name: 'Appearance Age', status: 'info', message: `No appearance_age override. Will use birthday-calculated age: ${birthdayAge}.` });
      } else {
        results.checks.push({ name: 'Appearance Age', status: 'warning', message: `No appearance_age or birthday set — image generation has no age anchor.` });
      }

      if (!character.gender) {
        results.checks.push({ name: 'Gender', status: 'warning', message: `No gender set on character. This affects image generation consistency.` });
      } else {
        results.checks.push({ name: 'Gender', status: 'passed', message: `Gender: ${character.gender}` });
      }
    }

    // --- STALE LOCATION REFERENCES ---
    if (selectedIssues.includes('stale_location_refs')) {
      // Load locations scoped to this user (shared + user-owned)
      const userLocations = await base44.asServiceRole.entities.LocationReference.filter({ created_by: user.email });
      const sharedLocations = await base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' });
      const validLocationIds = new Set([...userLocations, ...sharedLocations].map(l => l.id));

      const locationFields = [
        { field: 'current_home_location_id', label: 'Home' },
        { field: 'current_work_location_id', label: 'Work' },
        { field: 'occupation_location_id', label: 'Occupation Location' },
        { field: 'education_location_id', label: 'Education Location' },
        { field: 'resolved_current_location_id', label: 'Resolved Current Location' },
        { field: 'travel_destination_location_id', label: 'Travel Destination' },
      ];

      let staleCount = 0;
      for (const { field, label } of locationFields) {
        const val = character[field];
        if (val && !validLocationIds.has(val)) {
          results.issues_found.push(`STALE LOCATION: ${label} (${field}) points to missing/deleted location ID "${val}".`);
          staleCount++;
        }
      }

      if (staleCount === 0) {
        results.checks.push({ name: 'Stale Location References', status: 'passed', message: `All location ID references are valid.` });
      } else {
        results.checks.push({ name: 'Stale Location References', status: 'failed', message: `${staleCount} stale location reference(s) found. Characters referencing deleted locations can cause broken invites and scene errors.` });
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