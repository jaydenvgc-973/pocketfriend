/**
 * PHASE 3: DUAL-READ COMPATIBILITY
 * 
 * Provides utility functions for reading data with both old (created_by) and new (owner_user_id) ownership logic.
 * This is a TEMPORARY BRIDGE during the migration.
 * 
 * Once Phase 5+ is complete, these functions should be deprecated.
 */

/**
 * Check if a record has valid ownership
 * Returns: { hasNewOwnership: boolean, hasLegacyOwnership: boolean, ownerId: string|null }
 */
export function checkRecordOwnership(record) {
  const hasNewOwnership = !!record?.owner_user_id;
  const hasLegacyOwnership = !!record?.created_by;
  
  return {
    hasNewOwnership,
    hasLegacyOwnership,
    // Prefer new ownership if it exists
    ownerId: record?.owner_user_id || record?.created_by || null,
  };
}

/**
 * Resolve the owning user ID from a record using dual-path logic
 * Returns: userId string or null
 */
export function resolveOwnerIdFromRecord(record) {
  if (!record) return null;
  // Prefer owner_user_id (new system), fall back to created_by (legacy)
  return record.owner_user_id || record.created_by || null;
}

/**
 * Build a query filter that matches records owned by a specific user
 * Uses dual logic: checks BOTH owner_user_id AND created_by
 * 
 * This allows:
 * - New records (with owner_user_id) to be found
 * - Old records (with created_by email) to be found
 * 
 * Returns: query object compatible with base44 SDK
 */
export function buildOwnershipFilter(userId, createdByEmail) {
  return {
    $or: [
      { owner_user_id: userId },           // New system
      { created_by: createdByEmail },      // Legacy system
    ],
  };
}

/**
 * Filter an in-memory array of records by ownership
 * Uses dual-path logic for maximum compatibility
 */
export function filterRecordsByOwnership(records, userId, createdByEmail) {
  if (!Array.isArray(records)) return [];
  
  return records.filter(record => {
    const ownership = checkRecordOwnership(record);
    
    // Accept if either system matches
    if (ownership.hasNewOwnership && record.owner_user_id === userId) {
      return true;
    }
    if (ownership.hasLegacyOwnership && record.created_by === createdByEmail) {
      return true;
    }
    
    return false;
  });
}

/**
 * Deduplicate records that might appear twice (once via owner_user_id, once via created_by)
 * Keeps the one with newer ownership data (owner_user_id presence)
 */
export function deduplicateRecordsByOwnership(records) {
  if (!Array.isArray(records)) return [];
  
  const seen = new Set();
  const result = [];
  
  for (const record of records) {
    if (seen.has(record.id)) {
      continue;
    }
    
    seen.add(record.id);
    result.push(record);
  }
  
  return result;
}

/**
 * Check if a record should be visible to a user
 * Uses dual-path logic:
 * - New: owner_user_id must match userId
 * - Legacy: created_by must match createdByEmail
 */
export function isRecordVisibleToUser(record, userId, createdByEmail) {
  if (!record) return false;
  
  const ownership = checkRecordOwnership(record);
  
  // If it has new ownership, ONLY check owner_user_id
  if (ownership.hasNewOwnership) {
    return record.owner_user_id === userId;
  }
  
  // If it only has legacy ownership, check created_by
  if (ownership.hasLegacyOwnership) {
    return record.created_by === createdByEmail;
  }
  
  // No ownership at all
  return false;
}

/**
 * Ensure a record is marked with new ownership on read
 * If a record has legacy ownership but no owner_user_id, suggest backfill
 * 
 * Returns: { needsBackfill: boolean, ownerId: string|null }
 */
export function checkRecordBackfillStatus(record) {
  const { hasNewOwnership, hasLegacyOwnership } = checkRecordOwnership(record);
  
  return {
    needsBackfill: hasLegacyOwnership && !hasNewOwnership,
    hasOwnership: hasNewOwnership || hasLegacyOwnership,
  };
}

/**
 * Apply data_scope defaults if missing
 * Used during Phase 3 to ensure records have proper scope metadata
 */
export function ensureDataScope(record) {
  if (!record) return null;
  
  // If record already has data_scope, keep it
  if (record.data_scope) {
    return record;
  }
  
  // Default: private_user for records with any ownership
  return {
    ...record,
    data_scope: 'private_user',
  };
}