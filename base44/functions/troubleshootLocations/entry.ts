import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Current valid character_type values per schema (updated — created_by is PERMANENTLY FORBIDDEN)
const ACTIVE_CHARACTER_TYPES = ['active_created_character'];
const ALL_NPC_TYPES = ['npc_fictitious', 'npc_regular', 'npc_family_member'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { selectedIssues = [] } = await req.json();

    const results = {
      summary: '',
      checks: [],
      fixes_applied: [],
      issues_found: [],
    };

    // Load all active user characters — owner_email scoped only (created_by is FORBIDDEN)
    const userChars = await base44.entities.Character.filter(
      { owner_email: user.email, status: 'active' }, '-created_date', 200
    );

    // Load all locations accessible to this user: owner_email scoped + shared
    const userLocations = await base44.entities.LocationReference.filter({ owner_email: user.email });
    const sharedLocations = await base44.asServiceRole.entities.LocationReference.filter({ scope: 'shared' });
    const allLocations = [...userLocations, ...sharedLocations];
    const validLocationIds = new Set(allLocations.map(l => l.id));
    const locationById = {};
    allLocations.forEach(l => { locationById[l.id] = l; });

    // ── STALE LOCATION REFS ──────────────────────────────────────────────────
    if (selectedIssues.includes('stale_location_refs')) {
      const locationFields = [
        { field: 'current_home_location_id', label: 'Home Location' },
        { field: 'current_work_location_id', label: 'Work Location' },
        { field: 'occupation_location_id', label: 'Occupation Location' },
        { field: 'education_location_id', label: 'Education Location' },
        { field: 'resolved_current_location_id', label: 'Resolved Current Location' },
        { field: 'travel_destination_location_id', label: 'Travel Destination' },
      ];

      let totalStale = 0;
      for (const char of userChars) {
        const charStale = [];
        for (const { field, label } of locationFields) {
          const val = char[field];
          if (val && !validLocationIds.has(val)) {
            charStale.push(`${label} (${field}) points to missing ID "${val}"`);
            totalStale++;
          }
        }
        if (charStale.length > 0) {
          results.issues_found.push(`"${char.name}": ${charStale.join(' | ')}`);
        }
      }

      results.checks.push({
        name: 'Stale Location References',
        status: totalStale === 0 ? 'passed' : 'failed',
        message: totalStale === 0
          ? `All location ID references valid across ${userChars.length} characters`
          : `${totalStale} stale location reference(s) found across characters — these point to deleted/missing locations`
      });
    }

    // ── GENERIC LOCATION LABELS ──────────────────────────────────────────────
    if (selectedIssues.includes('generic_location_labels')) {
      // Current app uses resolved_current_location_name — not old generic text labels
      const GENERIC_PATTERNS = [
        /^at a bar/i, /^at the bar/i, /^at a club/i, /^at the gym/i,
        /^at a restaurant/i, /^out for dinner/i, /^out for lunch/i,
        /^out for a walk/i, /^running errands/i, /^out shopping/i,
      ];

      const genericChars = userChars.filter(c => {
        const activity = c.current_activity || '';
        const resolvedName = c.resolved_current_location_name || '';
        return GENERIC_PATTERNS.some(p => p.test(activity) || p.test(resolvedName));
      });

      if (genericChars.length > 0) {
        genericChars.forEach(c => {
          results.issues_found.push(`"${c.name}": generic location label detected — current_activity="${c.current_activity || 'none'}" | resolved_location="${c.resolved_current_location_name || 'none'}"`);
        });
        results.checks.push({
          name: 'Generic Location Labels',
          status: 'warning',
          message: `${genericChars.length} character(s) have generic location labels. These should be linked to real LocationReference records.`
        });
      } else {
        results.checks.push({
          name: 'Generic Location Labels',
          status: 'passed',
          message: `No generic location labels found across ${userChars.length} characters`
        });
      }
    }

    // ── RESOLVED LOCATION SYNC ───────────────────────────────────────────────
    if (selectedIssues.includes('resolved_location_sync')) {
      const REQUIRED_RESOLVED_FIELDS = ['resolved_current_location_id', 'resolved_current_location_name', 'resolved_presence_status'];
      let incompleteCount = 0;
      let staleNameCount = 0;

      for (const char of userChars) {
        const missing = REQUIRED_RESOLVED_FIELDS.filter(f => !char[f]);
        if (missing.length > 0) {
          results.issues_found.push(`"${char.name}": resolved location fields missing: ${missing.join(', ')}`);
          incompleteCount++;
        }

        // Check if resolved_current_location_name matches the actual location record name
        if (char.resolved_current_location_id && char.resolved_current_location_name) {
          const loc = locationById[char.resolved_current_location_id];
          if (loc && loc.name !== char.resolved_current_location_name) {
            results.issues_found.push(`"${char.name}": resolved_current_location_name="${char.resolved_current_location_name}" but location record name is "${loc.name}" — name is stale`);
            // Auto-fix: update the stale name — user-scoped (ownership confirmed by initial owner_email filter)
            await base44.entities.Character.update(char.id, {
              resolved_current_location_name: loc.name,
            });
            results.fixes_applied.push(`"${char.name}": corrected stale resolved_current_location_name to "${loc.name}"`);
            staleNameCount++;
          }
        }
      }

      results.checks.push({
        name: 'Resolved Location Field Completeness',
        status: incompleteCount === 0 && staleNameCount === 0 ? 'passed' : 'warning',
        message: [
          incompleteCount > 0 ? `${incompleteCount} character(s) missing resolved location fields` : null,
          staleNameCount > 0 ? `${staleNameCount} stale location name(s) auto-corrected` : null,
          incompleteCount === 0 && staleNameCount === 0 ? `All ${userChars.length} characters have up-to-date resolved location fields` : null,
        ].filter(Boolean).join(' | ')
      });
    }

    // ── LOCATION OWNERSHIP INTEGRITY ─────────────────────────────────────────
    if (selectedIssues.includes('location_type_integrity')) {
      const misownedLocs = userLocations.filter(l => {
        // User-created locations should NOT have scope='shared' unless created by admin
        return l.scope === 'shared' && l.created_by_role !== 'admin';
      });

      const noOwnerLocs = userLocations.filter(l => !l.owner_email && !l.owner_user_id && l.scope !== 'shared');

      if (misownedLocs.length > 0) {
        misownedLocs.forEach(l => {
          results.issues_found.push(`Location "${l.name}" (ID: ${l.id}): scope is "shared" but not created by admin — may be visible to other users unexpectedly`);
        });
      }

      if (noOwnerLocs.length > 0) {
        noOwnerLocs.forEach(l => {
          results.issues_found.push(`Location "${l.name}" (ID: ${l.id}): missing owner_email and owner_user_id — orphaned location record`);
        });
      }

      results.checks.push({
        name: 'Location Ownership Integrity',
        status: misownedLocs.length === 0 && noOwnerLocs.length === 0 ? 'passed' : 'warning',
        message: misownedLocs.length === 0 && noOwnerLocs.length === 0
          ? `All ${userLocations.length} user locations have correct scope and ownership`
          : `${misownedLocs.length} scope issue(s), ${noOwnerLocs.length} orphaned location(s) found`
      });
    }

    const totalIssues = results.issues_found.length;
    const totalFixes = results.fixes_applied.length;
    if (totalIssues === 0 && totalFixes === 0) {
      results.summary = `No location issues found across ${userChars.length} characters and ${allLocations.length} locations.`;
    } else if (totalFixes > 0) {
      results.summary = `Found ${totalIssues} issue(s), applied ${totalFixes} auto-fix(es).`;
    } else {
      results.summary = `Found ${totalIssues} location issue(s) — review details above.`;
    }

    return Response.json({ success: true, data: results });
  } catch (error) {
    console.error('[troubleshootLocations]', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});