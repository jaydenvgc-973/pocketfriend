import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // DIAGNOSTIC 1: Get all characters
    const allCharacters = await base44.entities.Character.filter({ created_by: user.email }, '-created_date');
    const allLocations = await base44.entities.LocationReference.list();
    const locationMap = Object.fromEntries(allLocations.map(l => [l.id, l]));

    const characterDiagnostics = [];
    const duplicateFindings = [];
    const contextErrors = [];
    const systemMismatches = [];

    // DIAGNOSTIC 2: Check each character
    for (const char of allCharacters) {
      if (char.status === 'deleted') continue;

      const diag = {
        characterId: char.id,
        characterName: char.name,
        displayName: char.display_name,
        primaryName: char.primary_name,
        aliases: char.aliases ? char.aliases.map(a => a.text) : [],
        currentLocationId: char.current_location_id,
        currentLocationName: char.current_location_id ? locationMap[char.current_location_id]?.name : null,
        currentActivity: char.current_activity,
        workLocationId: char.occupation_location_id,
        workLocationName: char.occupation_location_id ? locationMap[char.occupation_location_id]?.name : null,
        workStartTime: char.work_start_time,
        workEndTime: char.work_end_time,
        workDays: char.work_days,
        isOnShift: false,
        contextualStatus: null,
        issues: [],
      };

      // Check if on shift NOW
      if (char.occupation_location_id && char.work_start_time && char.work_end_time && char.work_days) {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const [startH, startM] = char.work_start_time.split(':').map(Number);
        const [endH, endM] = char.work_end_time.split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;
        diag.isOnShift = char.work_days.includes(dayOfWeek) && currentMinutes >= startMinutes && currentMinutes <= endMinutes;
      }

      // CRITICAL: Check if current_location_id MATCHES activity context, not keywords
      if (char.current_activity && char.current_location_id) {
        const activity = char.current_activity.toLowerCase();
        const locName = diag.currentLocationName?.toLowerCase() || '';
        
        // Does the activity make sense at this location?
        const validContexts = {
          'at work': [diag.workLocationName?.toLowerCase() || ''].filter(Boolean),
          'at home': [char.current_home_location_id ? locationMap[char.current_home_location_id]?.name?.toLowerCase() : ''].filter(Boolean),
          'at gym': ['gym'],
          'at school': [diag.currentLocationName?.toLowerCase() || ''].filter(Boolean),
          'reading': ['home', 'library', 'cafe', 'coffee', 'park', 'bar'], // context-dependent
          'working': [diag.workLocationName?.toLowerCase() || ''].filter(Boolean),
          'off the clock': [diag.workLocationName?.toLowerCase() || ''].filter(Boolean), // at work location but not working
        };

        // Check tense: is this present or past?
        const isPastTense = activity.includes('was ') || activity.includes('went ') || activity.includes('just ');
        const isPresentTense = !isPastTense;

        if (isPastTense) {
          diag.issues.push(`Activity "${char.current_activity}" is in PAST tense — should this be a memory, not current state?`);
        }
      }

      // DIAGNOSTIC 3: Check for location mismatch vs shift
      if (char.current_location_id && char.occupation_location_id && diag.isOnShift) {
        if (char.current_location_id !== char.occupation_location_id) {
          diag.issues.push(`Character is ON SHIFT at ${diag.workLocationName} but current_location_id is set to ${diag.currentLocationName} — this is a CONTRADICTION`);
          systemMismatches.push(diag);
        }
      }

      // DIAGNOSTIC 4: Check if character is at work location but NOT on shift
      if (char.current_location_id === char.occupation_location_id && !diag.isOnShift) {
        diag.issues.push(`Character's stated location is work location (${diag.workLocationName}) but NOT on shift — they are off-duty. Activity should reflect this.`);
      }

      // DIAGNOSTIC 5: Check for duplicate character detection
      const nameVariations = [
        char.name,
        char.primary_name,
        char.display_name,
        ...(char.aliases ? char.aliases.map(a => a.text) : []),
      ].filter(Boolean).map(n => n?.toLowerCase().trim());

      const potentialDuplicates = allCharacters.filter(c => {
        if (c.id === char.id || c.status === 'deleted') return false;
        const otherNames = [
          c.name,
          c.primary_name,
          c.display_name,
          ...(c.aliases ? c.aliases.map(a => a.text) : []),
        ].filter(Boolean).map(n => n?.toLowerCase().trim());
        
        return nameVariations.some(v => otherNames.includes(v));
      });

      if (potentialDuplicates.length > 0) {
        duplicateFindings.push({
          characterId: char.id,
          characterName: char.name,
          potentialDuplicates: potentialDuplicates.map(d => ({ id: d.id, name: d.name })),
        });
      }

      characterDiagnostics.push(diag);
    }

    // DIAGNOSTIC 6: Check conversation integrity
    const allConversations = await base44.entities.Conversation.list();
    const conversationIssues = [];
    for (const conv of allConversations) {
      const missingChars = conv.character_ids.filter(id => !allCharacters.find(c => c.id === id));
      if (missingChars.length > 0) {
        conversationIssues.push({
          conversationId: conv.id,
          title: conv.title,
          missingCharacterIds: missingChars,
        });
      }
    }

    return Response.json({
      timestamp: new Date().toISOString(),
      user: user.email,
      totalCharacters: allCharacters.length,
      totalConversations: allConversations.length,
      diagnostics: {
        characterData: characterDiagnostics,
        duplicateFindings,
        systemMismatches,
        conversationIssues,
      },
      summary: {
        totalIssuesFound: systemMismatches.length + duplicateFindings.length + conversationIssues.length,
        criticalMismatches: systemMismatches.length,
        potentialDuplicates: duplicateFindings.length,
        conversationIntegrityIssues: conversationIssues.length,
      },
      recommendations: [
        `Resolve ${systemMismatches.length} location/schedule contradictions by treating character statements as SOURCE OF TRUTH`,
        `Investigate ${duplicateFindings.length} potential duplicate characters — do not create new ones`,
        `Fix ${conversationIssues.length} broken conversation references`,
        `Ensure ALL location and activity decisions use COMPOUND CONTEXT, not keyword matching`,
        `Before ANY state change: verify across location, schedule, activity, and UI simultaneously`,
      ],
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});