/**
 * diagnoseNPCFictitiousCreation
 *
 * Creates a brand-new npc_fictitious character via the EXACT same code path used
 * by AddPeopleInTheirWorldPanel (createCharacterWithRelationships), then returns
 * the database record to prove character_type is preserved immediately and after
 * a subsequent re-read (simulating a refresh).
 *
 * Does NOT require any speaking_character_id — tests the minimal creation path.
 * Cleanup: hard deletes the test record by default (keep=false).
 * Pass keep=true to preserve the record for manual inspection.
 * Hard delete is used — not soft delete — so residue never contaminates duplicate checks.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const keep = body.keep === true;
  const testName = `DiagTest_NPC_${Date.now()}`;

  const result = {
    test_name: testName,
    user_email: user.email,
    creation_path: 'createCharacterWithRelationships (same as AddPeopleInTheirWorldPanel)',
    steps: [],
  };

  let createdId = null;

  try {
    // ── STEP 1: Create via createCharacterWithRelationships ──────────────────
    const createRes = await base44.functions.invoke('createCharacterWithRelationships', {
      characterData: {
        name: testName,
        character_type: 'npc_fictitious',
        owner_email: user.email,
        owner_user_id: user.id,
        created_by_role: user.role || 'user',
        status: 'active',
        exclude_from_homepage: true,
      },
      characterRelationships: [],
    });

    const createData = createRes?.data;
    if (!createData?.success) {
      result.steps.push({
        step: 1,
        action: 'create via createCharacterWithRelationships',
        status: 'FAILED',
        error: createData?.error || 'No success flag',
      });
      return Response.json({ ...result, overall: 'FAIL' });
    }

    createdId = createData.character?.id;
    const createdRecord = createData.character;

    result.steps.push({
      step: 1,
      action: 'create via createCharacterWithRelationships',
      status: 'OK',
      record: {
        id: createdRecord.id,
        name: createdRecord.name,
        character_type: createdRecord.character_type,
        owner_email: createdRecord.owner_email,
        status: createdRecord.status,
        created_date: createdRecord.created_date,
      },
      character_type_correct: createdRecord.character_type === 'npc_fictitious',
    });

    // ── STEP 2: Re-read immediately (simulates refresh) ──────────────────────
    await new Promise(r => setTimeout(r, 300)); // small delay to simulate async
    const rereadList = await base44.asServiceRole.entities.Character.filter({ id: createdId }, null, 1);
    const rereadRecord = rereadList?.[0] || null;

    result.steps.push({
      step: 2,
      action: 're-read from DB (simulates app refresh)',
      status: rereadRecord ? 'OK' : 'MISSING',
      record: rereadRecord ? {
        id: rereadRecord.id,
        name: rereadRecord.name,
        character_type: rereadRecord.character_type,
        owner_email: rereadRecord.owner_email,
        status: rereadRecord.status,
        updated_date: rereadRecord.updated_date,
      } : null,
      character_type_correct: rereadRecord?.character_type === 'npc_fictitious',
      type_mutated: rereadRecord && rereadRecord.character_type !== 'npc_fictitious',
      mutation_to: rereadRecord?.character_type !== 'npc_fictitious' ? rereadRecord?.character_type : null,
    });

    // ── STEP 3: Check for duplicates with same name ──────────────────────────
    const dupeCheck = await base44.asServiceRole.entities.Character.filter({
      owner_email: user.email,
      name: testName,
    });
    const nonDeleted = dupeCheck.filter(c => c.status !== 'deleted' && c.status !== 'soft_deleted');

    result.steps.push({
      step: 3,
      action: 'duplicate check',
      status: nonDeleted.length === 1 ? 'OK' : 'DUPLICATE_FOUND',
      total_records_with_name: nonDeleted.length,
      ids: nonDeleted.map(c => c.id),
      types: nonDeleted.map(c => c.character_type),
    });

    // ── CLEANUP — hard delete by default ────────────────────────────────────
    // Hard delete prevents test residue from polluting duplicate checks or future diagnostics.
    // soft_deleted records still appear in unfiltered queries and can cause false positives.
    if (!keep && createdId) {
      try {
        await base44.asServiceRole.entities.Character.delete(createdId);
        result.cleanup = { method: 'hard_delete', id: createdId, status: 'DELETED', note: 'Record permanently removed. Pass keep=true to preserve for inspection.' };
      } catch (delErr) {
        // Hard delete failed — fall back to diagnostic marker (not soft_deleted status)
        // so it is excluded from roster queries but visibly flagged as test residue.
        await base44.asServiceRole.entities.Character.update(createdId, {
          status: 'diagnostic_deleted',
          diagnostic_test: true,
          exclude_from_roster: true,
          exclude_from_homepage: true,
        }).catch(() => {});
        result.cleanup = {
          method: 'diagnostic_marker_fallback',
          id: createdId,
          status: 'FALLBACK',
          hard_delete_error: delErr.message,
          note: 'Hard delete failed. Record marked diagnostic_deleted + exclude_from_roster=true. This is test residue, not a real character.',
        };
      }
    } else if (keep) {
      result.cleanup = { method: 'kept', id: createdId, note: 'Record preserved as requested (keep=true).' };
    }

    // ── OVERALL RESULT ────────────────────────────────────────────────────────
    const allPassed = result.steps.every(s => s.status === 'OK' && s.character_type_correct !== false);
    result.overall = allPassed ? 'PASS' : 'FAIL';
    result.verdict = allPassed
      ? 'npc_fictitious is preserved through creation and refresh. No type mutation detected.'
      : 'TYPE MUTATION DETECTED or creation failed. See steps for details.';

    return Response.json(result);

  } catch (error) {
    // Emergency cleanup on unexpected error — attempt hard delete first
    if (createdId && !keep) {
      try {
        await base44.asServiceRole.entities.Character.delete(createdId);
      } catch {
        // Hard delete unavailable — apply diagnostic exclusion marker
        await base44.asServiceRole.entities.Character.update(createdId, {
          status: 'diagnostic_deleted',
          diagnostic_test: true,
          exclude_from_roster: true,
          exclude_from_homepage: true,
        }).catch(() => {});
      }
    }
    return Response.json({ ...result, overall: 'ERROR', error: error.message }, { status: 500 });
  }
});