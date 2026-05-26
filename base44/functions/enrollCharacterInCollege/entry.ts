import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Enrolls a character into a college/university school location.
 * 
 * - Creates education enrollment entry
 * - Sets default schedule (Mon-Fri 9-5 if no conflicts)
 * - Adds character to location enrolled_students
 * - Optionally sets campus residency
 * - Checks for schedule conflicts
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      character_id,
      location_id,
      program_name,
      institution,
      expected_graduation_date,
      lives_on_campus = false,
      custom_schedule = null,
    } = await req.json();

    if (!character_id || !location_id) {
      return Response.json({ error: 'character_id and location_id required' }, { status: 400 });
    }

    // Fetch character and location
    const character = await base44.entities.Character.filter({ id: character_id }).then(r => r[0]);
    const location = await base44.entities.LocationReference.filter({ id: location_id }).then(r => r[0]);

    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });
    if (!location) return Response.json({ error: 'Location not found' }, { status: 404 });

    // Check conflicts with proposed schedule
    const proposedSchedule = custom_schedule || {
      start_time: '09:00',
      end_time: '17:00',
      days: [1, 2, 3, 4, 5], // Mon-Fri
    };

    // Detect existing conflicts (ignore this location since we're enrolling there)
    const conflictCheck = await base44.functions.invoke('detectScheduleConflicts', {
      character_id,
      ignore_location_id: location_id,
    }).catch(() => ({ conflicts: [] }));

    const hasConflicts = conflictCheck.conflicts && conflictCheck.conflicts.length > 0;

    // Create enrollment entry
    const newEnrollment = {
      course_name: program_name || location.name,
      program_name: program_name || location.name,
      institution: institution || location.name,
      in_person_location_id: location_id,
      in_person_location_name: location.name,
      mode: 'in_person',
      status: 'current',
      start_date: new Date().toISOString(),
      completion_date: expected_graduation_date || null,
      schedule: proposedSchedule,
      must_attend: true,
    };

    // Update character education_enrollments
    const currentEnrollments = character.education_enrollments || [];
    const updatedEnrollments = [...currentEnrollments, newEnrollment];

    await base44.entities.Character.update(character_id, {
      education_enrollments: updatedEnrollments,
      education_location_id: location_id,
      education_location_name: location.name,
      student_status: 'enrolled',
    });

    // Add to location enrolled_students
    const enrolledStudents = location.enrolled_students || [];
    const studentExists = enrolledStudents.some(s => s.character_id === character_id);
    
    if (!studentExists) {
      enrolledStudents.push({
        character_id,
        character_name: character.name,
        tuition_amount: location.tuition_cost || 0,
        scholarship_enabled: false,
        enroll_date: new Date().toISOString(),
        status: 'active',
      });

      await base44.entities.LocationReference.update(location_id, {
        enrolled_students: enrolledStudents,
      });
    }

    // Handle campus residency
    let residencyUpdated = false;
    if (lives_on_campus && location.school_type === 'college' || location.school_type === 'university') {
      const residents = location.residents || [];
      const residentExists = residents.some(r => r.character_id === character_id);

      if (!residentExists) {
        residents.push({
          character_id,
          character_name: character.name,
          avatar_url: character.avatar_url || character.image_avatar_url,
          moved_in_date: new Date().toISOString(),
        });

        await base44.entities.LocationReference.update(location_id, { residents });

        // Update character home location
        await base44.entities.Character.update(character_id, {
          current_home_location_id: location_id,
          resolved_current_location_id: location_id,
          resolved_current_location_name: location.name,
        });

        residencyUpdated = true;
      }
    }

    return Response.json({
      success: true,
      character_id,
      location_id,
      enrollment: newEnrollment,
      conflicts_detected: hasConflicts,
      conflict_details: conflictCheck.conflicts || [],
      campus_residency_set: residencyUpdated,
      message: hasConflicts 
        ? 'Enrolled with schedule conflicts detected - review and adjust schedule if needed'
        : 'Successfully enrolled',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});