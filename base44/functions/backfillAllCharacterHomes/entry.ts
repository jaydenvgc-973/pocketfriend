import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const results = {
      totalCharacters: 0,
      homesCreated: 0,
      financialRecordsCreated: 0,
      skipped: 0,
      errors: [],
    };

    // Get all active characters
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email, status: 'active' },
      '-created_date',
      500
    );
    results.totalCharacters = allChars.length;

    // DESIGN RULE: Characters are NOT required to have a formal mapped Home Location.
    // This function is now DIAGNOSTIC ONLY — it reports housing status without creating anything.
    // Auto-creating homes and fabricating $1,200 rent for all characters was false enforcement.
    // Housing assignment must be user-initiated, not automated.

    const withHome = [];
    const withoutHome = [];

    for (const char of allChars) {
      const hasHome = !!(char.current_home_location_id || char.home_location_id);
      const existingFinancial = await base44.asServiceRole.entities.CharacterFinancial.filter({
        character_id: char.id,
      });
      const hasFinancial = existingFinancial.length > 0;

      if (hasHome || hasFinancial) {
        results.skipped++;
        withHome.push({ id: char.id, name: char.name, hasHome, hasFinancial });
      } else {
        withoutHome.push({
          id: char.id,
          name: char.name,
          note: 'No mapped home — valid state. No action taken.',
        });
      }
    }

    return Response.json({
      success: true,
      mode: 'diagnostic_only',
      note: 'This function no longer auto-creates homes or financial records. No home = valid state.',
      results: {
        ...results,
        withHome: withHome.length,
        withoutHome: withoutHome.length,
        withoutHomeDetails: withoutHome,
      },
    });
  } catch (error) {
    console.error('[backfillAllCharacterHomes]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});