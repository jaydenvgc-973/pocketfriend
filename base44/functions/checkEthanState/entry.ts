import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const chars = await base44.entities.Character.filter({ created_by: user.email });
    const ethan = chars.find(c => c.name && c.name.toLowerCase().includes('ethan'));

    if (!ethan) {
      return Response.json({ error: 'Ethan not found' }, { status: 404 });
    }

    // Check EVERY location-related field
    const diagnostics = {
      id: ethan.id,
      name: ethan.name,
      status: ethan.status,
      locationFields: {
        current_home_location_id: ethan.current_home_location_id || 'NULL',
        current_work_location_id: ethan.current_work_location_id || 'NULL',
        current_school_location_id: ethan.current_school_location_id || 'NULL',
        current_location_id: ethan.current_location_id || 'NULL',
        occupation_location_id: ethan.occupation_location_id || 'NULL',
        education_location_id: ethan.education_location_id || 'NULL',
      },
      activityFields: {
        current_activity: ethan.current_activity || 'NULL',
        current_life_event: ethan.current_life_event || 'NULL',
        current_education_activity: ethan.current_education_activity || 'NULL',
        current_job_training_activity: ethan.current_job_training_activity || 'NULL',
      },
      scheduleFields: {
        sleep_start_time: ethan.sleep_start_time || 'NULL',
        wake_up_time: ethan.wake_up_time || 'NULL',
        work_start_time: ethan.work_start_time || 'NULL',
        work_end_time: ethan.work_end_time || 'NULL',
        work_days: ethan.work_days || [],
      },
      systemFields: {
        system_prompt: ethan.system_prompt ? 'SET' : 'NULL',
        profile_summary: ethan.profile_summary ? 'SET' : 'NULL',
        emotional_state: ethan.emotional_state || 'NULL',
      },
    };

    // Find all NULLs
    const nulls = [];
    Object.entries(diagnostics.locationFields).forEach(([k, v]) => {
      if (v === 'NULL') nulls.push(`location: ${k}`);
    });
    Object.entries(diagnostics.activityFields).forEach(([k, v]) => {
      if (v === 'NULL') nulls.push(`activity: ${k}`);
    });

    return Response.json({
      timestamp: new Date().toISOString(),
      diagnostics,
      nullCount: nulls.length,
      nullFields: nulls,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});