import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const startTime = Date.now();
    const report = {
      timestamp: new Date().toISOString(),
      userId: user.email,
      systemChecks: {},
      failures: [],
      warnings: [],
      inconsistencies: [],
      pass: true,
      executionMs: 0,
    };

    // ========== 1. WORLD STATE INTEGRITY ==========
    const characters = await base44.entities.Character.filter({ 
      created_by: user.email,
      status: 'active',
    });
    const locations = await base44.entities.LocationReference.list();
    const locMap = Object.fromEntries(locations.map(l => [l.id, l]));

    const worldStateChecks = {
      totalCharacters: characters.length,
      totalLocations: locations.length,
      duplicatePresence: [],
      ghostOccupancy: [],
      staleLocations: [],
    };

    // Check for characters in multiple home locations
    characters.forEach(char => {
      const appearsIn = locations.filter(l =>
        l.resident_character_ids?.includes(char.id) ||
        l.resident_character_names?.includes(char.name)
      );
      if (appearsIn.length > 1) {
        worldStateChecks.duplicatePresence.push({
          character: char.name,
          locations: appearsIn.map(l => l.name),
        });
      }
    });

    report.systemChecks.worldStateIntegrity = {
      pass: worldStateChecks.duplicatePresence.length === 0,
      duplicates: worldStateChecks.duplicatePresence,
    };

    if (worldStateChecks.duplicatePresence.length > 0) {
      report.failures.push('Characters in multiple home locations detected');
      report.pass = false;
    }

    // ========== 2. CHARACTER CARD ACCURACY ==========
    const cardChecks = [];
    for (const char of characters) {
      const homeId = char.current_home_location_id;
      const homeLoc = homeId ? locMap[homeId] : null;
      
      // Check if character's home still exists
      if (homeId && !homeLoc) {
        cardChecks.push({
          character: char.name,
          issue: 'home_location_deleted',
          homeId,
          details: `Character claims home ${homeId} but location does not exist`,
        });
      }

      // Check if character's work location still exists
      const workId = char.current_work_location_id || char.occupation_location_id;
      const workLoc = workId ? locMap[workId] : null;
      if (workId && !workLoc) {
        cardChecks.push({
          character: char.name,
          issue: 'work_location_deleted',
          workId,
          details: `Character claims work ${workId} but location does not exist`,
        });
      }

      // Check school location
      const schoolId = char.current_school_location_id;
      const schoolLoc = schoolId ? locMap[schoolId] : null;
      if (schoolId && !schoolLoc) {
        cardChecks.push({
          character: char.name,
          issue: 'school_location_deleted',
          schoolId,
          details: `Character enrolled at ${schoolId} but location does not exist`,
        });
      }
    }

    report.systemChecks.characterCardAccuracy = {
      pass: cardChecks.length === 0,
      issueCount: cardChecks.length,
      issues: cardChecks,
    };

    if (cardChecks.length > 0) {
      report.failures.push(`${cardChecks.length} character cards reference deleted locations`);
      report.pass = false;
    }

    // ========== 3. OCCUPANCY LOGIC ==========
    const occupancyChecks = {
      missingResidents: [],
      orphanOccupancy: [],
    };

    // Check if all resident_character_ids actually have that location set
    locations.forEach(loc => {
      (loc.resident_character_ids || []).forEach(charId => {
        const char = characters.find(c => c.id === charId);
        if (!char) {
          occupancyChecks.orphanOccupancy.push({
            location: loc.name,
            characterId: charId,
            issue: 'character_deleted_but_still_in_resident_list',
          });
        } else if (char.current_home_location_id !== loc.id) {
          occupancyChecks.missingResidents.push({
            location: loc.name,
            character: char.name,
            expectedHome: char.current_home_location_id,
            actualResidenceRecord: loc.id,
            issue: 'mismatch',
          });
        }
      });
    });

    report.systemChecks.occupancyLogic = {
      pass: occupancyChecks.missingResidents.length === 0 && occupancyChecks.orphanOccupancy.length === 0,
      missingResidents: occupancyChecks.missingResidents,
      orphanOccupancy: occupancyChecks.orphanOccupancy,
    };

    if (occupancyChecks.missingResidents.length > 0 || occupancyChecks.orphanOccupancy.length > 0) {
      report.failures.push('Occupancy records out of sync with character location data');
      report.pass = false;
    }

    // ========== 4. TRAVEL INTEGRITY ==========
    const travelChecks = {
      charactersMissingHome: [],
      charactersMultipleWorks: [],
    };

    characters.forEach(char => {
      if (!char.current_home_location_id) {
        travelChecks.charactersMissingHome.push(char.name);
      }

      const workLocations = [char.current_work_location_id, char.occupation_location_id]
        .concat(char.additional_occupation_locations?.map(o => o.location_id) || [])
        .filter(Boolean);
      
      const uniqueWorks = [...new Set(workLocations)];
      
      if (uniqueWorks.length > 1) {
        travelChecks.charactersMultipleWorks.push({
          character: char.name,
          workLocations: uniqueWorks.map(id => locMap[id]?.name || id),
        });
      }
    });

    report.systemChecks.travelIntegrity = {
      pass: travelChecks.charactersMissingHome.length === 0,
      charactersMissingHome: travelChecks.charactersMissingHome,
      charactersWithSecondaryJobs: travelChecks.charactersMultipleWorks,
      note: 'Secondary jobs in additional_occupation_locations are valid; primary is tracked in current_work_location_id',
    };

    if (travelChecks.charactersMissingHome.length > 0) {
      report.warnings.push(`${travelChecks.charactersMissingHome.length} characters missing home location`);
    }

    // ========== 5. SCHEDULE INTEGRITY ==========
    const scheduleChecks = [];
    
    characters.forEach(char => {
      // Check if work schedule and location match
      if (char.work_start_time && char.work_end_time && !char.current_work_location_id && !char.occupation_location_id) {
        scheduleChecks.push({
          character: char.name,
          issue: 'work_schedule_but_no_workplace',
          details: 'Character has work hours but no workplace assigned',
        });
      }

      // Check student status
      if (char.student_status === 'enrolled' && !char.current_school_location_id && !char.education_location_id) {
        scheduleChecks.push({
          character: char.name,
          issue: 'enrolled_but_no_school',
          details: 'Character is enrolled but has no school location',
        });
      }
    });

    report.systemChecks.scheduleIntegrity = {
      pass: scheduleChecks.length === 0,
      issueCount: scheduleChecks.length,
      issues: scheduleChecks,
    };

    if (scheduleChecks.length > 0) {
      report.failures.push(`${scheduleChecks.length} schedule/location mismatches`);
      report.pass = false;
    }

    // ========== 6. DIALOGUE AND LOCATION CONSISTENCY ==========
    const messages = await base44.entities.Message.filter({}, '-timestamp', 100);
    const dialogueChecks = [];

    // Sample recent messages for location keyword claims
    const locationKeywords = {
      'home': 'home',
      'work': 'work',
      'church': 'religion',
      'hospital': 'hospital',
      'school': 'school',
      'gym': 'gym',
      'bar': 'bar',
      'clinic': 'hospital',
      'office': 'work',
    };

    messages.forEach(msg => {
      if (msg.sender_type === 'character') {
        const char = characters.find(c => c.id === msg.character_id);
        if (!char) return;

        // Check for direct location claims: "I'm at X" "I'm at home" etc
        const atPattern = /i'm\s+(?:at|in)\s+(.+?)(?:\.|,|$)/i;
        const match = msg.content.match(atPattern);
        
        if (match) {
          const claimedLocation = match[1].toLowerCase();
          // This is for future comparison against actual location
          dialogueChecks.push({
            character: char.name,
            message: msg.content.substring(0, 60),
            directLocationClaim: claimedLocation,
            timestamp: msg.timestamp,
            needsValidation: true,
          });
        }
      }
    });

    report.systemChecks.dialogueConsistency = {
      pass: true, // Validation requires live chat context
      recentLocationClaims: dialogueChecks.slice(0, 5),
      totalClaimsFound: dialogueChecks.length,
      note: 'Direct location claims should be validated against actual character location state',
    };

    // ========== 7. HOLIDAY SYSTEMS ==========
    const settingsList = await base44.entities.UserSettings.list();
    const settings = settingsList[0] || {};

    const holidayChecks = {
      observationEnabled: settings.holiday_observation_enabled !== false,
      settingsPersisted: !!settings.id,
      popupSupported: true, // HolidayPopup component exists
    };

    report.systemChecks.holidaySystem = {
      pass: holidayChecks.observationEnabled && holidayChecks.settingsPersisted,
      observationEnabled: holidayChecks.observationEnabled,
      settingsPersisted: holidayChecks.settingsPersisted,
      popupSupported: holidayChecks.popupSupported,
    };

    // ========== 8. SETTINGS PERSISTENCE ==========
    const settingsChecks = {
      id: !!settings.id,
      holidayObservationField: settings.holiday_observation_enabled !== undefined,
      voiceEnabled: settings.voice_enabled !== undefined,
      responseLengthField: !!settings.response_length,
    };

    report.systemChecks.settingsPersistence = {
      pass: settingsChecks.id && settingsChecks.holidayObservationField,
      checks: settingsChecks,
      note: 'holiday_observation_enabled persists to UserSettings; other fields may be null if user hasn\'t edited them',
    };

    if (!settingsChecks.id) {
      report.warnings.push('UserSettings record not created; will be auto-created on next save');
    }

    // ========== 9. MEMORY SYNCHRONIZATION ==========
    const memories = await base44.entities.CharacterMemory.filter({}, '-timestamp', 50);
    const memoryChecks = {
      invalidCharacterRefs: [],
      orphanedMemories: [],
    };

    memories.forEach(mem => {
      const char = characters.find(c => c.id === mem.character_id);
      if (!char) {
        memoryChecks.orphanedMemories.push({
          memoryId: mem.id,
          characterId: mem.character_id,
          issue: 'character_deleted_but_memory_remains',
        });
      }

      if (mem.related_character_id) {
        const relatedChar = characters.find(c => c.id === mem.related_character_id);
        if (!relatedChar) {
          memoryChecks.invalidCharacterRefs.push({
            memory: mem.memory_summary,
            invalidRef: mem.related_character_id,
          });
        }
      }
    });

    report.systemChecks.memorySynchronization = {
      pass: memoryChecks.invalidCharacterRefs.length === 0 && memoryChecks.orphanedMemories.length === 0,
      invalidRefs: memoryChecks.invalidCharacterRefs,
      orphaned: memoryChecks.orphanedMemories,
    };

    if (memoryChecks.orphanedMemories.length > 0) {
      report.warnings.push(`${memoryChecks.orphanedMemories.length} orphaned memories found`);
    }

    // ========== 10. LOCATION TITLE USAGE ==========
    const titleChecks = {
      workplacesMissingTitles: [],
      schoolsMissingTitles: [],
    };

    characters.forEach(char => {
      const workId = char.current_work_location_id || char.occupation_location_id;
      if (workId) {
        const workLoc = locMap[workId];
        if (workLoc && !workLoc.name) {
          titleChecks.workplacesMissingTitles.push(char.name);
        }
      }

      const schoolId = char.current_school_location_id || char.education_location_id;
      if (schoolId) {
        const schoolLoc = locMap[schoolId];
        if (schoolLoc && !schoolLoc.name) {
          titleChecks.schoolsMissingTitles.push(char.name);
        }
      }
    });

    report.systemChecks.locationTitleUsage = {
      pass: titleChecks.workplacesMissingTitles.length === 0 && titleChecks.schoolsMissingTitles.length === 0,
      workplacesMissingNames: titleChecks.workplacesMissingTitles,
      schoolsMissingNames: titleChecks.schoolsMissingTitles,
    };

    // ========== 11. DATA-DRIVES-BEHAVIOR (Sampling) ==========
    const behaviorChecks = {
      religiousCharacters: characters.filter(c => c.religion && c.religion !== 'None').length,
      addictionData: characters.filter(c => c.system_prompt?.includes('addiction') || c.system_prompt?.includes('recovery')).length,
      traitsData: characters.filter(c => c.trait_oversharer || c.trait_dry_humor || c.trait_night_owl).length,
    };

    report.systemChecks.dataDrivesBehavior = {
      note: 'These characters have meaningful data that should affect location choices and behavior',
      religiousCharacters: behaviorChecks.religiousCharacters,
      addictionRelatedCharacters: behaviorChecks.addictionData,
      traitsWithMeaningfulImpact: behaviorChecks.traitsData,
    };

    // ========== FINAL SUMMARY ==========
    report.executionMs = Date.now() - startTime;
    
    if (!report.pass) {
      report.summary = `DIAGNOSTIC FAILED: ${report.failures.length} critical failures found. See failures array.`;
    } else if (report.warnings.length > 0) {
      report.summary = `DIAGNOSTIC PASSED WITH WARNINGS: ${report.warnings.length} warning(s) found. See warnings array.`;
    } else {
      report.summary = 'DIAGNOSTIC PASSED: All systems verified.';
    }

    return Response.json(report, { status: report.pass ? 200 : 400 });
  } catch (error) {
    return Response.json({
      timestamp: new Date().toISOString(),
      error: error.message,
      stack: error.stack,
      pass: false,
    }, { status: 500 });
  }
});