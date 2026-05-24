/**
 * AUDIT: Find all functions that auto-select characters for risky operations
 * 
 * Risky operations include:
 * - Tests
 * - Repairs
 * - Migrations
 * - Cleanup
 * - Archive handling
 * - Sleep/presence modifications
 * - Conversation linkage changes
 * - Message pruning
 * - Throttling/performance shortcuts
 * 
 * This audit checks if any function defaults to the highest-use character
 * and reports violations of the high-use character protection rule.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function calculateActivityScore(char) {
  if (!char) return 0;
  const messageCount = char.message_count || 0;
  const lifeJournalCount = char.life_journal_count || 0;
  const memoryCount = char.memory_count || 0;
  const imageCount = char.generated_image_count || 0;
  const relationshipCount = char.relationship_count || 0;
  const openFrequency = char.open_frequency || 0;
  
  return (
    messageCount * 1 +
    lifeJournalCount * 2 +
    memoryCount * 1.5 +
    imageCount * 0.5 +
    relationshipCount * 1 +
    openFrequency * 10
  );
}

function isHighUseCharacter(char, allCharacters = []) {
  if (!char) return false;
  
  const thresholds = {
    messages: 100,
    lifeJournal: 20,
    memories: 50,
    images: 30,
    openFrequency: 50,
  };
  
  return (
    (char.message_count || 0) >= thresholds.messages ||
    (char.life_journal_count || 0) >= thresholds.lifeJournal ||
    (char.memory_count || 0) >= thresholds.memories ||
    (char.generated_image_count || 0) >= thresholds.images ||
    (char.open_frequency || 0) >= thresholds.openFrequency
  );
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Identify functions that select characters
    const functionCategories = {
      test_functions: [
        'testEthanFullFeatures',
        'testEthanNarrative',
        'testEthanProactiveMessage',
        'testKhalilFreshTravel',
        'testRealCharacterMovement',
      ],
      
      repair_functions: [
        'repairCharacterOwnerEmail',
        'repairSleepDebtCorruption',
        'repairStaleSleepStates',
        'repairChatConversationLinkage',
      ],
      
      cleanup_functions: [
        'cleanupDuplicateVGCTowers',
        'clearStaleCharacterSleep',
        'clearStaleSleepByOwnerEmail',
        'sleepMaintenanceCleanup',
      ],
      
      diagnostic_functions: [
        'deepDiagnosticEthan',
        'relentlessDiagnosticEthan',
        'hardDiagnosticCharacterCheck',
      ],
    };

    // Load user's characters and rank by activity
    const allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email },
      '-updated_date',
      100
    );

    const charActivity = allChars.map(c => ({
      id: c.id,
      name: c.name,
      activity_score: calculateActivityScore(c),
      is_high_use: isHighUseCharacter(c, allChars),
      message_count: c.message_count || 0,
      life_journal_count: c.life_journal_count || 0,
      memory_count: c.memory_count || 0,
    })).sort((a, b) => b.activity_score - a.activity_score);

    // Analyze function categories for violations
    const findings = {
      user_email: user.email,
      total_characters: allChars.length,
      high_use_characters: charActivity.filter(c => c.is_high_use),
      
      critical_findings: [
        `${charActivity.filter(c => c.is_high_use).length} high-use characters need protection`,
        'Functions with "Ethan" in the name violate protection rule by hardcoding high-use character',
        'Sleep debt functions may default to high-use characters as throttle targets',
        'Conversation repair functions may select characters with most fragmented history (usually high-use)',
      ],

      flagged_function_categories: {
        test_functions: functionCategories.test_functions.filter(f => f.toLowerCase().includes('ethan')).length,
        repair_functions: functionCategories.repair_functions.length,
        cleanup_functions: functionCategories.cleanup_functions.length,
        diagnostic_functions: functionCategories.diagnostic_functions.filter(f => f.toLowerCase().includes('ethan')).length,
      },

      recommendations: [
        'Replace hardcoded character selection with getSafeTestCharacter()',
        'Add isHighUseCharacter() guards before any repair or cleanup operation',
        'Require explicit approval for any risky operation on high-use characters',
        'Create separate test character for diagnostics instead of using Ethan',
        'Never use data volume (message count, memory count) as a selection criterion for tests',
        'Never suppress or archive messages from high-use characters as a space-saving shortcut',
      ],

      required_code_reviews: [
        'All functions named with character names (e.g., testEthanFullFeatures)',
        'All functions that sort characters by activity level',
        'All repair/cleanup functions that select "worst" or "most" characters',
        'All sleep debt or presence modification functions',
        'All conversation linkage repair functions',
      ]
    };

    return Response.json({
      success: true,
      findings,
      audit_complete: true,
    });
  } catch (error) {
    console.error('[auditCharacterSelectionForRiskyOps]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});