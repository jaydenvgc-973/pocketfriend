import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, promptText } = await req.json();
    if (!characterId || !promptText) {
      return Response.json({ error: 'Missing characterId or promptText' }, { status: 400 });
    }

    // Fetch character + location map for authoritative location check
    const char = await base44.entities.Character.filter({ id: characterId }).then(r => r[0]);
    if (!char) return Response.json({ error: 'Character not found' }, { status: 404 });

    const locs = await base44.functions.invoke('fetchAllLocationsForUser', {});
    const locationMap = Object.fromEntries((locs?.data?.locations || []).map(l => [l.id, l]));

    // Get authoritative location
    const authLocId = char.resolved_current_location_id || char.current_home_location_id;
    const authLocName = locationMap[authLocId]?.name || 'Unknown Location';

    // Detect park/lake/Central Park mentions in the prompt
    const parkPatterns = /\b(park|lake|central park|outdoor|nature|sitting by water|walking through)\b/gi;
    const hasParkContext = parkPatterns.test(promptText);

    if (hasParkContext && authLocName !== 'Unknown Location') {
      // CORRECTION: Strip park/lake flavor, inject actual location truth
      const correctedPrompt = promptText
        .replace(/\b(I'm sitting|I'm by|I'm at|I'm in) (?:a )?(?:park|lake|central park|the park|the lake|water)\b/gi, `I'm at ${authLocName}`)
        .replace(/\b(the park|the lake|central park|that park|that lake)\b/gi, authLocName);

      console.log(`[enforceChatLocationTruth] CORRECTION: Stripped park/lake context. Location truth: ${authLocName}`);
      return Response.json({
        corrected: true,
        originalPrompt: promptText,
        correctedPrompt,
        authoritativeLocation: authLocName,
        authoritativeLocationId: authLocId,
      });
    }

    return Response.json({
      corrected: false,
      authoritativeLocation: authLocName,
      authoritativeLocationId: authLocId,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});