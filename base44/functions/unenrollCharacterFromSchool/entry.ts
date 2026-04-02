import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { character_id, location_id, reason } = await req.json();

    if (!character_id || !location_id) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get school
    const locations = await base44.entities.LocationReference.filter({
      id: location_id
    });
    if (!locations[0]) {
      return Response.json({ error: 'School not found' }, { status: 404 });
    }
    const school = locations[0];

    // Find and update student
    const students = (school.enrolled_students || []).map(s =>
      s.character_id === character_id
        ? { ...s, status: reason === 'graduated' ? 'graduated' : 'dropped' }
        : s
    );

    await base44.entities.LocationReference.update(school.id, {
      enrolled_students: students
    });

    // Update character
    const chars = await base44.entities.Character.filter({
      id: character_id
    });
    if (chars[0]) {
      const enrollments = (chars[0].education_enrollments || []).map(e =>
        e.location_id === location_id
          ? { ...e, status: reason === 'graduated' ? 'graduated' : 'dropped' }
          : e
      );

      // Check if character has other active enrollments
      const hasOtherEnrollments = enrollments.some(e => e.status === 'active');

      await base44.entities.Character.update(character_id, {
        education_enrollments: enrollments,
        student_status: hasOtherEnrollments ? 'enrolled' : 'not_student',
        education_location_id: hasOtherEnrollments ? chars[0].education_location_id : null,
        education_location_name: hasOtherEnrollments ? chars[0].education_location_name : null
      });
    }

    return Response.json({
      success: true,
      character_id,
      school_name: school.name,
      action: reason || 'dropped',
      message: `${chars[0]?.name} ${reason === 'graduated' ? 'graduated from' : 'dropped out of'} ${school.name}`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});