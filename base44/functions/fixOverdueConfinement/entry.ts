/**
 * fixOverdueConfinement
 *
 * Finds characters with overdue jail sentences and releases them.
 *
 * Rules:
 * - If jail_release_date exists and is in the past → release
 * - If jail_sentence_days + jailed_at gives a past date → release
 * - If release day has passed with no exact time → release at end of that day
 * - If no release date or sentence length → flag for manual review, do NOT release
 *
 * dry_run=true → diagnose only, no writes
 * dry_run=false → apply releases
 *
 * Returns full proof for each character: booked_date, sentence_days,
 * calculated_release_date, current_time, release_overdue, action_taken.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { dry_run = true } = await req.json().catch(() => ({}));
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const nowMs = nowET.getTime();

    // Load all jailed characters for this owner
    const jailed = await base44.entities.Character.filter(
      { owner_email: user.email, is_jailed: true },
      null,
      100
    );

    const report = [];
    const released = [];
    const needsManualReview = [];

    for (const char of jailed) {
      const proof = {
        character_id: char.id,
        character_name: char.name,
        booked_date: char.jailed_at || null,
        sentence_days: char.jail_sentence_days || null,
        stored_release_date: char.jail_release_date || null,
        incarceration_status: char.incarceration_status || null,
        current_time_et: nowET.toISOString(),
        release_overdue: false,
        calculated_release_date: null,
        action_taken: 'none',
        reason: null,
      };

      // ── DETERMINE RELEASE DATE ────────────────────────────────────────────
      let releaseDateMs = null;

      // Priority 1: explicit jail_release_date
      if (char.jail_release_date) {
        releaseDateMs = new Date(char.jail_release_date).getTime();
        proof.calculated_release_date = char.jail_release_date;
        proof.release_date_source = 'jail_release_date';
      }
      // Priority 2: jailed_at + jail_sentence_days
      else if (char.jailed_at && char.jail_sentence_days) {
        const jailedMs = new Date(char.jailed_at).getTime();
        releaseDateMs = jailedMs + (char.jail_sentence_days * 24 * 60 * 60 * 1000);
        proof.calculated_release_date = new Date(releaseDateMs).toISOString();
        proof.release_date_source = 'jailed_at + sentence_days';
      }

      if (releaseDateMs === null) {
        // No release date determinable — do NOT release, flag for manual review
        proof.action_taken = 'flagged_manual_review';
        proof.reason = 'No jail_release_date or jailed_at+sentence_days — cannot determine release. Manual release required.';
        needsManualReview.push(proof);
        report.push(proof);
        continue;
      }

      // ── CHECK IF OVERDUE ──────────────────────────────────────────────────
      // Allow same-day release: if release day has passed entirely (past 23:59 of release day),
      // or if releaseDateMs is in the past
      const releaseDayEnd = (() => {
        const d = new Date(releaseDateMs);
        d.setHours(23, 59, 59, 999);
        return d.getTime();
      })();

      const isOverdue = nowMs > releaseDayEnd || nowMs > releaseDateMs;
      proof.release_overdue = isOverdue;
      proof.release_date_readable = new Date(releaseDateMs).toLocaleString('en-US', { timeZone: 'America/New_York' });

      if (!isOverdue) {
        proof.action_taken = 'none';
        proof.reason = `Sentence not yet complete. Release: ${proof.release_date_readable}`;
        report.push(proof);
        continue;
      }

      // ── RELEASE ───────────────────────────────────────────────────────────
      if (!dry_run) {
        const releasePayload = {
          is_jailed: false,
          incarceration_status: 'released',
          jail_release_date: new Date(releaseDateMs).toISOString(),
          resolved_presence_status: 'home',
          resolved_location_type: 'home',
          resolved_source_reason: 'sentence_complete_auto_release',
          resolved_last_updated_at: nowET.toISOString(),
          // Clear confinement fields
          incarceration_facility_id: null,
        };

        // Restore to home if available
        if (char.current_home_location_id) {
          releasePayload.resolved_current_location_id = char.current_home_location_id;
        }

        try {
          await base44.entities.Character.update(char.id, releasePayload);
          proof.action_taken = 'released';
          proof.reason = `Sentence complete. Released and returned home. Auto-release at ${nowET.toISOString()}.`;
          released.push(proof);

          // Log a LifeEvent for the release
          await base44.asServiceRole.entities.LifeEvent.create({
            character_id: char.id,
            character_name: char.name,
            event_type: 'major_life_event',
            valence: 'mixed',
            severity: 'major',
            title: 'Released from incarceration',
            description: `${char.name} was automatically released after completing their sentence (${char.jail_sentence_days || '?'} days). Booked: ${char.jailed_at || 'unknown'}.`,
            emotional_impact: 'Relief mixed with uncertainty about what comes next',
            triggered_by: 'system_auto_release',
            timestamp: nowET.toISOString(),
            systems_updated: ['presence', 'location'],
            context_tags: ['jail', 'release', 'auto_release'],
          }).catch(() => {});
        } catch (writeErr) {
          proof.action_taken = 'release_write_failed';
          proof.reason = `Write failed: ${writeErr.message}`;
        }
      } else {
        proof.action_taken = 'would_release';
        proof.reason = `Sentence complete (overdue by ${Math.round((nowMs - releaseDateMs) / 3600000)}h). Would be released on apply.`;
        released.push(proof);
      }

      report.push(proof);
    }

    const overdueCount = report.filter(r => r.release_overdue).length;
    const releasedCount = released.length;

    return Response.json({
      dry_run,
      owner_email: user.email,
      et_time: nowET.toISOString(),
      total_jailed: jailed.length,
      overdue_count: overdueCount,
      released_count: dry_run ? 0 : releasedCount,
      would_release_count: dry_run ? releasedCount : 0,
      needs_manual_review: needsManualReview.length,
      summary: dry_run
        ? `Diagnostic: ${jailed.length} jailed, ${overdueCount} overdue, ${needsManualReview.length} need manual review.`
        : `Released ${releasedCount} character(s). ${needsManualReview.length} need manual review.`,
      characters: report,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});