/**
 * campusResidencyGuard — Canonical shared resolver for campus residency.
 *
 * This is the SINGLE SOURCE OF TRUTH for the rule:
 *   "Student enrollment does NOT equal campus residence."
 *
 * ALL image generation paths, sleep logic, home logic, and any other system
 * that needs to answer "Is this school location valid as this character's home/sleep/image location?"
 * MUST call this function rather than inline their own logic.
 *
 * Called via: base44.functions.invoke('campusResidencyGuard', { character_id, location_id, ... })
 *
 * CANONICAL RULE (enforced here):
 *   A school location is only valid as home/sleep/residence when ALL of:
 *     1. character has an active enrollment at that school location
 *     2. that enrollment record has lives_on_campus === true (EXPLICIT, not inferred)
 *     3. enrollment status is not 'dropped' or 'graduated'
 *
 *   Missing lives_on_campus → NOT a campus resident
 *   lives_on_campus = false → NOT a campus resident
 *   lives_on_campus = undefined/null → NOT a campus resident
 *   Enrollment alone → NOT a campus resident
 *   student_status='enrolled' alone → NOT a campus resident
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    // ── MODE: isExplicitCampusResident ────────────────────────────────────────
    // Query: { character_id, school_location_id }
    // Returns: { is_campus_resident: bool, reason: string, enrollment: object|null }
    if (body.mode === 'isExplicitCampusResident' || body.school_location_id) {
      const { character_id, school_location_id } = body;
      if (!character_id || !school_location_id) {
        return Response.json({ error: 'character_id and school_location_id required' }, { status: 400 });
      }

      const charList = await base44.entities.Character.filter({ id: character_id }, null, 1).catch(() => []);
      const char = charList?.[0];
      if (!char) {
        return Response.json({ error: 'Character not found', is_campus_resident: false }, { status: 404 });
      }

      const result = evaluateCampusResidency(char, school_location_id);
      return Response.json(result);
    }

    // ── MODE: resolveLocationWithSchoolGuard ──────────────────────────────────
    // Query: { character_id, candidate_location_id }
    // Returns: { location_id: string|null, rejected: bool, reason: string|null, home_location_id: string|null }
    if (body.mode === 'resolveLocationWithSchoolGuard' || body.candidate_location_id) {
      const { character_id, candidate_location_id } = body;
      if (!character_id || !candidate_location_id) {
        return Response.json({ error: 'character_id and candidate_location_id required' }, { status: 400 });
      }

      const charList = await base44.entities.Character.filter({ id: character_id }, null, 1).catch(() => []);
      const char = charList?.[0];
      if (!char) {
        return Response.json({ error: 'Character not found', location_id: candidate_location_id, rejected: false }, { status: 404 });
      }

      const schoolLocId = char.current_school_location_id || char.education_location_id || null;
      const homeLocId = char.current_home_location_id || char.home_location_id || null;

      // Not a school location — pass through unchanged
      if (!schoolLocId || candidate_location_id !== schoolLocId) {
        return Response.json({
          location_id: candidate_location_id,
          rejected: false,
          reason: null,
          home_location_id: homeLocId,
          school_location_id: schoolLocId,
          rule: 'not_a_school_location',
        });
      }

      const presenceStatus = char.resolved_presence_status || char.location_status || '';

      // Guard 1: not at school
      if (presenceStatus !== 'at_school') {
        return Response.json({
          location_id: homeLocId,
          rejected: true,
          reason: `school_id_rejected_presence_is_${presenceStatus || 'unknown'}`,
          home_location_id: homeLocId,
          school_location_id: schoolLocId,
          rule: 'rejected_not_at_school',
          presence_status: presenceStatus,
        });
      }

      // Guard 2: at school but not explicit campus resident
      const residencyResult = evaluateCampusResidency(char, schoolLocId);
      if (!residencyResult.is_campus_resident) {
        return Response.json({
          location_id: homeLocId,
          rejected: true,
          reason: 'school_id_rejected_not_campus_resident',
          home_location_id: homeLocId,
          school_location_id: schoolLocId,
          rule: 'rejected_lives_on_campus_not_true',
          residency_detail: residencyResult.reason,
          presence_status: presenceStatus,
        });
      }

      // Both guards passed
      return Response.json({
        location_id: candidate_location_id,
        rejected: false,
        reason: null,
        home_location_id: homeLocId,
        school_location_id: schoolLocId,
        rule: 'accepted_at_school_and_campus_resident',
        enrollment: residencyResult.enrollment,
        presence_status: presenceStatus,
      });
    }

    // ── MODE: fullAudit — diagnostic only ────────────────────────────────────
    // Query: { character_id }
    // Returns complete campus residency picture for a character
    if (body.mode === 'fullAudit' || (body.character_id && !body.school_location_id && !body.candidate_location_id)) {
      const { character_id } = body;
      if (!character_id) {
        return Response.json({ error: 'character_id required' }, { status: 400 });
      }

      const charList = await base44.entities.Character.filter({ id: character_id }, null, 1).catch(() => []);
      const char = charList?.[0];
      if (!char) {
        return Response.json({ error: 'Character not found' }, { status: 404 });
      }

      const schoolLocId = char.current_school_location_id || char.education_location_id || null;
      const homeLocId = char.current_home_location_id || char.home_location_id || null;
      const presenceStatus = char.resolved_presence_status || char.location_status || '';
      const enrollments = char.education_enrollments || [];

      const residencyResult = schoolLocId ? evaluateCampusResidency(char, schoolLocId) : null;

      return Response.json({
        character_id: char.id,
        character_name: char.name,
        student_status: char.student_status,
        school_location_id: schoolLocId,
        home_location_id: homeLocId,
        presence_status: presenceStatus,
        enrollment_count: enrollments.length,
        active_enrollments: enrollments.filter(e => e.status !== 'dropped' && e.status !== 'graduated'),
        campus_residency_evaluation: residencyResult,
        canonical_rule: 'enrollment_does_not_equal_residence',
        summary: residencyResult?.is_campus_resident
          ? `CAMPUS RESIDENT: ${char.name} has explicit lives_on_campus=true for school ${schoolLocId}`
          : `NOT CAMPUS RESIDENT: ${char.name} — home/sleep/image must resolve to ${homeLocId || 'assigned home'}, not school`,
      });
    }

    return Response.json({ error: 'Invalid request. Provide mode + required fields.' }, { status: 400 });

  } catch (error) {
    console.error('[campusResidencyGuard] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ── CORE EVALUATION LOGIC ─────────────────────────────────────────────────────
// This is the canonical guard. All modes call this function.
// The same logic is inlined in generateImageAsync and regenerateImageWithReason
// (Deno functions cannot import local files — they call this via invoke instead).

function evaluateCampusResidency(charRecord, schoolLocationId) {
  if (!charRecord || !schoolLocationId) {
    return {
      is_campus_resident: false,
      reason: 'missing_character_or_school_id',
      enrollment: null,
    };
  }

  const enrollments = charRecord.education_enrollments || [];

  if (enrollments.length === 0) {
    return {
      is_campus_resident: false,
      reason: 'no_enrollment_records',
      enrollment: null,
    };
  }

  const activeEnrollment = enrollments.find(e => {
    const matchesLocation =
      e.location_id === schoolLocationId ||
      e.in_person_location_id === schoolLocationId;
    if (!matchesLocation) return false;
    if (e.status === 'dropped' || e.status === 'graduated') return false;
    return true;
  });

  if (!activeEnrollment) {
    return {
      is_campus_resident: false,
      reason: 'no_active_enrollment_at_this_school',
      enrollment: null,
    };
  }

  // CRITICAL CANONICAL RULE:
  // lives_on_campus must be EXPLICITLY true.
  // undefined, null, false, missing → NOT a campus resident.
  // This is not a default. This is not inferred. It must be saved by the user.
  if (activeEnrollment.lives_on_campus !== true) {
    return {
      is_campus_resident: false,
      reason: `lives_on_campus_is_${activeEnrollment.lives_on_campus === false ? 'false' : 'missing_or_undefined'}_not_true`,
      enrollment: activeEnrollment,
    };
  }

  return {
    is_campus_resident: true,
    reason: 'lives_on_campus_explicitly_true',
    enrollment: activeEnrollment,
  };
}