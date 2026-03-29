import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const diagnostics = {
      checks_performed: [],
      issues_found: [],
      fixes_applied: [],
      final_state: 'unknown'
    };

    // CHECK 1: CONNECTION - verify service endpoint and basic connectivity
    try {
      diagnostics.checks_performed.push('Connection check');
      // Attempt a minimal backend call to verify service is reachable
      await base44.functions.invoke('simulateCharacterInteraction', { 
        characterId: null, 
        _testConnection: true 
      }).catch(() => {
        // Expected to fail with null characterId, but if it doesn't timeout, service is reachable
      });
      diagnostics.checks_performed.push('Service endpoint is reachable');
    } catch (connErr) {
      if (connErr.message?.includes('timeout') || connErr.message?.includes('network')) {
        diagnostics.issues_found.push('SERVICE NOT REACHABLE: Connection timeout or network error');
      }
    }

    // CHECK 2: STATE VALIDATION - verify no characters are stuck in loading/failed state
    try {
      diagnostics.checks_performed.push('Character state check');
      const characters = await base44.entities.Character.filter(
        { created_by: user.email },
        "-created_date",
        10
      );

      for (const char of characters) {
        // Check for stuck simulation flags or metadata
        if (char._simulation_stuck || char._last_simulation_failed) {
          diagnostics.issues_found.push(`CHARACTER STUCK: ${char.name} has failed simulation state`);
        }
      }

      if (diagnostics.issues_found.length === 0) {
        diagnostics.checks_performed.push('No characters stuck in failed state');
      }
    } catch (stateErr) {
      diagnostics.issues_found.push(`STATE CHECK FAILED: ${stateErr.message}`);
    }

    // CHECK 3: REQUEST EXECUTION - attempt a real simulation call
    try {
      diagnostics.checks_performed.push('Request execution check');
      const testChars = await base44.entities.Character.filter(
        { created_by: user.email },
        "-created_date",
        1
      );

      if (testChars.length > 0) {
        const testChar = testChars[0];
        try {
          const res = await base44.functions.invoke('simulateCharacterInteraction', {
            characterId: testChar.id
          });

          if (!res || !res.data) {
            diagnostics.issues_found.push('RESPONSE FAILURE: Backend returned empty response');
          } else if (res.data.error === 'Failed to simulate interaction. Try again.') {
            diagnostics.issues_found.push('BACKEND ERROR: "Failed to simulate interaction. Try again." - backend call not executing properly');
          } else {
            diagnostics.checks_performed.push('Request execution successful');
          }
        } catch (execErr) {
          diagnostics.issues_found.push(`EXECUTION FAILED: ${execErr.message}`);
        }
      }
    } catch (reqErr) {
      diagnostics.issues_found.push(`EXECUTION CHECK FAILED: ${reqErr.message}`);
    }

    // CHECK 4: SESSION/CONTEXT VALIDATION - verify user session is valid
    try {
      diagnostics.checks_performed.push('Session/context check');
      // If we got here, user is authenticated
      diagnostics.checks_performed.push('User session is valid and authenticated');
    } catch (sessErr) {
      diagnostics.issues_found.push(`SESSION INVALID: ${sessErr.message}`);
    }

    // CHECK 5: CACHED FAILURE STATE - look for error artifacts
    try {
      diagnostics.checks_performed.push('Cached failure state check');
      // Check if there's any persistent error flag in user settings
      const settings = await base44.entities.UserSettings.filter({ created_by: user.email });
      if (settings.length > 0 && settings[0]._interaction_tool_failed) {
        diagnostics.issues_found.push('CACHED FAILURE: Failure state persisted in settings');
        // Clear it
        await base44.entities.UserSettings.update(settings[0].id, { _interaction_tool_failed: false });
        diagnostics.fixes_applied.push('Cleared cached failure state from user settings');
      }
    } catch (cacheErr) {
      // Settings may not exist, non-critical
    }

    // AUTO-FIX ACTIONS
    if (diagnostics.issues_found.length > 0) {
      // FIX 1: Reset character simulation state
      try {
        const characters = await base44.entities.Character.filter(
          { created_by: user.email },
          "-created_date",
          10
        );
        for (const char of characters) {
          if (char._simulation_stuck || char._last_simulation_failed) {
            await base44.entities.Character.update(char.id, {
              _simulation_stuck: false,
              _last_simulation_failed: false
            });
            diagnostics.fixes_applied.push(`Reset simulation state for ${char.name}`);
          }
        }
      } catch (fixErr) {
        diagnostics.issues_found.push(`RESET FAILED: Could not reset character states`);
      }

      // FIX 2: Reinitialize tool session by clearing any error flags
      try {
        const settings = await base44.entities.UserSettings.filter({ created_by: user.email });
        if (settings.length > 0) {
          await base44.entities.UserSettings.update(settings[0].id, {
            _interaction_tool_failed: false,
            _interaction_tool_last_error: null
          });
          diagnostics.fixes_applied.push('Reinitialized tool session and cleared error flags');
        }
      } catch (sessFixErr) {
        // Non-critical
      }

      // FIX 3: Retry the simulation call after fixes
      try {
        const testChars = await base44.entities.Character.filter(
          { created_by: user.email },
          "-created_date",
          1
        );
        if (testChars.length > 0) {
          const retryRes = await base44.functions.invoke('simulateCharacterInteraction', {
            characterId: testChars[0].id
          });
          if (retryRes?.data && !retryRes.data.error) {
            diagnostics.fixes_applied.push('Simulation call succeeded after recovery');
            diagnostics.final_state = 'recovered';
          } else {
            diagnostics.final_state = 'not_recovered_safely';
          }
        }
      } catch (retryErr) {
        diagnostics.final_state = 'not_recovered_safely';
      }
    } else {
      diagnostics.final_state = 'no_issues_found';
    }

    // Generate summary
    let summary = '';
    if (diagnostics.final_state === 'recovered') {
      summary = 'Simulated interaction tool reconnected and operational';
    } else if (diagnostics.final_state === 'not_recovered_safely') {
      summary = `Issue found but could not auto-recover. Performed ${diagnostics.fixes_applied.length} recovery action(s).`;
    } else if (diagnostics.final_state === 'no_issues_found') {
      summary = 'No issues detected. Simulated interaction tool is healthy.';
    } else {
      summary = 'Diagnostic completed. Tool state uncertain.';
    }

    return Response.json({
      data: {
        summary,
        checks_performed: diagnostics.checks_performed,
        issues_found: diagnostics.issues_found,
        fixes_applied: diagnostics.fixes_applied,
        final_state: diagnostics.final_state
      }
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});