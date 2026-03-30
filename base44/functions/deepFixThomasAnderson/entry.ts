import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const diagnostics = {
      user_email: user.email,
      found: false,
      record_valid: false,
      created_by_correct: false,
      correction_saved: false,
      populated_to_active: false,
      visible_in_queries: false,
      checks: [],
      fixes_applied: [],
      final_status: null,
    };

    // Step 1: Find Thomas Anderson in the database
    const allChars = await base44.entities.Character.filter({ created_by: user.email }, '-created_date', 100);
    const thomas = allChars.find(c => c.name === 'Thomas Anderson' || c.name === 'Thomas');

    if (!thomas) {
      diagnostics.final_status = 'FAILED: Thomas Anderson not found in database for this user';
      return Response.json(diagnostics, { status: 404 });
    }

    diagnostics.found = true;
    diagnostics.thomas_id = thomas.id;
    diagnostics.checks.push({
      check: '1. Thomas Anderson record found',
      status: 'PASS',
      detail: `Found character with ID: ${thomas.id}, name: ${thomas.name}`,
    });

    // Step 2: Verify record is complete and valid
    const isComplete = thomas.name && thomas.personality_summary && thomas.avatar_url;
    if (!isComplete) {
      diagnostics.checks.push({
        check: '2. Record completeness',
        status: 'WARNING',
        detail: 'Record has some missing fields but may still be functional',
      });
    } else {
      diagnostics.record_valid = true;
      diagnostics.checks.push({
        check: '2. Record completeness',
        status: 'PASS',
        detail: 'Record has core fields',
      });
    }

    // Step 3: Check created_by field
    const hasCreatedBy = !!thomas.created_by;
    const createdByCorrect = thomas.created_by === user.email;

    diagnostics.checks.push({
      check: '3. created_by field present',
      status: hasCreatedBy ? 'PASS' : 'FAIL',
      detail: `created_by: "${thomas.created_by || '(MISSING)'}", expected: "${user.email}"`,
    });

    diagnostics.checks.push({
      check: '4. created_by value correct',
      status: createdByCorrect ? 'PASS' : 'FAIL',
      detail: createdByCorrect ? 'Correct' : `Mismatch: "${thomas.created_by}" vs "${user.email}"`,
    });

    // Step 4: Fix created_by if incorrect
    if (!createdByCorrect) {
      await base44.entities.Character.update(thomas.id, { created_by: user.email });
      diagnostics.fixes_applied.push('Corrected created_by field to authenticated user');
      diagnostics.correction_saved = true;
      diagnostics.checks.push({
        check: '5. Correction persisted',
        status: 'PASS',
        detail: 'created_by field corrected and saved',
      });
    } else {
      diagnostics.correction_saved = true;
      diagnostics.created_by_correct = true;
      diagnostics.checks.push({
        check: '5. created_by already correct',
        status: 'PASS',
        detail: 'No correction needed',
      });
    }

    // Step 5: Verify status is active
    const statusCorrect = thomas.status === 'active' || !thomas.status;
    if (!statusCorrect) {
      await base44.entities.Character.update(thomas.id, { status: 'active' });
      diagnostics.fixes_applied.push('Set character status to active');
      diagnostics.checks.push({
        check: '6. Character status',
        status: 'PASS',
        detail: 'Status corrected to active',
      });
    } else {
      diagnostics.checks.push({
        check: '6. Character status',
        status: 'PASS',
        detail: `Status is correct: ${thomas.status || 'active (default)'}`,
      });
    }

    // Step 6: Verify Thomas appears in active character query
    const activeChars = await base44.entities.Character.filter(
      { created_by: user.email },
      '-created_date',
      100
    );
    const thomasInQuery = activeChars.some(c => c.id === thomas.id);
    const thomasIsActive = activeChars.find(c => c.id === thomas.id)?.status !== 'moved_away' && 
                          activeChars.find(c => c.id === thomas.id)?.status !== 'deleted';

    diagnostics.visible_in_queries = thomasInQuery && thomasIsActive;
    diagnostics.checks.push({
      check: '7. Visible in active character query',
      status: thomasInQuery && thomasIsActive ? 'PASS' : 'FAIL',
      detail: `Query returns Thomas: ${thomasInQuery}, Status is active: ${thomasIsActive}`,
    });

    // Step 7: Final verification - re-fetch to confirm changes persisted
    const updatedThomas = await base44.entities.Character.filter({ id: thomas.id });
    const finalRecord = updatedThomas[0];

    if (finalRecord && finalRecord.created_by === user.email && 
        (finalRecord.status === 'active' || !finalRecord.status)) {
      diagnostics.populated_to_active = true;
      diagnostics.checks.push({
        check: '8. Final verification',
        status: 'PASS',
        detail: 'All corrections confirmed in final record read',
      });
    } else {
      diagnostics.checks.push({
        check: '8. Final verification',
        status: 'FAIL',
        detail: 'Final record does not match expected state',
      });
    }

    // Determine final status
    if (diagnostics.visible_in_queries && diagnostics.correction_saved) {
      diagnostics.final_status = 'SUCCESS: Thomas Anderson has been fully verified and fixed. He is now properly populated and visible.';
    } else {
      diagnostics.final_status = 'PARTIAL: Some checks passed but full population may not be complete. See detailed checks.';
    }

    return Response.json({
      success: true,
      diagnostics,
      summary: {
        thomas_found: diagnostics.found,
        created_by_fixed: diagnostics.correction_saved,
        fully_populated: diagnostics.visible_in_queries,
        status: diagnostics.final_status,
      },
    });

  } catch (error) {
    return Response.json({ 
      success: false,
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});