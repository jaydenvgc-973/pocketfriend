import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * backfillCharacterFinancialUserScoped
 *
 * User-scoped financial backfill. Unlike backfillFinancialsForAllCharacters which
 * uses asServiceRole (blocked by Character RLS), this reads Characters via the
 * user's own session where RLS passes naturally.
 *
 * Safe to run multiple times. Idempotent — never creates duplicates.
 * Must be called by an authenticated user.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Read user-scoped — RLS passes because it's the owner's own session
    const allChars = await base44.entities.Character.filter(
      { character_type: 'active_created_character', status: 'active' },
      null,
      500
    );

    // Read existing financial records (user-scoped)
    const existingCFs = await base44.entities.CharacterFinancial.filter(null, null, 500);
    const existingIds = new Set(existingCFs.map(f => f.character_id));

    const missing = allChars.filter(c => !existingIds.has(c.id));

    let created = 0, skipped = 0, errors = 0;
    const results = [];

    for (const char of missing) {
      try {
        await base44.entities.CharacterFinancial.create({
          character_id: char.id,
          character_name: char.name,
          owner_email: char.owner_email || user.email,
          is_npc: false,
          home_location_id: char.current_home_location_id || null,
          home_location_name: null,
          is_homeless: !char.current_home_location_id,
          current_balance: 6000,
          total_income: 0,
          total_expenses: 0,
          income_sources: [],
          recurring_expenses: [],
          other_monthly_expenses: [],
          last_updated: new Date().toISOString(),
        });
        results.push({ name: char.name, id: char.id, status: 'created' });
        created++;
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        if (err.message && err.message.includes('duplicate')) {
          results.push({ name: char.name, id: char.id, status: 'skipped_duplicate' });
          skipped++;
        } else {
          results.push({ name: char.name, id: char.id, status: 'error', error: err.message });
          errors++;
        }
      }
    }

    return Response.json({
      success: true,
      user_email: user.email,
      total_characters: allChars.length,
      existing_cf_count: existingIds.size,
      missing_count: missing.length,
      created,
      skipped,
      errors,
      results,
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});