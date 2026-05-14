/**
 * Runtime Verification Harness
 * 
 * Collects REAL records from the database and runs actual checks.
 * Safe by default (dryRun=true). Optionally runs mutating tests.
 * 
 * NOT a document. Returns actual data from live app.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      dryRun = true,
      runTravelPromiseTest = false,
      testCharacterId = null,
      testCharacterConfirmed = false,
    } = await req.json();

    // ── PROOF LEVEL ──────────────────────────────────────────────────────────
    let proofLevel = dryRun ? 'read_only_runtime' : 'mutating_runtime_test';

    // ── COLLECT REAL RECORDS ─────────────────────────────────────────────────

    // 1. User Settings
    const userSettingsArr = await base44.entities.UserSettings.filter(
      { owner_email: user.email },
      null,
      1
    );
    const userSettings = userSettingsArr?.[0] || {};

    // 2. Character Roster
    const characters = await base44.entities.Character.filter(
      { owner_email: user.email },
      '-created_date',
      100
    );

    // 3. Selected test character (default: first active character)
    let testChar = null;
    if (testCharacterId) {
      const tcArr = await base44.entities.Character.filter(
        { id: testCharacterId, owner_email: user.email },
        null,
        1
      );
      testChar = tcArr?.[0];
    } else {
      testChar = characters.find(c => c.is_active_character) || characters[0];
    }

    // 4. User location
    const userHasLocation = !!(userSettings.user_current_location_id && userSettings.user_current_location_name);

    // 5. Chat Cache Status (sample recent conversations)
    const recentConvos = await base44.entities.Conversation.filter(
      { character_ids: { $in: characters.map(c => c.id) } },
      '-last_message_date',
      10
    );

    // 6. Recent image messages (last 5)
    const imageMessages = await base44.entities.Message.filter(
      { image_url: { $exists: true } },
      '-created_date',
      5
    );

    // 7. Recent ScheduledEvents (last 10)
    const scheduledEvents = await base44.entities.ScheduledEvent.filter(
      { primary_character_id: { $in: characters.map(c => c.id) } },
      '-created_date',
      10
    );

    // 8. Recent Memories (last 10)
    const memories = testChar
      ? await base44.entities.CharacterMemory.filter(
          { character_id: testChar.id },
          '-created_date',
          10
        )
      : [];

    // 9. Recent LifeEvents (last 10)
    const lifeEvents = testChar
      ? await base44.entities.LifeEvent.filter(
          { character_id: testChar.id },
          '-created_date',
          10
        )
      : [];

    // 10. Moments/Achievements
    const achievements = await base44.entities.UserAchievement.filter(
      { owner_email: user.email },
      '-unlocked_at',
      20
    );

    // 11. Check for AVIF/HEIC in locations
    const locations = await base44.entities.LocationReference.filter(
      { owner_email: user.email },
      null,
      50
    );
    const unsupportedImageAnalysis = analyzeLocationImages(locations);

    // ── RUN SAFE CHECKS ──────────────────────────────────────────────────────

    const checks = {
      owner_email_present: !!user.email,
      no_created_by_usage: checkNoCreatedByUsage(characters, memories, lifeEvents),
      user_location_known: userHasLocation,
      user_location_id: userSettings.user_current_location_id || 'UNKNOWN',
      user_location_name: userSettings.user_current_location_name || 'UNKNOWN',
      character_roster_count: characters.length,
      test_character_available: !!testChar,
      test_character_id: testChar?.id || null,
      test_character_name: testChar?.name || null,
      test_character_has_avatar: !!(testChar?.avatar_url || testChar?.reference_image_urls?.length),
      recent_conversations_loaded: recentConvos.length,
      image_messages_valid: imageMessages.filter(m => m.image_url || m.generation_context).length,
      image_messages_with_generation_context: imageMessages.filter(m => m.generation_context).length,
      scheduled_events_pending: scheduledEvents.filter(e => e.status === 'pending').length,
      scheduled_events_completed: scheduledEvents.filter(e => e.status === 'completed').length,
      memories_written: memories.length,
      memories_with_source_context: memories.filter(m => m.source_context).length,
      life_events_recorded: lifeEvents.length,
      achievements_unlocked: achievements.length,
      bilateral_memory_ready: checkBilateralMemoryReadiness(characters),
      unsupported_images: {
        total_count: unsupportedImageAnalysis.totalUnsupported,
        affected_locations: unsupportedImageAnalysis.affectedLocations.length,
        has_replacements_needed: unsupportedImageAnalysis.needsReplacement,
        details: unsupportedImageAnalysis.details.slice(0, 5), // First 5 issues
      },
    };

    // ── OPTIONAL: TRAVEL PROMISE TEST ────────────────────────────────────────

    let travelTestResult = null;
    if (runTravelPromiseTest && testCharacterId && testCharacterConfirmed) {
      if (!dryRun) {
        proofLevel = 'mutating_runtime_test';

        // Get character before state
        const beforeArr = await base44.entities.Character.filter(
          { id: testCharacterId, owner_email: user.email },
          null,
          1
        );
        const beforeRecord = beforeArr?.[0];

        if (!beforeRecord) {
          return Response.json({
            error: 'Test character not found',
            proof_level: proofLevel,
          }, { status: 404 });
        }

        // Check user location
        if (!userSettings.user_current_location_id) {
          return Response.json({
            error: 'User location required for travel test',
            proof_level: proofLevel,
            recovery: 'User must be at a location first',
          }, { status: 400 });
        }

        // Run travel promise test
        try {
          const travelRes = await base44.functions.invoke('commitCharacterTravelToUser', {
            characterId: testCharacterId,
            characterResponse: 'I am on my way right now!',
            conversationId: recentConvos[0]?.id || null,
          });

          if (!travelRes?.data?.committed) {
            return Response.json({
              error: 'Travel commitment failed',
              proof_level: proofLevel,
              reason: travelRes?.data?.reason,
            }, { status: 400 });
          }

          // Get character after state
          const afterArr = await base44.entities.Character.filter(
            { id: testCharacterId, owner_email: user.email },
            null,
            1
          );
          const afterRecord = afterArr?.[0];

          // Get created ScheduledEvent
          const eventsArr = await base44.entities.ScheduledEvent.filter(
            { primary_character_id: testCharacterId, source: 'conversation_travel_promise' },
            '-created_date',
            1
          );
          const scheduledEvent = eventsArr?.[0];

          travelTestResult = {
            success: true,
            before_record: {
              id: beforeRecord.id,
              name: beforeRecord.name,
              travel_status: beforeRecord.travel_status,
              resolved_presence_status: beforeRecord.resolved_presence_status,
              resolved_current_location_id: beforeRecord.resolved_current_location_id,
            },
            after_record: {
              id: afterRecord.id,
              name: afterRecord.name,
              travel_status: afterRecord.travel_status,
              resolved_presence_status: afterRecord.resolved_presence_status,
              resolved_current_location_id: afterRecord.resolved_current_location_id,
              traveling_to_location_id: afterRecord.traveling_to_location_id,
              traveling_to_location_name: afterRecord.traveling_to_location_name,
              travel_destination_location_id: afterRecord.travel_destination_location_id,
              last_location_update_time: afterRecord.last_location_update_time,
            },
            scheduled_event_payload: scheduledEvent ? {
              id: scheduledEvent.id,
              type: scheduledEvent.type,
              status: scheduledEvent.status,
              trigger_time: scheduledEvent.trigger_time,
              primary_character_id: scheduledEvent.primary_character_id,
              event_payload: scheduledEvent.event_payload,
            } : null,
            next_required_action: 'Wait for ScheduledEvent to fire (in ~20 min) or manually call processScheduledEvents to verify arrival',
          };
        } catch (err) {
          travelTestResult = {
            success: false,
            error: err.message,
          };
        }
      } else {
        // Dry run: show what would happen
        travelTestResult = {
          dry_run: true,
          message: 'Travel test would write travel_status=traveling_to_destination and create ScheduledEvent',
          would_use_location: {
            id: userSettings.user_current_location_id,
            name: userSettings.user_current_location_name,
          },
        };
      }
    }

    // ── REPORT ───────────────────────────────────────────────────────────────

    return Response.json({
      proof_level: proofLevel,
      dryRun,
      timestamp: new Date().toISOString(),
      user: {
        email: user.email,
        full_name: user.full_name,
      },
      checks,
      travel_promise_test: travelTestResult,
      warnings: generateWarnings(checks, characters),
      next_steps: generateNextSteps(checks, travelTestResult, dryRun),
    });

  } catch (error) {
    console.error('[runAppCompletionVerification]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

// ── HELPERS ──────────────────────────────────────────────────────────────────

function checkNoCreatedByUsage(characters, memories, lifeEvents) {
  const charsWithCreatedBy = characters.filter(c => c.created_by).length;
  const memsWithCreatedBy = memories.filter(m => m.created_by).length;
  const eventsWithCreatedBy = lifeEvents.filter(e => e.created_by).length;

  return (charsWithCreatedBy + memsWithCreatedBy + eventsWithCreatedBy) === 0;
}

function analyzeLocationImages(locations) {
  const unsupportedFormats = ['avif', 'heic', 'heif'];
  const details = [];
  let totalUnsupported = 0;
  const affectedLocations = new Set();

  locations.forEach(loc => {
    if (!loc.zones) return;
    loc.zones.forEach(zone => {
      if (!zone.image_urls) return;
      const unsupported = zone.image_urls.filter(url => {
        const ext = url?.toLowerCase().split('.').pop()?.split('?')[0];
        return unsupportedFormats.includes(ext);
      });
      if (unsupported.length > 0) {
        totalUnsupported += unsupported.length;
        affectedLocations.add(loc.name);
        details.push({
          location: loc.name,
          zone: zone.zone_name,
          unsupported_count: unsupported.length,
          total_in_zone: zone.image_urls.length,
        });
      }
    });
  });

  return {
    totalUnsupported,
    affectedLocations: Array.from(affectedLocations),
    needsReplacement: totalUnsupported > 0,
    details,
  };
}

function checkBilateralMemoryReadiness(characters) {
  // Check if at least one character pair has potential for bilateral sync
  const withMemories = characters.filter(c => c.family_members?.length > 0 || c.fictional_relationships?.length > 0);
  return withMemories.length >= 2;
}

function generateWarnings(checks, characters) {
  const warnings = [];

  if (!checks.user_location_known) {
    warnings.push('User location unknown — travel promise tests will fail with 400');
  }

  if (characters.length === 0) {
    warnings.push('No characters found — verify owner_email scoping');
  }

  if (checks.unsupported_images.total_count > 0) {
    warnings.push(`${checks.unsupported_images.total_count} unsupported images detected — may cause generation issues`);
  }

  if (checks.image_messages_valid > 0 && checks.image_messages_with_generation_context === 0) {
    warnings.push('Image messages exist but no generation_context recorded — regeneration recovery unavailable');
  }

  if (checks.scheduled_events_pending > 5) {
    warnings.push(`${checks.scheduled_events_pending} pending ScheduledEvents — check processScheduledEvents execution`);
  }

  return warnings;
}

function generateNextSteps(checks, travelTestResult, dryRun) {
  const steps = [];

  if (!checks.user_location_known) {
    steps.push('REQUIRED: Set user location in UserSettings before running travel promise test');
  }

  if (!checks.test_character_available) {
    steps.push('REQUIRED: Create or select a test character');
  }

  if (!checks.test_character_has_avatar) {
    steps.push('RECOMMENDED: Add avatar or reference images to test character for image generation');
  }

  if (checks.unsupported_images.has_replacements_needed) {
    steps.push('ACTION: Replace unsupported AVIF/HEIC images with JPEG/PNG in affected zones');
  }

  if (travelTestResult?.success) {
    steps.push('✓ Travel promise test PASSED: Verify arrival by waiting 20 min or calling processScheduledEvents manually');
  }

  if (dryRun && !travelTestResult?.dry_run) {
    steps.push('NEXT: Run with dryRun=false and runTravelPromiseTest=true to execute actual travel promise test');
  }

  return steps;
}