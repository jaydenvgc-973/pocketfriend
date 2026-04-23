import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function isProviderAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  // Private storage — requires authentication, provider cannot access
  if (url.includes('/files/mp/private/')) return false;
  if (url.includes('/files/private/')) return false;
  // Signed/expiring URLs — provider cannot use them
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  // Public file storage on base44.app — /files/mp/public/ paths ARE publicly accessible
  // DO NOT block these — they are the primary storage for user-uploaded location images
  // Only block API-gated paths that require session auth
  if (url.includes('base44.app/api/apps/') && !url.includes('/files/mp/public/') && !url.includes('/files/public/')) return false;
  return true;
}

async function resolveLocationImages(base44, locationId, zoneName) {
  if (!locationId) return { images: [], zoneName: null, locationName: null };
  
  const loc = await base44.asServiceRole.entities.LocationReference.get(locationId).catch(() => null);
  if (!loc) {
    console.error(`[regen] ⛔ Location NOT FOUND: id=${locationId}`);
    return { images: [], zoneName: null, locationName: null };
  }

  console.log(`[regen] ✓ Location loaded: "${loc.name}" | zones=${loc.zones?.length || 0} | flat_images=${loc.image_urls?.length || 0}`);
  loc.zones?.forEach((z, i) => {
    console.log(`[regen]   Zone[${i}]: "${z.zone_name}" | images=${z.image_urls?.length || 0}`);
  });

  let images = [];
  let resolvedZone = null;

  // STEP 1: Exact zone match
  if (zoneName && loc.zones?.length > 0) {
    const zone = loc.zones.find(z => z.zone_name?.toLowerCase() === zoneName.toLowerCase());
    if (zone) {
      const filtered = (zone.image_urls || []).filter(isProviderAccessible);
      images = filtered.slice(0, 6);
      resolvedZone = zone.zone_name;
      console.log(`[regen] ✓ Zone MATCHED: "${zone.zone_name}" | total=${zone.image_urls?.length || 0} | accessible=${images.length}`);
    } else {
      const available = loc.zones?.map(z => z.zone_name).join(', ');
      console.warn(`[regen] ⚠️ Zone "${zoneName}" not found. Available: ${available}`);
    }
  }

  // STEP 2: First zone with accessible images
  if (images.length === 0 && loc.zones?.length > 0) {
    const firstZone = loc.zones.find(z => (z.image_urls || []).some(isProviderAccessible));
    if (firstZone) {
      images = (firstZone.image_urls || []).filter(isProviderAccessible).slice(0, 6);
      resolvedZone = firstZone.zone_name;
      console.log(`[regen] ✓ Fallback zone: "${resolvedZone}" | images=${images.length}`);
    }
  }

  // STEP 3: Flat location images
  if (images.length === 0 && loc.image_urls?.length > 0) {
    images = loc.image_urls.filter(isProviderAccessible).slice(0, 6);
    console.log(`[regen] ✓ Fallback flat images: ${images.length}`);
  }

  console.log(`[regen] resolveLocationImages RESULT: name="${loc.name}" | zone="${resolvedZone || 'none'}" | images=${images.length}`);
  return { images, zoneName: resolvedZone, locationName: loc.name };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { messageId, reason, customPrompt, manualLocationId, manualZoneId } = await req.json();
    if (!messageId || !reason) return Response.json({ error: 'messageId and reason required' }, { status: 400 });
    
    console.log(`[regen] ▶ REQUEST: messageId=${messageId} | reason=${reason} | manualLocationId=${manualLocationId || 'NONE'} | manualZoneId=${manualZoneId || 'NONE'}`);

    // Fetch the message
    let message = await base44.asServiceRole.entities.Message.get(messageId).catch(() => null);
    if (!message) {
      const msgList = await base44.asServiceRole.entities.Message.filter({ id: messageId }, null, 1).catch(() => []);
      message = msgList?.[0] || null;
    }
    if (!message) return Response.json({ error: 'Message not found', success: false }, { status: 404 });

    const ctx = message.generation_context || {};
    const originalPrompt = ctx.prompt || null;
    const originalCharId = ctx.character_id || message.character_id || null;
    const originalSubjectType = ctx.subject_type || 'character';

    // Fetch character
    let character = null;
    if (originalCharId) {
      const charListUser = await base44.entities.Character.filter({ id: originalCharId }, null, 1).catch(() => []);
      character = charListUser?.[0] || null;
      if (!character) character = await base44.asServiceRole.entities.Character.get(originalCharId).catch(() => null);
      if (!character) {
        const charList = await base44.asServiceRole.entities.Character.filter({ id: originalCharId }, null, 1).catch(() => []);
        character = charList?.[0] || null;
      }
      if (!character && message?.created_by) {
        const charList2 = await base44.asServiceRole.entities.Character.filter({ id: originalCharId, created_by: message.created_by }, null, 1).catch(() => []);
        character = charList2?.[0] || null;
      }
    }
    console.log(`[regen] Character: ${character?.name || 'NOT FOUND'} (id=${originalCharId || 'none'})`);

    const charName = character?.name || 'the character';
    const charDesc = [character?.appearance_notes, character?.personality_summary, character?.age_range, character?.gender, character?.ethnicities?.join(', ')].filter(Boolean).join(', ');

    // Build character reference images
    const serverCharRefs = [character?.avatar_url, ...(character?.reference_image_urls || [])].filter(Boolean).filter(isProviderAccessible);
    const ctxCharRefs = (ctx.character_reference_images || []).filter(Boolean).filter(isProviderAccessible);
    const charRefImages = serverCharRefs.length > 0 ? serverCharRefs : ctxCharRefs;
    console.log(`[regen] charRefImages: ${charRefImages.length} (server=${serverCharRefs.length}, ctx=${ctxCharRefs.length})`);

    // ══════════════════════════════════════════════════════════════════════════
    // LOCATION RESOLUTION — STRICT PRIORITY ORDER
    //
    // RULE: manualLocationId ALWAYS wins. It must be resolved FIRST.
    //       Nothing from the original generation context may override it.
    //       The original location refs are DISCARDED when manual is provided.
    // ══════════════════════════════════════════════════════════════════════════
    
    let locationRefImages = [];
    let effectiveLocationName = null;
    let effectiveZoneName = null;
    let effectiveLocationId = null;

    if (manualLocationId) {
      // ── PATH A: USER EXPLICITLY SELECTED A LOCATION (AND OPTIONALLY ZONE) ─
      // This is the HIGHEST PRIORITY. Do NOT mix with original context.
      console.log(`[regen] ═══ PATH A: MANUAL LOCATION SELECTED ═══`);
      console.log(`[regen] manualLocationId=${manualLocationId} | manualZoneId=${manualZoneId || 'none (auto)'}`);
      
      effectiveLocationId = manualLocationId;
      const resolved = await resolveLocationImages(base44, manualLocationId, manualZoneId || null);
      locationRefImages = resolved.images;
      effectiveZoneName = resolved.zoneName || manualZoneId || null;
      effectiveLocationName = resolved.locationName;

      if (locationRefImages.length === 0) {
        console.error(`[regen] ⛔ CRITICAL: Manual location "${effectiveLocationName}" (${manualLocationId}) resolved ZERO accessible images`);
        console.error(`[regen] Zone requested: "${manualZoneId || 'none'}"`);
        console.error(`[regen] The AI will generate a generic room — this is a data issue with the location record`);
      } else {
        console.log(`[regen] ✓ MANUAL LOCATION RESOLVED: "${effectiveLocationName}" → zone="${effectiveZoneName}" | ${locationRefImages.length} images`);
        console.log(`[regen] Image URLs:`, locationRefImages.map(u => u.substring(0, 70)));
      }

    } else {
      // ── PATH B: NO MANUAL SELECTION — USE ORIGINAL CONTEXT OR CHARACTER FILE ─
      console.log(`[regen] ═══ PATH B: NO MANUAL LOCATION — using original context or character file ═══`);
      
      // Try original generation context location first
      const originalLocationId = ctx.location_id || null;
      const originalZoneName = ctx.zone_name || null;
      const originalLocationRefs = (ctx.location_reference_images || []).filter(isProviderAccessible);

      if (originalLocationRefs.length > 0 && originalLocationId) {
        // Use original context location refs
        locationRefImages = originalLocationRefs.slice(0, 6);
        effectiveLocationId = originalLocationId;
        effectiveZoneName = originalZoneName;
        effectiveLocationName = ctx.location_name || null;
        console.log(`[regen] ✓ Using original context location: "${effectiveLocationName}" | zone="${effectiveZoneName}" | ${locationRefImages.length} images`);
      } else {
        // No usable original refs — look up from character file
        let fallbackLocationId = null;
        if (character) {
          fallbackLocationId = character.resolved_current_location_id || character.current_home_location_id || character.home_location_id || null;
          if (!fallbackLocationId) {
            // Scan resident locations
            const savedLocs = await base44.asServiceRole.entities.LocationReference.filter({ created_by: message.created_by || user.email }, '-created_date', 100).catch(() => []);
            const residentHome = savedLocs.find(l =>
              l.category === 'home' &&
              ((l.resident_character_ids || []).includes(originalCharId) || (l.residents || []).some(r => r.character_id === originalCharId))
            );
            if (residentHome) fallbackLocationId = residentHome.id;
          }
        }

        if (fallbackLocationId) {
          // Derive zone hint from original prompt
          let zoneHint = null;
          const pLower = (originalPrompt || '').toLowerCase();
          if (/\b(kitchen|stove|fridge|counter|oven|pancake|breakfast)\b/.test(pLower)) zoneHint = 'kitchen';
          else if (/\b(bedroom|bed|sleeping|nightstand)\b/.test(pLower)) zoneHint = 'bedroom';
          else if (/\b(bathroom|shower|bathtub|toilet)\b/.test(pLower)) zoneHint = 'bathroom';
          else if (/\b(living room|couch|sofa|tv|lounge)\b/.test(pLower)) zoneHint = 'living room';
          else if (/\b(backyard|patio|deck|yard)\b/.test(pLower)) zoneHint = 'backyard';

          const resolved = await resolveLocationImages(base44, fallbackLocationId, zoneHint);
          locationRefImages = resolved.images;
          effectiveZoneName = resolved.zoneName;
          effectiveLocationName = resolved.locationName;
          effectiveLocationId = fallbackLocationId;
        }
      }
    }

    const hasLocation = locationRefImages.length > 0;
    const locationLabel = [effectiveLocationName, effectiveZoneName].filter(Boolean).join(' → ');
    
    console.log(`[regen] ═══ FINAL RESOLUTION ═══`);
    console.log(`[regen] hasLocation=${hasLocation} | locationLabel="${locationLabel}" | images=${locationRefImages.length}`);
    console.log(`[regen] charRefImages=${charRefImages.length}`);

    // ── ROOM LOCK BLOCK ───────────────────────────────────────────────────────
    const roomLock = hasLocation ? `

════════════════════════════════════════════════════════════
ENVIRONMENT IDENTITY LOCK: ${locationLabel}
════════════════════════════════════════════════════════════
The first ${locationRefImages.length} reference image(s) are GROUND TRUTH photographs of this exact room.
YOU MUST REPRODUCE THIS EXACT SPACE. Match: flooring, walls, furniture, lighting, window treatments, decor.
ONLY camera angle and subject placement may differ.
⛔ DO NOT substitute any other room. ⛔ DO NOT use avatar background as environment.
════════════════════════════════════════════════════════════` : '';

    const qualityFooter = `\nABSOLUTE RULES: No floating text, no overlays, no watermarks. Photorealistic photograph only.`;

    // ── BUILD PROMPT BY REASON ────────────────────────────────────────────────
    let prompt = '';
    let referenceImages = [];

    if (reason === 'wrong_location' || reason === 'flawed') {
      const scenePrompt = (reason === 'wrong_location' && hasLocation)
        ? `${charName} in the ${effectiveZoneName || 'room'} at ${effectiveLocationName}.`
        : (reason === 'wrong_location')
          ? `${charName} in a scene.`
          : (originalPrompt || `${charName} in a natural candid scene`);

      const locationOverride = (reason === 'wrong_location' && hasLocation) ? `

════════════════════════════════════════════════════════════
⛔ LOCATION OVERRIDE — HARD ENVIRONMENT RESET ⛔
════════════════════════════════════════════════════════════
The user explicitly selected this location: ${locationLabel}
The first ${locationRefImages.length} reference image(s) ARE the exact room to use.
CRITICAL:
✗ IGNORE any room from the character avatar photos
✗ IGNORE the previous wrong room entirely
✓ BUILD the scene entirely from the provided location reference images
✓ This exact room, these exact furnishings, this exact environment
════════════════════════════════════════════════════════════` : '';

      prompt = `${scenePrompt}${roomLock}${locationOverride}

CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.

AVATAR SEPARATION RULE — MANDATORY:
Character reference images = PERSON IDENTITY ONLY (face, skin, hair, body).
Character reference images ≠ background, room, or environment.
Environment comes ONLY from location reference images.

Ultra high-resolution photorealistic photograph.${qualityFooter}`;

      referenceImages = [...locationRefImages.slice(0, 4), ...charRefImages.slice(0, 2)].filter(Boolean);

    } else if (reason === 'no_avatar') {
      const isMultiPerson = originalSubjectType === 'joint';
      prompt = `${originalPrompt || `${charName} in a natural candid scene`}${roomLock}

EXTREME CHARACTER LIKENESS REQUIREMENT for ${charName}:
Match exactly: face structure, eyes, nose, mouth, skin tone, hair (color/texture/LENGTH/style), body type.
Do NOT invent or approximate. The reference photos ARE this person.${isMultiPerson ? '\nMULTI-PERSON: Each person must have a distinctly different face from the reference photos.' : ''}

AVATAR SEPARATION: Reference photos define the PERSON ONLY, not the room/background.
Room comes ONLY from location reference images: ${locationLabel || 'as described in prompt'}.

Photorealistic photograph. Natural lighting.${qualityFooter}`;

      referenceImages = [...locationRefImages.slice(0, 4), ...charRefImages.slice(0, 2)].filter(Boolean);

    } else if ((reason === 'dont_like' || reason === 'custom_prompt') && customPrompt) {
      prompt = `${customPrompt}${roomLock}
CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.
${hasLocation ? `ENVIRONMENT: Use reference images 1–${locationRefImages.slice(0,4).length} for room/environment (80% authority). Character reference images = person identity only.` : `Character identity: ${charName}. Avatar background = 0% scene influence.`}
Photorealistic photograph.${qualityFooter}`;

      referenceImages = [...locationRefImages.slice(0, 4), ...charRefImages.slice(0, 2)].filter(Boolean);

    } else {
      prompt = `${originalPrompt || `${charName} in a natural candid scene`}${roomLock}
CHARACTER: ${charName}${charDesc ? ` (${charDesc})` : ''}.
${hasLocation ? `Reference images 1–${locationRefImages.slice(0,4).length}: ENVIRONMENT. Remaining: CHARACTER IDENTITY only.` : `Character identity only. Avatar background = 0% scene influence.`}
Photorealistic photograph.${qualityFooter}`;
      referenceImages = [...locationRefImages.slice(0, 4), ...charRefImages.slice(0, 2)].filter(Boolean);
    }

    console.log(`[regen] ▶ GENERATING: reason=${reason} | refs=${referenceImages.length} (loc=${Math.min(locationRefImages.length,4)}, char=${Math.min(charRefImages.length,2)}) | locationLabel="${locationLabel}"`);

    // ── GENERATE ──────────────────────────────────────────────────────────────
    let genRes;
    try {
      genRes = await base44.asServiceRole.integrations.Core.GenerateImage({
        prompt,
        existing_image_urls: referenceImages.length > 0 ? referenceImages : undefined,
      });
    } catch (genErr) {
      const msg = genErr?.message || '';
      if (msg.includes('filtered') || msg.includes('guidelines') || msg.includes('blocked') || msg.includes('violated')) {
        return Response.json({ success: false, filtered: true, error: 'Image blocked by content filter. Try rephrasing.' });
      }
      throw genErr;
    }

    if (!genRes?.url) return Response.json({ success: false, error: 'Generation returned no URL' }, { status: 500 });

    // Write result back to the exact message
    const targetMsg = await base44.asServiceRole.entities.Message.get(messageId).catch(() => null);
    if (!targetMsg || targetMsg.id !== messageId) {
      console.error(`[regen] ⛔ ID MISMATCH: requested=${messageId} got=${targetMsg?.id || 'null'}`);
      return Response.json({ success: false, error: 'Message ID mismatch — aborting write' }, { status: 400 });
    }
    await base44.asServiceRole.entities.Message.update(messageId, { image_url: genRes.url });
    console.log(`[regen] ✓ SUCCESS: message ${messageId} updated with new image`);

    if (character?.id) {
      base44.asServiceRole.entities.Memory.create({
        character_id: character.id,
        title: `Sent a regenerated photo`,
        description: `The user regenerated a photo (reason: ${reason}).`,
        emotional_impact: 'neutral',
        timestamp: new Date().toISOString(),
        source_context: `regenerated_image_${messageId}`,
      }).catch(() => {});
    }

    return Response.json({ success: true, image_url: genRes.url, messageId, reason });
  } catch (error) {
    console.error('[regenerateImageWithReason]', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});