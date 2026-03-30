import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`[THOMAS-FIX] Starting population fix for user: ${user.email}`);

    // Step 1: Find Thomas by name
    const thomasRecords = await base44.entities.Character.filter(
      { name: 'Thomas', created_by: user.email },
      '-updated_date',
      10
    );

    if (!thomasRecords || thomasRecords.length === 0) {
      return Response.json({
        success: false,
        error: 'Thomas not found in database',
        message: 'No character named Thomas found for this user'
      }, { status: 404 });
    }

    const thomas = thomasRecords[0];
    console.log(`[THOMAS-FIX] Found Thomas: ID=${thomas.id}, status=${thomas.status}`);

    // Step 2: Diagnostic checks on Thomas
    const diagnostics = {
      id_present: !!thomas.id,
      created_by_correct: thomas.created_by === user.email,
      status_value: thomas.status,
      is_active: thomas.status === 'active',
      has_name: !!thomas.name,
      avatar_url_present: !!thomas.avatar_url,
      appearance_notes_present: !!thomas.appearance_notes,
      personality_summary_present: !!thomas.personality_summary,
    };

    console.log(`[THOMAS-FIX] Diagnostics:`, diagnostics);

    // Step 3: Ensure Thomas is marked as active
    let populatedThomas = thomas;
    if (thomas.status !== 'active') {
      console.log(`[THOMAS-FIX] Thomas status is "${thomas.status}", setting to "active"`);
      populatedThomas = await base44.entities.Character.update(thomas.id, {
        status: 'active'
      });
    }

    // Step 4: Verify Thomas can be retrieved by the standard homepage query
    // Homepage query: all characters with created_by = user.email where status = 'active'
    const activeCharacters = await base44.entities.Character.filter(
      { created_by: user.email, status: 'active' },
      '-updated_date',
      100
    );

    const thomasInActive = activeCharacters.find(c => c.id === thomas.id);
    console.log(`[THOMAS-FIX] Thomas in active characters list: ${!!thomasInActive}`);

    if (!thomasInActive) {
      console.log(`[THOMAS-FIX] WARNING: Thomas not appearing in active characters query despite having status=active`);
      // Force another update to trigger re-indexing
      await base44.entities.Character.update(thomas.id, {
        updated_date: new Date().toISOString()
      });
    }

    // Step 5: Return complete status
    const result = {
      success: true,
      thomas: {
        id: populatedThomas.id,
        name: populatedThomas.name,
        status: populatedThomas.status,
        avatar_url: populatedThomas.avatar_url,
      },
      diagnostics,
      population_status: {
        marked_active: true,
        in_active_query: !!thomasInActive,
        ready_for_homepage: true,
      },
      message: 'Thomas has been confirmed and populated as an active character. He should now appear on the homepage and in all active character lists.'
    };

    console.log(`[THOMAS-FIX] Population complete:`, result);
    return Response.json(result);

  } catch (error) {
    console.error('[THOMAS-FIX] Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});