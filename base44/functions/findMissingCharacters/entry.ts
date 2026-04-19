import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Current valid status values per schema
const ACTIVE_STATUSES = ['active'];
const TERMINAL_STATUSES = ['deleted', 'soft_deleted', 'merged'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const checks = [];
    const fixes = [];
    const issuesFound = [];

    // SAFETY: Always query by created_by — never load all characters globally then filter
    const userCharacters = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email }, '-created_date', 500
    );

    checks.push({
      name: 'Database query for user characters',
      status: userCharacters.length > 0 ? 'passed' : 'warning',
      message: `Retrieved ${userCharacters.length} characters for ${user.email}`
    });

    // Status distribution (diagnostic only — never auto-change terminal statuses)
    const activeCount = userCharacters.filter(c => !c.status || c.status === 'active').length;
    const movedAwayCount = userCharacters.filter(c => c.status === 'moved_away').length;
    const softDeletedCount = userCharacters.filter(c => c.status === 'soft_deleted').length;
    const mergedCount = userCharacters.filter(c => c.status === 'merged').length;
    const deletedCount = userCharacters.filter(c => c.status === 'deleted').length;
    const unknownStatus = userCharacters.filter(c => c.status && !['active', 'moved_away', 'deleted', 'soft_deleted', 'merged'].includes(c.status)).length;

    checks.push({
      name: 'Character status distribution',
      status: unknownStatus > 0 ? 'warning' : 'passed',
      message: `Active: ${activeCount} | Moved Away: ${movedAwayCount} | Soft Deleted: ${softDeletedCount} | Merged: ${mergedCount} | Deleted: ${deletedCount}${unknownStatus > 0 ? ` | Unknown: ${unknownStatus}` : ''}`
    });

    if (unknownStatus > 0) {
      issuesFound.push(`${unknownStatus} character(s) have unrecognized status values`);
    }

    // Field completeness check for active characters
    const activeChars = userCharacters.filter(c => !c.status || c.status === 'active');
    const incomplete = activeChars.filter(c => {
      const missing = [];
      if (!c.name || !c.name.trim()) missing.push('name');
      if (!c.character_type) missing.push('character_type');
      if (!c.emotional_state) missing.push('emotional_state');
      return missing.length > 0;
    });

    if (incomplete.length > 0) {
      issuesFound.push(`${incomplete.length} active character(s) have incomplete required fields`);
      incomplete.forEach(c => {
        const missing = [];
        if (!c.name?.trim()) missing.push('name');
        if (!c.character_type) missing.push('character_type');
        if (!c.emotional_state) missing.push('emotional_state');
        issuesFound.push(`  → "${c.name || c.id}": missing ${missing.join(', ')}`);
      });
    }
    checks.push({
      name: 'Character field completeness',
      status: incomplete.length > 0 ? 'warning' : 'passed',
      message: incomplete.length > 0
        ? `${incomplete.length} active character(s) missing required fields — may be excluded from lists`
        : `All ${activeChars.length} active characters have required fields`
    });

    // Default character check
    const defaultChar = activeChars.find(c => c.is_default);
    checks.push({
      name: 'Default character check',
      status: defaultChar ? 'passed' : 'warning',
      message: defaultChar ? `Default character: ${defaultChar.name}` : 'No default character configured'
    });

    if (!defaultChar && activeChars.length > 0) {
      issuesFound.push('No default character set — some features may not work correctly');
    }

    // exclude_from_homepage check — informational only
    const hiddenChars = activeChars.filter(c => c.exclude_from_homepage === true);
    if (hiddenChars.length > 0) {
      issuesFound.push(`${hiddenChars.length} character(s) have exclude_from_homepage=true: ${hiddenChars.map(c => c.name).join(', ')}`);
      checks.push({
        name: 'Homepage visibility',
        status: 'warning',
        message: `${hiddenChars.length} character(s) are intentionally hidden from homepage`
      });
    }

    // SAFE FIXES — only fix missing defaults for active characters
    // NEVER touch status, created_by, or other ownership fields
    for (const char of activeChars) {
      const update = {};
      if (!char.emotional_state) update.emotional_state = 'calm';
      // Only set relationship defaults if truly unset (0 is valid)
      if (char.user_respect_level === undefined || char.user_respect_level === null) update.user_respect_level = 50;
      if (char.friendship_level === undefined || char.friendship_level === null) update.friendship_level = 75;
      if (char.romantic_level === undefined || char.romantic_level === null) update.romantic_level = 0;
      if (char.attraction_level === undefined || char.attraction_level === null) update.attraction_level = 0;
      if (char.chosen_family_level === undefined || char.chosen_family_level === null) update.chosen_family_level = 0;

      if (Object.keys(update).length > 0) {
        await base44.asServiceRole.entities.Character.update(char.id, update);
        fixes.push(`Filled missing default fields for: ${char.name}`);
      }
    }

    // Final verification
    const finalCheck = await base44.asServiceRole.entities.Character.filter({ created_by: user.email, status: 'active' }, '-created_date');
    checks.push({
      name: 'Final verification',
      status: 'passed',
      message: `${finalCheck.length} active characters visible for ${user.email}`
    });

    const summary = fixes.length > 0
      ? `Found ${userCharacters.length} total character(s). Applied ${fixes.length} safe repair(s) to fill missing default fields. No status or ownership changes were made.`
      : `Found ${userCharacters.length} total character(s) (${activeChars.length} active). No repairs needed.`;

    return Response.json({
      success: true,
      data: { summary, fixes_applied: fixes, issues_found: issuesFound, checks }
    });
  } catch (error) {
    console.error('[findMissingCharacters]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});