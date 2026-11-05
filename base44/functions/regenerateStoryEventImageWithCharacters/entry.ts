import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── URL UTILITIES (inlined — Deno sandbox cannot import local files) ──────────
function toPublicCDN(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('https://media.base44.com/')) return url;
  const match = url.match(/https:\/\/base44\.app\/api\/apps\/[^\/]+\/files\/mp\/public\/([^\/]+\/[^?]+)/);
  if (match) return `https://media.base44.com/images/public/${match[1]}`;
  return url;
}

function isAccessible(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('https://')) return false;
  if (url.includes('/files/mp/private/') || url.includes('/files/private/')) return false;
  if (url.includes('?token=') || url.includes('?signed=') || url.includes('X-Amz-Signature')) return false;
  if (url.includes('base44.app/api/apps/')) return false;
  return true;
}

function cdnFilter(urls) {
  return (urls || []).map(toPublicCDN).filter(isAccessible);
}

// ── STORY EVENT IMAGE CONTINUITY BLOCKS (inlined) ────────────────────────────
// Every Story Event moment is generated separately. These blocks keep the same
// people, the same selected venue and the same clothing across the whole event.

function buildCharacterIdentityLockBlock(entries) {
  if (!entries || entries.length === 0) return '';
  const lines = [
    `════════════════════════════════════════════════════════════`,
    `🔒 CHARACTER IDENTITY LOCK — REFERENCE IMAGERY IS AUTHORITY`,
    `════════════════════════════════════════════════════════════`,
  ];
  for (const e of entries) {
    lines.push(``);
    lines.push(`${e.name}${e.first_name ? ` ("${e.first_name}")` : ''}${e.character_id ? ` — Character ID: ${e.character_id}` : ''}`);
    lines.push(e.appearance
      ? `  Documented appearance: ${e.appearance}`
      : `  Documented appearance: (none recorded — the attached reference image is the sole authority for this person)`);
    lines.push(`  - Face, facial features, complexion, hairstyle, hair texture, body type and proportions MUST match this person's reference imagery exactly.`);
    lines.push(`  - AGE IS NOT AN APPEARANCE DESCRIPTION. Never infer how this person looks from a numeric age, and never from a family or social role (grandmother, grandfather, mother, father, elder).`);
    lines.push(`  - Do NOT age them up: no added gray hair, added weight, wrinkles, frailty, dowdy clothing, or "typical for their age" styling that the reference imagery does not show.`);
    lines.push(`  - Do NOT age them down or idealize them into a younger, smoother, more generic version of themselves.`);
    lines.push(`  - Where a written detail and the reference image disagree, the REFERENCE IMAGE wins.`);
  }
  lines.push(`════════════════════════════════════════════════════════════`);
  return lines.join('\n');
}

function buildVenueIdentityLockBlock(venue, imageRange) {
  if (!venue || !venue.images || venue.images.length === 0) return '';
  const lines = [
    `════════════════════════════════════════════════════════════`,
    `📍 LOCATION IDENTITY LOCK — THE SELECTED, EXISTING VENUE`,
    `════════════════════════════════════════════════════════════`,
    `This event takes place at "${venue.name}", a real existing location the user selected.`,
    `Attached ${venue.images.length === 1 ? 'image' : 'images'} ${imageRange} ${venue.images.length === 1 ? 'is a reference photograph' : 'are reference photographs'} of that actual place.`,
  ];
  if (venue.description) lines.push(`Documented description: ${venue.description}`);
  if (venue.category) lines.push(`Location type: ${String(venue.category).replace(/_/g, ' ')}`);
  lines.push(`- Treat it as a THREE-DIMENSIONAL PLACE, not a backdrop: same architecture, geometry, layout, materials, furniture types, colours, finishes and distinguishing features.`);
  lines.push(`- The camera may be anywhere inside it — facing another wall, closer to a surface, from the entrance, from a different angle. A different viewpoint is expected and correct.`);
  lines.push(`- Do NOT reproduce the reference photograph's framing or composition, and do NOT composite people onto it.`);
  lines.push(`- Do NOT restyle, renovate, redecorate or simplify it, and do NOT replace it with generic scenery of the same category.`);
  lines.push(`- Lighting, weather and atmosphere follow THIS event's time and mood, not the reference photograph.`);
  lines.push(`════════════════════════════════════════════════════════════`);
  return lines.join('\n');
}

