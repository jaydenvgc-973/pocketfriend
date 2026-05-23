/**
 * Unified Image Generation Context Builder
 *
 * Single source of truth for resolving identity, outfit, location context across ALL image paths:
 * - Chat character-generated images
 * - Media Grid generation
 * - Media Gallery send
 * - Why Regenerate
 * - Load Photo recovery
 * - World Phone / World Contacts
 *
 * Produces consistent:
 * - identity lock (character ID, name, appearance)
 * - outfit rule (source, final text, precedence)
 * - location/zone context (location ID, zone name, reference images)
 * - final provider prompt
 * - audit diagnostic payload
 *
 * CRITICAL: This builder is the ONLY place identity/outfit/location resolution happens.
 * All image paths must call this builder and use its output.
 */

/**
 * Build complete image generation context from source data.
 *
 * Returns:
 * {
 *   identity: { character_id, character_name, description, appearance_lock_text },
 *   outfit: { source, text, precedence_reason },
 *   location: { location_id, location_name, zone_name, zone_images },
 *   prompt: { original, sanitized, final_provider },
 *   references: { character_refs, location_refs, user_refs },
 *   audit: { full diagnostic payload },
 * }
 */
export async function buildImageGenerationContext({
  sourceType, // 'chat' | 'media_grid' | 'media_gallery' | 'regenerate' | 'load_photo' | 'world_phone'
  characterRecord,
  characterId,
  characterName,
  prompt,
  locationId,
  zoneName,
  userRecord,
  userPersonaName,
  userRefs = [],
  characterRefs = [],
  locationRefs = [],
  base44,
}) {
  const audit = {
    source_path: sourceType,
    timestamp: new Date().toISOString(),
    diagnostics: {},
  };

  // ── IDENTITY RESOLUTION ──────────────────────────────────────────────────────
  let effectiveCharacterId = characterId;
  let effectiveCharacterName = characterName;
  let effectiveCharacterRecord = characterRecord;
  let appearanceLockText = '';

  if (!effectiveCharacterId && prompt) {
    // Scan prompt for [CHARACTER] Name token
    const m = prompt.match(/^\[CHARACTER\]\s+([A-Za-z][A-Za-z\s'-]{1,40}?)(?:\s+|[,.]|$)/i);
    if (m) {
      const nameInPrompt = m[1].trim();
      audit.diagnostics.prompt_character_token = nameInPrompt;
      // Attempt name resolution — log attempt but do not fail
      try {
        const chars = await base44.asServiceRole.entities.Character.filter(
          { owner_email: userRecord?.email }, null, 100
        ).catch(() => []);
        const match = chars.find(c =>
          c.name?.toLowerCase() === nameInPrompt.toLowerCase() ||
          c.name?.toLowerCase().startsWith(nameInPrompt.toLowerCase())
        );
        if (match) {
          effectiveCharacterId = match.id;
          effectiveCharacterName = match.name;
          effectiveCharacterRecord = match;
          audit.diagnostics.identity_source = 'prompt_character_token';
        }
      } catch (e) {
        audit.diagnostics.identity_resolution_error = e?.message;
      }
    }
  }

  // Build appearance lock text from character record
  if (effectiveCharacterRecord) {
    const al = effectiveCharacterRecord.appearance_lock || {};
    const descParts = [
      effectiveCharacterRecord.age_range ? `${effectiveCharacterRecord.age_range} years old` : null,
      effectiveCharacterRecord.gender || null,
      effectiveCharacterRecord.ethnicities?.length > 0 ? effectiveCharacterRecord.ethnicities.join('/') + ' ethnicity' : null,
      al.skin_tone ? `${al.skin_tone} skin tone` : null,
      al.hairstyle ? `${al.hairstyle} hairstyle` : null,
      al.hair_type ? `${al.hair_type} hair` : null,
      al.facial_hair || null,
      effectiveCharacterRecord.appearance_notes || null,
      effectiveCharacterRecord.avatar_description_text || null,
    ].filter(Boolean);
    appearanceLockText = descParts.join(', ');
  }

  audit.diagnostics.identity = {
    character_id: effectiveCharacterId || null,
    character_name: effectiveCharacterName || null,
    appearance_lock_text: appearanceLockText || null,
    appearance_lock_present: !!appearanceLockText,
  };

  // ── OUTFIT RESOLUTION ────────────────────────────────────────────────────────
  let outfitText = null;
  let outfitSource = 'none';
  let outfitPrecedenceReason = null;

  // Check if prompt explicitly specifies clothing
  const promptLowerForOutfit = (prompt || '').toLowerCase();
  const sleepWakeKeywords = ['sleeping', 'asleep', 'in bed', 'woke up', 'waking up', 'just woke', 'napping', 'nap', 'lying in bed'];
  const isSleepContext = sleepWakeKeywords.some(kw => promptLowerForOutfit.includes(kw));

  if (isSleepContext && effectiveCharacterRecord) {
    // Sleep context: prioritize sleepwear
    const closet = (effectiveCharacterRecord.character_closet || []).filter(o => o.outfit_id);
    const sleepItem = closet.find(o => o.category === 'sleepwear' || o.category === 'lounge');
    const co = effectiveCharacterRecord.current_outfit;

    if (sleepItem) {
      outfitText = [sleepItem.top, sleepItem.bottom, sleepItem.shoes, sleepItem.outerwear, sleepItem.accessories]
        .filter(Boolean)
        .map(p => {
          const t = p.trim();
          return /^(n\/?a|none|-)$/i.test(t) ? null : t;
        })
        .filter(Boolean)
        .join(', ') || sleepItem.full_description || null;
      outfitSource = 'sleepwear_locked';
      outfitPrecedenceReason = 'sleep_context_and_sleepwear_exists';
    } else if (co && (co.category === 'sleepwear' || co.category === 'lounge')) {
      outfitText = [co.top, co.bottom, co.shoes, co.outerwear, co.accessories]
        .filter(Boolean)
        .map(p => {
          const t = p.trim();
          return /^(n\/?a|none|-)$/i.test(t) ? null : t;
        })
        .filter(Boolean)
        .join(', ') || co.full_description || null;
      outfitSource = 'current_outfit_sleepwear';
      outfitPrecedenceReason = 'sleep_context_and_current_outfit_sleepwear';
    } else {
      const g = (effectiveCharacterRecord.gender || '').toLowerCase();
      outfitText = g === 'female'
        ? 'soft cotton pajama set or oversized sleep shirt and shorts'
        : g === 'male'
        ? 'pajama bottoms or boxer shorts, no shirt or plain sleep shirt'
        : 'comfortable pajama set';
      outfitSource = 'default_sleepwear';
      outfitPrecedenceReason = 'sleep_context_no_saved_sleepwear';
    }
  } else if (effectiveCharacterRecord) {
    // Non-sleep context: use current outfit or closet
    const co = effectiveCharacterRecord.current_outfit;
    if (co && co.outfit_id) {
      outfitText = [co.top, co.bottom, co.shoes, co.outerwear, co.accessories]
        .filter(Boolean)
        .map(p => {
          const t = p.trim();
          return /^(n\/?a|none|-)$/i.test(t) ? null : t;
        })
        .filter(Boolean)
        .join(', ') || co.full_description || null;
      outfitSource = 'current_outfit';
      outfitPrecedenceReason = 'current_outfit_exists';
    } else {
      const closet = (effectiveCharacterRecord.character_closet || []).filter(o => o.outfit_id);
      if (closet.length > 0) {
        outfitText = [closet[0].top, closet[0].bottom, closet[0].shoes, closet[0].outerwear, closet[0].accessories]
          .filter(Boolean)
          .map(p => {
            const t = p.trim();
            return /^(n\/?a|none|-)$/i.test(t) ? null : t;
          })
          .filter(Boolean)
          .join(', ') || closet[0].full_description || null;
        outfitSource = 'closet_first_item';
        outfitPrecedenceReason = 'no_current_outfit_fallback_to_closet';
      }
    }
  }

  audit.diagnostics.outfit = {
    source: outfitSource,
    text: outfitText || null,
    precedence_reason: outfitPrecedenceReason,
    sleep_context_detected: isSleepContext,
  };

  // ── LOCATION RESOLUTION ──────────────────────────────────────────────────────
  let locationRecord = null;
  let effectiveZoneName = zoneName;
  let zoneImages = [];

  if (locationId) {
    try {
      const locList = await base44.asServiceRole.entities.LocationReference.filter(
        { id: locationId }, null, 1
      ).catch(() => []);
      locationRecord = locList?.[0] || null;

      if (locationRecord) {
        // Resolve zone images
        const zones = (locationRecord.zones || []).filter(z => (z.image_urls || []).length > 0);
        if (zoneName && zones.length > 0) {
          const matchedZone = zones.find(z => z.zone_name?.toLowerCase() === zoneName.toLowerCase());
          zoneImages = matchedZone?.image_urls || zones[0]?.image_urls || [];
          effectiveZoneName = matchedZone?.zone_name || zones[0]?.zone_name;
        } else if (zones.length > 0) {
          zoneImages = zones[0]?.image_urls || [];
          effectiveZoneName = zones[0]?.zone_name;
        } else {
          zoneImages = locationRecord.image_urls || [];
        }
      }
    } catch (e) {
      audit.diagnostics.location_resolution_error = e?.message;
    }
  }

  audit.diagnostics.location = {
    location_id: locationId || null,
    location_name: locationRecord?.name || null,
    zone_name: effectiveZoneName || null,
    zone_images_count: zoneImages.length,
  };

  // ── FINAL CONTEXT ────────────────────────────────────────────────────────────
  const context = {
    identity: {
      character_id: effectiveCharacterId,
      character_name: effectiveCharacterName,
      description: appearanceLockText,
      appearance_lock_text: appearanceLockText,
    },
    outfit: {
      source: outfitSource,
      text: outfitText,
      precedence_reason: outfitPrecedenceReason,
    },
    location: {
      location_id: locationId,
      location_name: locationRecord?.name,
      zone_name: effectiveZoneName,
      zone_images: zoneImages,
    },
    prompt: {
      original: prompt,
      // Sanitized prompt would be applied by the specific generation function
      // (since sanitization rules may vary per path)
    },
    references: {
      character_refs: characterRefs,
      location_refs: locationRefs,
      user_refs: userRefs,
    },
    audit,
  };

  return context;
}