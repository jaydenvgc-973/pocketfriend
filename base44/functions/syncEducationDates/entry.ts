/**
 * syncEducationDates
 *
 * Backfill + live sync for education date fields between:
 *   Character.education_enrollments[] / completed_education[]  (start_date, completion_date, course_name)
 *   LocationReference.enrolled_students[]                       (start_date, end_date, course_name)
 *
 * Direction: Character data is the source of truth for dates.
 * If the location student card is missing start_date or end_date but the Character has them,
 * this function copies them over.
 *
 * Can also be called with a specific character_id for targeted sync.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { character_id: targetCharId } = body;

    // Fetch characters to process
    let characters;
    if (targetCharId) {
      characters = await base44.entities.Character.filter({ id: targetCharId, owner_email: user.email });
    } else {
      characters = await base44.entities.Character.filter({ owner_email: user.email, status: 'active' });
    }

    if (!characters.length) return Response.json({ success: true, synced: 0, message: 'No characters found' });

    // Collect all unique location IDs we'll need to update
    const locationIdsToFetch = new Set();
    for (const char of characters) {
      const allEnrollments = [
        ...(char.education_enrollments || []),
        ...(char.completed_education || []),
      ];
      for (const e of allEnrollments) {
        const locId = e.location_id || e.in_person_location_id;
        if (locId) locationIdsToFetch.add(locId);
      }
      if (char.education_location_id) locationIdsToFetch.add(char.education_location_id);
      if (char.current_school_location_id) locationIdsToFetch.add(char.current_school_location_id);
    }

    // Fetch all relevant locations in one pass
    const locationMap = {};
    if (locationIdsToFetch.size > 0) {
      const locIds = [...locationIdsToFetch];
      // Fetch in batches of 20 to avoid payload limits
      for (let i = 0; i < locIds.length; i += 20) {
        const batch = locIds.slice(i, i + 20);
        const fetched = await base44.asServiceRole.entities.LocationReference.filter({ id: { $in: batch } });
        for (const loc of fetched) locationMap[loc.id] = loc;
      }
    }

    let synced = 0;
    const updates = []; // { location_id, enrolled_students }

    for (const char of characters) {
      // Build a merged list of all active enrollments with their dates
      const allEnrollments = [
        ...(char.education_enrollments || []).map(e => ({ ...e, _src: 'enrollments' })),
        ...(char.completed_education || []).filter(e => e.status === 'active' || e.status === 'enrolled').map(e => ({ ...e, _src: 'completed' })),
      ];

      for (const enrollment of allEnrollments) {
        const locId = enrollment.location_id || enrollment.in_person_location_id || char.education_location_id;
        if (!locId) continue;
        const loc = locationMap[locId];
        if (!loc) continue;

        const students = loc.enrolled_students || [];
        const studentIdx = students.findIndex(s => s.character_id === char.id && s.status === 'active');
        if (studentIdx === -1) continue;

        const student = students[studentIdx];
        const charStartDate = enrollment.start_date || null;
        const charEndDate = enrollment.completion_date || enrollment.end_date || null;
        const charCourseName = enrollment.course_name || enrollment.program_name || loc.name;
        const charEnrollDate = enrollment.enroll_date || null;

        // Only patch if location card is missing data that the character has
        const needsStartDate = !student.start_date && charStartDate;
        const needsEndDate = !student.end_date && charEndDate;
        const needsCourseName = !student.course_name && charCourseName;
        const needsEnrollDate = !student.enroll_date && charEnrollDate;

        if (!needsStartDate && !needsEndDate && !needsCourseName && !needsEnrollDate) continue;

        // Patch this student entry
        const patchedStudents = [...students];
        patchedStudents[studentIdx] = {
          ...student,
          ...(needsStartDate ? { start_date: charStartDate } : {}),
          ...(needsEndDate ? { end_date: charEndDate } : {}),
          ...(needsCourseName ? { course_name: charCourseName } : {}),
          ...(needsEnrollDate ? { enroll_date: charEnrollDate } : {}),
        };

        // Merge into the updates map (avoid writing the same location twice)
        const existing = updates.find(u => u.location_id === locId);
        if (existing) {
          existing.enrolled_students = patchedStudents;
        } else {
          updates.push({ location_id: locId, enrolled_students: patchedStudents });
          // Keep locationMap current for subsequent characters
          locationMap[locId] = { ...loc, enrolled_students: patchedStudents };
        }
        synced++;
      }
    }

    // Write all location updates
    await Promise.all(updates.map(u =>
      base44.asServiceRole.entities.LocationReference.update(u.location_id, { enrolled_students: u.enrolled_students })
    ));

    return Response.json({
      success: true,
      synced,
      locations_updated: updates.length,
      characters_checked: characters.length,
      message: `Synced education dates for ${synced} student record(s) across ${updates.length} location(s)`,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});