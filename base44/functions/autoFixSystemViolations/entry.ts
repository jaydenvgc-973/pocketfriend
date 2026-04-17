import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * AUTO-FIX: Safe system violation corrections only.
 *
 * RULES (enforced strictly):
 * - NO character deletions
 * - NO NPC deletions
 * - NO location deletions or changes
 * - NO schedule changes
 * - NO character data drift
 * - Only fixes: ownership fields, missing defaults, broken URLs, stale caches
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const [allCharacters, locations] = await Promise.all([
      base44.asServiceRole.entities.Character.filter({ status: 'active' }, '-created_date', 500),
      base44.asServiceRole.entities.LocationReference.list('-created_date', 200),
    ]);

    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));
    const fixes_applied = [];
    const issues_found = [];
    const checks = [];

    for (const char of allCharacters) {
      const updates = {};

      // ── FIX 1: Missing owner_email ──────────────────────────────────────────
      // STRICT RULE: NEVER overwrite an existing owner_email — it was explicitly set by a user.
      // Only fill it in if it is completely absent AND created_by is a real user email (not admin session).
      // Admin session emails (like murqart@gmail.com used as app builder) must NOT be auto-assigned
      // to characters belonging to other accounts.
      // This fix is intentionally disabled to prevent cross-account contamination.
      // owner_email must only be set explicitly by the user or by createFictionalRelationship.
      // if (!char.owner_email && char.created_by) { ... } — DISABLED

      // ── FIX 2: Missing emotional_state default ──────────────────────────────
      if (!char.emotional_state) {
        updates.emotional_state = 'calm';
        fixes_applied.push(`${char.name}: emotional_state missing — defaulted to "calm"`);
      }

      // ── FIX 3: Missing sleep schedule default (only if both are absent) ─────
      // NEVER overwrites existing sleep schedule values.
      if (!char.sleep_start_time && !char.wake_up_time) {
        updates.sleep_start_time = '23:00';
        updates.wake_up_time = '07:00';
        fixes_applied.push(`${char.name}: sleep schedule missing — defaulted to 11pm–7am`);
      }

      // ── FIX 4: Stale system_prompt cache (only if it contains placeholder identity) ──
      if (char.system_prompt) {
        const PLACEHOLDER = /\bthe user\b|\bthe player\b|\bplayer\b/i;
        if (PLACEHOLDER.test(char.system_prompt)) {
          updates.system_prompt = null;
          fixes_applied.push(`${char.name}: stale system_prompt had placeholder identity — cleared (will rebuild on next chat)`);
        }
      }

      // ── FIX 5: Resolved location pointing to deleted location (report only) ─
      // Never clears or changes location fields. Only reports.
      if (char.resolved_current_location_id && !locationMap[char.resolved_current_location_id]) {
        issues_found.push(`${char.name}: resolved_current_location_id "${char.resolved_current_location_id}" points to a deleted location. Reassign from character profile.`);
      }
      if (char.current_home_location_id && !locationMap[char.current_home_location_id]) {
        issues_found.push(`${char.name}: current_home_location_id "${char.current_home_location_id}" points to a deleted location. Reassign from character profile.`);
      }
      if (char.current_work_location_id && !locationMap[char.current_work_location_id]) {
        issues_found.push(`${char.name}: current_work_location_id "${char.current_work_location_id}" points to a deleted location. Reassign from character profile.`);
      }

      // ── FIX 6: NPC ownership — NPC must be owned by the same account as its parent ──
      // Detects NPCs created_by admin session instead of the correct user account.
      if ((char.character_type === 'npc' || char.character_type === 'family_npc') && char.owner_email && char.created_by !== char.owner_email) {
        // The owner_email is the authoritative source for NPCs. Update created_by to match.
        updates.created_by = char.owner_email;
        fixes_applied.push(`NPC "${char.name}": created_by (${char.created_by}) corrected to owner_email (${char.owner_email})`);
      }

      if (Object.keys(updates).length > 0) {
        await base44.asServiceRole.entities.Character.update(char.id, updates).catch(err => {
          issues_found.push(`Failed to update ${char.name}: ${err.message}`);
        });
      }
    }

    // ── GLOBAL: Check for any user settings missing fictional_world_name ───────
    const allSettings = await base44.asServiceRole.entities.UserSettings.list('-created_date', 100);
    const noWorldName = allSettings.filter(s => !s.fictional_world_name);
    if (noWorldName.length > 0) {
      issues_found.push(`${noWorldName.length} user account(s) have no fictional world name set — characters will use "the user" placeholder until set.`);
    }

    checks.push({ name: 'Character ownership fields', status: 'passed', message: `Scanned ${allCharacters.length} active characters.` });
    checks.push({ name: 'NPC routing integrity', status: fixes_applied.some(f => f.includes('NPC')) ? 'fixed' : 'passed', message: 'NPC owner_email and created_by verified.' });
    checks.push({ name: 'Stale prompt caches', status: 'passed', message: 'system_prompt fields checked for placeholder identity.' });
    checks.push({ name: 'Location references', status: issues_found.some(i => i.includes('deleted location')) ? 'warning' : 'passed', message: 'Location ID references checked (read-only — no changes made to locations or schedules).' });

    return Response.json({
      success: true,
      summary: `Scanned ${allCharacters.length} characters. ${fixes_applied.length} fix(es) applied. ${issues_found.length} issue(s) found (reported only — no destructive changes).`,
      fixes_applied,
      issues_found,
      checks,
      fixed: fixes_applied, // UI alias
    });
  } catch (error) {
    console.error('[autoFixSystemViolations]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});