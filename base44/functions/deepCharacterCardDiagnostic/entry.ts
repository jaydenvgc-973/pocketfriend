import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const characters = await base44.entities.Character.filter({ created_by: user.email }, '-created_date', 100);
    const locations = await base44.entities.LocationReference.list('-created_date', 200);
    const financials = await base44.entities.CharacterFinancial.list('-created_date', 100);
    const conversations = await base44.entities.Conversation.list('-created_date', 500);
    
    const locationMap = Object.fromEntries(locations.map(l => [l.id, l]));
    
    const report = {
      totalCharacters: characters.length,
      activeCharacters: characters.filter(c => c.status === 'active').length,
      characterReports: [],
      rules: {
        gym: 'Character at gym should have current_location_id pointing to gym location + gym category + character in gym_members',
        restaurant: 'Character at restaurant should have current_location_id + food_drink category + valid location name',
        bar: 'Character at bar should have current_location_id + food_drink OR social category + bar keyword in name/keywords',
        club: 'Character at club should have current_location_id + social category + club/nightclub in keywords'
      },
      gaps: [],
      misalignments: []
    };

    for (const char of characters) {
      if (char.status !== 'active') continue;

      const charReport = {
        characterId: char.id,
        characterName: char.name,
        variables: {
          current_activity: char.current_activity || null,
          current_location_id: char.current_location_id || null,
          current_work_location_id: char.current_work_location_id || null,
          current_home_location_id: char.current_home_location_id || null,
          current_school_location_id: char.current_school_location_id || null,
          emotional_state: char.emotional_state || 'unknown',
          character_type: char.character_type || 'unknown',
          is_default: char.is_default || false,
          health_status: char.health_status || null,
          student_status: char.student_status || 'not_student',
          current_job_training_activity: char.current_job_training_activity || 'none',
          work_start_time: char.work_start_time || null,
          work_end_time: char.work_end_time || null,
          wake_time: char.wake_time || null,
          sleep_time: char.sleep_time || null
        },
        locations: {},
        issues: [],
        ruleChecks: {}
      };

      // Map all location references
      if (char.current_location_id) {
        charReport.locations.current = locationMap[char.current_location_id] || { id: char.current_location_id, name: 'MISSING LOCATION DATA' };
      }
      if (char.current_work_location_id) {
        charReport.locations.work = locationMap[char.current_work_location_id] || { id: char.current_work_location_id, name: 'MISSING LOCATION DATA' };
      }
      if (char.current_home_location_id) {
        charReport.locations.home = locationMap[char.current_home_location_id] || { id: char.current_home_location_id, name: 'MISSING LOCATION DATA' };
      }
      if (char.current_school_location_id) {
        charReport.locations.school = locationMap[char.current_school_location_id] || { id: char.current_school_location_id, name: 'MISSING LOCATION DATA' };
      }

      // Check activity parsing
      const activity = (char.current_activity || '').toLowerCase().trim();
      charReport.activityParsing = {
        raw: char.current_activity,
        lowerTrimmed: activity,
        hasGymKeyword: activity.includes('gym'),
        hasWorkKeyword: activity.includes('work'),
        hasHomeKeyword: activity.includes('home') || activity.includes('bed') || activity.includes('apartment'),
        hasRestaurantKeyword: activity.includes('restaurant') || activity.includes('dinner') || activity.includes('lunch') || activity.includes('brunch'),
        hasBarKeyword: activity.includes('bar') || activity.includes('lounge') || activity.includes('happy hour'),
        hasClubKeyword: activity.includes('club') || activity.includes('nightclub') || activity.includes('nightlife'),
        hasCoffeeKeyword: activity.includes('coffee') || activity.includes('café') || activity.includes('cafe'),
        hasMallKeyword: activity.includes('mall') || activity.includes('shopping'),
        hasWorkLocationName: char.current_work_location_id && activity.includes(locationMap[char.current_work_location_id]?.name?.toLowerCase() || 'NOTFOUND')
      };

      // RULE CHECK: GYM
      if (charReport.activityParsing.hasGymKeyword) {
        const currentLoc = charReport.locations.current;
        const isGymCategory = currentLoc && currentLoc.category === 'gym';
        const isInGymMembers = currentLoc && currentLoc.gym_members && currentLoc.gym_members.includes(char.id);
        const hasLocationId = !!char.current_location_id;

        charReport.ruleChecks.gym = {
          rule: 'At gym: current_location_id + gym category + in gym_members',
          hasLocationId,
          isGymCategory,
          isInGymMembers,
          currentLocation: currentLoc?.name || 'NONE',
          passed: hasLocationId && isGymCategory && isInGymMembers
        };
        
        if (!charReport.ruleChecks.gym.passed) {
          charReport.issues.push(`GYM RULE FAILED: hasLocationId=${hasLocationId}, isGymCategory=${isGymCategory}, isInGymMembers=${isInGymMembers}`);
        }
      }

      // RULE CHECK: RESTAURANT
      if (charReport.activityParsing.hasRestaurantKeyword) {
        const currentLoc = charReport.locations.current;
        const isFoodDrinkCategory = currentLoc && (currentLoc.category === 'food_drink' || currentLoc.category === 'restaurant');
        const hasValidName = currentLoc && currentLoc.name;
        const hasLocationId = !!char.current_location_id;

        charReport.ruleChecks.restaurant = {
          rule: 'At restaurant: current_location_id + food_drink category + valid name',
          hasLocationId,
          isFoodDrinkCategory,
          hasValidName,
          currentLocation: currentLoc?.name || 'NONE',
          passed: hasLocationId && isFoodDrinkCategory && hasValidName
        };

        if (!charReport.ruleChecks.restaurant.passed) {
          charReport.issues.push(`RESTAURANT RULE FAILED: hasLocationId=${hasLocationId}, isFoodDrinkCategory=${isFoodDrinkCategory}, hasValidName=${hasValidName}`);
        }
      }

      // RULE CHECK: BAR
      if (charReport.activityParsing.hasBarKeyword) {
        const currentLoc = charReport.locations.current;
        const isSocialOrFoodDrink = currentLoc && (currentLoc.category === 'social' || currentLoc.category === 'food_drink');
        const hasBarKeywordInLocation = currentLoc && (
          currentLoc.name?.toLowerCase().includes('bar') ||
          currentLoc.keywords?.some(k => k.toLowerCase().includes('bar'))
        );
        const hasLocationId = !!char.current_location_id;

        charReport.ruleChecks.bar = {
          rule: 'At bar: current_location_id + social/food_drink category + bar keyword',
          hasLocationId,
          isSocialOrFoodDrink,
          hasBarKeywordInLocation,
          currentLocation: currentLoc?.name || 'NONE',
          locationKeywords: currentLoc?.keywords || [],
          passed: hasLocationId && isSocialOrFoodDrink && hasBarKeywordInLocation
        };

        if (!charReport.ruleChecks.bar.passed) {
          charReport.issues.push(`BAR RULE FAILED: hasLocationId=${hasLocationId}, isSocialOrFoodDrink=${isSocialOrFoodDrink}, hasBarKeywordInLocation=${hasBarKeywordInLocation}`);
        }
      }

      // RULE CHECK: CLUB
      if (charReport.activityParsing.hasClubKeyword) {
        const currentLoc = charReport.locations.current;
        const isSocialCategory = currentLoc && currentLoc.category === 'social';
        const hasClubKeywordInLocation = currentLoc && (
          currentLoc.name?.toLowerCase().includes('club') ||
          currentLoc.name?.toLowerCase().includes('nightclub') ||
          currentLoc.keywords?.some(k => k.toLowerCase().includes('club') || k.toLowerCase().includes('nightclub'))
        );
        const hasLocationId = !!char.current_location_id;

        charReport.ruleChecks.club = {
          rule: 'At club: current_location_id + social category + club keyword',
          hasLocationId,
          isSocialCategory,
          hasClubKeywordInLocation,
          currentLocation: currentLoc?.name || 'NONE',
          locationKeywords: currentLoc?.keywords || [],
          passed: hasLocationId && isSocialCategory && hasClubKeywordInLocation
        };

        if (!charReport.ruleChecks.club.passed) {
          charReport.issues.push(`CLUB RULE FAILED: hasLocationId=${hasLocationId}, isSocialCategory=${isSocialCategory}, hasClubKeywordInLocation=${hasClubKeywordInLocation}`);
        }
      }

      // DISPLAY ALIGNMENT CHECKS
      const displayChecks = {
        currentLocationIdExists: !!char.current_location_id,
        currentLocationDataExists: !!charReport.locations.current,
        currentLocationHasName: charReport.locations.current?.name !== undefined,
        currentLocationHasCategory: charReport.locations.current?.category !== undefined,
        workLocationIdExists: !!char.current_work_location_id,
        workLocationDataExists: !!charReport.locations.work,
        homeLocationIdExists: !!char.current_home_location_id,
        homeLocationDataExists: !!charReport.locations.home,
        homeLocationHasDisplayName: charReport.locations.home?.name !== undefined,
        workScheduleConfigured: !!char.work_start_time && !!char.work_end_time
      };

      charReport.displayAlignment = displayChecks;
      
      if (!displayChecks.currentLocationDataExists && displayChecks.currentLocationIdExists) {
        charReport.issues.push(`CRITICAL: current_location_id set but location data missing in database`);
      }
      if (!displayChecks.workLocationDataExists && displayChecks.workLocationIdExists) {
        charReport.issues.push(`CRITICAL: current_work_location_id set but location data missing in database`);
      }
      if (!displayChecks.homeLocationDataExists && displayChecks.homeLocationIdExists) {
        charReport.issues.push(`CRITICAL: current_home_location_id set but home location data missing in database`);
      }
      if (displayChecks.homeLocationIdExists && !displayChecks.homeLocationHasDisplayName) {
        charReport.issues.push(`CRITICAL: home location missing display_name`);
      }

      // CHECK FOR GAPS
      const gaps = [];
      if (!char.current_activity && char.status === 'active') {
        gaps.push('No current_activity set');
      }
      if (!char.current_home_location_id && char.status === 'active' && char.character_type !== 'npc' && char.character_type !== 'background') {
        gaps.push('CRITICAL: No current_home_location_id set for active character');
      }
      if (char.current_home_location_id && !charReport.locations.home) {
        gaps.push('CRITICAL: current_home_location_id references missing location in database');
      }
      if (!char.current_work_location_id && char.occupation && !char.occupation.includes('unemployed') && !char.occupation.includes('student')) {
        gaps.push('Occupation set but no work_location_id');
      }
      if (!char.current_school_location_id && (char.student_status === 'enrolled' || char.education)) {
        gaps.push('Student status enrolled but no school_location_id');
      }
      if (!char.emotional_state) {
        gaps.push('No emotional_state');
      }
      if (!char.wake_time || !char.sleep_time) {
        gaps.push('Incomplete sleep schedule');
      }
      if (!char.voice_enabled && char.character_type === 'active') {
        gaps.push('Voice disabled for active character');
      }
      if (char.work_start_time && char.work_end_time && !char.work_days) {
        gaps.push('Work times set but no work_days');
      }
      if (char.current_work_location_id && !char.work_start_time && !char.work_end_time) {
        gaps.push('Work location set but no schedule times');
      }
      if (!char.gender && char.character_type !== 'npc') {
        gaps.push('No gender set');
      }
      if (!char.age && !char.birth_year && char.character_type !== 'npc') {
        gaps.push('No age or birth year set');
      }

      charReport.gaps = gaps;

      if (charReport.issues.length > 0 || gaps.length > 0) {
        report.characterReports.push(charReport);
      }
    }

    // Summary of all issues
    report.characterReports.forEach(charReport => {
      if (charReport.issues.length > 0) {
        report.misalignments.push({
          character: charReport.characterName,
          issues: charReport.issues
        });
      }
      if (charReport.gaps.length > 0) {
        report.gaps.push({
          character: charReport.characterName,
          gaps: charReport.gaps
        });
      }
    });

    return Response.json(report);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});