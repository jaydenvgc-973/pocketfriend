import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Handles education completion/graduation:
 * - Moves enrollment from active to completed
 * - Removes campus residency if applicable
 * - Marks credentials as earned
 * - Keeps completed education permanently visible
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { character_id, location_id, enrollment_index } = await req.json();

    if (!character_id || location_id === undefined || enrollment_index === undefined) {
      return Response.json({ error: 'character_id, location_id, and enrollment_index required' }, { status: 400 });
    }

    const character = await base44.entities.Character.filter({ id: character_id }).then(r => r[0]);
    const location = await base44.entities.LocationReference.filter({ id: location_id }).then(r => r[0]);

    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });
    if (!location) return Response.json({ error: 'Location not found' }, { status: 404 });

    // Move enrollment to completed
    const enrollments = character.education_enrollments || [];
    const completedEdu = character.completed_education || [];

    if (enrollment_index < 0 || enrollment_index >= enrollments.length) {
      return Response.json({ error: 'Invalid enrollment_index' }, { status: 400 });
    }

    const enrollment = enrollments[enrollment_index];
    const completedEntry = {
      ...enrollment,
      status: 'graduated',
      completion_date: new Date().toISOString(),
    };

    // Remove from active, add to completed
    const updatedEnrollments = enrollments.filter((_, i) => i !== enrollment_index);
    const updatedCompleted = [...completedEdu, completedEntry];

    // Remove from enrolled_students
    const updatedEnrolledStudents = (location.enrolled_students || []).filter(s => s.character_id !== character_id);

    // Handle campus residency removal only if this character had residency at this school
    let residencyRemoved = false;
    const updatedResidents = (location.residents || []).filter(r => {
      if (r.character_id === character_id && character.current_home_location_id === location_id) {
        residencyRemoved = true;
        return false;
      }
      return true;
    });

    // Update character
    await base44.entities.Character.update(character_id, {
      education_enrollments: updatedEnrollments,
      completed_education: updatedCompleted,
      student_status: updatedEnrollments.length === 0 ? 'graduated' : 'enrolled',
      current_home_location_id: residencyRemoved ? null : character.current_home_location_id,
    });

    // Update location
    await base44.entities.LocationReference.update(location_id, {
      enrolled_students: updatedEnrolledStudents,
      residents: updatedResidents,
    });

    return Response.json({
      success: true,
      character_id,
      location_id,
      completed_credential: completedEntry,
      campus_residency_removed: residencyRemoved,
      remaining_enrollments: updatedEnrollments.length,
      message: `${enrollment.course_name || enrollment.program_name} completion recorded. Credential remains visible on profile.`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});