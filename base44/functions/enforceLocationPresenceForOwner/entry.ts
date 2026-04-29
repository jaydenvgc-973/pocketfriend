import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // AUTH: must be authenticated
    const user = await base44.auth.me();
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { owner_email } = await req.json();

    // OWNERSHIP GUARD: caller must match owner_email
    if (!owner_email || owner_email !== user.email) {
      return Response.json({ error: 'Forbidden: owner_email must match authenticated user' }, { status: 403 });
    }

    // QUERY: active_created_character only, scoped by owner_email
    const characters = await base44.entities.Character.filter({
      owner_email,
      character_type: 'active_created_character'
    });

    const results = [];
    let updated = 0;
    let no_change = 0;
    let errors = 0;

    // BATCH: call Phase 4A for each character individually
    for (const character of characters) {
      // Skip any record missing owner_email (invalid record — do not process)
      if (!character.owner_email) {
        results.push({
          character_id: character.id,
          name: character.name || null,
          status: 'skipped_no_owner'
        });
        continue;
      }

      try {
        const response = await base44.functions.invoke('enforceCharacterLocationPresence', {
          character_id: character.id,
          owner_email
        });

        const status = response?.data?.status || 'unknown';

        results.push({
          character_id: character.id,
          name: character.name || null,
          status
        });

        if (status === 'updated') updated++;
        else if (status === 'no_change') no_change++;
        else errors++;

      } catch (err) {
        // One failure does not stop the batch
        results.push({
          character_id: character.id,
          name: character.name || null,
          status: 'error',
          error: err.message
        });
        errors++;
      }
    }

    return Response.json({
      owner_email,
      total: characters.length,
      updated,
      no_change,
      errors,
      results
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});