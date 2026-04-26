import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * REPAIR IS_ACTIVE_CHARACTER + OWNERSHIP — DIRECT ID ONLY
 * 
 * 15 IDs from CSV export.
 * All must have is_active_character = true
 * Ownership locked by owner_email + owner_user_id
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ADOBEVGC (4 records)
    const ADOBEVGC_RECS = [
      { id: '69e723823c06d08253e79c94', name: 'Jayden Jackson' },
      { id: '69e1cbaf2dae540ad7f9042a', name: 'Alden Spencer' },
      { id: '69dfcd6c96f06a0babbef844', name: 'Chris Brown' },
      { id: '69dc124ddcbb6c398e71c40b', name: 'Ken' }
    ];

    // MURQART (11 records)
    const MURQART_RECS = [
      { id: '69cef8406d65304465075d79', name: 'Melody Jackson Perry' },
      { id: '69cd1c421ecd8b69850b3a6a', name: 'Andre Rivera' },
      { id: '69cb6a64a823aa902e589f99', name: 'Brian Anderson' },
      { id: '69cb668118f90525d129922c', name: 'Test Character' },
      { id: '69c7b299fe07fcd80eedfdfd', name: 'Lila Green' },
      { id: '69c7b299fe07fcd80eedfdfc', name: 'Nathan Parker' },
      { id: '69c215677279ef7b0b01a737', name: 'James Anderson' },
      { id: '69c0d59d7e382cc866ded9c9', name: 'Ethan Thompson' },
      { id: '69c0c0e2945e5649ef6e72f8', name: 'Ava Dei Park' },
      { id: '69c05643cad0c019b157815c', name: 'Jonathan Anthony Smith' },
      { id: '69c01e985ccb5ecb47d2972e', name: 'Matt Lopez' }
    ];

    const allRecs = [
      ...ADOBEVGC_RECS.map(r => ({ ...r, account: 'adobevgc@gmail.com', user_id: '69dc11160b6a8c4e19937fac' })),
      ...MURQART_RECS.map(r => ({ ...r, account: 'murqart@gmail.com', user_id: null }))
    ];

    const results = {
      total: allRecs.length,
      repaired: 0,
      failed: [],
      before_after: []
    };

    for (const rec of allRecs) {
      try {
        // GET before
        const before = await base44.asServiceRole.entities.Character.get(rec.id);
        
        if (!before) {
          results.failed.push({ id: rec.id, name: rec.name, error: 'RECORD_NOT_FOUND' });
          continue;
        }

        // Verify character_type
        if (before.character_type !== 'active_created_character') {
          results.failed.push({
            id: rec.id,
            name: rec.name,
            error: `WRONG_TYPE: ${before.character_type} (expected active_created_character)`
          });
          continue;
        }

        // Build update payload
        const updatePayload = {
          is_active_character: true,
          owner_email: rec.account
        };

        if (rec.user_id) {
          updatePayload.owner_user_id = rec.user_id;
        }

        // UPDATE
        await base44.asServiceRole.entities.Character.update(rec.id, updatePayload);

        // GET after
        const after = await base44.asServiceRole.entities.Character.get(rec.id);

        results.before_after.push({
          id: rec.id,
          name: rec.name,
          account: rec.account,
          before: {
            character_type: before.character_type,
            is_active_character: before.is_active_character,
            owner_email: before.owner_email,
            owner_user_id: before.owner_user_id
          },
          after: {
            character_type: after.character_type,
            is_active_character: after.is_active_character,
            owner_email: after.owner_email,
            owner_user_id: after.owner_user_id
          }
        });

        results.repaired++;

      } catch (err) {
        results.failed.push({
          id: rec.id,
          name: rec.name,
          error: err.message
        });
      }
    }

    return Response.json({
      task: 'REPAIR_ACTIVE_CREATED_BY_DIRECT_ID',
      results
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});