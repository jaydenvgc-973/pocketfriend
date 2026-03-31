import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { characterId, characterName, locationId, locationName, hourlyRate } = await req.json();
    if (!characterId || !locationId || hourlyRate === undefined) {
      return Response.json({
        error: 'characterId, locationId, and hourlyRate required',
      }, { status: 400 });
    }

    // Update location: add character to workers, set pay rate
    const location = await base44.asServiceRole.entities.LocationReference.get(locationId);
    if (!location) return Response.json({ error: 'Location not found' }, { status: 404 });

    const updatedWorkers = Array.from(new Set([
      ...(location.worker_character_ids || []),
      characterId,
    ]));

    const updatedPayRates = {
      ...(location.worker_pay_rates || {}),
      [characterId]: hourlyRate,
    };

    await base44.asServiceRole.entities.LocationReference.update(locationId, {
      worker_character_ids: updatedWorkers,
      worker_pay_rates: updatedPayRates,
    });

    // Update character's financial record with work location and rate
    const financialRecords = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { character_id: characterId }
    );
    
    if (financialRecords.length > 0) {
      const financial = financialRecords[0];
      const updatedIncomeSources = Array.from(
        new Map([
          ...(financial.income_sources || []).map(s => [s.location_id, s]),
          [locationId, {
            location_id: locationId,
            location_name: locationName,
            total_earned: 0,
            last_payment_date: null,
          }],
        ]).values()
      );

      await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
        work_location_id: locationId,
        work_location_name: locationName,
        hourly_rate: hourlyRate,
        income_sources: updatedIncomeSources,
      });
    }

    return Response.json({
      success: true,
      message: `${characterName} assigned to ${locationName} at $${hourlyRate}/hr`,
    });
  } catch (error) {
    console.error('[assignCharacterToWork]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});