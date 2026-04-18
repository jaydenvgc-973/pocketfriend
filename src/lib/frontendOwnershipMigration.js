/**
 * PHASE 6: MIGRATE FRONTEND QUERIES
 * 
 * Helper functions and migration guide for frontend code to transition from:
 * - OLD: filter({ created_by: currentUser.email })
 * - NEW: filter({ owner_user_id: currentUser.id })
 * 
 * During migration, both approaches work (Phase 3 dual-read support).
 * But frontend should gradually adopt the new pattern.
 */

/**
 * MIGRATION GUIDE:
 * 
 * 1. In useQuery hooks:
 *    OLD: base44.entities.Character.filter({ created_by: user.email })
 *    NEW: base44.entities.Character.filter({ owner_user_id: user.id })
 * 
 * 2. In direct entity calls:
 *    OLD: base44.entities.Character.list()  // all records (filtered by RLS)
 *    NEW: base44.entities.Character.filter({ owner_user_id: user.id })
 * 
 * 3. When creating records:
 *    OLD: No owner_user_id needed (auto-populated from created_by)
 *    NEW: REQUIRED — use enforceOwnershipOnCreate() helper
 * 
 * 4. When filtering for admin operations:
 *    OLD: base44.asServiceRole.entities.Character.filter({ created_by: targetEmail })
 *    NEW: base44.asServiceRole.entities.Character.filter({ owner_user_id: targetUserId })
 */

/**
 * Build a query filter for the current user's records
 * Automatically uses the new ownership system
 * 
 * Usage:
 * const filter = buildCurrentUserFilter(currentUser);
 * const myCharacters = await base44.entities.Character.filter(filter);
 */
export function buildCurrentUserFilter(currentUser) {
  if (!currentUser?.id) {
    console.warn('[frontendOwnershipMigration] No current user ID available, returning empty filter');
    return {};
  }

  return {
    owner_user_id: currentUser.id,
  };
}

/**
 * Build a query filter for a specific user's records (admin use)
 * 
 * Usage:
 * const filter = buildUserFilter(targetUserId);
 * const targetUserCharacters = await base44.asServiceRole.entities.Character.filter(filter);
 */
export function buildUserFilter(userId) {
  if (!userId) {
    throw new Error('userId is required');
  }

  return {
    owner_user_id: userId,
  };
}

/**
 * Build a query filter with dual-path support (for transition period)
 * Searches for records matching EITHER owner_user_id OR created_by
 * This is useful during the migration phase
 * 
 * Usage:
 * const filter = buildDualPathFilter(currentUser.id, currentUser.email);
 * const myCharacters = await base44.entities.Character.filter(filter);
 * 
 * NOTE: This will return duplicates if records have both owner_user_id and created_by.
 * Use deduplicateRecordsByOwnership() to clean results.
 */
export function buildDualPathFilter(userId, userEmail) {
  if (!userId || !userEmail) {
    throw new Error('Both userId and userEmail are required for dual-path filtering');
  }

  return {
    $or: [
      { owner_user_id: userId },
      { created_by: userEmail },
    ],
  };
}

/**
 * Extract user ID from a user object returned by base44.auth.me()
 * Safely handles both old and new user object formats
 */
export function extractUserId(userObj) {
  if (!userObj) return null;
  
  // Primary: explicit id field
  if (userObj.id) return userObj.id;
  
  // Fallback: email-based lookup (legacy)
  if (userObj.email) return userObj.email;
  
  return null;
}

/**
 * React hook: Build ownership filter for current user
 * Handles user loading state gracefully
 * 
 * Usage in a component:
 * const { data: currentUser } = useQuery({ queryKey: ['user'], queryFn: () => base44.auth.me() });
 * const ownershipFilter = useOwnershipFilter(currentUser);
 * const { data: myCharacters } = useQuery({
 *   queryKey: ['characters'],
 *   queryFn: () => base44.entities.Character.filter(ownershipFilter),
 *   enabled: !!ownershipFilter && ownershipFilter.owner_user_id,
 * });
 */
export function useOwnershipFilterForCurrentUser(currentUser) {
  if (!currentUser?.id) {
    return null;
  }

  return buildCurrentUserFilter(currentUser);
}

/**
 * Validation helper: Check if a query result belongs to the current user
 * Useful for defensive filtering before rendering
 * 
 * Usage:
 * const validRecords = records.filter(r => isRecordOwnedByUser(r, currentUser.id));
 */
