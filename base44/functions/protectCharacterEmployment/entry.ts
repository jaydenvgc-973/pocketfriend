import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * protectCharacterEmployment — HARD AUTHORITY RULE
 *
 * Employment fields are AUTHORITATIVE DATA. Presence, travel, sleep, event cleanup,
 * graduation, and autonomous movement resolvers DO NOT have authority to clear them.
 *
 * This function:
 * 1. Audits all employment fields across all characters
 * 2. Detects mismatches (e.g. character on workplace roster but no occupation_location_id)
 * 3. Reports violations without auto-clearing either side
 * 4. Restores specifically-targeted character employment (Ethan Thompson)
 *
 * EMPLOYMENT CAN ONLY BE CHANGED BY:
 * - Explicit user employment assignment/removal (UI dashboard)
 * - Approved admin/dashboard data repair
 * - Explicit job termination logic (user-visible, auditable)
 *
 * NOT BY:
 * - Graduation cleanup
 * - Event cleanup
 * - Presence resolver
 * - Travel resolver
 * - Autonomous movement resolver
 * - Stale state cleanup
 * - Sleep/wake resolver
 * - Cache rebuild
 */

const EMPLOYMENT_FIELDS = [
  'occupation_location_id',
  'current_work_location_id',
  'additional_occupation_locations',
  'work_start_time',
  'work_end_time',
  'work_days',
  'occupation',
  'job_title',
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { dry_run = true, target_character_name = null, owner_email = user.email } = body;

    const report = {
      timestamp: new Date().toISOString(),
      owner_email,
      dry_run,
      characters_audited: 0,
      violations_found: 0,
      repairs_made: 0,
      mismatches: [],
      repairs: [],
      ethan_forensic: null,
    };

    // ── LOAD ALL ACTIVE CHARACTERS ─────────────────────────────────────────
    // Load by owner_email scoped to the authenticated user
    let characters = [];
    try {
      characters = await base44.entities.Character.filter({
        owner_email,
        status: 'active',
      }, null, 300);
    } catch {
      characters = await base44.asServiceRole.entities.Character.filter({
        status: 'active',
      }, null, 300).then(all => all.filter(c => c.owner_email === owner_email));
    }

    // ── LOAD ALL LOCATIONS ─────────────────────────────────────────────────
    let locations = [];
    try {
      locations = await base44.entities.LocationReference.filter({
        owner_email,
      }, null, 500);
    } catch {
      locations = await base44.asServiceRole.entities.LocationReference.filter({
        owner_email,
      }, null, 500);
    }
    const locationMap = {};
    for (const loc of locations) locationMap[loc.id] = loc;

    report.characters_audited = characters.length;

    // ── AUDIT: DETECT EMPLOYMENT-ROSTER MISMATCHES ─────────────────────────
    for (const char of characters) {
      const mismatches = [];

      // Check: character has occupation_location_id but not on workplace roster
      const occLocId = char.occupation_location_id || char.current_work_location_id;
      if (occLocId && locationMap[occLocId]) {
        const workplace = locationMap[occLocId];
        const onRoster = (workplace.worker_character_ids || []).includes(char.id);
        if (!onRoster) {
          mismatches.push({
            type: 'character_has_work_but_not_on_roster',
            character_id: char.id,
            character_name: char.name,
            occupation_location_id: occLocId,
            workplace_name: workplace.name,
            severity: 'medium',
          });
        }
      }

      // Check: character is on workplace roster but has no occupation_location_id
      if (!occLocId) {
        for (const loc of locations) {
          if ((loc.worker_character_ids || []).includes(char.id)) {
            mismatches.push({
              type: 'on_roster_but_no_occupation_link',
              character_id: char.id,
              character_name: char.name,
              workplace_id: loc.id,
              workplace_name: loc.name,
              severity: 'high',
            });

            // Auto-repair: restore the link
            if (!dry_run) {
              await base44.asServiceRole.entities.Character.update(char.id, {
                occupation_location_id: loc.id,
                occupation_location_name: loc.name,
                current_work_location_id: loc.id,
              });
            }
            report.repairs_made++;
            report.repairs.push({
              character: char.name,
              action: 'restore_occupation_link_from_roster',
              workplace: loc.name,
              workplace_id: loc.id,
            });
          }
        }
      }

      // Check: presence_stay_lock without valid reason
      if (char.presence_stay_lock === true) {
        mismatches.push({
          type: 'presence_stay_lock_active',
          character_id: char.id,
          character_name: char.name,
          lock_location_id: char.presence_stay_lock_location_id,
          set_at: char.presence_stay_lock_set_at,
          severity: 'high',
        });

        // Clear invalid stay lock if character has a job and was locked silently
        if (occLocId && !dry_run) {
          await base44.asServiceRole.entities.Character.update(char.id, {
            presence_stay_lock: false,
            presence_stay_lock_location_id: null,
            presence_stay_lock_set_at: null,
          });
          report.repairs_made++;
          report.repairs.push({
            character: char.name,
            action: 'clear_invalid_presence_stay_lock',
            reason: 'character_has_employment',
          });
        }
      }

      if (mismatches.length > 0) {
        report.violations_found += mismatches.length;
        report.mismatches.push(...mismatches);
      }
    }

    // ── ETHAN THOMPSON FORENSIC ────────────────────────────────────────────
    if (target_character_name) {
      const ethan = characters.find(c =>
        c.name?.toLowerCase().includes(target_character_name.toLowerCase())
      );

      if (ethan) {
        report.ethan_forensic = {
          character_id: ethan.id,
          character_name: ethan.name,
          occupation_location_id: ethan.occupation_location_id || null,
          current_work_location_id: ethan.current_work_location_id || null,
          additional_occupation_locations: ethan.additional_occupation_locations || [],
          work_start_time: ethan.work_start_time || null,
          work_end_time: ethan.work_end_time || null,
          work_days: ethan.work_days || null,
          presence_stay_lock: ethan.presence_stay_lock || false,
          presence_stay_lock_location_id: ethan.presence_stay_lock_location_id || null,
          presence_stay_lock_set_at: ethan.presence_stay_lock_set_at || null,
          resolved_presence_status: ethan.resolved_presence_status || null,
          resolved_current_location_id: ethan.resolved_current_location_id || null,
          student_status: ethan.student_status || null,
          education_location_id: ethan.education_location_id || null,
        };

        // Find any workplace that lists Ethan
        const workplacesWithEthan = locations.filter(l =>
          (l.worker_character_ids || []).includes(ethan.id)
        );
        report.ethan_forensic.workplaces_listing_character = workplacesWithEthan.map(w => ({
          id: w.id,
          name: w.name,
          category: w.category,
          worker_shift: w.worker_shifts?.[ethan.id] || null,
        }));

        // If Ethan has no occupation but is on a workplace roster, restore the link
        if (!ethan.occupation_location_id && workplacesWithEthan.length > 0 && !dry_run) {
          const primaryWorkplace = workplacesWithEthan[0];
          await base44.asServiceRole.entities.Character.update(ethan.id, {
            occupation_location_id: primaryWorkplace.id,
            occupation_location_name: primaryWorkplace.name,
            current_work_location_id: primaryWorkplace.id,
            presence_stay_lock: false,
            presence_stay_lock_location_id: null,
          });
          report.repairs_made++;
          report.repairs.push({
            character: ethan.name,
            action: 'restore_ethan_employment_from_roster',
            workplace: primaryWorkplace.name,
          });
          report.ethan_forensic.restored = true;
          report.ethan_forensic.restored_workplace = primaryWorkplace.name;
        }
      }
    }

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});