function buildClothingContinuityBlock(entries) {
  if (!entries || entries.length === 0) return '';
  const lines = [
    `════════════════════════════════════════════════════════════`,
    `👕 CLOTHING CONTINUITY — THIS IS ONE CONTINUOUS EVENT`,
    `════════════════════════════════════════════════════════════`,
  ];
  for (const e of entries) {
    lines.push(`${e.name}: ${e.outfit || 'no wardrobe record — the outfit established in the other images of this event must be repeated exactly'}`);
  }
  lines.push(``);
  lines.push(`- Every image of this event shows the same outfit on the same person, in the same colours, patterns and accessories.`);
  lines.push(`- A new image is NOT a new outfit. A different camera angle is NOT a new outfit. A new moment is NOT a new outfit.`);
  lines.push(`- Change someone's clothing ONLY when this image's own scene explicitly shows the change: they shower or bathe, dress for a new activity, get ready for bed, or the story moves to a different time or place where a change has happened.`);
  lines.push(`════════════════════════════════════════════════════════════`);
  return lines.join('\n');
}

function buildImageMapBlock(entries) {
  if (!entries || entries.length === 0) return '';
  return ['IMAGE MAP (attached images, in order):', ...entries.map(e => `${e.range}: ${e.label}`)].join('\n');
}