export function isRecordOwnedByUser(record, userId) {
  if (!record || !userId) return false;
  
  // Prefer owner_user_id (new system)
  if (record.owner_user_id === userId) return true;
  
  // Fallback to created_by (legacy, for backward compat)
  // Only check if owner_user_id doesn't exist (migration safety)
  if (!record.owner_user_id && record.created_by && record.created_by === userId) {
    return true;
  }
  
  return false;
}

/**
 * Safe filtering for query results
 * Removes any records that don't belong to the current user
 * 
 * Usage:
 * const { data: allChars } = useQuery({...});
 * const safeChars = filterQueryResultsForUser(allChars, currentUser.id);
 */
export function filterQueryResultsForUser(records, userId) {
  if (!Array.isArray(records) || !userId) return [];
  
  return records.filter(record => isRecordOwnedByUser(record, userId));
}

/**
 * Migration debugging helper
 * Analyzes query results to identify mixed ownership patterns
 * (useful for tracking down migration issues)
 */
export function analyzeOwnershipInResults(records, currentUserId) {
  if (!Array.isArray(records)) return null;

  const analysis = {
    total: records.length,
    withNewOwnership: 0,
    withLegacyOwnership: 0,
    withBoth: 0,
    orphaned: 0,
    belongsToUser: 0,
    belongsToOtherUser: 0,
  };

  for (const record of records) {
    const hasNew = !!record.owner_user_id;
    const hasLegacy = !!record.created_by;

    if (hasNew && hasLegacy) {
      analysis.withBoth++;
    } else if (hasNew) {
      analysis.withNewOwnership++;
    } else if (hasLegacy) {
      analysis.withLegacyOwnership++;
    } else {
      analysis.orphaned++;
    }

    // Check ownership
    if (isRecordOwnedByUser(record, currentUserId)) {
      analysis.belongsToUser++;
    } else if (hasNew || hasLegacy) {
      analysis.belongsToOtherUser++;
    }
  }

  return analysis;
}

/**
 * Create a "before/after" migration plan for a component
 * Useful for code review before switching to new system
 */
export function migrationPlan(componentName) {
  return {
    component: componentName,
    steps: [
      {
        step: 1,
        description: 'Identify all base44.entities.*.filter({ created_by: ... }) calls',
        action: 'Search codebase for "created_by" in filter queries',
      },
      {
        step: 2,
        description: 'Get currentUser from useQuery and extract ID',
        action: 'Use extractUserId(currentUser) or currentUser?.id',
      },
      {
        step: 3,
        description: 'Replace filter with ownership-based query',
        action: 'Use buildCurrentUserFilter(currentUser) or { owner_user_id: currentUser.id }',
      },
      {
        step: 4,
        description: 'Test with both old and new data',
        action: 'Verify dual-path filtering still works (Phase 3)',
      },
      {
        step: 5,
        description: 'Add defensive filtering on results',
        action: 'Use filterQueryResultsForUser(results, currentUser.id) if needed',
      },
    ],
  };
}

/**
 * Common migration patterns — copy/paste ready snippets
 */
export const migrationPatterns = {
  // Pattern 1: Simple character list
  characterList: {
    old: `const { data: characters } = useQuery({
  queryKey: ['characters'],
  queryFn: () => base44.entities.Character.filter({ created_by: currentUser.email }),
});`,
    new: `const { data: characters } = useQuery({
  queryKey: ['characters'],
  queryFn: () => base44.entities.Character.filter({ owner_user_id: currentUser.id }),
});`,
  },

  // Pattern 2: With pagination
  characterListPaginated: {
    old: `const { data: characters } = useQuery({
  queryKey: ['characters', page],
  queryFn: () => base44.entities.Character.filter(
    { created_by: currentUser.email },
    '-created_date',
    50,
    page * 50
  ),
});`,
    new: `const { data: characters } = useQuery({
  queryKey: ['characters', page],
  queryFn: () => base44.entities.Character.filter(
    { owner_user_id: currentUser.id },
    '-created_date',
    50,
    page * 50
  ),
});`,
  },

  // Pattern 3: Admin querying user's records
  adminViewingUserRecords: {
    old: `const targetCharacters = await base44.asServiceRole.entities.Character.filter({
  created_by: targetUserEmail
});`,
    new: `const targetCharacters = await base44.asServiceRole.entities.Character.filter({
  owner_user_id: targetUserId
});`,
  },

  // Pattern 4: Creating a record
  createRecord: {
    old: `const newCharacter = await base44.entities.Character.create({
  name: 'John',
  // created_by auto-populated by backend
});`,
    new: `const { data: enforced } = enforceOwnershipOnCreate({
  name: 'John',
}, currentUser.id);

const newCharacter = await base44.entities.Character.create(enforced);`,
  },
};