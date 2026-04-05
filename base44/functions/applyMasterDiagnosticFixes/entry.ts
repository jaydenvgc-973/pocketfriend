import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const fixes = {
      timestamp: new Date().toISOString(),
      actionsPerformed: [],
      pass: true,
    };

    const characters = await base44.entities.Character.filter({ 
      created_by: user.email,
      status: 'active',
    });
    const locations = await base44.entities.LocationReference.list();
    const locMap = Object.fromEntries(locations.map(l => [l.id, l]));

    // ========== FIX 1: Remove orphaned residents from locations ==========
    const activeCharIds = new Set(characters.map(c => c.id));

    for (const loc of locations) {
      const originalResidents = [...(loc.resident_character_ids || [])];
      const originalNames = [...(loc.resident_character_names || [])];

      const cleanedResidents = (loc.resident_character_ids || []).filter(id => activeCharIds.has(id));
      const cleanedNames = (loc.resident_character_names || []).filter(name => 
        characters.some(c => c.name === name)
      );

      if (cleanedResidents.length !== originalResidents.length) {
        const removed = originalResidents.filter(id => !cleanedResidents.includes(id));
        await base44.entities.LocationReference.update(loc.id, {
          resident_character_ids: cleanedResidents,
          resident_character_names: cleanedNames,
        });
        
        fixes.actionsPerformed.push({
          action: 'remove_orphaned_residents',
          location: loc.name,
          removedIds: removed,
          totalRemoved: removed.length,
        });
      }
    }

    // ========== FIX 2: Reconcile occupancy mismatches ==========
    const occupancyMismatches = [];
    
    for (const loc of locations) {
      for (const residentId of (loc.resident_character_ids || [])) {
        const char = characters.find(c => c.id === residentId);
        if (char && char.current_home_location_id !== loc.id) {
          occupancyMismatches.push({
            character: char.name,
            characterId: char.id,
            currentHome: char.current_home_location_id,
            residenceRecordHome: loc.id,
          });
        }
      }
    }

    // For each mismatch, update character to match occupancy record (source of truth)
    for (const mismatch of occupancyMismatches) {
      const char = characters.find(c => c.id === mismatch.characterId);
      if (char) {
        await base44.entities.Character.update(char.id, {
          current_home_location_id: mismatch.residenceRecordHome,
        });

        fixes.actionsPerformed.push({
          action: 'fix_occupancy_mismatch',
          character: char.name,
          newHome: locMap[mismatch.residenceRecordHome]?.name || mismatch.residenceRecordHome,
        });
      }
    }

    // ========== FIX 3: Ensure all active characters have a home ==========
    const charactersNeedingHome = characters.filter(c => !c.current_home_location_id);

    for (const char of charactersNeedingHome) {
      // Try to find a home for them or assign a default generic home
      const genericHome = locations.find(l => 
        l.is_default_generic && l.category === 'home' && 
        l.resident_character_ids && l.resident_character_ids.length < 10
      );

      if (genericHome) {
        await base44.entities.Character.update(char.id, {
          current_home_location_id: genericHome.id,
        });

        if (!genericHome.resident_character_ids) {
          genericHome.resident_character_ids = [];
        }
        if (!genericHome.resident_character_ids.includes(char.id)) {
          await base44.entities.LocationReference.update(genericHome.id, {
            resident_character_ids: [...(genericHome.resident_character_ids || []), char.id],
            resident_character_names: [...(genericHome.resident_character_names || []), char.name],
          });
        }

        fixes.actionsPerformed.push({
          action: 'assign_missing_home',
          character: char.name,
          assignedHome: genericHome.name,
        });
      } else {
        fixes.actionsPerformed.push({
          action: 'character_needs_home_no_generic_available',
          character: char.name,
          status: 'requires_manual_intervention',
        });
      }
    }

    // ========== FIX 4: Ensure UserSettings exists and persists ==========
    const settingsList = await base44.entities.UserSettings.list();
    if (settingsList.length === 0) {
      await base44.entities.UserSettings.create({
        holiday_observation_enabled: true,
      });
      fixes.actionsPerformed.push({
        action: 'create_user_settings',
        details: 'UserSettings record created with holiday observation enabled',
      });
    }

    // ========== FIX 5: Validate character financial records ==========
    const financials = await base44.entities.CharacterFinancial.filter({});
    const financialCharIds = new Set(financials.map(f => f.character_id));

    const charsNeedingFinancial = characters.filter(c => !financialCharIds.has(c.id));
    for (const char of charsNeedingFinancial) {
      await base44.entities.CharacterFinancial.create({
        character_id: char.id,
        character_name: char.name,
        current_balance: 6000,
      });
      fixes.actionsPerformed.push({
        action: 'create_financial_record',
        character: char.name,
      });
    }

    fixes.summary = `Applied ${fixes.actionsPerformed.length} fixes. Run masterDeepDiagnostic again to verify.`;
    return Response.json(fixes, { status: 200 });
  } catch (error) {
    return Response.json({
      timestamp: new Date().toISOString(),
      error: error.message,
      pass: false,
    }, { status: 500 });
  }
});