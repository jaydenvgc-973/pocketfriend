import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { character_id, character_name, location_id, scholarship_enabled } = await req.json();

    if (!character_id || !location_id) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get school location
    const locations = await base44.entities.LocationReference.filter({
      id: location_id
    });
    if (!locations[0]) {
      return Response.json({ error: 'School not found' }, { status: 404 });
    }
    const school = locations[0];

    // Verify it's an education location
    if (!['education', 'school'].includes(school.category)) {
      return Response.json({ error: 'Location is not a school' }, { status: 400 });
    }

    // Get character
    const chars = await base44.entities.Character.filter({
      id: character_id
    });
    if (!chars[0]) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }
    const character = chars[0];

    // Check if already enrolled
    const alreadyEnrolled = (school.enrolled_students || []).some(
      s => s.character_id === character_id && s.status === 'active'
    );
    if (alreadyEnrolled) {
      return Response.json({ error: 'Already enrolled in this school' }, { status: 400 });
    }

    // Calculate tuition amount
    let tuitionAmount = school.tuition_cost || 0;
    if (tuitionAmount > 0 && school.tuition_frequency === 'annual') {
      tuitionAmount = tuitionAmount / 12; // Monthly equivalent
    } else if (tuitionAmount > 0 && school.tuition_frequency === 'semester') {
      tuitionAmount = tuitionAmount / 6;
    }

    // Add to school's enrolled_students
    const updatedStudents = [
      ...(school.enrolled_students || []),
      {
        character_id,
        character_name: character_name || character.name,
        tuition_amount: tuitionAmount,
        scholarship_enabled: scholarship_enabled || false,
        enroll_date: new Date().toISOString(),
        status: 'active'
      }
    ];

    await base44.entities.LocationReference.update(school.id, {
      enrolled_students: updatedStudents
    });

    // Update character student_status
    await base44.entities.Character.update(character_id, {
      student_status: 'enrolled',
      education_location_id: location_id,
      education_location_name: school.name
    });

    // Add to character's education_enrollments
    const enrollment = {
      location_id,
      location_name: school.name,
      tuition_amount: tuitionAmount,
      scholarship_enabled: scholarship_enabled || false,
      enroll_date: new Date().toISOString(),
      status: 'active'
    };

    const updatedEnrollments = [
      ...(character.education_enrollments || []),
      enrollment
    ];

    await base44.entities.Character.update(character_id, {
      education_enrollments: updatedEnrollments
    });

    return Response.json({
      success: true,
      character_id,
      character_name: character.name,
      school_name: school.name,
      tuition_amount: tuitionAmount,
      scholarship_enabled: scholarship_enabled || false,
      message: `${character.name} enrolled in ${school.name}`
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});