import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * retriggerWorkScheduleWorkflow
 *
 * Continuation mechanism for the Work Schedule Enforcement Workflow.
 *
 * After enforceCharacterWorkSchedule enforces a valid shift boundary and
 * returns a next_execution_time, this function updates the character's
 * work_details field (one of the six approved employment-configuration
 * trigger fields) with a retrigger timestamp. That update causes the Work
 * Schedule Enforcement entity trigger to fire, starting a fresh workflow
 * run that enforces the NEXT boundary.
 *
 * This achieves indefinite continuation WITHOUT a backward Workflow
 * transition (which the validator rejects as UNBOUNDED_CYCLE) and WITHOUT
 * a finite unrolled iteration count. Each workflow run handles one
 * boundary: initial invoke → wait → enforce invoke → retrigger → end.
 * The retrigger starts the next run.
 *
 * The timestamp is placed INSIDE the existing work_details object (an
 * approved trigger field) — it is NOT a new top-level field, NOT a new
 * deadline field, and NOT a new scheduling authority. It exists solely
 * to ensure the work_details value changes so the entity trigger fires.
 *
 * Service-role only: called from the Workflow's invoke_backend_function.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let body = {};
    try { body = await req.json(); } catch { /* no body */ }
    const characterId = body.character_id || body.characterId || body.event?.entity_id;

    if (!characterId) {
      return Response.json({ error: 'character_id is required' }, { status: 400 });
    }

    // Load the character (service-role — no user session in Workflow context)
    let character = null;
    try {
      const list = await base44.asServiceRole.entities.Character.filter({ id: characterId }, null, 1);
      character = list?.[0] || null;
    } catch { /* fall through */ }

    if (!character) {
      return Response.json({ error: 'Character not found', character_id: characterId }, { status: 404 });
    }

    // Update work_details with a retrigger timestamp. This is an update to
    // an existing approved trigger field (work_details), ensuring the entity
    // trigger fires and a new workflow run starts for the next boundary.
    const currentWorkDetails = character.work_details || {};
    const updatedWorkDetails = {
      ...currentWorkDetails,
      _workflow_retrigger_at: new Date().toISOString()
    };

    await base44.asServiceRole.entities.Character.update(characterId, {
      work_details: updatedWorkDetails
    });

    return Response.json({
      success: true,
      character_id: characterId,
      retriggered_at: updatedWorkDetails._workflow_retrigger_at
    });
  } catch (error) {
    console.error('[retriggerWorkScheduleWorkflow] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});