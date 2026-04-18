/**
 * PHASE 4: LOCK NEW WRITES
 * 
 * Enforcement layer that ensures all NEW records are created with proper ownership.
 * This STOPS future contamination — no new records can be created without owner_user_id.
 * 
 * Use this middleware/validator BEFORE every CREATE operation.
 */

/**
 * Validate and enforce ownership on CREATE payload
 * 
 * Rules:
 * - owner_user_id is REQUIRED (cannot be null)
 * - data_scope defaults to 'private_user' for user-owned records
 * - data_scope can only be 'shared' or 'system_global' if explicitly set
 * - Returns: { valid: boolean, data: enriched data object, error: string|null }
 */
export function enforceOwnershipOnCreate(payload, currentUserId) {
  if (!payload) {
    return {
      valid: false,
      data: null,
      error: 'Payload is required',
    };
  }

  if (!currentUserId) {
    return {
      valid: false,
      data: null,
      error: 'Current user ID is required for ownership enforcement',
    };
  }

  // Make a copy so we don't mutate the original
  const enrichedData = { ...payload };

  // ENFORCE: owner_user_id is required
  if (!enrichedData.owner_user_id) {
    enrichedData.owner_user_id = currentUserId;
  }

  // Validate: owner_user_id cannot be different user (unless admin)
  // For now, we'll allow admins to set owner_user_id to anyone
  // But regular users can only own their own records
  if (enrichedData.owner_user_id !== currentUserId) {
    return {
      valid: false,
      data: null,
      error: `Cannot create records owned by other users. Payload has owner_user_id=${enrichedData.owner_user_id}, but current user=${currentUserId}`,
    };
  }

  // ENFORCE: data_scope defaults to private_user
  if (!enrichedData.data_scope) {
    enrichedData.data_scope = 'private_user';
  }

  // Validate: private records cannot have null owner_user_id
  if (enrichedData.data_scope === 'private_user' && !enrichedData.owner_user_id) {
    return {
      valid: false,
      data: null,
      error: 'Private records must have owner_user_id',
    };
  }

  // Remove legacy created_by if present (new writes should not use it)
  // We let created_by be auto-populated by the backend
  delete enrichedData.created_by;

  return {
    valid: true,
    data: enrichedData,
    error: null,
  };
}

/**
 * Validate ownership for admin-created records
 * Admins can create records with different owner_user_id (for system-wide data)
 */
export function enforceOwnershipOnCreateAsAdmin(payload, currentUserId, isAdmin) {
  if (!isAdmin) {
    return enforceOwnershipOnCreate(payload, currentUserId);
  }

  if (!payload) {
    return {
      valid: false,
      data: null,
      error: 'Payload is required',
    };
  }

  const enrichedData = { ...payload };

  // Admins MUST explicitly set owner_user_id or data_scope
  if (!enrichedData.owner_user_id && enrichedData.data_scope !== 'system_global' && enrichedData.data_scope !== 'shared') {
    enrichedData.owner_user_id = currentUserId;
  }

  if (!enrichedData.data_scope) {
    enrichedData.data_scope = enrichedData.owner_user_id ? 'private_user' : 'system_global';
  }

  // System-global records don't need owner_user_id
  if (enrichedData.data_scope === 'system_global' && !enrichedData.owner_user_id) {
    enrichedData.owner_user_id = null;
  }

  delete enrichedData.created_by;

  return {
    valid: true,
    data: enrichedData,
    error: null,
  };
}

/**
 * Batch validate multiple CREATE payloads
 * Returns: { valid: boolean, results: array of { payload, enriched, valid, error } }
 */
export function enforceOwnershipBatch(payloads, currentUserId) {
  if (!Array.isArray(payloads)) {
    return {
      valid: false,
      results: [],
      error: 'Payloads must be an array',
    };
  }

  const results = payloads.map((payload, idx) => {
    const enforcement = enforceOwnershipOnCreate(payload, currentUserId);
    return {
      index: idx,
      payload,
      enriched: enforcement.data,
      valid: enforcement.valid,
      error: enforcement.error,
    };
  });

  const allValid = results.every(r => r.valid);

  return {
    valid: allValid,
    results,
    error: allValid ? null : `${results.filter(r => !r.valid).length} payloads failed validation`,
  };
}

/**
 * Check if a record creation would violate ownership rules
 * Use this for pre-flight validation before making API calls
 */
export function willCreateViolateOwnership(payload, currentUserId) {
  const enforcement = enforceOwnershipOnCreate(payload, currentUserId);
  return {
    wouldViolate: !enforcement.valid,
    reason: enforcement.error,
    correctedPayload: enforcement.data,
  };
}

/**
 * Apply ownership enforcement to multiple payload fields in an object
 * Useful when dealing with nested creates (e.g., create character with family members)
 * 
 * Example: enforceOwnershipNested({ character: {...}, locations: [{...}, {...}] }, userId)
 */
export function enforceOwnershipNested(payloadsObj, currentUserId) {
  const enforced = {};
  const errors = [];

  for (const [key, value] of Object.entries(payloadsObj)) {
    if (Array.isArray(value)) {
      // Array of payloads
      const batchResult = enforceOwnershipBatch(value, currentUserId);
      enforced[key] = batchResult.results.map(r => r.enriched);
      if (!batchResult.valid) {
        errors.push(`${key}: ${batchResult.error}`);
      }
    } else if (typeof value === 'object' && value !== null) {
      // Single payload
      const result = enforceOwnershipOnCreate(value, currentUserId);
      enforced[key] = result.data;
      if (!result.valid) {
        errors.push(`${key}: ${result.error}`);
      }
    } else {
      // Non-payload value, keep as-is
      enforced[key] = value;
    }
  }

  return {
    valid: errors.length === 0,
    enforced,
    errors,
  };
}