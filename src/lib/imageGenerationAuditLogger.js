/**
 * Image Generation Audit Logger
 *
 * Captures proof-based diagnostics for every image generation, recovery, and regeneration request.
 * Enables side-by-side comparison of behavior across all paths to identify actual root causes.
 *
 * RULES:
 * - No guessing: log actual data, not assumptions
 * - No generic 500 errors: always log provider response/rejection reason
 * - No device/file type blame unless logs prove it
 * - No bedroom/clothing blame unless provider response proves it
 * - Identity collapse = immediate red flag (log when fallback happens)
 */

export function createImageGenerationAudit({
  sourceType, // 'chat' | 'media_grid' | 'media_gallery' | 'regenerate' | 'load_photo' | 'world_phone'
  messageId,
  senderCharacterId,
  recipientCharacterId,
  selectedSubjectIds = [],
  resolvedSubjectIds = [],
  effectiveCharacterId,
  characterName,
  userPersonaName,
  promptDerivedNames = [],
  originalPrompt,
  sanitizedPrompt,
  finalProviderPrompt,
  outfitSource,
  outfitText,
  outfitInjected,
  promptClothingPreserved,
  locationSource,
  zoneName,
  characterRefsCount,
  locationRefsCount,
  userRefsCount,
  providerStatus,
  providerRejectionText,
  generatedImageUrl,
  uploadedStoragePath,
  savedMessageImageUrl,
  identityCollapseDetected,
  fallbackCaucasianUsed,
}) {
  const audit = {
    timestamp: new Date().toISOString(),
    source_path: sourceType,
    message_id: messageId,
    request_identity: {
      sender_character_id: senderCharacterId || null,
      recipient_character_id: recipientCharacterId || null,
      selected_subject_ids: selectedSubjectIds,
      resolved_subject_ids: resolvedSubjectIds,
      prompt_derived_names: promptDerivedNames,
    },
    resolved_identity: {
      effective_character_id: effectiveCharacterId || null,
      character_name: characterName || null,
      user_persona_name: userPersonaName || null,
    },
    prompt_analysis: {
      original_prompt: originalPrompt ? originalPrompt.substring(0, 300) : null,
      original_prompt_length: originalPrompt?.length || 0,
      sanitized_prompt: sanitizedPrompt ? sanitizedPrompt.substring(0, 300) : null,
      sanitized_prompt_length: sanitizedPrompt?.length || 0,
      prompt_was_sanitized: sanitizedPrompt !== originalPrompt,
      final_provider_prompt: finalProviderPrompt ? finalProviderPrompt.substring(0, 300) : null,
      final_provider_prompt_length: finalProviderPrompt?.length || 0,
    },
    outfit_context: {
      source: outfitSource,
      text: outfitText ? outfitText.substring(0, 200) : null,
      injected: outfitInjected,
      prompt_clothing_preserved: promptClothingPreserved,
    },
    location_context: {
      source: locationSource,
      zone_name: zoneName,
    },
    references: {
      character_refs_count: characterRefsCount,
      location_refs_count: locationRefsCount,
      user_refs_count: userRefsCount,
    },
    provider_interaction: {
      status: providerStatus, // 'success' | 'rejected' | 'error' | 'timeout' | 'rate_limit'
      rejection_text: providerRejectionText ? providerRejectionText.substring(0, 500) : null,
    },
    output_storage: {
      generated_image_url: generatedImageUrl ? generatedImageUrl.substring(0, 200) : null,
      uploaded_storage_path: uploadedStoragePath ? uploadedStoragePath.substring(0, 200) : null,
      saved_message_image_url: savedMessageImageUrl ? savedMessageImageUrl.substring(0, 200) : null,
      urls_match: generatedImageUrl === savedMessageImageUrl,
    },
    warnings: {
      identity_collapse_detected: identityCollapseDetected,
      fallback_caucasian_used: fallbackCaucasianUsed,
    },
  };

  return audit;
}

/**
 * Compare two audit logs to find differences.
 * Returns object showing which fields differ.
 */
export function compareAudits(audit1, audit2) {
  const differences = {};

  // Compare top-level identity, outfit, location, references
  const compareObject = (path, obj1, obj2) => {
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object') {
      if (obj1 !== obj2) {
        differences[path] = { audit1: obj1, audit2: obj2 };
      }
      return;
    }
    for (const key in obj1) {
      if (typeof obj1[key] === 'object' && obj1[key] !== null) {
        compareObject(`${path}.${key}`, obj1[key], obj2[key]);
      } else if (obj1[key] !== obj2[key]) {
        differences[`${path}.${key}`] = { audit1: obj1[key], audit2: obj2[key] };
      }
    }
  };

  compareObject('resolved_identity', audit1.resolved_identity, audit2.resolved_identity);
  compareObject('prompt_analysis', audit1.prompt_analysis, audit2.prompt_analysis);
  compareObject('outfit_context', audit1.outfit_context, audit2.outfit_context);
  compareObject('location_context', audit1.location_context, audit2.location_context);
  compareObject('references', audit1.references, audit2.references);
  compareObject('provider_interaction', audit1.provider_interaction, audit2.provider_interaction);
  compareObject('warnings', audit1.warnings, audit2.warnings);

  return differences;
}

/**
 * Format audit for logging/display
 */
export function formatAuditLog(audit) {
  return JSON.stringify(audit, null, 2);
}