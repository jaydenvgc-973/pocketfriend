/**
 * UNIFIED EDUCATION ENROLLMENT
 * Supports three enrollment types:
 *   full_school   → character enrolled at a school (tuition + schedule)
 *   course        → standalone modular course (may or may not be location-tied)
 *   certification → skill/career cert (usually one-time cost or free, on-demand)
 *
 * Three learning modes:
 *   in_person         → tied to a real location + schedule, character must travel
 *   remote_scheduled  → tied to a schedule, NOT a location
 *   on_demand         → no fixed schedule, no location requirement, anytime/anywhere
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      character_id,
      // Enrollment type: 'full_school' | 'course' | 'certification'
      enrollment_type = 'course',
      // Learning mode: 'in_person' | 'remote_scheduled' | 'on_demand'
      mode = 'on_demand',
      // For full_school + in_person course: school/location ID
      location_id,
      // Course / cert metadata
      course_name,
      institution,
      // Cost (one-time for courses/certs; monthly for full_school)
      cost = 0,
      scholarship_enabled = false,
      // Campus residency — only valid for college/university (residential school types)
      lives_on_campus = false,
      // Duration
      start_date,
      expected_completion_date,
      // Schedule (for in_person and remote_scheduled)
      // { days: [0-6], start_time: "HH:MM", end_time: "HH:MM" }
      schedule,
      // What completing this unlocks
      rewards,
      // Initial progress %
      initial_progress = 0,
    } = body;

    if (!character_id || !course_name) {
      return Response.json({ error: 'character_id and course_name are required' }, { status: 400 });
    }

    const chars = await base44.entities.Character.filter({ id: character_id });
    if (!chars[0]) return Response.json({ error: 'Character not found' }, { status: 404 });
    const character = chars[0];

    // If full_school or in_person → validate + enroll in location
    let school = null;
    let tuitionAmount = cost;

    if (enrollment_type === 'full_school' && location_id) {
      const locs = await base44.entities.LocationReference.filter({ id: location_id });
      if (!locs[0]) return Response.json({ error: 'School location not found' }, { status: 404 });
      school = locs[0];

      const schoolCategories = ['education', 'school', 'community', 'generic'];
      if (school.category && !schoolCategories.includes(school.category)) {
        return Response.json({ error: `Location category "${school.category}" is not a school type` }, { status: 400 });
      }

      const alreadyEnrolled = (school.enrolled_students || []).some(
        s => s.character_id === character_id && s.status === 'active'
      );
      if (alreadyEnrolled) {
        return Response.json({ error: 'Already enrolled in this school' }, { status: 400 });
      }

      // Calculate tuition
      if (!cost && school.tuition_cost > 0) {
        tuitionAmount = school.tuition_cost;
        if (school.tuition_frequency === 'annual') tuitionAmount = tuitionAmount / 12;
        else if (school.tuition_frequency === 'semester') tuitionAmount = tuitionAmount / 6;
      }

      // SCHOOL TYPE RESIDENCY RULE:
      // Grammar school and high school are NON-RESIDENTIAL. Campus residency is impossible.
      // College/university may support campus residency when explicitly selected.
      // Any other school type: campus residency not supported.
      const RESIDENTIAL_SCHOOL_TYPES = ['college', 'university', 'trade_school', 'other'];
      const isResidentialSchoolType = !school.school_type || RESIDENTIAL_SCHOOL_TYPES.includes(school.school_type);
      const effectiveLivesOnCampus = isResidentialSchoolType && (body.lives_on_campus === true);
      if (body.lives_on_campus === true && !isResidentialSchoolType) {
        console.warn(`[enrollCharacterInSchool] ⛔ campus residency rejected: school_type="${school.school_type}" is non-residential. lives_on_campus forced to false.`);
      }

      // Update school enrolled_students — include all date + program fields so location card stays in sync
      const enrollNow = new Date().toISOString();
      const updatedStudents = [
        ...(school.enrolled_students || []),
        {
          character_id,
          character_name: character.name,
          tuition_amount: tuitionAmount,
          scholarship_enabled,
          enroll_date: enrollNow,
          start_date: start_date || null,
          end_date: expected_completion_date || null,
          course_name: course_name?.trim() || school.name,
          enrollment_type,
          lives_on_campus: effectiveLivesOnCampus,
          status: 'active',
        }
      ];
      await base44.entities.LocationReference.update(school.id, { enrolled_students: updatedStudents });

      // Update character top-level student fields
      await base44.entities.Character.update(character_id, {
        student_status: 'enrolled',
        education_location_id: location_id,
        education_location_name: school.name,
        current_school_location_id: location_id,
      });

      // Update education_enrollments — MUST include lives_on_campus so campusResidencyGuard reads it correctly.
      // lives_on_campus is only ever true for college/university (residential school types).
      const updatedEnrollments = [
        ...(character.education_enrollments || []),
        {
          location_id,
          location_name: school.name,
          tuition_amount: tuitionAmount,
          scholarship_enabled,
          enroll_date: new Date().toISOString(),
          lives_on_campus: effectiveLivesOnCampus,
          status: 'active',
        }
      ];
      await base44.entities.Character.update(character_id, { education_enrollments: updatedEnrollments });
    }

    // Build the education item — this goes into completed_education array
    // (items with completion_date in future = "in progress"; past = "completed")
    const now = new Date();
    const startDate = start_date || now.toISOString();
    // Default duration: certification=90d, course=180d, full_school=365d
    let defaultDays = enrollment_type === 'certification' ? 90 : enrollment_type === 'course' ? 180 : 365;
    const completionDate = expected_completion_date || new Date(now.getTime() + defaultDays * 86400000).toISOString();

    const educationEntry = {
      course_name: course_name.trim(),
      institution: institution || school?.name || '',
      enrollment_type,   // full_school | course | certification
      mode,              // in_person | remote_scheduled | on_demand
      location_id: location_id || null,
      location_name: school?.name || null,
      cost: scholarship_enabled ? 0 : tuitionAmount,
      scholarship_enabled,
      schedule: schedule || null, // { days, start_time, end_time }
      start_date: startDate,
      completion_date: completionDate,
      status: 'active',
      progress: initial_progress,
      rewards: rewards || null, // e.g. { career_qualifications: [], income_boost: 0, skill_tags: [] }
    };

    const updatedCompleted = [...(character.completed_education || []), educationEntry];
    await base44.entities.Character.update(character_id, { completed_education: updatedCompleted });

    // Deduct one-time cost for courses / certs immediately
    const shouldChargeNow = (enrollment_type === 'course' || enrollment_type === 'certification') && tuitionAmount > 0 && !scholarship_enabled;
    if (shouldChargeNow) {
      const financials = await base44.entities.CharacterFinancial.filter({ character_id });
      if (financials[0]) {
        const newBalance = financials[0].current_balance - tuitionAmount;
        await base44.entities.CharacterFinancial.update(financials[0].id, {
          current_balance: newBalance,
          total_expenses: (financials[0].total_expenses || 0) + tuitionAmount,
        });
        await base44.entities.FinancialTransaction.create({
          character_id,
          character_name: character.name,
          sender_id: character_id,
          sender_type: 'character',
          sender_name: character.name,
          receiver_id: 'system',
          receiver_type: 'system',
          receiver_name: institution || 'Education',
          amount: tuitionAmount,
          direction: 'expense',
          transaction_type: 'tuition',
          description: `Enrollment fee: ${course_name}`,
          balance_after: newBalance,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return Response.json({
      success: true,
      character_id,
      character_name: character.name,
      course_name,
      enrollment_type,
      mode,
      cost: tuitionAmount,
      scholarship_enabled,
      start_date: startDate,
      expected_completion_date: completionDate,
      schedule: schedule || null,
      message: `${character.name} enrolled in ${course_name} (${mode} ${enrollment_type})`,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});