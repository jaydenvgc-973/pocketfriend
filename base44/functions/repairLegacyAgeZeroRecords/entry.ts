import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * repairLegacyAgeZeroRecords
 *
 * Conservative one-pass audit for blank/null/zero age fields.
 *
 * RULE 1 — Blank/missing age:
 *   Any character with age === undefined, null, "", or whitespace-only string
 *   → set to 21. No conditions, no exceptions.
 *
 * RULE 2 — Existing age: 0 or "0":
 *   Treat as suspicious legacy coercion unless structured proof exists.
 *   Structured proof (checked in order of reliability):
 *     A. birthday field resolves mathematically to age 0 (born within the last year)
 *     B. age_intentionally_zero === true  (explicit opt-in flag set after this fix)
 *     C. Active enrollment in a daycare/preschool school type
 *   Counter-evidence that overrides A–C:
 *     X. Character has a work location (infants cannot hold jobs)
 *   If no proof, or if counter-evidence applies → set to 21.
 *
 * WHAT THIS DOES NOT DO:
 *   - Does not search name, backstory, bio, avatar_description_text, or any text field
 *   - Does not use Number(""), loose coercion, or truthy/falsy checks on age
 *   - Does not lock the age field after repair
 *   - Does not prevent a user from later saving a legitimate age: 0 newborn
 *
 * All writes use service-role to ensure RLS does not block the repair pass.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const body = await req.json().catch(() => ({}));

    // dry_run defaults to true — must explicitly pass dry_run: false to write
    const dryRun = body.dry_run !== false;

    // Write pass requires explicit confirmation token to prevent accidental execution
    const confirmed = body.confirm === 'RUN_LEGACY_AGE_REPAIR';

    if (!dryRun && !confirmed) {
      return Response.json({
        success: false,
        error: 'Confirmation token required to execute write pass.',
        required_confirm: 'RUN_LEGACY_AGE_REPAIR',
        hint: 'Pass { "dry_run": false, "confirm": "RUN_LEGACY_AGE_REPAIR" } to execute writes.',
      }, { status: 400 });
    }

    // Load all non-deleted characters across all accounts (service role)
    const allCharacters = await base44.asServiceRole.entities.Character.filter({
      status: { $in: ['active', 'on_break'] }
    }, '-created_date', 2000);

    // Current date in Eastern Time for birthday math
    // Use explicit ET conversion: UTC offset is -4 (EDT) or -5 (EST)
    const nowUTC = new Date();
    const etOffsetMs = (() => {
      // Determine whether Eastern is currently EDT (-4) or EST (-5)
      // Use Intl to get the correct offset
      const etStr = nowUTC.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
      const etDate = new Date(etStr);
      return nowUTC.getTime() - etDate.getTime();
    })();
    const nowET = new Date(nowUTC.getTime() - etOffsetMs);

    const report = {
      dry_run: dryRun,
      scanned: 0,
      rule1_blank_fixed: [],       // blank/null/undefined/empty-string → 21
      rule2_zero_confirmed: [],    // age: 0 with valid structured proof → left alone
      rule2_zero_repaired: [],     // age: 0 with no proof → 21
      errors: [],
    };

    const writes = [];

    for (const char of allCharacters) {
      report.scanned++;
      const rawAge = char.age;

      // ── RULE 1: Blank / missing / empty-string age ────────────────────────
      // Strict type checks — no coercion, no falsy shortcuts
      const isMissing = (
        rawAge === undefined ||
        rawAge === null ||
        (typeof rawAge === 'string' && rawAge.trim() === '')
      );

      if (isMissing) {
        report.rule1_blank_fixed.push({
          id: char.id,
          name: char.name,
          owner_email: char.owner_email || char.created_by,
          raw_age_value: rawAge,
          action: 'set_to_21',
        });
        if (!dryRun) {
          writes.push(
            base44.asServiceRole.entities.Character.update(char.id, { age: 21 })
          );
        }
        continue;
      }

      // ── RULE 2: Existing 0 or "0" ─────────────────────────────────────────
      // Compare strictly — do not use Number() coercion
      const isZero = (rawAge === 0 || rawAge === '0');

      if (!isZero) {
        // Not missing, not zero — nothing to do
        continue;
      }

      // --- Check for structured proof of intentional infancy ---

      let proofReason = null;

      // Proof A: birthday field resolves mathematically to age 0 in Eastern Time
      if (!proofReason && char.birthday) {
        const birthDate = new Date(char.birthday);
        if (!isNaN(birthDate.getTime())) {
          let computedAge = nowET.getFullYear() - birthDate.getFullYear();
          const monthDiff = nowET.getMonth() - birthDate.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && nowET.getDate() < birthDate.getDate())) {
            computedAge--;
          }
          if (computedAge === 0) {
            proofReason = `birthday_math: born ${char.birthday}, computed age = 0 (Eastern Time)`;
          }
        }
      }

      // Proof B: explicit opt-in flag — only trusted if set after this fix is deployed
      if (!proofReason && char.age_intentionally_zero === true) {
        proofReason = 'age_intentionally_zero_flag';
      }

      // Proof C: active enrollment in daycare/preschool (structured education record)
      if (!proofReason && Array.isArray(char.education_enrollments)) {
        const hasDaycareEnrollment = char.education_enrollments.some(e =>
          e.status === 'active' && e.school_type === 'daycare_preschool'
        );
        if (hasDaycareEnrollment) {
          proofReason = 'active_daycare_enrollment';
        }
      }

      // --- Counter-evidence: adult-only commitments override all proof ---
      // An infant cannot hold a job. If a work location is set, treat as coerced adult.
      const hasWorkLocation = !!(char.current_work_location_id || char.occupation_location_id);
      if (hasWorkLocation && proofReason) {
        proofReason = null; // Counter-evidence wins
      }

      if (proofReason) {
        // Confirmed infant — leave age: 0 untouched
        report.rule2_zero_confirmed.push({
          id: char.id,
          name: char.name,
          owner_email: char.owner_email || char.created_by,
          proof: proofReason,
          action: 'left_at_zero',
        });
      } else {
        // No structured proof — conservative repair to 21
        report.rule2_zero_repaired.push({
          id: char.id,
          name: char.name,
          owner_email: char.owner_email || char.created_by,
          raw_age_value: rawAge,
          action: 'set_to_21',
        });
        if (!dryRun) {
          writes.push(
            base44.asServiceRole.entities.Character.update(char.id, { age: 21 })
          );
        }
      }
    }

    // Execute all writes in parallel
    if (writes.length > 0) {
      const results = await Promise.allSettled(writes);
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          report.errors.push(`Write failed at index ${i}: ${r.reason?.message || r.reason}`);
        }
      });
    }

    const totalRepaired = report.rule1_blank_fixed.length + report.rule2_zero_repaired.length;

    return Response.json({
      success: true,
      dry_run: dryRun,
      summary: dryRun
        ? `DRY RUN — would repair ${totalRepaired} record(s) across ${report.scanned} scanned.`
        : `Repaired ${totalRepaired} record(s) across ${report.scanned} scanned.`,
      total_scanned: report.scanned,
      total_repaired: totalRepaired,
      rule1_blank_repaired: report.rule1_blank_fixed.length,
      rule2_zero_repaired: report.rule2_zero_repaired.length,
      rule2_zero_confirmed_infants: report.rule2_zero_confirmed.length,
      errors: report.errors,
      details: report,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});