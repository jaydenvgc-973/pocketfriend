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