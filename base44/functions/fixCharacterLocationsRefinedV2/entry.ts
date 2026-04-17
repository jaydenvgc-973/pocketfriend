import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * fixCharacterLocationsRefinedV2
 *
 * SAFE DIAGNOSTIC ONLY — aligns with current system rules:
 * - Uses asServiceRole for all queries
 * - Scopes characters strictly to this user's account (owner_email OR created_by)
 * - Scopes locations to this user's account OR shared (scope='shared')
 * - Uses resolved_current_location_id (the authoritative field), not legacy current_location_id
 * - NEVER writes location fields — reports only
 * - NEVER changes schedules, character types, or sleep times
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Fetch characters belonging to THIS user's account only ─────────────
    const byCreatedBy = await base44.asServiceRole.entities.Character.filter(
      { created_by: user.email, status: 'active' }, '-created_date', 200
    );
    const byOwnerEmail = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email, status: 'active' }, '-created_date', 200
    );
    // Deduplicate
    const charMap = {};
    [...byCreatedBy, ...byOwnerEmail].forEach(c => { charMap[c.id] = c; });
    const characters = Object.values(charMap);

    // ── Fetch locations visible to this user (owned + shared) ──────────────
    const ownedLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { created_by: user.email }, '-created_date', 300
    );
    const sharedLocations = await base44.asServiceRole.entities.LocationReference.filter(
      { scope: 'shared' }, '-created_date', 200
    );
    const allLocations = [...ownedLocations, ...sharedLocations];
    const locationMap = {};
    allLocations.forEach(l => { locationMap[l.id] = l; });

    const issues = [];
    const clean = [];

    for (const char of characters) {
      // Only check active characters (not NPCs without a presence)
      const isActiveChar = char.character_type === 'active' || char.character_type === 'promoted_npc';

      // ── Check 1: resolved_current_location_id points to a deleted/missing location ──
      if (char.resolved_current_location_id && !locationMap[char.resolved_current_location_id]) {
        issues.push({
          characterId: char.id,
          characterName: char.name,
          type: 'stale_resolved_location',
          field: 'resolved_current_location_id',
          staleId: char.resolved_current_location_id,
          message: `resolved_current_location_id "${char.resolved_current_location_id}" points to a location that no longer exists or is not visible to this account. Re-assign from character profile.`,
        });
        continue;
      }

      // ── Check 2: current_home_location_id stale ──────────────────────────
      if (char.current_home_location_id && !locationMap[char.current_home_location_id]) {
        issues.push({
          characterId: char.id,
          characterName: char.name,
          type: 'stale_home_location',
          field: 'current_home_location_id',
          staleId: char.current_home_location_id,
          message: `current_home_location_id "${char.current_home_location_id}" points to a deleted or inaccessible location. Re-assign home from character profile.`,
        });
      }

      // ── Check 3: current_work_location_id stale ──────────────────────────
      if (char.current_work_location_id && !locationMap[char.current_work_location_id]) {
        issues.push({
          characterId: char.id,
          characterName: char.name,
          type: 'stale_work_location',
          field: 'current_work_location_id',
          staleId: char.current_work_location_id,
          message: `current_work_location_id "${char.current_work_location_id}" points to a deleted or inaccessible location. Re-assign work location from character profile.`,
        });
      }

      // ── Check 4: Active character has no home assigned ────────────────────
      if (isActiveChar && !char.current_home_location_id) {
        issues.push({
          characterId: char.id,
          characterName: char.name,
          type: 'missing_home',
          field: 'current_home_location_id',
          message: `${char.name} has no home location assigned. Assign a home from the character profile.`,
        });
      }

      // ── Check 5: resolved_presence_status is stale/inconsistent ──────────
      if (isActiveChar && char.resolved_presence_status === 'at_work' && !char.current_work_location_id) {
        issues.push({
          characterId: char.id,
          characterName: char.name,
          type: 'presence_work_no_location',
          field: 'resolved_presence_status',
          message: `${char.name} is marked as "at_work" but has no work location assigned — presence status may display incorrectly.`,
        });
      }

      // ── Check 6: NPC ownership cross-account drift ────────────────────────
      if ((char.character_type === 'npc' || char.character_type === 'family_npc')) {
        const ownerEmail = char.owner_email || char.created_by;
        if (ownerEmail && ownerEmail !== user.email) {
          issues.push({
            characterId: char.id,
            characterName: char.name,
            type: 'npc_ownership_drift',
            field: 'owner_email',
            message: `NPC "${char.name}" is owned by "${ownerEmail}" but appeared in this account's query — possible ownership drift. Review this NPC's owner_email and created_by fields.`,
          });
        }
      }

      // If no issues found for this character, mark as clean
      const hasIssue = issues.some(i => i.characterId === char.id);
      if (!hasIssue) {
        clean.push({ characterId: char.id, characterName: char.name, status: 'ok' });
      }
    }

    return Response.json({
      summary: {
        totalCharacters: characters.length,
        activeCharacters: characters.filter(c => c.character_type === 'active' || c.character_type === 'promoted_npc').length,
        npcCharacters: characters.filter(c => c.character_type === 'npc' || c.character_type === 'family_npc').length,
        issuesFound: issues.length,
        cleanCharacters: clean.length,
      },
      issues,
      clean,
      note: 'This function is read-only. No location fields, schedules, or character types were modified. Resolve issues manually via the character profile editor.',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});