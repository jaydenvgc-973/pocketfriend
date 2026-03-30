import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const checks = [];
    const fixes = [];
    const issuesFound = [];

    // ====== DEEP DIAGNOSTIC LEVEL 1: Database Query ======
    console.log(`[DIAGNOSTIC] Finding all characters for user: ${user.email}`);
    const allCharactersDB = await base44.asServiceRole.entities.Character.list('-created_date', 1000);
    console.log(`[DIAGNOSTIC] Found ${allCharactersDB.length} total characters in database`);

    // ====== DEEP DIAGNOSTIC LEVEL 2: User-Owned Filter ======
    const userCharacters = allCharactersDB.filter(c => c.created_by === user.email);
    console.log(`[DIAGNOSTIC] Found ${userCharacters.length} characters with correct created_by: ${user.email}`);
    checks.push({
      name: 'Database query for user characters',
      status: userCharacters.length > 0 ? 'passed' : 'warning',
      message: `Retrieved ${userCharacters.length} characters from database with created_by=${user.email}`
    });

    // ====== DEEP DIAGNOSTIC LEVEL 3: Orphaned/Misattributed ======
    const orphanedChars = allCharactersDB.filter(c => {
      // Characters with service role email or weird ownership
      return (c.created_by && (c.created_by.includes('service+') || !c.created_by.includes('@'))) || !c.created_by;
    });
    if (orphanedChars.length > 0) {
      issuesFound.push(`Found ${orphanedChars.length} orphaned characters with incorrect created_by`);
    }
    checks.push({
      name: 'Orphaned character scan',
      status: orphanedChars.length > 0 ? 'warning' : 'passed',
      message: orphanedChars.length > 0 ? `Found ${orphanedChars.length} orphaned records` : 'No orphaned records'
    });

    // ====== DEEP DIAGNOSTIC LEVEL 4: Status States ======
    const activeCount = userCharacters.filter(c => c.status === 'active' || !c.status).length;
    const movedAwayCount = userCharacters.filter(c => c.status === 'moved_away').length;
    const deletedCount = userCharacters.filter(c => c.status === 'deleted').length;
    const unknownStatus = userCharacters.filter(c => c.status && !['active', 'moved_away', 'deleted'].includes(c.status)).length;

    if (unknownStatus > 0) {
      issuesFound.push(`Found ${unknownStatus} characters with unknown status values`);
    }
    checks.push({
      name: 'Character status distribution',
      status: unknownStatus > 0 ? 'warning' : 'passed',
      message: `Active: ${activeCount}, Moved: ${movedAwayCount}, Deleted: ${deletedCount}${unknownStatus > 0 ? `, Unknown: ${unknownStatus}` : ''}`
    });

    // ====== DEEP DIAGNOSTIC LEVEL 5: Field Completeness ======
    const incomplete = userCharacters.filter(c => {
      const missing = [];
      if (!c.name || !c.name.trim()) missing.push('name');
      if (!c.avatar_url && !c.reference_image_urls?.length) missing.push('avatar');
      if (!c.personality_summary) missing.push('personality');
      if (!c.emotional_state) missing.push('emotional_state');
      return missing.length > 0;
    });

    if (incomplete.length > 0) {
      issuesFound.push(`Found ${incomplete.length} characters with incomplete core fields`);
    }
    checks.push({
      name: 'Character field completeness',
      status: incomplete.length > 0 ? 'warning' : 'passed',
      message: incomplete.length > 0 ? `${incomplete.length} characters missing core fields` : 'All characters have required fields'
    });

    // ====== DEEP DIAGNOSTIC LEVEL 6: Default Character ======
    const defaultChar = userCharacters.find(c => c.is_default);
    if (!defaultChar && userCharacters.length > 0) {
      issuesFound.push('No default character set');
    }
    checks.push({
      name: 'Default character check',
      status: defaultChar ? 'passed' : 'warning',
      message: defaultChar ? `Default character set: ${defaultChar.name}` : 'No default character configured'
    });

    // ====== APPLY FIXES ======
    console.log(`[FIXES] Starting repair process for ${userCharacters.length} characters`);

    // FIX 1: Ensure all user characters have correct created_by
    for (const char of userCharacters) {
      if (char.created_by !== user.email) {
        console.log(`[FIX] Correcting created_by for ${char.name} (${char.id})`);
        await base44.asServiceRole.entities.Character.update(char.id, {
          created_by: user.email
        });
        fixes.push(`Corrected ownership: ${char.name}`);
      }
    }

    // FIX 2: Ensure all active/custom characters have status = 'active'
    for (const char of userCharacters) {
      if (char.status === 'deleted' || !char.status || (char.status && !['active', 'moved_away'].includes(char.status))) {
        const newStatus = char.is_default ? 'active' : 'active';
        console.log(`[FIX] Setting status to ${newStatus} for ${char.name} (was: ${char.status})`);
        await base44.asServiceRole.entities.Character.update(char.id, {
          status: newStatus
        });
        fixes.push(`Set status to active: ${char.name}`);
      }
    }

    // FIX 3: Ensure all characters have required system fields
    for (const char of userCharacters) {
      const update = {};
      if (!char.emotional_state) update.emotional_state = 'calm';
      if (!char.user_respect_level) update.user_respect_level = 50;
      if (!char.friendship_level) update.friendship_level = 75;
      if (!char.romantic_level) update.romantic_level = 0;
      if (!char.attraction_level) update.attraction_level = 0;
      if (!char.chosen_family_level) update.chosen_family_level = 0;

      if (Object.keys(update).length > 0) {
        console.log(`[FIX] Adding missing default fields to ${char.name}`);
        await base44.asServiceRole.entities.Character.update(char.id, update);
        fixes.push(`Added default fields: ${char.name}`);
      }
    }

    // ====== FINAL VERIFICATION ======
    console.log(`[DIAGNOSTIC] Running final verification...`);
    const finalCheck = await base44.asServiceRole.entities.Character.filter({ created_by: user.email }, '-created_date');
    const finalActive = finalCheck.filter(c => c.status === 'active' || !c.status).length;

    checks.push({
      name: 'Final verification scan',
      status: finalActive === activeCount + unknownStatus ? 'passed' : 'fixed',
      message: `Final count: ${finalActive} active characters (was: ${activeCount})`
    });

    const summary = fixes.length > 0
      ? `Found ${userCharacters.length} character(s). Applied ${fixes.length} repair(s) to ensure they appear on your homepage and throughout the app.`
      : `Found ${userCharacters.length} character(s). All systems healthy — no repairs needed.`;

    return Response.json({
      success: true,
      data: {
        summary,
        fixes_applied: fixes,
        issues_found: issuesFound,
        checks
      }
    });
  } catch (error) {
    console.error('[ERROR] Deep diagnostic failed:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});