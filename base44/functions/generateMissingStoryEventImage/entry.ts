import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── PARTICIPANT NAME REFERENCE KEY (inlined — Deno sandbox cannot import local files) ──
function buildParticipantNameReferenceKeyBlock(participants) {
  if (!participants || participants.length === 0) return '';
  const lines = [];
  lines.push(`[NAME REFERENCE KEY — SELECTED PARTICIPANTS]`);
  lines.push(`Every name in the scene prompt maps to exactly one visual identity bundle below.`);
  lines.push(`Do NOT infer any appearance, gender, outfit, or body from a name alone.`);
  lines.push(`Do NOT assign any subject's attributes to a different subject.`);
  lines.push(``);
  for (const p of participants) {
    const displayName = p.display_name || 'Unknown';
    const promptName = p.matched_prompt_name || displayName.split(/\s+/)[0];
    if (p.participant_type === 'user') {
      const userIdValue = p.user_id || 'authenticated_user';
      lines.push(`"${promptName}" = ${displayName} (User ID: ${userIdValue}) — use their visual identity references`);
    } else {
      const charIdValue = p.character_id || 'character';
      lines.push(`"${promptName}" = ${displayName} (Character ID: ${charIdValue}) — use their visual identity references`);
    }
  }
  lines.push(`[END NAME REFERENCE KEY]`);
  return `\n════════════════════════════════════════════════════════════\n${lines.join('\n')}\n════════════════════════════════════════════════════════════\n`;
}

// ── URL UTILITIES (inlined) ───────────────────────────────────────────────────
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

// The AVATAR is the character's canonical face and is ALWAYS included first —
// reference photographs follow. Story Event images must preserve the established
// face, hair, complexion and body, so the avatar is never dropped in favour of
// loose reference photos.
function resolveCharacterRefImages(charRecord) {
  if (!charRecord) return [];
  const out = [];
  const pushUrl = (url) => {
    const pub = toPublicCDN(url);
    if (!pub || !isAccessible(pub) || out.includes(pub)) return;
    out.push(pub);
  };
  pushUrl(charRecord.avatar_url);
  pushUrl(charRecord.image_avatar_url);
  for (const url of cdnFilter(charRecord.reference_image_urls || [])) {
    if (out.length >= 4) break;
    if (url.includes('generated_image') && out.length > 0) continue;
    pushUrl(url);
  }
  return out.slice(0, 4);
}

// ── STORY EVENT IMAGE CONTINUITY BLOCKS (inlined — Deno sandbox) ──────────────
// Story Event moments are generated one at a time. These blocks keep the same
// people, the same selected venue and the same clothing across all of them.

// Age at the date the event represents — a child's appearance depends on the age
// they were AT THAT TIME, not their age today. Eastern Time is authoritative;
// event dates are plain calendar dates so the year difference is exact.
function ageAtEventDate(character, eventDate) {
  const birthday = character?.birthday;
  const target = eventDate ? new Date(`${String(eventDate).substring(0, 10)}T12:00:00`) : new Date();
  if (birthday) {
    const birth = new Date(birthday);
    if (!isNaN(birth.getTime()) && !isNaN(target.getTime())) {
      let age = target.getFullYear() - birth.getFullYear();
      const monthDiff = target.getMonth() - birth.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && target.getDate() < birth.getDate())) age--;
      if (age >= 0) return age;
    }
  }
  const storedAge = Number(character?.age);
  return Number.isFinite(storedAge) && storedAge >= 0 ? Math.floor(storedAge) : null;
}

// Adults must never be aged by stereotype; children must actually develop,
// because identity is not a frozen body.
function developmentalAgeDirective(entry) {
  const fixed = entry.appearance_age != null && Number.isFinite(Number(entry.appearance_age))
    ? Number(entry.appearance_age)
    : null;
  if (fixed !== null) {
    return `  - The user has fixed this character's visual age at ${fixed}. That decision is authoritative: do not age them older or younger than ${fixed}. Keep their identity from the reference imagery.`;
  }
  const age = entry.age_at_event != null ? Number(entry.age_at_event) : null;
  if (age === null) {
    return `  - No age is recorded. Do not invent one, and do not apply a stereotypical appearance for any age.`;
  }
  if (age < 18) {
    return [
      `  - AGE AT THIS EVENT: ${age}. At this moment in the story this person is a child or adolescent.`,
      `  - Take IDENTITY from the reference imagery (facial features, eye shape, complexion, hair colour and texture). Take HEIGHT, body proportions and facial maturity from age ${age}.`,
      `  - The reference images may have been made at an earlier age. Use them for identity only, never for developmental stage.`,
      `  - Do NOT render an infant or toddler where a ${age}-year-old is described, and do NOT render an adult. The same recognisable person must appear, grown to ${age}.`,
      `  - Never substitute an unrelated child. It must read as this person at ${age}, not a stranger of that age.`,
    ].join('\n');
  }
  return `  - AGE AT THIS EVENT: ${age}. Adults do not visibly transform on a schedule. Do NOT add wrinkles, grey hair, weight, sagging, frailty or "elderly" styling merely because of this number, and do NOT smooth them into a younger person. Their reference imagery is authoritative.`;
}

