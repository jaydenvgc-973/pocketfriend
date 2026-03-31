/**
 * updateCharacterLifeContext
 *
 * Intelligence layer for the autonomy system.
 * Called after life events to keep character card fields accurate:
 * - new job → updates work_details, work schedule, current_activity
 * - signed up for class → updates education fields
 * - doctor/surgery/appointment → schedules that as a ScheduledEvent + updates health_status
 * - location visit (gym, coffee shop, etc.) → updates current_activity
 * - job training → updates job_training fields
 *
 * This NEVER blanks out existing data — it only enriches it.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { character_id, event_type, event_description, conversation_id } = body;

    if (!character_id || !event_description) {
      return Response.json({ error: 'character_id and event_description required' }, { status: 400 });
    }

    const character = await base44.asServiceRole.entities.Character.get(character_id);
    if (!character) return Response.json({ error: 'Character not found' }, { status: 404 });

    const now = new Date();

    // Ask the LLM to extract structured life context from the event
    const analysisPrompt = `You are analyzing a life event for a fictional character to extract structured updates for their profile.

CHARACTER: ${character.name}
Current job: ${character.work_details?.job_title || 'unknown'} at ${character.work_details?.workplace_type || 'unknown'}
Current work schedule: ${character.work_start_time || '09:00'} - ${character.work_end_time || '17:00'}, days ${(character.work_days || [1,2,3,4,5]).join(',')}
Current education: ${character.current_education_activity || 'none'}
Current job training: ${character.current_job_training_activity || 'none'}
Current location/city: ${[character.city, character.state].filter(Boolean).join(', ') || 'unknown'}
Current health status: ${character.health_status || 'healthy'}

EVENT TYPE: ${event_type || 'general'}
EVENT DESCRIPTION: ${event_description}
CURRENT DATE/TIME: ${now.toISOString()}

Analyze the event and determine what structured updates are needed. Return a JSON object:
{
  "updates_needed": boolean,
  "work_details_update": {
    "apply": boolean,
    "job_title": string or null,
    "workplace_type": string or null,
    "work_environment": string or null
  },
  "work_schedule_update": {
    "apply": boolean,
    "work_start_time": string or null (HH:MM 24h),
    "work_end_time": string or null (HH:MM 24h),
    "work_days": number[] or null (0=Sun,1=Mon,...,6=Sat)
  },
  "education_update": {
    "apply": boolean,
    "current_education_activity": string or null,
    "education_details": {
      "course_name": string or null,
      "institution": string or null,
      "location": string or null,
      "duration_days": number or null
    } or null,
    "education_start_date": string or null (ISO),
    "education_expected_completion_date": string or null (ISO)
  },
  "job_training_update": {
    "apply": boolean,
    "current_job_training_activity": string or null,
    "job_training_details": {
      "training_name": string or null,
      "company": string or null,
      "position_title": string or null,
      "duration_days": number or null
    } or null,
    "job_training_start_date": string or null (ISO),
    "job_training_expected_completion_date": string or null (ISO)
  },
  "current_activity_update": {
    "apply": boolean,
    "current_activity": string or null
  },
  "health_status_update": {
    "apply": boolean,
    "health_status": string or null
  },
  "location_update": {
    "apply": boolean,
    "city": string or null,
    "state": string or null
  },
  "scheduled_event": {
    "should_create": boolean,
    "description": string or null,
    "trigger_time": string or null (ISO),
    "type": "narrative" | "internal",
    "source": "simulation"
  },
  "reasoning": string
}

Rules:
- Only set "apply": true for fields that genuinely changed based on the event
- NEVER blank out existing data (null means "don't change", not "clear")
- For appointments/surgery/hospital: set a scheduled_event with an appropriate trigger_time
- For gym/coffee shop/park visits: update current_activity only, not permanent fields
- For new jobs: update work_details AND work_schedule if inferable
- For classes/courses: update education fields with realistic duration
- For job training: update job_training fields
- For moving cities: update location
- Be conservative — only apply what the event actually implies`;

    const analysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: analysisPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          updates_needed: { type: 'boolean' },
          work_details_update: { type: 'object' },
          work_schedule_update: { type: 'object' },
          education_update: { type: 'object' },
          job_training_update: { type: 'object' },
          current_activity_update: { type: 'object' },
          health_status_update: { type: 'object' },
          location_update: { type: 'object' },
          scheduled_event: { type: 'object' },
          reasoning: { type: 'string' },
        },
      },
    });

    if (!analysis?.updates_needed) {
      return Response.json({ success: true, applied: false, reasoning: analysis?.reasoning || 'No updates needed' });
    }

    const patch = {};

    // Work details
    if (analysis.work_details_update?.apply) {
      const current = character.work_details || {};
      patch.work_details = {
        ...current,
        ...(analysis.work_details_update.job_title != null && { job_title: analysis.work_details_update.job_title }),
        ...(analysis.work_details_update.workplace_type != null && { workplace_type: analysis.work_details_update.workplace_type }),
        ...(analysis.work_details_update.work_environment != null && { work_environment: analysis.work_details_update.work_environment }),
      };
    }

    // Work schedule
    if (analysis.work_schedule_update?.apply) {
      if (analysis.work_schedule_update.work_start_time != null) patch.work_start_time = analysis.work_schedule_update.work_start_time;
      if (analysis.work_schedule_update.work_end_time != null) patch.work_end_time = analysis.work_schedule_update.work_end_time;
      if (analysis.work_schedule_update.work_days != null) patch.work_days = analysis.work_schedule_update.work_days;
    }

    // Education
    if (analysis.education_update?.apply) {
      if (analysis.education_update.current_education_activity != null) patch.current_education_activity = analysis.education_update.current_education_activity;
      if (analysis.education_update.education_details != null) patch.education_details = analysis.education_update.education_details;
      if (analysis.education_update.education_start_date != null) patch.education_start_date = analysis.education_update.education_start_date;
      if (analysis.education_update.education_expected_completion_date != null) patch.education_expected_completion_date = analysis.education_update.education_expected_completion_date;
    }

    // Job training
    if (analysis.job_training_update?.apply) {
      if (analysis.job_training_update.current_job_training_activity != null) patch.current_job_training_activity = analysis.job_training_update.current_job_training_activity;
      if (analysis.job_training_update.job_training_details != null) patch.job_training_details = analysis.job_training_update.job_training_details;
      if (analysis.job_training_update.job_training_start_date != null) patch.job_training_start_date = analysis.job_training_update.job_training_start_date;
      if (analysis.job_training_update.job_training_expected_completion_date != null) patch.job_training_expected_completion_date = analysis.job_training_update.job_training_expected_completion_date;
    }

    // Current activity
    if (analysis.current_activity_update?.apply && analysis.current_activity_update.current_activity != null) {
      patch.current_activity = analysis.current_activity_update.current_activity;
    }

    // Health status
    if (analysis.health_status_update?.apply && analysis.health_status_update.health_status != null) {
      patch.health_status = analysis.health_status_update.health_status;
    }

    // Location
    if (analysis.location_update?.apply) {
      if (analysis.location_update.city != null) patch.city = analysis.location_update.city;
      if (analysis.location_update.state != null) patch.state = analysis.location_update.state;
    }

    // Apply character patch if anything changed
    if (Object.keys(patch).length > 0) {
      await base44.asServiceRole.entities.Character.update(character_id, patch);
    }

    // Create scheduled event if needed (appointment, surgery, etc.)
    if (analysis.scheduled_event?.should_create && analysis.scheduled_event.trigger_time) {
      await base44.asServiceRole.entities.ScheduledEvent.create({
        character_ids: [character_id],
        character_names: [character.name],
        description: analysis.scheduled_event.description || event_description,
        trigger_time: analysis.scheduled_event.trigger_time,
        status: 'pending',
        conversation_id: conversation_id || null,
        primary_character_id: character_id,
        type: analysis.scheduled_event.type || 'internal',
        source: 'simulation',
      });
    }

    return Response.json({
      success: true,
      applied: true,
      patch_applied: patch,
      scheduled_event_created: analysis.scheduled_event?.should_create || false,
      reasoning: analysis.reasoning,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});