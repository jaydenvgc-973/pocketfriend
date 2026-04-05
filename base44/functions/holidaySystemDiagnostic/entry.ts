import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const checks = {};
    const failures = [];

    // 1. CHECK SETTINGS PERSISTENCE
    checks.settingsPersistence = await checkSettingsPersistence(base44, user);
    if (!checks.settingsPersistence.pass) failures.push(...checks.settingsPersistence.issues);

    // 2. CHECK LOCATION OCCUPANCY VALIDITY
    checks.locationOccupancy = await checkLocationOccupancy(base44, user);
    if (!checks.locationOccupancy.pass) failures.push(...checks.locationOccupancy.issues);

    // 3. CHECK CHARACTER DUPLICATE PRESENCE
    checks.characterPresence = await checkCharacterPresence(base44, user);
    if (!checks.characterPresence.pass) failures.push(...checks.characterPresence.issues);

    // 4. CHECK CLOSURE LOGIC
    checks.closureLogic = await checkClosureLogic(base44, user);
    if (!checks.closureLogic.pass) failures.push(...checks.closureLogic.issues);

    // 5. CHECK SCHEDULE OVERRIDE
    checks.scheduleOverride = await checkScheduleOverride(base44, user);
    if (!checks.scheduleOverride.pass) failures.push(...checks.scheduleOverride.issues);

    // 6. CHECK MEMORY CONTINUITY
    checks.memoryContinuity = await checkMemoryContinuity(base44, user);
    if (!checks.memoryContinuity.pass) failures.push(...checks.memoryContinuity.issues);

    const pass = failures.length === 0;

    return Response.json({
      timestamp: new Date().toISOString(),
      diagnostic: {
        pass,
        totalFailures: failures.length,
        failures,
      },
      checks,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function checkSettingsPersistence(base44, user) {
  const issues = [];
  const userSettings = await base44.entities.UserSettings.filter({ created_by: user.email });
  const settings = userSettings[0];

  if (!settings) {
    return { pass: false, issues: ['CRITICAL: UserSettings not found for user'] };
  }

  // Check if holiday observation toggle exists
  const hasToggle = 'holiday_observation_enabled' in settings;
  if (!hasToggle) {
    issues.push('WARNING: holiday_observation_enabled not set in UserSettings');
  }

  return { pass: issues.length === 0, issues };
}

async function checkLocationOccupancy(base44, user) {
  const issues = [];
  
  const characters = await base44.entities.Character.filter({ created_by: user.email });
  const locations = await base44.entities.LocationReference.list();
  
  for (const char of characters) {
    const residesAt = locations.filter(l =>
      l.resident_character_ids?.includes(char.id) ||
      l.resident_character_names?.includes(char.name)
    );

    if (residesAt.length > 1) {
      issues.push(`CRITICAL: ${char.name} appears in ${residesAt.length} homes (${residesAt.map(l => l.name).join(', ')})`);
    }

    // Check for stale occupancy
    const lastUpdate = char.updated_date ? new Date(char.updated_date) : null;
    const now = new Date();
    const daysSinceUpdate = lastUpdate ? (now - lastUpdate) / (1000 * 60 * 60 * 24) : 0;
    
    if (daysSinceUpdate > 30) {
      issues.push(`INFO: ${char.name} occupancy not updated for ${Math.floor(daysSinceUpdate)} days`);
    }
  }

  return { pass: issues.filter(i => i.startsWith('CRITICAL')).length === 0, issues };
}

async function checkCharacterPresence(base44, user) {
  const issues = [];
  
  const characters = await base44.entities.Character.filter({ created_by: user.email });
  const locations = await base44.entities.LocationReference.list();

  for (const char of characters) {
    // Check if character has valid current location
    if (char.current_location_id) {
      const validLoc = locations.find(l => l.id === char.current_location_id);
      if (!validLoc) {
        issues.push(`ERROR: ${char.name} current_location_id points to deleted location`);
      }
    }

    // Check if character home location exists
    if (char.current_home_location_id) {
      const homeExists = locations.find(l => l.id === char.current_home_location_id);
      if (!homeExists) {
        issues.push(`ERROR: ${char.name} home location does not exist`);
      }
    }

    // Check for presence in multiple locations simultaneously
    const presentAt = locations.filter(l =>
      l.resident_character_ids?.includes(char.id) ||
      l.resident_character_names?.includes(char.name)
    );

    if (presentAt.length > 1) {
      issues.push(`CRITICAL: ${char.name} simultaneously present in: ${presentAt.map(l => l.name).join(', ')}`);
    }
  }

  return { pass: issues.filter(i => i.startsWith('CRITICAL')).length === 0, issues };
}

async function checkClosureLogic(base44, user) {
  const issues = [];
  
  const locations = await base44.entities.LocationReference.list();
  
  // Find locations with category 'office' or 'school'
  const offices = locations.filter(l => l.category === 'workplace' || l.category === 'office');
  const schools = locations.filter(l => l.category === 'school' || l.category === 'education');

  // Check if any have holiday closure metadata
  const hasClosureData = [...offices, ...schools].some(l => l.holiday_closures || l.closed_on_holidays);

  if (!hasClosureData) {
    issues.push('INFO: No holiday closure data found on locations (may need implementation)');
  }

  return { pass: true, issues };
}

async function checkScheduleOverride(base44, user) {
  const issues = [];
  
  const characters = await base44.entities.Character.filter({ created_by: user.email });

  for (const char of characters) {
    // Check if character has schedule profile
    if (char.schedule_profile_id) {
      const profiles = await base44.entities.CharacterScheduleProfile.filter({ id: char.schedule_profile_id });
      if (profiles.length === 0) {
        issues.push(`WARNING: ${char.name} schedule_profile_id references deleted profile`);
      }
    }
  }

  return { pass: issues.filter(i => i.startsWith('ERROR')).length === 0, issues };
}

async function checkMemoryContinuity(base44, user) {
  const issues = [];
  
  const characters = await base44.entities.Character.filter({ created_by: user.email });
  const memories = await base44.entities.CharacterMemory.filter({});

  for (const char of characters) {
    const charMemories = memories.filter(m => m.character_id === char.id);
    if (charMemories.length === 0) {
      issues.push(`INFO: ${char.name} has no memories recorded yet`);
    }
  }

  return { pass: true, issues };
}