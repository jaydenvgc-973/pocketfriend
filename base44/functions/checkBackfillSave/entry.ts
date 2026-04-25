import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { characterId } = await req.json();

    // Query CharacterAutomaticNarrative directly
    const allRecords = await base44.asServiceRole.entities.CharacterAutomaticNarrative.filter(
      { character_id: characterId },
      '-timestamp',
      20
    );

    console.log(`[checkBackfillSave] Total records: ${allRecords.length}`);
    
    const backfilled = allRecords.filter(r => r.triggered_by === 'backfill');
    console.log(`[checkBackfillSave] Backfilled records: ${backfilled.length}`);
    
    if (backfilled.length > 0) {
      console.log(`[checkBackfillSave] First: ${backfilled[0].narrative_text?.substring(0, 60)}`);
    }

    return Response.json({
      total: allRecords.length,
      backfilled_count: backfilled.length,
      records: backfilled.slice(0, 3).map(r => ({
        id: r.id,
        triggered_by: r.triggered_by,
        event_type: r.event_type,
        text: r.narrative_text?.substring(0, 80),
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});