import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * autoFixSystemViolations
 *
 * Safe "Fix All" diagnostic + repair for the Home page.
 * Rules enforced:
 * - NEVER deletes characters, NPCs, family members, memories, life events, or locations
 * - NEVER changes schedules, sleep times, work hours, or work days
 * - NEVER changes character_type, status, or owner_email / created_by
 * - NEVER moves characters to a location without validating current schedule
 * - Only fixes: venue closure returns home (if valid home exists + venue is actually closed),
 *   broken/unrecognized activity labels, and missing emotional_state defaults
 * - Multi-user safe: only touches characters owned by the calling user account
 *   (or runs as service role for admin-triggered fix-all)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow both user-triggered (with auth) and scheduled automation (no user token)
    let callerEmail = null;
    try {
      const user = await base44.auth.me();
      callerEmail = user?.email || null;
    } catch (_) {
      // Called from scheduled automation — runs across all users
    }

    const now = new Date();
    const currentHour = now.getUTCHours() - 4; // Approximate ET (handle wrapping)
    const etHour = ((currentHour % 24) + 24) % 24;
    const dayOfWeek = now.getDay();

    // Load characters — if caller is known, limit to their account; otherwise all active
    const allCharacters = await base44.asServiceRole.entities.Character.filter({ status: 'active' });
    const characters = callerEmail
      ? allCharacters.filter(c => c.created_by === callerEmail || c.owner_email === callerEmail)
      : allCharacters;

    const allLocations = await base44.asServiceRole.entities.LocationReference.list();
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    const fixLog = [];
    let fixed = 0;
    const updates = [];

    // Activity labels that are clearly generic/broken and should be cleared
    // NOTE: does NOT clear schedule-driven states like "sleeping", "at work", "at school"
    const GENERIC_ACTIVITY_PATTERNS = /^\s*(undefined|null|NaN|object Object|\[object\]|test|example|placeholder)\s*$/i;

    for (const char of characters) {
      // Skip diagnostic/test characters entirely
      if (char.diagnostic_only || char.is_test_character) continue;

      let updateData = {};

      // ── FIX 1: Clear broken/invalid activity labels ──────────────────
      // Only clear if the activity string is clearly garbage — never clear real states
      const activity = char.current_activity || '';
      if (activity && GENERIC_ACTIVITY_PATTERNS.test(activity)) {
        updateData.current_activity = '';
        fixLog.push(`Cleared garbage activity for ${char.name}: "${activity}"`);
        fixed++;
      }

      // ── FIX 2: Restore missing emotional_state default ───────────────
      if (!char.emotional_state) {
        updateData.emotional_state = 'calm';
        fixLog.push(`Restored emotional_state to "calm" for ${char.name}`);
        fixed++;
      }

      // ── FIX 3: Return from CLOSED venue — ONLY if all conditions met ──
      // Conditions: character has a work_location or visited location set,
      //             that location HAS defined operating hours,
      //             those hours confirm the venue is CLOSED right now,
      //             character has a home location to return to,
      //             it is NOT currently work hours for this character
      if (char.resolved_current_location_id && locationMap[char.resolved_current_location_id]) {
        const loc = locationMap[char.resolved_current_location_id];

        // Never force-move from home or character-specific locations
        const isHome = loc.category === 'home' || loc.id === char.current_home_location_id;
        const isWorkplace = loc.id === char.current_work_location_id || loc.id === char.occupation_location_id;

        if (!isHome && !isWorkplace && loc.operating_hours?.length > 0) {
          const todayHours = loc.operating_hours.find(h => h.day_of_week === dayOfWeek);
          if (todayHours) {
            const [locOpen] = (todayHours.open_time || '00:00').split(':').map(Number);
            const [locClose] = (todayHours.close_time || '23:59').split(':').map(Number);
            const venueClosed = etHour < locOpen || etHour >= locClose;

            // Verify it's not during character's work hours (work schedule takes priority)
            const workStart = char.work_start_time ? parseInt(char.work_start_time.split(':')[0]) : null;
            const workEnd = char.work_end_time ? parseInt(char.work_end_time.split(':')[0]) : null;
            const isWorkHours = workStart != null && workEnd != null && etHour >= workStart && etHour < workEnd && (char.work_days || []).includes(dayOfWeek);

            if (venueClosed && !isWorkHours && char.current_home_location_id) {
              updateData.resolved_current_location_id = char.current_home_location_id;
              updateData.resolved_current_location_name = locationMap[char.current_home_location_id]?.name || 'Home';
              updateData.resolved_presence_status = 'home';
              updateData.resolved_last_updated_at = new Date().toISOString();
              fixLog.push(`Returned ${char.name} home — "${loc.name}" is closed at this hour`);
              fixed++;
            }
          }
        }
      }

      // ── Apply updates ────────────────────────────────────────────────
      if (Object.keys(updateData).length > 0) {
        updates.push(
          base44.asServiceRole.entities.Character.update(char.id, updateData).catch(err => {
            console.error(`[autoFix] Failed to update ${char.name}:`, err.message);
          })
        );
      }
    }

    await Promise.all(updates);

    // ── OWNERSHIP INTEGRITY SCAN (read-only report) ──────────────────────
    const ownershipIssues = [];
    for (const char of characters) {
      if (!char.owner_email && !char.created_by) {
        ownershipIssues.push(`${char.name} (ID: ${char.id}): no owner_email or created_by — orphaned`);
      }
      if (char.character_type === 'npc' && !char.owner_email) {
        ownershipIssues.push(`NPC "${char.name}" (ID: ${char.id}): missing owner_email — may be misrouted`);
      }
    }

    return Response.json({
      success: true,
      summary: fixed > 0
        ? `Applied ${fixed} fix(es) across ${characters.length} character(s)`
        : `All ${characters.length} character(s) are clean — no fixes needed`,
      fixes_applied: fixLog,
      issues_found: ownershipIssues,
      checks: [
        { name: 'Characters scanned', status: 'info', message: `${characters.length} active character(s) checked` },
        { name: 'Fixes applied', status: fixed > 0 ? 'fixed' : 'passed', message: `${fixed} correction(s) applied` },
        { name: 'Ownership report', status: ownershipIssues.length > 0 ? 'warning' : 'passed', message: ownershipIssues.length > 0 ? `${ownershipIssues.length} ownership issue(s) found — review above` : 'All ownership fields consistent' },
      ],
    });
  } catch (error) {
    console.error('[autoFixSystemViolations]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});