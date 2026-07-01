import { resolveLocationWithSchoolGuard } from './campusResidencyResolver.js';
import { resolveCurrentOutfit, buildOutfitPromptText } from './outfitRotationEngine.js';
import { resolveUserParticipantInPrompt } from './chatImageSubjectResolver.js';
import { adaptOutfitForWeather } from './weatherOutfitAdapter.js';
import { resolveUniform, determineCharacterRoleAtLocation, buildUniformOutfitContext } from './uniformResolver.js';

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
  // PERMANENT RULE: all app timestamps use Eastern Time — UTC is forbidden as app reasoning authority.
  const _etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const _etStr = `${_etNow.getFullYear()}-${String(_etNow.getMonth()+1).padStart(2,'0')}-${String(_etNow.getDate()).padStart(2,'0')} ${String(_etNow.getHours()).padStart(2,'0')}:${String(_etNow.getMinutes()).padStart(2,'0')} ET`;
  const audit = {
    source_path: sourceType,
    timestamp_et: _etStr,
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

      // ── USER-PARTICIPANT RESOLUTION (must run before Character lookup) ──────
      // If the name token matches the authenticated user's world name, resolve to
      // participant_type:"user" via User Profile + UserSettings — do NOT search Characters.
      let resolvedAsUser = false;
      if (userRecord?.email) {
        try {
          const settingsList = await base44.asServiceRole.entities.UserSettings.filter(
            { owner_email: userRecord.email }, null, 1
          ).catch(() => []);
          const settings = settingsList?.[0] || null;
          const worldName = settings?.fictional_world_name || userRecord?.world_name || userRecord?.full_name || null;
          if (worldName && nameInPrompt.toLowerCase() === worldName.toLowerCase()) {
            // Name matches authenticated user's world name — store user participant context,
            // do not assign effectiveCharacterId (user is not a Character).
            audit.diagnostics.identity_source = 'user_participant_world_name_match';
            audit.diagnostics.user_participant = {
              participant_type: 'user',
              user_id: userRecord.id,
              world_name: worldName,
              resolved_from: 'User_Profile_and_UserSettings',
            };
            resolvedAsUser = true;
            console.log(`[imageGenerationContextBuilder] USER PARTICIPANT resolved: world_name="${worldName}" matches prompt token — no Character lookup performed.`);
          }
        } catch (e) {
          audit.diagnostics.user_participant_resolution_error = e?.message;
        }
      }

      // Attempt Character name resolution only when NOT resolved as user
      if (!resolvedAsUser) {
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
  }

  // Build appearance lock text from character record.
  // CRITICAL: Only structured fields (ethnicities, appearance_lock.*) are used.
  // appearance_notes and avatar_description_text are intentionally EXCLUDED —
  // they are free-text prose that may reinvent the character's look and create
  // a second competing appearance authority. Structured lock fields are the
  // ONLY canonical appearance source.
  if (effectiveCharacterRecord) {
    const al = effectiveCharacterRecord.appearance_lock || {};
    const descParts = [
      effectiveCharacterRecord.age_range ? `${effectiveCharacterRecord.age_range} years old` : null,
      effectiveCharacterRecord.gender || null,
      effectiveCharacterRecord.ethnicities?.length > 0 ? effectiveCharacterRecord.ethnicities.join('/') + ' ethnicity' : null,
      al.skin_tone ? `${al.skin_tone} skin tone` : null,
      al.hairstyle ? `${al.hairstyle} hairstyle` : null,
      al.hair_type ? `${al.hair_type} hair` : null,
      al.hair_color ? `${al.hair_color} hair color` : null,
      al.facial_hair || null,
      al.body_type || al.overall_aesthetic || null,
      al.distinguishing_features || null,
    ].filter(Boolean);
    appearanceLockText = descParts.join(', ');
  }

  audit.diagnostics.identity = {
    character_id: effectiveCharacterId || null,
    character_name: effectiveCharacterName || null,
    appearance_lock_text: appearanceLockText || null,
    appearance_lock_present: !!appearanceLockText,
  };

  // ── USER-PARTICIPANT SCAN across the FULL prompt ──────────────────────────
  // Covers [JOINT], [CHARACTER], secondary subjects, scene descriptions, and
  // non-leading name mentions. The user may appear anywhere in the prompt.
  // avatar/photo_url on any stored entry is a display cache — canonical identity
  // comes from User Profile + UserSettings (passed in as userRecord).
  let userParticipantDetected = false;
  let userParticipantWorldName = null;
  if (prompt && userRecord) {
    // Build a minimal resolvedUser bundle from userRecord for the scanner.
    // We use the same field priority as resolveAuthenticatedUser.js.
    const scanBundle = {
      world_name: userRecord.world_name || userRecord.fictional_world_name || userRecord.full_name || null,
      full_name: userRecord.full_name || null,
      aliases: userRecord.user_aliases || userRecord.aliases || [],
    };
    const scanResult = resolveUserParticipantInPrompt(prompt, scanBundle);
    if (scanResult.matched) {
      userParticipantDetected = true;
      userParticipantWorldName = scanResult.worldName;
      audit.diagnostics.user_participant_in_prompt = {
        detected: true,
        world_name: userParticipantWorldName,
        matched_form: scanResult.matchedForm,
        note: 'avatar/photo must come from User Profile + UserSettings at generation time, not from any stored relationship entry',
      };
      console.log(`[imageGenerationContextBuilder] USER PARTICIPANT detected in prompt — matched form "${scanResult.matchedForm}" — avatar must be resolved from User Profile at generation time`);
    }
  }

  // ── LOCATION SANITIZATION (must run before outfit resolution) ───────────────
  // SCHOOL CONTAMINATION GUARD — uses canonical campusResidencyResolver.
  // Enrollment at a school is NOT residence. Campus housing is only valid
  // when lives_on_campus === true is explicitly saved on the enrollment record.
  // sanitizedLocationId must be established here so the outfit resolver can use
  // the location category as context for accurate outfit category selection.
  let sanitizedLocationId = locationId;
  if (effectiveCharacterRecord && locationId) {
    const guardResult = resolveLocationWithSchoolGuard(effectiveCharacterRecord, locationId);
    if (guardResult.rejected) {
      console.warn(`[imageGenerationContextBuilder] ⛔ SCHOOL CONTAMINATION GUARD: "${locationId}" rejected — ${guardResult.reason}. Replaced with home="${guardResult.locationId || 'none'}"`);
      sanitizedLocationId = guardResult.locationId;
      audit.diagnostics.school_contamination_guard = {
        rejected_id: locationId,
        rejected_reason: guardResult.reason,
        replaced_with: guardResult.locationId || null,
      };
    }

    // Stale travel-to-school guard: if traveling_to_location_id is school but not actively traveling
    const schoolLocId = effectiveCharacterRecord.current_school_location_id
      || effectiveCharacterRecord.education_location_id || null;
    const travelingToLocId = effectiveCharacterRecord.traveling_to_location_id || null;
    const travelStatus = effectiveCharacterRecord.travel_status || 'not_traveling';
    const presenceStatus = effectiveCharacterRecord.resolved_presence_status || effectiveCharacterRecord.location_status || '';
    if (travelingToLocId && schoolLocId && travelingToLocId === schoolLocId) {
      const isActiveSchoolTravel = travelStatus === 'traveling_to_school' && presenceStatus !== 'home';
      if (!isActiveSchoolTravel) {
        console.warn(`[imageGenerationContextBuilder] ⛔ STALE SCHOOL TRAVEL GUARD: traveling_to_location_id is school but not active travel — suppressed`);
        audit.diagnostics.stale_school_travel_guard = { suppressed_id: travelingToLocId, reason: `travel_status="${travelStatus}" presence="${presenceStatus}"` };
        if (sanitizedLocationId && schoolLocId && sanitizedLocationId === schoolLocId) {
          sanitizedLocationId = effectiveCharacterRecord.current_home_location_id || effectiveCharacterRecord.home_location_id || null;
          audit.diagnostics.stale_school_travel_guard.forced_home = sanitizedLocationId || null;
        }
      }
    }
  }

  let locationRecord = null;
  let effectiveZoneName = zoneName;
  let zoneImages = [];

  if (sanitizedLocationId) {
    try {
      const locList = await base44.asServiceRole.entities.LocationReference.filter(
        { id: sanitizedLocationId }, null, 1
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
    location_id: sanitizedLocationId || null,
    original_location_id: locationId !== sanitizedLocationId ? locationId : undefined,
    location_name: locationRecord?.name || null,
    zone_name: effectiveZoneName || null,
    zone_images_count: zoneImages.length,
  };

  // ── OUTFIT RESOLUTION ────────────────────────────────────────────────────────
  // MUST run after location resolution so we have locationRecord?.category available.
  let outfitText = null;
  let outfitSource = 'none';
  let outfitPrecedenceReason = null;
  let resolvedOutfit = null;

  const promptLowerForOutfit = (prompt || '').toLowerCase();
  const sleepWakeKeywords = ['sleeping', 'asleep', 'in bed', 'woke up', 'waking up', 'just woke', 'napping', 'nap', 'lying in bed'];
  const isSleepContext = sleepWakeKeywords.some(kw => promptLowerForOutfit.includes(kw));

  if (isSleepContext && effectiveCharacterRecord) {
    // Sleep context: prioritize sleepwear from closet, then current_outfit if it's sleepwear, then default
    const closet = (effectiveCharacterRecord.character_closet || []).filter(o => o.outfit_id);
    const sleepItem = closet.find(o => o.category === 'sleepwear' || o.category === 'lounge');
    const co = effectiveCharacterRecord.current_outfit;
    if (sleepItem) {
      outfitText = buildOutfitPromptText(sleepItem);
      outfitSource = 'sleepwear_locked';
      outfitPrecedenceReason = 'sleep_context_and_sleepwear_exists';
    } else if (co && (co.category === 'sleepwear' || co.category === 'lounge')) {
      outfitText = buildOutfitPromptText(co);
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
    // Non-sleep context: use the rotation engine as the ONLY authoritative outfit source.
    // CRITICAL: character.current_outfit is NOT used — it reflects the last manually clicked
    // outfit card, not the context-correct rotation result. The engine reads:
    //   - character.resolved_presence_status (home / at_work / visiting / traveling)
    //   - character.today_category_outfit_overrides (date-scoped manual override, rotation ON)
    //   - character.manual_category_selections (persistent selection, rotation OFF)
    //   - character.outfit_rotation_enabled
    //   - character.character_closet
    // locationRecord?.category is passed so the engine knows gym/work/home/etc.
    const locationCategoryForOutfit = locationRecord?.category || null;
    resolvedOutfit = resolveCurrentOutfit(
      effectiveCharacterRecord,
      prompt || '',          // activity hints from the generation prompt
      locationCategoryForOutfit
    );
    if (resolvedOutfit) {
      outfitText = buildOutfitPromptText(resolvedOutfit);
      outfitSource = 'rotation_engine';
      outfitPrecedenceReason = `rotation_resolved_category:${resolvedOutfit.category || 'unknown'}`;
    } else {
      // No closet — last-resort only, not preferred
      const co = effectiveCharacterRecord.current_outfit;
      if (co) {
        outfitText = buildOutfitPromptText(co);
        outfitSource = 'current_outfit_last_resort';
        outfitPrecedenceReason = 'no_closet_rotation_unavailable';
      }
    }
  }

  // ── UNIFORM OVERRIDE ──────────────────────────────────────────────────────
  // If the character is at a location with a required uniform, the uniform IS
  // what they're wearing — it takes priority over the closet outfit.
  // PROOF POINT 3: uniform requirements override weather (uniforms are never adapted).
  let uniformOutfitObj = null;
  if (!isSleepContext && effectiveCharacterRecord && locationRecord) {
    try {
      const charRole = determineCharacterRoleAtLocation(effectiveCharacterRecord, locationRecord);
      if (charRole) {
        const resolvedUniform = resolveUniform(effectiveCharacterRecord, locationRecord, charRole);
        if (resolvedUniform?.uniform) {
          const uCtx = buildUniformOutfitContext(resolvedUniform);
          if (uCtx?.outfit) {
            uniformOutfitObj = uCtx.outfit;
            outfitText = uCtx.description || buildOutfitPromptText(uCtx.outfit);
            outfitSource = `uniform:${resolvedUniform.source}`;
            outfitPrecedenceReason = `uniform_override:${resolvedUniform.applicability}`;
          }
        }
      }
    } catch (e) {
      audit.diagnostics.uniform_resolution_error = e?.message;
    }
  }

  // ── WEATHER ADAPTATION LAYER ──────────────────────────────────────────────
  // Adapt the visible outfit text based on weather — remove outerwear in heat,
  // allow additional layer removal in extreme heat when socially appropriate.
  // Uniforms are never adapted (isUniformOutfit check in the adapter).
  // The outfit object (authority) is never mutated — only the visible text changes.
  // PROOF POINT 1: weather modifies visible clothing.
  // PROOF POINT 2: outerwear dynamically worn/removed.
  // PROOF POINT 5: same adapter used by clothing awareness (Chat) and image gen.
  let weatherAdaptation = null;
  if (outfitText && !isSleepContext) {
    let weatherCache = null;
    try {
      if (userRecord?.email && base44) {
        const settingsList = await base44.asServiceRole?.entities?.UserSettings?.filter(
          { owner_email: userRecord.email }, null, 1
        ).catch(() => []) || [];
        weatherCache = settingsList?.[0]?.daily_weather_cache || null;
      }
    } catch { /* non-fatal — weather adaptation is a enhancement, not a requirement */ }

    if (weatherCache) {
      const isWorkerAtLoc = locationRecord?.worker_character_ids?.includes(effectiveCharacterId) || false;
      // Use the uniform outfit object if a uniform was resolved, else the rotation outfit
      const outfitForAdaptation = uniformOutfitObj || resolvedOutfit || effectiveCharacterRecord?.current_outfit || null;
      weatherAdaptation = adaptOutfitForWeather({
        outfitText,
        outfit: outfitForAdaptation,
        source: outfitSource,
        category: uniformOutfitObj ? 'uniform' : (resolvedOutfit?.category || null),
        weatherCache,
        location: locationRecord,
        character: effectiveCharacterRecord,
        isWorker: isWorkerAtLoc,
      });
      if (weatherAdaptation?.adapted) {
        outfitText = weatherAdaptation.adaptedText;
        outfitPrecedenceReason += ` → weather_adapted:${weatherAdaptation.reason}`;
      }
    }
  }

  audit.diagnostics.outfit = {
    source: outfitSource,
    text: outfitText || null,
    precedence_reason: outfitPrecedenceReason,
    sleep_context_detected: isSleepContext,
    weather_adapted: weatherAdaptation?.adapted || false,
    weather_adaptation_reason: weatherAdaptation?.reason || null,
    weather_removed_pieces: weatherAdaptation?.removedPieces || [],
  };

  // ── FINAL CONTEXT ────────────────────────────────────────────────────────────
  const context = {
    identity: {
      character_id: effectiveCharacterId,
      character_name: effectiveCharacterName,
      description: appearanceLockText,
      appearance_lock_text: appearanceLockText,
    },
    // User-participant fields — populated when the authenticated user appears in the prompt.
    // Callers MUST resolve avatar/appearance from User Profile + UserSettings, not from any
    // stored relationship entry. The stored photo_url is a display cache only.
    user_participant: {
      detected: userParticipantDetected,
      world_name: userParticipantWorldName,
    },
    outfit: {
      source: outfitSource,
      text: outfitText,
      precedence_reason: outfitPrecedenceReason,
    },
    location: {
      location_id: sanitizedLocationId,
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