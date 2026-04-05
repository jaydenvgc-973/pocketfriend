import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const result = {
      timestamp: new Date().toISOString(),
      fixed: [],
    };

    const characters = await base44.entities.Character.filter({ 
      created_by: user.email,
      status: 'active',
    });

    // For characters with multiple work locations, keep current_work_location_id
    // and move extras to additional_occupation_locations
    for (const char of characters) {
      const currentWork = char.current_work_location_id;
      const occupationWork = char.occupation_location_id;
      const additionalWorks = char.additional_occupation_locations || [];

      const allWorks = [currentWork, occupationWork, ...additionalWorks.map(a => a.location_id)]
        .filter(Boolean);

      const uniqueWorks = [...new Set(allWorks.filter(Boolean))];

      if (uniqueWorks.length > 1) {
        // Keep the first as primary, move others to additional
        const [primaryWork, ...otherWorks] = uniqueWorks;

        const newAdditional = otherWorks.map(workId => ({
          location_id: workId,
          location_name: workId, // Will be resolved by UI if needed
          job_title: 'Secondary Job',
        }));

        await base44.entities.Character.update(char.id, {
          current_work_location_id: primaryWork,
          occupation_location_id: primaryWork,
          additional_occupation_locations: newAdditional,
        });

        result.fixed.push({
          character: char.name,
          primaryWork,
          secondaryCount: otherWorks.length,
        });
      }
    }

    // Ensure holiday_observation_enabled field exists
    const settingsList = await base44.entities.UserSettings.list();
    if (settingsList.length > 0 && settingsList[0].id) {
      const settings = settingsList[0];
      if (settings.holiday_observation_enabled === undefined) {
        await base44.entities.UserSettings.update(settings.id, {
          holiday_observation_enabled: true,
        });
        result.fixed.push({
          action: 'set_holiday_observation_enabled',
          value: true,
        });
      }
    }

    result.summary = `Fixed ${result.fixed.length} work location conflicts`;
    return Response.json(result);
  } catch (error) {
    return Response.json({
      error: error.message,
      pass: false,
    }, { status: 500 });
  }
});