function resolveVenueRefImages(venue) {
  if (!venue) return [];
  const urls = [
    ...cdnFilter(venue.image_urls || []),
    ...(venue.zones || []).flatMap(z => cdnFilter(z.image_urls || [])),
  ];
  return urls.filter((url, i, arr) => arr.indexOf(url) === i).slice(0, 3);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { story_event_id, image_id, visible_character_ids, reasons } = body;
    if (!story_event_id || !image_id) {
      return Response.json({ error: 'story_event_id and image_id required' }, { status: 400 });
    }
    // visible_character_ids is optional for non-identity reasons (flawed, location_incorrect).
    // When provided, identities MUST resolve with reference images.
    const hasCharacterIds = visible_character_ids && Array.isArray(visible_character_ids) && visible_character_ids.length > 0;
    const hasLikenessReason = Array.isArray(reasons) && reasons.includes('does_not_look_like_them');
    
    // If likeness reason but no character IDs, fall back to event participants
    let effectiveCharacterIds = hasCharacterIds ? [...visible_character_ids] : [];
    if (!hasCharacterIds && hasLikenessReason) {
      return Response.json({ error: 'visible_character_ids required when "does_not_look_like_them" is selected' }, { status: 400 });
    }

    const allReasons = Array.isArray(reasons) && reasons.length > 0 ? reasons : [];

    // Fetch StoryEvent
    const events = await base44.asServiceRole.entities.StoryEvent.filter({ id: story_event_id }, null, 1);
    const event = events[0];
    if (!event) return Response.json({ error: 'StoryEvent not found' }, { status: 404 });

    // Fetch existing image
    const existingImages = await base44.asServiceRole.entities.StoryEventImage.filter({ id: image_id }, null, 1);
    const existingImage = existingImages[0];
    if (!existingImage) return Response.json({ error: 'StoryEventImage not found' }, { status: 404 });

    const momentType = existingImage.moment_type;
    const originalPrompt = existingImage.prompt || '';
    const venueName = event.venue_name || 'the event venue';

    // ── LOAD ALL VISIBLE IDENTITIES (User + all character types) ──────────
    // Service role lookup resolves both Character entities and User identities.
    const charById = {};
    const refImages = [];
    const visibleNames = [];
    const visibleTypes = [];
    const lookupStatusByChar = {};

    for (const cid of effectiveCharacterIds) {
      try {
        const isUserIdentity = cid.startsWith('user_');

        if (isUserIdentity) {
          // ── User identity: look up User + UserSettings for reference images ─
          const rawId = cid.replace('user_', '');
          let userRefImages = [];
          let userName = rawId;

          try {
            // Look up the user via service role
            const userList = await base44.asServiceRole.entities.User.list(null, 500);
            const matched = userList.find(u => u.id === rawId || u.email === rawId);
            if (matched) {
              // World name and avatar live on the USER entity — not UserSettings
              userName = matched.world_name || matched.full_name || matched.email || rawId;

              // Collect user reference images from the USER entity (authoritative source)
              if (Array.isArray(matched.generated_avatar_urls)) {
                matched.generated_avatar_urls.forEach(url => {
                  if (url && typeof url === 'string') userRefImages.push(url);
                });
              }
              if (Array.isArray(matched.reference_image_urls)) {
                matched.reference_image_urls.forEach(url => {
                  if (url && typeof url === 'string') userRefImages.push(url);
                });
              }

              // UserSettings only for appearance_lock (User entity does not have it)
              let userAppearanceLock = null;
              try {
                const settingsList = await base44.asServiceRole.entities.UserSettings.filter(
                  { owner_email: matched.email }, null, 1
                );
                if (settingsList[0]) {
                  userAppearanceLock = settingsList[0].appearance_lock || null;
                }
              } catch (_) {}

              charById[cid] = {
                name: userName,
                display_name: userName,
                character_type: 'user',
                appearance_notes: '',
                appearance_lock: userAppearanceLock,
                style_identity: '',
                avatar_url: userRefImages[0] || null,
              };
            }
          } catch (_) {}

          visibleNames.push(userName);
          visibleTypes.push('user');

          // The user is NEVER a generic stranger. They are the authenticated,
          // known identity. Finding the user record IS the resolution — the
          // user is resolved as soon as they are matched, regardless of whether
          // uploaded reference photos exist. The appearance_lock + name are
          // sufficient for identity generation. Reference images (when present)
          // are still collected above for grounding.
          if (userRefImages.length > 0) {
            refImages.push(...userRefImages);
          }
          // User is resolved the moment we matched their record (charById was set).
          lookupStatusByChar[cid] = charById[cid] ? 'resolved' : 'reference_lookup_failed';
        } else {
          // ── Character identity ──────────────────────────────────────────
          const chars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
          if (chars[0]) {
            const c = chars[0];
            charById[cid] = c;
            visibleNames.push(c.name || c.display_name || cid);
            visibleTypes.push(c.character_type || 'active_created_character');

            // Collect all reference image sources
            const charRefImages = [];
            if (c.avatar_url && typeof c.avatar_url === 'string') charRefImages.push(c.avatar_url);
            if (c.image_avatar_url && typeof c.image_avatar_url === 'string') charRefImages.push(c.image_avatar_url);
            if (Array.isArray(c.reference_image_urls)) {
              c.reference_image_urls.forEach(url => {
                if (url && typeof url === 'string') charRefImages.push(url);
              });
            }

            if (charRefImages.length > 0) {
              refImages.push(...charRefImages);
              lookupStatusByChar[cid] = 'resolved';
            } else {
              lookupStatusByChar[cid] = 'reference_lookup_failed';
            }
          } else {
            visibleNames.push(cid);
            visibleTypes.push('unknown');
            lookupStatusByChar[cid] = 'character_not_found';
          }
        }
      } catch (_) {
        visibleNames.push(cid);
        visibleTypes.push('unknown');
        lookupStatusByChar[cid] = 'character_not_found';
      }
    }

    // ── OUTFIT AUTHORITY: resolveCharacterOutfitContext / resolveUserOutfitContext ──
    // Story Event image regeneration must honor the same wardrobe authority as
    // Chat and Scene. Resolve the authoritative closet outfit for each visible
    // character and the user, then inject it as a CLOSET OUTFIT LOCK block.
    const ownerEmail = event.owner_email || user.email;
    const outfitByCid = {};
    for (const cid of effectiveCharacterIds) {
      const isUserIdentity = cid.startsWith('user_');
      try {
        if (isUserIdentity) {
          const outfitRes = await base44.asServiceRole.functions.invoke('resolveUserOutfitContext', {
            ownerEmail: ownerEmail,
            locationCategory: null,
            locationId: event.venue_id || null,
          });
          if (outfitRes?.text) outfitByCid[cid] = outfitRes.text;
        } else {
          const outfitRes = await base44.asServiceRole.functions.invoke('resolveCharacterOutfitContext', {
            characterId: cid,
            locationId: event.venue_id || null,
            locationCategory: null,
            ownerEmail: ownerEmail,
          });
          if (outfitRes?.text) outfitByCid[cid] = outfitRes.text;
        }
      } catch (outfitErr) {
        console.warn(`[regenerateStoryEventImageWithCharacters] Outfit resolve failed for ${cid}: ${outfitErr?.message}`);
      }
    }

    const outfitLockLines = [];
    outfitLockLines.push(`════════════════════════════════════════════════════════════`);
    outfitLockLines.push(`👕 CLOSET OUTFIT LOCK — CLOTHING CONTINUITY FOR THIS EVENT`);
    outfitLockLines.push(`════════════════════════════════════════════════════════════`);
    outfitLockLines.push(`Each person's clothing below is the AUTHORITATIVE outfit from their Character/User Closet.`);
    outfitLockLines.push(`Do NOT invent, substitute, or genericize clothing. Render exactly what is described.`);
    let anyOutfit = false;
    for (const cid of effectiveCharacterIds) {
      const c = charById[cid];
      const name = c?.name || c?.display_name || cid;
      if (outfitByCid[cid]) {
        anyOutfit = true;
        outfitLockLines.push(`- ${name}: ${outfitByCid[cid]}`);
      }
    }
    if (!anyOutfit) outfitLockLines.push(`(No closet outfit resolved — repeat exactly the clothing established in the other images of this event.)`);
    outfitLockLines.push(``);
    outfitLockLines.push(`- This is ONE CONTINUOUS EVENT: every image of it shows the same outfit on the same person.`);
    outfitLockLines.push(`- A new image is NOT a new outfit, and a different camera angle is NOT a new outfit.`);
    outfitLockLines.push(`- Change someone's clothing ONLY when this image's own scene explicitly shows the change (showering or bathing, dressing for a new activity, getting ready for bed, or a different time or place where a change happened).`);
    outfitLockLines.push(`════════════════════════════════════════════════════════════`);
    const outfitLockBlock = outfitLockLines.join('\n');

    // ── VENUE IDENTITY REFERENCES ─────────────────────────────────────────────
    // A real, persisted, non-rabbit-hole venue brings its own reference photographs.
    // Rabbit-hole behaviour is untouched.
    const isRabbitHole = !!event.is_rabbit_hole;
    let venueRecord = null;
    if (!isRabbitHole && event.venue_id) {
      try {
        const venueRecs = await base44.asServiceRole.entities.LocationReference.filter({ id: event.venue_id }, null, 1);
        venueRecord = venueRecs[0] || null;
      } catch (_) {}
    }
    const venueRefImages = isRabbitHole ? [] : resolveVenueRefImages(venueRecord);
    const venueImageLock = venueRefImages.length > 0
      ? {
          name: venueRecord?.name || venueName,
          description: (venueRecord?.description || '').substring(0, 600) || null,
          category: venueRecord?.category || null,
          images: venueRefImages,
        }
      : null;

    // ── EVENT CONTINUITY REFERENCE ────────────────────────────────────────────
    // An already generated image from this same event keeps clothing and the room
    // identical. It is a continuity anchor, never a composition template.
    let continuityImageUrl = null;
    try {
      const siblingImages = await base44.asServiceRole.entities.StoryEventImage.filter(
        { story_event_id }, 'order', 10
      ).catch(() => []);
      const sibling = (siblingImages || []).find(i => i.image_url && i.id !== image_id);
      continuityImageUrl = sibling?.image_url || null;
    } catch (_) {}

    // Build appearance context ONLY from resolved characters
    const appearanceParts = effectiveCharacterIds.map(cid => {
      const c = charById[cid];
      if (!c) return '';
      const parts = [];
      if (c.appearance_notes) parts.push(c.appearance_notes);
      if (c.avatar_description_text) parts.push(c.avatar_description_text);
      if (c.appearance_lock && typeof c.appearance_lock === 'object') {
        const al = c.appearance_lock;
        if (al.skin_tone) parts.push(`skin: ${al.skin_tone}`);
        if (al.hair_type) parts.push(`hair: ${al.hair_type}`);
        if (al.hairstyle) parts.push(`hairstyle: ${al.hairstyle}`);
        if (al.facial_hair) parts.push(`facial hair: ${al.facial_hair}`);
        if (al.clothing_style) parts.push(`clothing: ${al.clothing_style}`);
        if (al.overall_aesthetic) parts.push(`aesthetic: ${al.overall_aesthetic}`);
      }
      if (c.style_identity && !parts.some(p => p.includes(c.style_identity))) {
        parts.push(`style: ${c.style_identity}`);
      }
      return `${c.name || cid}: ${parts.join(', ')}`;
    }).filter(Boolean).join(' | ');

    // ── REFERENCE PLAN: identity → venue → continuity ────────────────────────
    // The IMAGE MAP below tells the generator what each attached image is for, so a
    // face can never be used as room data or a room as a face.
    const planRefs = [];
    const planMap = [];
    const addPlanRef = (url) => {
      const clean = toPublicCDN(url);
      if (!clean || !isAccessible(clean) || planRefs.includes(clean)) return null;
      planRefs.push(clean);
      return planRefs.length;
    };
    const rangeOf = (nums) => (nums.length === 1 ? `Image ${nums[0]}` : `Images ${nums[0]}–${nums[nums.length - 1]}`);

    // Identity images are grouped per person in the order they were collected
    // (avatar first, then photographs) — the same order the ids were resolved in.
    const identityEntries = [];
    {
      let cursor = 0;
      for (const cid of effectiveCharacterIds) {
        const c = charById[cid];
        const collected = [];
        if (c) {
          if (c.avatar_url && typeof c.avatar_url === 'string') collected.push(c.avatar_url);
          if (c.image_avatar_url && typeof c.image_avatar_url === 'string') collected.push(c.image_avatar_url);
          if (Array.isArray(c.reference_image_urls)) {
            for (const url of c.reference_image_urls) {
              if (url && typeof url === 'string') collected.push(url);
            }
          }
        }
        const nums = [];
        for (const url of collected) {
          const n = addPlanRef(url);
          if (n) nums.push(n);
          if (nums.length >= 3) break;
        }
        cursor += 1;
        identityEntries.push({
          name: c?.name || c?.display_name || cid,
          first_name: null,
          character_id: cid.startsWith('user_') ? null : cid,
          appearance: c
            ? [c.appearance_notes, c.avatar_description_text,
               c.appearance_lock?.skin_tone ? `skin: ${c.appearance_lock.skin_tone}` : null,
               c.appearance_lock?.hairstyle ? `hairstyle: ${c.appearance_lock.hairstyle}` : null,
               c.appearance_lock?.hair_type ? `hair: ${c.appearance_lock.hair_type}` : null,
               c.appearance_lock?.overall_aesthetic ? `aesthetic: ${c.appearance_lock.overall_aesthetic}` : null,
               c.style_identity ? `style: ${c.style_identity}` : null,
              ].filter(Boolean).join(' | ')
            : null,
        });
        if (nums.length > 0) {
          planMap.push({
            range: rangeOf(nums),
            label: `FACE / BODY IDENTITY — ${c?.name || cid}. Face, hair, complexion, body type come from here.`,
          });
        }
        void cursor;
      }
    }

    const venueNums = venueRefImages.map(u => addPlanRef(u)).filter(Boolean);
    if (venueNums.length > 0) {
      planMap.push({
        range: rangeOf(venueNums),
        label: `LOCATION SPATIAL DATA — ${venueImageLock.name}. Build this exact place from these; do NOT copy their framing.`,
      });
    }

    if (continuityImageUrl) {
      const continuityNum = addPlanRef(continuityImageUrl);
      if (continuityNum) {
        planMap.push({
          range: `Image ${continuityNum}`,
          label: `CONTINUITY REFERENCE — an already generated photograph from THIS SAME EVENT. Use ONLY for the same clothing and the same room. Do NOT copy its camera angle, framing, pose or composition.`,
        });
      }
    }

    const identityLockBlock = buildCharacterIdentityLockBlock(identityEntries);
    const venueIdentityLockBlock = venueImageLock && venueNums.length > 0
      ? buildVenueIdentityLockBlock(venueImageLock, rangeOf(venueNums).replace(/^Images? /, ''))
      : '';
    const imageMapBlock = buildImageMapBlock(planMap);

    // Deduplicated, CDN-safe reference payload built by the plan above.
    const dedupedRefs = planRefs.slice(0, 12);

    // ── CRITICAL: BLOCK GENERATION IF REFERENCES FAIL ────────────────────
    // If any selected identity has reference_lookup_failed, refuse to generate.
    // This prevents generating generic strangers when identities were selected.
    const anyReferenceLookupFailed = Object.values(lookupStatusByChar).some(s => s === 'reference_lookup_failed');
    const anyCharacterNotFound = Object.values(lookupStatusByChar).some(s => s === 'character_not_found');
    const allResolved = !anyReferenceLookupFailed && !anyCharacterNotFound;

    // BUILD THE DIAGNOSTIC REGARDLESS — it must be returned even on failure
    const failedCharacters = Object.entries(lookupStatusByChar)
      .filter(([, s]) => s !== 'resolved')
      .map(([cid, s]) => ({ id: cid, status: s, name: visibleNames[effectiveCharacterIds.indexOf(cid)] || cid }));

    const lookupDiagnostic = !allResolved
      ? `partial_lookup: ${failedCharacters.map(f => `${f.id}=${f.status}`).join(', ')}`
      : 'all_characters_resolved_with_references';

    // BLOCK: identities selected but reference images missing
    if (hasCharacterIds && !allResolved) {
      return Response.json({
        success: false,
        error: 'reference_lookup_failed',
        detail: `Cannot regenerate: ${failedCharacters.length} selected identities could not be resolved with reference images. This prevents generating generic strangers.`,
        failed_characters: failedCharacters,
        reference_lookup_status_by_character: lookupStatusByChar,
        resolved_count: Object.values(lookupStatusByChar).filter(s => s === 'resolved').length,
        reference_lookup_failed_count: Object.values(lookupStatusByChar).filter(s => s === 'reference_lookup_failed').length,
        character_not_found_count: Object.values(lookupStatusByChar).filter(s => s === 'character_not_found').length,
      }, { status: 422 });
    }

    // Build regeneration prompt
    const reasonText = allReasons.length > 0
      ? `REGENERATION REASONS: ${allReasons.join(', ')}.`
      : 'Regenerating with selected characters.';

    const regenPrompt = [
      originalPrompt,
      '',
      reasonText,
      '',
      `VISIBLE CHARACTERS (ONLY THESE — NO GENERIC STRANGERS OR SUBSTITUTES):`,
      visibleNames.join(', '),
      '',
      `CHARACTER APPEARANCE (MUST MATCH EXACTLY — USE REFERENCE IMAGES):`,
      appearanceParts || 'Use reference images for character identity.',
      '',
      identityLockBlock,
      '',
      ...(venueIdentityLockBlock ? [venueIdentityLockBlock, ''] : []),
      outfitLockBlock,
      '',
      ...(imageMapBlock ? [imageMapBlock, ''] : []),
      `VENUE: ${venueName}`,
      `- The people and the room must be photographed from THIS moment's own camera position. Do not repeat the framing of any reference image.`,
      `MOMENT: ${momentType.replace('_', ' ')}`,
      `EVENT: ${event.title}`,
      `DATE: ${event.event_date}`,
      '',
      `BACKGROUND POPULATION DIVERSITY LAW — ABSOLUTE OVERRIDE:`,
      `Caucasian/White is NEVER the default appearance for any automatically generated, unspecified, or background person.`,
      `This applies to: background figures, crowds, pedestrians, shoppers, coworkers, students, diners, patrons, visitors, commuters, and ALL other incidental or unnamed people.`,
      `When generating ANY person whose ethnicity is not explicitly defined by reference images, appearance lock, or character data:`,
      `✅ Distribute across diverse backgrounds: Black, Hispanic/Latino, Indian, Jamaican, African, Asian, Middle Eastern, Haitian, Mixed heritage, Indigenous, Pacific Islander, South Asian, and other culturally appropriate backgrounds.`,
      `✅ Vary skin tones, facial features, hair textures, and body types to reflect authentic real-world human diversity.`,
      `⛔ DO NOT collapse all background people to a single ethnicity.`,
      `⛔ DO NOT use training-data "generic person" defaults — those priors skew heavily Caucasian/White.`,
      `⛔ DO NOT default to Caucasian when no ethnicity is specified — select from the diverse backgrounds listed above.`,
      `This rule overrides any training-data bias. Explicitly defined characters are NOT affected — their locked appearance is always preserved exactly.`,
    ].join('\n');

    // Generate image
    const imageRes = await base44.asServiceRole.integrations.Core.GenerateImage({
      prompt: regenPrompt,
      existing_image_urls: dedupedRefs.length > 0 ? dedupedRefs : undefined,
    });

    if (!imageRes?.url) {
      return Response.json({ error: 'Image generation failed — no URL returned' }, { status: 500 });
    }

    // Update the StoryEventImage record with all required fields
    await base44.asServiceRole.entities.StoryEventImage.update(image_id, {
      image_url: imageRes.url,
      prompt: regenPrompt,
      visible_character_ids: effectiveCharacterIds,
      visible_character_names: visibleNames,
      visible_character_types: visibleTypes,
      reference_image_urls: dedupedRefs,
      reference_lookup_status_by_character: lookupStatusByChar,
      regeneration_reason: allReasons.join(', ') || 'character_selection_update',
      description: lookupDiagnostic,
    });

    // ── Find or create a real Conversation for Media Gallery visibility ──────
    // Service-role create + owner_email ensures the gallery's owner_email query
    // path finds these conversations even without user auth context.
    let storyEventConversationId = `story_event_${story_event_id}`;
    try {
      const existingConvos = await base44.asServiceRole.entities.Conversation.filter(
        { title: `story_event::${story_event_id}`, channel: 'story_event' },
        '-created_date', 5
      ).catch(() => []);

      if (existingConvos?.length > 0 && existingConvos[0]?.id) {
        storyEventConversationId = existingConvos[0].id;
      } else {
        const storyConvo = await base44.asServiceRole.entities.Conversation.create({
          title: `story_event::${story_event_id}`,
          type: 'direct',
          character_ids: effectiveCharacterIds,
          channel: 'story_event',
          owner_email: event.owner_email || user.email,
        }).catch(() => null);
        if (storyConvo?.id) {
          storyEventConversationId = storyConvo.id;
        }
      }
    } catch (e) {
      console.warn(`[regenerateStoryEventImageWithCharacters] Conversation resolution failed: ${e?.message}`);
    }

    // Create Message for Media Gallery — uses real Conversation ID
    await base44.asServiceRole.entities.Message.create({
      conversation_id: storyEventConversationId,
      sender_type: 'user',
      content: '',
      image_url: imageRes.url,
      image_description: regenPrompt,
      image_analysis_status: 'complete',
      generation_context: {
        source: 'story_event_regen',
        story_event_id,
        event_title: event.title,
        event_date: event.event_date,
        moment_type: momentType,
        visible_character_ids: effectiveCharacterIds,
        visible_character_names: visibleNames,
        visible_character_types: visibleTypes,
        venue_id: event.venue_id,
        venue_name: venueName,
        regeneration_parent_image_id: image_id,
        regeneration_reasons: allReasons,
        scene_prompt: regenPrompt,
        character_reference_images: dedupedRefs.slice(0, 5),
        reference_lookup_status_by_character: lookupStatusByChar,
        subjects: effectiveCharacterIds.map(cid => ({
          subject_type: 'character',
          subject_id: cid,
          subject_name: charById[cid]?.name || cid,
          subject_character_type: charById[cid]?.character_type || 'unknown',
        })),
      },
      timestamp: new Date().toISOString(),
    });

    return Response.json({
      success: true,
      image_id,
      new_url: imageRes.url,
      visible_character_ids: effectiveCharacterIds,
      visible_character_names: visibleNames,
      visible_character_types: visibleTypes,
      reference_image_urls: dedupedRefs,
      reference_lookup_status_by_character: lookupStatusByChar,
      lookup_diagnostic: lookupDiagnostic,
      reference_lookup_failed_count: Object.values(lookupStatusByChar).filter(s => s === 'reference_lookup_failed').length,
      character_not_found_count: Object.values(lookupStatusByChar).filter(s => s === 'character_not_found').length,
    });
  } catch (error) {
    console.error('[regenerateStoryEventImageWithCharacters]', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});