import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * Assign a character to work at a location with pay details.
 * Supports primary + secondary jobs.
 * Updates both Location and CharacterFinancial records.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { characterId, characterName, locationId, locationName, payAmount, payType = 'hourly', jobTitle } = body;

    if (!characterId || !locationId || payAmount === undefined) {
      return Response.json({ error: 'characterId, locationId, payAmount required' }, { status: 400 });
    }

    // Update location: add worker + set pay
    const location = await base44.asServiceRole.entities.LocationReference.get(locationId);
    const workerIds = Array.from(new Set([...(location.worker_character_ids || []), characterId]));
    
    const updateData = {
      worker_character_ids: workerIds,
    };
    updateData.worker_pay_rates = { ...(location.worker_pay_rates || {}), [characterId]: payAmount };
    updateData.worker_pay_type = { ...(location.worker_pay_type || {}), [characterId]: payType };
    if (jobTitle) {
      updateData.worker_job_titles = { ...(location.worker_job_titles || {}), [characterId]: jobTitle };
    }

    await base44.asServiceRole.entities.LocationReference.update(locationId, updateData);

    // Update financial record: add income source
    const financial = await base44.asServiceRole.entities.CharacterFinancial.filter(
      { character_id: characterId }
    ).then(arr => arr[0]);

    if (!financial) {
      return Response.json({ error: 'Financial record not found' }, { status: 404 });
    }

    const incomeSources = financial.income_sources || [];
    const existing = incomeSources.find(i => i.location_id === locationId);
    if (!existing) {
      incomeSources.push({
        location_id: locationId,
        location_name: locationName,
        pay_type: payType,
        pay_amount: payAmount,
        total_earned: 0,
        last_payment_date: null,
      });
    } else {
      existing.pay_type = payType;
      existing.pay_amount = payAmount;
    }

    // Track work locations
    const workLocIds = Array.from(new Set([...(financial.work_location_ids || []), locationId]));
    const workLocNames = workLocIds.map(id => {
      if (id === locationId) return locationName;
      const existing = (financial.work_location_names || []).find((_, i) => (financial.work_location_ids || [])[i] === id);
      return existing || '';
    }).filter(Boolean);

    await base44.asServiceRole.entities.CharacterFinancial.update(financial.id, {
      work_location_ids: workLocIds,
      work_location_names: workLocNames,
      income_sources: incomeSources,
    });

    return Response.json({
      success: true,
      message: `${characterName} assigned to ${locationName} at ${payAmount}/${payType}${jobTitle ? ` as ${jobTitle}` : ''}`,
    });
  } catch (error) {
    console.error('[assignCharacterToJob]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});