function buildCharacterIdentityLockBlock(entries) {
  if (!entries || entries.length === 0) return '';
  const lines = [
    `════════════════════════════════════════════════════════════`,
    `🔒 CHARACTER IDENTITY LOCK — REFERENCE IMAGERY IS AUTHORITY`,
    `════════════════════════════════════════════════════════════`,
  ];
  for (const e of entries) {
    lines.push(``);
    lines.push(`${e.name} ("${e.first_name}", Character ID: ${e.character_id})`);
    lines.push(e.appearance
      ? `  Documented appearance: ${e.appearance}`
      : `  Documented appearance: (none recorded — the attached reference image is the sole authority for this person)`);
    lines.push(`  Reference images attached: ${e.ref_count > 0 ? `${e.ref_count} (${e.ref_range})` : `NONE — this is a data gap, render only from documented appearance`}`);
    lines.push(`  - Face, facial features, complexion, hairstyle, hair texture and individual appearance MUST match this person's reference imagery exactly.`);
    lines.push(developmentalAgeDirective(e));
    lines.push(`  - AGE IS NOT A ROLE. Never infer appearance from a family or social role (grandmother, grandfather, mother, father, elder). A grandmother is not automatically grey-haired, heavyset or dressed in a stereotypical way.`);
    lines.push(`  - Where a written detail and the reference image disagree, the REFERENCE IMAGE wins for identity.`);
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
  if (venue.description) lines.push(`User's written description (background colour only — NOT an authority on the interior, OVERRIDDEN by the photographs): ${String(venue.description).substring(0, 200)}`);
  if (venue.category) lines.push(`Location type: ${String(venue.category).replace(/_/g, ' ')}`);
  lines.push(`- The room is built ONLY from those photographs: architecture, layout, materials, furniture types, colours, finishes and distinctive features.`);
  lines.push(`- Do NOT invent decor, fixtures, wall treatments, furniture or room features that are not visible in the photographs.`);
  lines.push(`- Treat it as a THREE-DIMENSIONAL PLACE, not a backdrop: you may place the camera anywhere inside it — facing another wall, closer to a surface, from the entrance, from a different angle. A different viewpoint is expected and correct.`);
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
    lines.push(`${e.name}: ${e.outfit || 'no wardrobe record — if an earlier image of this event exists, repeat exactly the clothing worn there; otherwise dress them in ordinary, fully covering everyday clothing appropriate to this venue and keep it identical for the rest of the event'}`);
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

// ── USER IDENTITY LOCK (inlined) ──────────────────────────────────────────────
function buildUserIdentityLockBlock(userBundle) {
  if (!userBundle || userBundle.participant_type !== 'user') return '';
  const lines = [];
  const worldName = userBundle.display_name || 'the User';
  const promptName = userBundle.matched_prompt_name || 'User';
  const userId = userBundle.user_id || 'authenticated_user';

  lines.push(`════════════════════════════════════════════════════════════`);
  lines.push(`🔒 USER IDENTITY LOCK — ZERO-DRIFT ENFORCEMENT`);
  lines.push(`════════════════════════════════════════════════════════════`);
  lines.push(`The participant "${promptName}" is the AUTHENTICATED USER of this world.`);
  lines.push(`They are a real visual subject in this scene — NOT a generic bystander.`);
  lines.push(`Their likeness MUST appear in this image with the EXACT identity profile below.`);
  lines.push(``);
  lines.push(`USER IDENTITY ANCHOR:`);
  lines.push(`  World Name: ${worldName}`);
  lines.push(`  User ID: ${userId}`);
  if (userBundle.gender) lines.push(`  Gender: ${userBundle.gender}`);
  if (userBundle.culture) lines.push(`  Culture: ${userBundle.culture}`);
  if (userBundle.race) lines.push(`  Race: ${userBundle.race}`);

  const al = userBundle.appearance_lock;
  if (al && typeof al === 'object') {
    lines.push(``);
    lines.push(`USER APPEARANCE LOCK (render these EXACT attributes):`);
    if (al.height_display) lines.push(`  Height: ${al.height_display}`);
    else if (al.height_inches) lines.push(`  Height: ${al.height_inches} inches`);
    if (al.skin_tone) lines.push(`  Skin tone: ${al.skin_tone}`);
    if (al.hair_type) lines.push(`  Hair type: ${al.hair_type}`);
    if (al.hairstyle) lines.push(`  Hairstyle: ${al.hairstyle}`);
    if (al.facial_hair) lines.push(`  Facial hair: ${al.facial_hair}`);
    if (al.clothing_style) lines.push(`  Clothing style: ${al.clothing_style}`);
    if (al.overall_aesthetic) lines.push(`  Overall aesthetic: ${al.overall_aesthetic}`);
  }

  if (userBundle.ref_images && userBundle.ref_images.length > 0) {
    lines.push(``);
    lines.push(`USER VISUAL REFERENCE: ${userBundle.ref_images.length} avatar/reference image(s) attached.`);
    lines.push(`The person "${promptName}" MUST match the face, body, skin color, and hairstyle shown in those reference images.`);
  }

  lines.push(``);
  lines.push(`ENFORCEMENT:`);
  lines.push(`- "${promptName}" MUST be visibly present in this image as a real, rendered person.`);
  lines.push(`- Do NOT omit, replace, or genericize "${promptName}".`);
  lines.push(`════════════════════════════════════════════════════════════`);
  return `\n${lines.join('\n')}\n`;
}

/**
 * generateMissingStoryEventImage
 *
 * Generates a SINGLE missing image moment for an existing COMPLETE Story Event.
 *
 * This is NOT a second image system. It uses the same production pipeline as
 * generateStoryEvent (GenerateImage integration, Name Reference Key, User
 * Identity Lock, diversity law, reference image resolution). The difference:
 * it targets ONE missing moment without touching the parent Story Event status
 * or rerunning any continuity effects (memories, LifeEvents, LocationHistory,
 * participation, narrative injection).
 *
 * Use case: StoryEvent.status === 'complete' but a StoryEventImage record was
 * never created for an intended moment (opening, key_moment, closing).
 *
 * Contract:
 *   - Does NOT change StoryEvent.status (stays 'complete')
 *   - Does NOT rerun memories, LifeEvents, LocationHistory, participation
 *   - Does NOT rerun narrative injection
 *   - Creates a NEW StoryEventImage record for the specified moment
 *   - Creates a Media Gallery Message record (same as generateStoryEvent)
 *   - Uses InvokeLLM to generate a moment-specific image prompt from the
 *     existing narrative (same approach as generateStoryEvent, but focused
 *     on one moment)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { story_event_id, moment_type, visible_character_ids } = body;

    if (!story_event_id || !moment_type) {
      return Response.json({ error: 'story_event_id and moment_type are required' }, { status: 400 });
    }

    const VALID_MOMENTS = ['opening', 'key_moment', 'closing'];
    if (!VALID_MOMENTS.includes(moment_type)) {
      return Response.json({ error: `moment_type must be one of: ${VALID_MOMENTS.join(', ')}` }, { status: 400 });
    }

    // ── LOAD STORY EVENT ──────────────────────────────────────────────────────
    const events = await base44.asServiceRole.entities.StoryEvent.filter({ id: story_event_id }, null, 1);
    const event = events[0];
    if (!event) return Response.json({ error: 'StoryEvent not found' }, { status: 404 });

    // Verify the event is complete — missing image generation is for complete events only
    if (event.status !== 'complete') {
      return Response.json({
        error: `StoryEvent must be 'complete' to generate missing images (current: ${event.status})`,
      }, { status: 409 });
    }

    // ── IDEMPOTENCY: Check if a StoryEventImage already exists for this moment ──
    const existingImgs = await base44.asServiceRole.entities.StoryEventImage.filter(
      { story_event_id, moment_type }, null, 5
    ).catch(() => []);

    // If a SUCCESSFUL image exists (has image_url), refuse — use regenerate instead
    const existingSuccessful = existingImgs.find(img => img.image_url);
    if (existingSuccessful) {
      return Response.json({
        error: 'Image already exists for this moment. Use regenerateStoryEventImageWithCharacters instead.',
        existing_image_id: existingSuccessful.id,
      }, { status: 409 });
    }

    // If a FAILED record exists (no image_url), we can update it instead of creating a new one
    const existingFailed = existingImgs.find(img => !img.image_url);
    const updateExistingId = existingFailed?.id || null;

    // ── LOAD PARTICIPANT DATA ─────────────────────────────────────────────────
    const ownerEmail = event.owner_email || user.email;
    const focusIds = event.focus_character_ids || [];
    const participantIds = event.participant_character_ids || [];
    const allIds = [...new Set([...focusIds, ...participantIds])];

    const charById = {};
    for (const cid of allIds) {
      try {
        const chars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
        if (chars[0]) charById[cid] = chars[0];
      } catch (_) {}
    }

    // ── RESOLVE CHARACTER BUNDLES ─────────────────────────────────────────────
    const participantBundles = [];
    for (const cid of allIds) {
      const c = charById[cid];
      if (!c) continue;
      const displayName = c.name || c.display_name || cid;
      const firstName = displayName.split(/\s+/)[0];
      const refImages = resolveCharacterRefImages(c);

      const appearanceParts = [];
      if (c.appearance_notes) appearanceParts.push(c.appearance_notes);
      if (c.avatar_description_text) appearanceParts.push(c.avatar_description_text);
      if (c.appearance_lock && typeof c.appearance_lock === 'object') {
        const al = c.appearance_lock;
        const lockParts = [];
        if (al.skin_tone) lockParts.push(`skin: ${al.skin_tone}`);
        if (al.hair_type) lockParts.push(`hair: ${al.hair_type}`);
        if (al.hairstyle) lockParts.push(`hairstyle: ${al.hairstyle}`);
        if (al.facial_hair) lockParts.push(`facial hair: ${al.facial_hair}`);
        if (al.clothing_style) lockParts.push(`clothing: ${al.clothing_style}`);
        if (al.overall_aesthetic) lockParts.push(`aesthetic: ${al.overall_aesthetic}`);
        if (lockParts.length > 0) appearanceParts.push(lockParts.join(', '));
      }
      if (c.style_identity && !appearanceParts.some(p => p.includes(c.style_identity))) {
        appearanceParts.push(`style: ${c.style_identity}`);
      }

      // ── OUTFIT AUTHORITY: resolveCharacterOutfitContext ────────────────────
      // Story Event images must honor the same Character Closet authority as
      // Chat and Scene. Pass venue_id as locationId so facility uniforms
      // (work/school/jail/hospital patient) resolve correctly.
      let outfitText = null;
      let outfitSource = 'no_closet';
      try {
        const outfitRes = await base44.asServiceRole.functions.invoke('resolveCharacterOutfitContext', {
          characterId: c.id,
          locationId: event.venue_id || null,
          locationCategory: null,
          ownerEmail: ownerEmail,
        });
        outfitText = outfitRes?.text || null;
        outfitSource = outfitRes?.source || 'not_called';
      } catch (outfitErr) {
        console.warn(`[generateMissingStoryEventImage] Outfit resolve failed for ${c.id}: ${outfitErr?.message}`);
      }

      participantBundles.push({
        participant_type: 'character',
        character_id: c.id,
        user_id: null,
        display_name: displayName,
        matched_prompt_name: firstName,
        ref_images: refImages,
        appearance_notes: appearanceParts.join(' | ') || null,
        outfit_text: outfitText,
        outfit_source: outfitSource,
        is_focus: focusIds.includes(cid),
        char_record: c,
      });
    }

    // ── RESOLVE USER BUNDLE (if user was a participant) ───────────────────────
    const includeUser = !!event.user_participant;
    let userBundle = null;
    if (includeUser) {
      try {
        const userEntityList = await base44.asServiceRole.entities.User.filter({ email: ownerEmail }, null, 1).catch(() => []);
        const userEntityRecord = userEntityList?.[0] || null;
        const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: ownerEmail }, null, 1).catch(() => []);
        const settingsRecord = settingsList?.[0] || null;

        if (userEntityRecord || settingsRecord) {
          const userEntityRefs = cdnFilter(userEntityRecord?.reference_image_urls || []);
          const userEntityAvatars = cdnFilter(userEntityRecord?.generated_avatar_urls || []);
          const settingsAvatar = cdnFilter([settingsRecord?.avatar_url, settingsRecord?.image_avatar_url].filter(Boolean));
          const userRefImages = [...userEntityRefs.slice(0, 3), ...userEntityAvatars.slice(0, 2), ...settingsAvatar.slice(0, 2)].filter(Boolean);

          const worldName = userEntityRecord?.world_name || settingsRecord?.fictional_world_name || null;
          const platformUserId = userEntityRecord?.id || ownerEmail;

          // ── USER OUTFIT AUTHORITY: resolveUserOutfitContext ──────────────────
          let userOutfitText = null;
          let userOutfitSource = 'no_outfit';
          try {
            const userOutfitRes = await base44.asServiceRole.functions.invoke('resolveUserOutfitContext', {
              ownerEmail: ownerEmail,
              locationCategory: null,
              locationId: event.venue_id || null,
            });
            userOutfitText = userOutfitRes?.text || null;
            userOutfitSource = userOutfitRes?.source || 'no_outfit';
          } catch (userOutfitErr) {
            console.warn(`[generateMissingStoryEventImage] User outfit resolve failed: ${userOutfitErr?.message}`);
          }

          userBundle = {
            participant_type: 'user',
            character_id: null,
            user_id: platformUserId,
            display_name: worldName || 'User / My Persona',
            matched_prompt_name: (worldName || 'User').split(/\s+/)[0],
            ref_images: userRefImages,
            appearance_lock: settingsRecord?.appearance_lock || null,
            gender: userEntityRecord?.gender || settingsRecord?.user_gender || null,
            culture: settingsRecord?.user_culture || null,
            race: settingsRecord?.user_race || null,
            outfit_text: userOutfitText,
            outfit_source: userOutfitSource,
            is_focus: event.user_participant?.is_focus || false,
          };
        }
      } catch (_) {}
    }

    // ── DETERMINE VISIBLE CHARACTERS FOR THIS MOMENT ──────────────────────────
    // Use provided visible_character_ids if given, otherwise derive from moment type
    let visibleCharIds = [];
    if (visible_character_ids && Array.isArray(visible_character_ids) && visible_character_ids.length > 0) {
      // Filter to only IDs that are actual event participants
      visibleCharIds = visible_character_ids.filter(id => allIds.includes(id));
    } else {
      visibleCharIds = moment_type === 'opening' ? participantIds.slice(0, 3)
        : moment_type === 'key_moment' ? (focusIds.length > 0 ? focusIds : participantIds.slice(0, 2))
        : participantIds.slice(0, 2);
    }

    const visibleBundles = participantBundles.filter(b => visibleCharIds.includes(b.character_id));
    const visibleCharNames = visibleBundles.map(b => b.display_name);
    const visibleCharTypes = visibleBundles.map(b => b.char_record?.character_type || 'active_created_character');

    // ── VENUE IDENTITY REFERENCES ─────────────────────────────────────────────
    // Only a real, persisted, non-rabbit-hole venue the user selected has its own
    // reference photographs. Rabbit-hole behaviour is untouched.
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
          name: venueRecord?.name || event.venue_name || 'the venue',
          description: (venueRecord?.description || '').substring(0, 600) || null,
          category: venueRecord?.category || null,
          images: venueRefImages,
        }
      : null;

    // ── EVENT CONTINUITY REFERENCE ────────────────────────────────────────────
    // An image already generated for this same event keeps clothing and the room
    // identical across moments. It is a continuity anchor, never a composition template.
    let continuityImageUrl = null;
    try {
      const siblingImages = await base44.asServiceRole.entities.StoryEventImage.filter(
        { story_event_id }, 'order', 10
      ).catch(() => []);
      const sibling = (siblingImages || []).find(i => i.image_url && i.moment_type !== moment_type);
      continuityImageUrl = sibling?.image_url || null;
    } catch (_) {}

    // ── BUILD NAME REFERENCE KEY ──────────────────────────────────────────────
    const allBundles = [...participantBundles, ...(userBundle ? [userBundle] : [])];
    const nameReferenceKeyBlock = buildParticipantNameReferenceKeyBlock(
      allBundles.map(b => ({
        participant_type: b.participant_type,
        character_id: b.character_id,
        user_id: b.user_id,
        display_name: b.display_name,
        matched_prompt_name: b.matched_prompt_name,
      }))
    );

    const userIdentityLockBlock = buildUserIdentityLockBlock(userBundle);

    // ── REFERENCE PLAN: identity → venue → user → continuity ──────────────────
    const planRefs = [];
    const planMap = [];
    const addPlanRef = (url) => {
      const clean = toPublicCDN(url);
      if (!clean || !isAccessible(clean) || planRefs.includes(clean)) return null;
      planRefs.push(clean);
      return planRefs.length;
    };
    const rangeOf = (nums) => (nums.length === 1 ? `Image ${nums[0]}` : `Images ${nums[0]}–${nums[nums.length - 1]}`);

    const identityEntries = [];
    for (const b of visibleBundles) {
      const nums = b.ref_images.slice(0, 2).map(u => addPlanRef(u)).filter(Boolean);
      if (nums.length > 0) {
        planMap.push({
          range: rangeOf(nums),
          label: `FACE / BODY IDENTITY — ${b.display_name}. Face, hair, complexion, body type come from here.`,
        });
      }
      identityEntries.push({
        name: b.display_name,
        first_name: b.matched_prompt_name,
        character_id: b.character_id,
        appearance: b.appearance_notes,
        age_at_event: ageAtEventDate(b.char_record, eventDate),
        appearance_age: b.char_record?.appearance_age ?? null,
        ref_count: nums.length,
        ref_range: nums.length > 0 ? rangeOf(nums) : null,
      });
    }

    const venueNums = venueRefImages.map(u => addPlanRef(u)).filter(Boolean);
    if (venueNums.length > 0) {
      planMap.push({
        range: rangeOf(venueNums),
        label: `LOCATION SPATIAL DATA — ${venueImageLock.name}. Build this exact place from these; do NOT copy their framing.`,
      });
    }

    const userNums = (userBundle?.ref_images || []).map(u => addPlanRef(u)).filter(Boolean);
    if (userNums.length > 0) {
      planMap.push({ range: rangeOf(userNums), label: `FACE / IDENTITY — ${userBundle.display_name} (the User).` });
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
    const clothingContinuityBlock = buildClothingContinuityBlock([
      ...visibleBundles.map(b => ({ name: b.display_name, outfit: b.outfit_text })),
      ...(userBundle ? [{ name: `${userBundle.display_name} (User)`, outfit: userBundle.outfit_text }] : []),
    ]);
    const imageMapBlock = buildImageMapBlock(planMap);

    // ── GENERATE MOMENT-SPECIFIC IMAGE PROMPT VIA LLM ──────────────────────────
    // Uses the existing narrative to generate a focused image prompt for this
    // specific moment — same approach as generateStoryEvent, but for one moment.
    const venueName = event.venue_name || 'the event venue';
    const eventDate = event.event_date;
    const title = event.title || 'Untitled Event';
    const narrative = event.generated_narrative || '';
    const participantNames = event.participant_character_names || [];
    const focusNames = event.focus_character_names || [];
    const userParticipantName = event.user_participant?.display_name || null;
    const allParticipantNames = userParticipantName
      ? [...participantNames, userParticipantName]
      : participantNames;

    // Character appearance context for the LLM
    const characterAppearanceContext = visibleBundles.map(b => {
      const c = b.char_record;
      const appearanceBlock = b.appearance_notes
        ? `  APPEARANCE: ${b.appearance_notes}`
        : '';
      const outfitBlock = b.outfit_text
        ? `  OUTFIT (authoritative — from Character Closet): ${b.outfit_text}`
        : '';
      return [
        `- ${b.display_name} ${b.is_focus ? '★ FOCUS' : ''}`,
        c.personality_summary ? `  Personality: ${c.personality_summary}` : '',
        c.gender ? `  Gender: ${c.gender}` : '',
        appearanceBlock,
        outfitBlock,
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    const momentDescription = moment_type === 'opening'
      ? 'the opening scene — arrival, setting the atmosphere, first interactions'
      : moment_type === 'key_moment'
      ? 'the peak/key moment — the most dramatic or emotionally significant moment'
      : 'the closing scene — winding down, departure, final impressions';

    const llmPrompt = [
      `You are generating an image prompt for a specific moment in a story event.`,
      ``,
      `EVENT: ${title}`,
      `VENUE: ${venueName}`,
      `DATE: ${eventDate}`,
      `MOMENT: ${moment_type.replace('_', ' ')} — ${momentDescription}`,
      ``,
      `NARRATIVE (for context):`,
      narrative.substring(0, 2000),
      ``,
      `PARTICIPANTS: ${allParticipantNames.join(', ')}`,
      `FOCUS: ${focusNames.length > 0 ? focusNames.join(', ') : 'None'}`,
      ``,
      `VISIBLE IN THIS MOMENT: ${visibleCharNames.join(', ') || 'No specific characters'}`,
      ``,
      `CHARACTER APPEARANCE (use for image — DO NOT invent generic strangers):`,
      characterAppearanceContext || 'Use reference images.',
      ...(userBundle?.outfit_text ? [``, `USER OUTFIT (authoritative — from User Closet): ${userBundle.outfit_text}`] : []),
      ``,
      `Generate a single image prompt for the ${moment_type.replace('_', ' ')} moment.`,
      `Describe ONLY: the visible characters using their documented appearance, their actions and expressions, the camera position/angle/distance, the lighting and the mood.`,
      `Do NOT describe generic strangers. Every person must match a participant's documented appearance.`,
      `Do NOT describe the room's decor, furniture, layout, architecture, wall treatments or lighting fixtures — the venue's own reference photographs are attached to the renderer and are the sole authority for the interior. Naming interior details here would conflict with them. Refer to the venue only by its name.`,
      `AGE IS NOT A ROLE: never describe anyone as elderly, aged, gray-haired, heavyset, frail, dowdy, or "typical for their age" because of a numeric age or a family role (grandmother, grandfather, mother, father). Never describe an adult as younger or more idealized than their documented appearance.`,
      `CHILDREN DO DEVELOP: if a participant is a child or adolescent at this event's date, describe them at that developmental stage (age-appropriate height, proportions and facial maturity) while keeping them recognisably the same person from their references. A reference photo from an earlier age is identity, not current stage.`,
      `DO NOT INVENT OR RESTYLE ANYONE'S CLOTHING. Outfits come from the Character/User Closet and stay identical across this event's images. The ONLY exception: when the narrative explicitly establishes a clothing change at this moment (showering, changing into gym clothes, dressing for a shift, getting ready for bed, a different time or place), state that change plainly, and only that change.`,
      ...(userBundle ? [
        `The user participant "${userBundle.display_name}" MUST appear in this image by name.`,
      ] : []),
      ``,
      `Return JSON: { "prompt": "the image generation prompt", "description": "what the image shows" }`,
    ].join('\n');

    const llmRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: llmPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          description: { type: 'string' },
        },
      },
      model: 'gemini_3_1_pro',
    });

    const momentPrompt = llmRes?.prompt || `Scene at ${venueName} during the ${moment_type.replace('_', ' ')} moment of ${title}.`;
    const momentDescriptionText = llmRes?.description || `${moment_type.replace('_', ' ')} moment at ${venueName}`;

    // ── BUILD FINAL IMAGE PROMPT (same structure as generateStoryEvent) ───────
    const finalImagePrompt = [
      `════════════════════════════════════════════════════════════`,
      `⚠️ CRITICAL: FICTIONAL CHARACTER NOTICE`,
      `════════════════════════════════════════════════════════════`,
      `ALL subjects are 100% FICTIONAL CHARACTERS for a storytelling app. Not real people.`,
      `Treat as characters in a novel or video game. Render from descriptions and reference photos only.`,
      `════════════════════════════════════════════════════════════`,
      ``,
      nameReferenceKeyBlock,
      ``,
      ...(userIdentityLockBlock ? [userIdentityLockBlock, ``] : []),
      ...(identityLockBlock ? [identityLockBlock, ``] : []),
      ...(venueIdentityLockBlock ? [venueIdentityLockBlock, ``] : []),
      ...(clothingContinuityBlock ? [clothingContinuityBlock, ``] : []),
      ...(imageMapBlock ? [imageMapBlock, ``] : []),
      `════════════════════════════════════════════════════════════`,
      `STORY EVENT: "${title}"`,
      `MOMENT: ${moment_type.replace('_', ' ')}`,
      `VENUE: ${venueName}`,
      `EVENT DATE: ${eventDate || 'unspecified'}`,
      `════════════════════════════════════════════════════════════`,
      ``,
      momentPrompt,
      ``,
      `VISIBLE PARTICIPANTS (ALL listed must appear — NO OMISSIONS, NO STAND-INS):`,
      visibleCharNames.length > 0 ? visibleCharNames.map(n => `- ${n}`).join('\n') : '- No specific characters',
      ...(userBundle ? [`- ${userBundle.display_name} (User)`] : []),
      ``,
      // ── CLOSET OUTFIT LOCK — honor the same wardrobe authority as Chat/Scene ──
      ...(() => {
        const lines = [`CLOSET OUTFIT LOCK — AUTHORITY: resolveCharacterOutfitContext / resolveUserOutfitContext`];
        lines.push(`Each person's clothing below is the AUTHORITATIVE outfit from their Character/User Closet.`);
        lines.push(`Do NOT invent, substitute, or genericize clothing. Render exactly what is described.`);
        let anyOutfit = false;
        for (const b of visibleBundles) {
          if (b.outfit_text) {
            anyOutfit = true;
            lines.push(`- ${b.display_name}: ${b.outfit_text}`);
          }
        }
        if (userBundle?.outfit_text) {
          anyOutfit = true;
          lines.push(`- ${userBundle.display_name} (User): ${userBundle.outfit_text}`);
        }
        if (!anyOutfit) lines.push(`(No closet outfits resolved — use reference images for clothing.)`);
        return [lines.join('\n'), ``];
      })(),
      `Photorealistic photograph. Ultra-detailed. Real human proportions. Not an illustration.`,
      ``,
      `IDENTITY ENFORCEMENT:`,
      `- Every person must match a participant in the Name Reference Key.`,
      `- Do NOT generate generic strangers or stand-ins.`,
      `- Use ONLY the visual identity references provided.`,
      ``,
      `BACKGROUND POPULATION DIVERSITY LAW — ABSOLUTE OVERRIDE:`,
      `Caucasian/White is NEVER the default appearance for any automatically generated, unspecified, or background person.`,
      `✅ Distribute across diverse backgrounds: Black, Hispanic/Latino, Indian, Jamaican, African, Asian, Middle Eastern, Haitian, Mixed heritage, Indigenous, Pacific Islander, South Asian.`,
      `✅ Vary skin tones, facial features, hair textures, and body types.`,
      `⛔ DO NOT collapse all background people to a single ethnicity.`,
      `⛔ DO NOT use training-data "generic person" defaults.`,
      `Explicitly defined characters are NOT affected — their locked appearance is always preserved exactly.`,
    ].join('\n');

    // ── RESOLVE REFERENCE IMAGES ─────────────────────────────────────────────
    // Built by the reference plan above (identity → venue → user → continuity).
    const refImages = planRefs.slice(0, 12);

    // ── GENERATE IMAGE ────────────────────────────────────────────────────────
    const imageRes = await base44.asServiceRole.integrations.Core.GenerateImage({
      prompt: finalImagePrompt,
      existing_image_urls: refImages.length > 0 ? refImages : undefined,
    });

    if (!imageRes?.url) {
      return Response.json({ error: 'Image generation failed — no URL returned' }, { status: 500 });
    }

    // ── CREATE OR UPDATE StoryEventImage RECORD ───────────────────────────────
    const momentOrder = { opening: 0, key_moment: 1, closing: 2 };
    const imageRecordData = {
      story_event_id,
      moment_type,
      image_url: imageRes.url,
      description: momentDescriptionText,
      prompt: finalImagePrompt,
      order: momentOrder[moment_type] ?? 0,
      visible_character_ids: visibleCharIds,
      visible_character_names: visibleCharNames,
      visible_character_types: visibleCharTypes,
      reference_image_urls: refImages.slice(0, 5),
      reference_lookup_status_by_character: Object.fromEntries(
        visibleBundles.map(b => [b.character_id, b.ref_images.length > 0 ? 'resolved' : 'reference_lookup_failed'])
      ),
    };

    let imageRecordId = null;
    if (updateExistingId) {
      // Update the existing failed record
      await base44.asServiceRole.entities.StoryEventImage.update(updateExistingId, imageRecordData);
      imageRecordId = updateExistingId;
    } else {
      // Create a new record
      const newRecord = await base44.asServiceRole.entities.StoryEventImage.create(imageRecordData);
      imageRecordId = newRecord?.id || null;
    }

    // ── FIND OR CREATE CONVERSATION FOR MEDIA GALLERY ────────────────────────
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
          character_ids: allIds,
          channel: 'story_event',
          owner_email: ownerEmail,
        }).catch(() => null);
        if (storyConvo?.id) storyEventConversationId = storyConvo.id;
      }
    } catch (_) {}

    // ── CREATE MEDIA GALLERY MESSAGE ─────────────────────────────────────────
    await base44.asServiceRole.entities.Message.create({
      conversation_id: storyEventConversationId,
      sender_type: 'user',
      content: '',
      image_url: imageRes.url,
      image_description: `${momentDescriptionText}${userBundle ? ` — Featuring: ${userBundle.display_name}` : ''}`,
      image_analysis_status: 'complete',
      generation_context: {
        generation_context_version: 2,
        context_origin: 'story_event_missing_image',
        name_reference_key_injected: true,
        source: 'story_event',
        story_event_id,
        story_event_image_id: imageRecordId,
        event_title: title,
        event_date: eventDate,
        moment_type,
        participant_character_ids: participantIds,
        focus_character_ids: focusIds,
        visible_character_ids: visibleCharIds,
        visible_character_names: visibleCharNames,
        venue_id: event.venue_id || null,
        venue_name: venueName,
        scene_prompt: finalImagePrompt,
        original_raw_prompt: momentPrompt,
        character_reference_images: refImages.slice(0, 5),
        subjects: visibleCharIds.map(cid => {
          const bundle = participantBundles.find(b => b.character_id === cid);
          return {
            subject_type: 'character',
            subject_id: cid,
            subject_name: bundle?.display_name || charById[cid]?.name || cid,
            reference_images: bundle?.ref_images || [],
            reference_image_count: bundle?.ref_images.length || 0,
          };
        }),
      },
      timestamp: new Date().toISOString(),
      owner_email: ownerEmail,
    });

    return Response.json({
      success: true,
      image_id: imageRecordId,
      moment_type,
      new_url: imageRes.url,
      description: momentDescriptionText,
      visible_character_ids: visibleCharIds,
      visible_character_names: visibleCharNames,
      created_new_record: !updateExistingId,
      updated_existing_record: !!updateExistingId,
    });
  } catch (error) {
    console.error('[generateMissingStoryEventImage]', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});