import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * TEMPORARY: Test the backfill → retrieve chain
 * 1. Manually save a test backfill record to AutomaticNarrative
 * 2. Query it back via retrieveActiveMemory
 * 3. Prove the full chain works
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId } = await req.json();
    if (!characterId) {
      return Response.json({ error: 'characterId required' }, { status: 400 });
    }

    console.log(`[testBackfillChain] Starting test for char=${characterId}`);

    // ── STEP 1: FETCH CHARACTER ──────────────────────────────────────────
    const charList = await base44.entities.Character.filter({ id: characterId }, null, 1);
    const character = charList?.[0];
    if (!character) {
      return Response.json({ error: 'Character not found' }, { status: 404 });
    }
    console.log(`[testBackfillChain] Character: ${character.name}`);

    // ── STEP 2: MANUALLY CREATE A TEST BACKFILL RECORD ────────────────────
    const testTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    console.log(`[testBackfillChain] Creating test backfill record for ${testTime.toISOString()}`);

    let savedRecord = null;
    try {
      savedRecord = await base44.asServiceRole.entities.AutomaticNarrative.create({
        character_id: characterId,
        character_name: character.name,
        owner_user_id: character.owner_user_id,
        owner_email: character.owner_email || character.created_by,
        event_type: 'passive_time',
        narrative_text: `[TEST] ${character.name} was just going about their day, nothing special happening.`,
        memory_summary: '[TEST] Routine passive time during missed period',
        timestamp: testTime.toISOString(),
        local_time: testTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        time_of_day: 'afternoon',
        location_id: character.resolved_current_location_id || character.current_home_location_id || null,
        location_name: character.resolved_current_location_name || 'Unknown',
        sleep_state: 'awake',
        travel_state: 'at_location',
        work_state: 'off_work',
        needs_snapshot: {
          hunger: 70,
          energy: 75,
          social: 65,
          health: 80,
          mental: 70,
          financial_need: 60,
          hygiene: 75,
          comfort: 70,
        },
        triggered_by: 'backfill',
        is_catch_up: true,
        visibility: 'memory_only',
      });

      console.log(`[testBackfillChain] Create response:`, JSON.stringify(savedRecord));

      if (!savedRecord || !savedRecord.id) {
        console.error(`[testBackfillChain] ✗ SAVE FAILED: no ID returned`);
        return Response.json({
          success: false,
          step: 'SAVE',
          error: 'No ID returned from create',
          response: savedRecord,
        });
      }

      console.log(`[testBackfillChain] ✓ SAVED with ID: ${savedRecord.id}`);
    } catch (err) {
      console.error(`[testBackfillChain] ✗ SAVE ERROR: ${err.message}`);
      return Response.json({
        success: false,
        step: 'SAVE',
        error: err.message,
      }, { status: 500 });
    }

    // ── STEP 3: QUERY IT BACK ────────────────────────────────────────────
    console.log(`[testBackfillChain] Querying back the saved record...`);

    let queryResult = [];
    try {
      // First try: with triggered_by filter
      const queryWithFilter = await base44.asServiceRole.entities.AutomaticNarrative.filter(
        { character_id: characterId, triggered_by: 'backfill' },
        '-timestamp',
        10
      );
      console.log(`[testBackfillChain] Query WITH filter returned: ${queryWithFilter.length} records`);
      if (queryWithFilter.length > 0) {
        console.log(`[testBackfillChain]   -> Found: ID=${queryWithFilter[0].id}`);
      }

      // Second try: no filter, just character_id
      queryResult = await base44.asServiceRole.entities.AutomaticNarrative.filter(
        { character_id: characterId },
        '-timestamp',
        10
      );
      console.log(`[testBackfillChain] Query WITHOUT filter returned: ${queryResult.length} records`);
      if (queryResult.length > 0) {
        console.log(`[testBackfillChain]   -> Most recent: ID=${queryResult[0].id} | triggered_by=${queryResult[0].triggered_by}`);
        const foundSaved = queryResult.find(r => r.id === savedRecord.id);
        console.log(`[testBackfillChain]   -> Found saved record? ${!!foundSaved}`);
      }
    } catch (err) {
      console.error(`[testBackfillChain] ✗ QUERY ERROR: ${err.message}`);
      return Response.json({
        success: false,
        step: 'QUERY',
        error: err.message,
      }, { status: 500 });
    }

    if (queryResult.length === 0) {
      console.error(`[testBackfillChain] ✗ QUERY RETURNED 0 RECORDS (saved record not found)`);
      return Response.json({
        success: false,
        step: 'QUERY',
        error: 'Saved record not found in query results',
        savedId: savedRecord.id,
        queryCount: queryResult.length,
      });
    }

    // ── STEP 4: CALL retrieveActiveMemory ────────────────────────────────
    console.log(`[testBackfillChain] Calling retrieveActiveMemory...`);

    let memoryResult;
    try {
      memoryResult = await base44.asServiceRole.functions.invoke('retrieveActiveMemory', {
        characterId,
        currentMessage: 'test',
        recentMessages: [],
        topK: 10,
      });
      console.log(`[testBackfillChain] retrieveActiveMemory returned: ${JSON.stringify(memoryResult?.data)?.substring(0, 200)}`);
    } catch (err) {
      console.error(`[testBackfillChain] ✗ MEMORY ERROR: ${err.message}`);
      return Response.json({
        success: false,
        step: 'RETRIEVE_MEMORY',
        error: err.message,
      }, { status: 500 });
    }

    const memoryData = memoryResult?.data;
    const backfillInMemory = memoryData?.memories?.find(m => m.id === savedRecord.id);

    if (!backfillInMemory) {
      console.error(`[testBackfillChain] ✗ BACKFILL NOT IN MEMORY RESULTS`);
      return Response.json({
        success: false,
        step: 'MEMORY_SEARCH',
        error: 'Backfill record not found in memory context',
        savedId: savedRecord.id,
        memoryCount: memoryData?.memories?.length,
      });
    }

    console.log(`[testBackfillChain] ✓ BACKFILL FOUND IN MEMORY: ${backfillInMemory.title}`);

    return Response.json({
      success: true,
      steps: {
        SAVE: { success: true, id: savedRecord.id },
        QUERY: { success: true, count: queryResult.length, foundSavedId: queryResult[0].id === savedRecord.id },
        RETRIEVE_MEMORY: { success: true, count: memoryData?.memories?.length, foundBackfill: !!backfillInMemory },
      },
      proof: {
        savedId: savedRecord.id,
        savedText: savedRecord.narrative_text,
        queriedId: queryResult[0]?.id,
        memoryTitle: backfillInMemory?.title,
        memoryScore: backfillInMemory?._score,
      },
    });

  } catch (error) {
    console.error('[testBackfillChain] FATAL:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});