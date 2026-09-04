import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ── PARTICIPANT NAME REFERENCE KEY ────────────────────────────────────────────
//
// ARCHITECTURE NOTE — ENFORCED DUPLICATION (not abandoned scaffolding):
// Deno backend functions are deployed as isolated sandboxes. They cannot import
// from local lib/ files — only from npm: or jsr: URLs. This is a verified platform
// constraint: any `import` from a relative path throws "Module not found" at runtime.
//
// Therefore, this function MUST be inlined in generateImageAsync.js,
// regenerateImageWithReason.js, AND generateStoryEvent.js. The three copies
// are the enforced strategy, not a maintenance oversight.
//
// ANTI-DRIFT RULE: The function body below is the canonical source.
// Any change here MUST be applied identically to generateImageAsync.js
// and regenerateImageWithReason.js.
// verifyParticipantNameReferenceKeyDrift now covers all three files.
//
// The required format is:
//   "PromptName" = Canonical Display Name (Character ID: ...) — use their visual identity references
//   "PromptName" = User Display Name (User ID: <runtime_authenticated_user_id>) — use their visual identity references
//
// USER ID RULE: user_id = user.id from base44.auth.me() — the authenticated user's
// platform entity ID. NOT email. email is used only for owner_email scoping.
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

// ── URL UTILITIES ─────────────────────────────────────────────────────────────

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

// ── ADD HOURS TO HH:MM TIME STRING ───────────────────────────────────────────
function addHoursToTime(timeStr, hours) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  const totalMins = h * 60 + m + hours * 60;
  const newH = Math.floor(totalMins / 60) % 24;
  const newM = totalMins % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

// ── RESOLVE PARTICIPANT REFERENCE IMAGES ──────────────────────────────────────
// Resolves canonical reference images for a character record.
// Priority: reference_image_urls (no generated) → CDN avatar → empty.
function resolveCharacterRefImages(charRecord) {
  if (!charRecord) return [];
  const allRefs = cdnFilter(charRecord.reference_image_urls || []);
  const validRefs = allRefs.filter(url => !url.includes('generated_image'));
  if (validRefs.length > 0) return validRefs.slice(0, 3);
  // CDN avatar fallback — only if it is a canonical portrait, not a generated scene image
  if (charRecord.avatar_url) {
    const avatarPublic = toPublicCDN(charRecord.avatar_url);
    const isCDN = avatarPublic.startsWith('https://media.base44.com/');
    if (isAccessible(avatarPublic) && (isCDN || !avatarPublic.includes('generated_image'))) {
      return [avatarPublic];
    }
  }
  if (charRecord.image_avatar_url) {
    const imgAvatar = toPublicCDN(charRecord.image_avatar_url);
    if (isAccessible(imgAvatar)) return [imgAvatar];
  }
  return [];
}

/**
 * buildUserIdentityLockBlock
 *
 * ZERO-DRIFT IDENTITY LOCK for the authenticated User when they are a selected
 * Story Event participant. The User is a first-class visual subject — parallel
 * to a character with a character_id. This block explicitly injects the User's
 * appearance_lock (height, skin tone, hair type, hairstyle, facial hair),
 * avatar-derived body type / skin color / facial features, gender, ethnicity,
 * culture, race, and world name DIRECTLY into the image generation prompt string.
 *
 * This is injected for EVERY image moment where the User is a participant —
 * regardless of whether they are a focus character. The User's likeness must
 * never be omitted, genericized, or replaced with a stand-in when they are
 * intentionally included in a Story Event.
 */
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
  lines.push(`They are a real visual subject in this scene — NOT a generic bystander, NOT a stand-in, NOT a placeholder.`);
  lines.push(`Their likeness MUST appear in this image with the EXACT identity profile below.`);
  lines.push(``);
  lines.push(`USER IDENTITY ANCHOR:`);
  lines.push(`  World Name: ${worldName}`);
  lines.push(`  User ID: ${userId}`);
  if (userBundle.gender) lines.push(`  Gender: ${userBundle.gender}`);
  if (userBundle.culture) lines.push(`  Culture: ${userBundle.culture}`);
  if (userBundle.race) lines.push(`  Race: ${userBundle.race}`);
  if (Array.isArray(userBundle.ethnicities) && userBundle.ethnicities.length > 0) {
    lines.push(`  Ethnicity: ${userBundle.ethnicities.join(', ')}`);
  }

  // ── APPEARANCE LOCK — explicit attribute injection ──────────────────────
  // These are the authoritative appearance attributes. Inject them verbatim
  // into the prompt so the image generator cannot default to training-data priors.
  const al = userBundle.appearance_lock;
  if (al && typeof al === 'object') {
    lines.push(``);
    lines.push(`USER APPEARANCE LOCK (render these EXACT attributes — do NOT substitute, do NOT genericize):`);
    if (al.height_display) lines.push(`  Height: ${al.height_display}`);
    else if (al.height_inches) lines.push(`  Height: ${al.height_inches} inches`);
    if (al.skin_tone) lines.push(`  Skin tone: ${al.skin_tone}`);
    if (al.hair_type) lines.push(`  Hair type: ${al.hair_type}`);
    if (al.hairstyle) lines.push(`  Hairstyle: ${al.hairstyle}`);
    if (al.facial_hair) lines.push(`  Facial hair: ${al.facial_hair}`);
    if (al.makeup) lines.push(`  Makeup: ${al.makeup}`);
    if (al.clothing_style) lines.push(`  Clothing style: ${al.clothing_style}`);
    if (al.footwear) lines.push(`  Footwear: ${al.footwear}`);
    if (al.overall_aesthetic) lines.push(`  Overall aesthetic: ${al.overall_aesthetic}`);
    if (Array.isArray(al.custom_keywords) && al.custom_keywords.length > 0) {
      lines.push(`  Custom appearance keywords: ${al.custom_keywords.join(', ')}`);
    }
    if (al.head_ratio) lines.push(`  Head-to-body ratio: ${al.head_ratio}`);
  }

  // ── AVATAR-DERIVED VISUAL ANCHOR ────────────────────────────────────────
  // The avatar defines the user's base form: body type, skin color, facial
  // features, face shape, hairstyle. Reference images are attached separately
  // via existing_image_urls — this block tells the generator to USE them.
  if (userBundle.ref_images && userBundle.ref_images.length > 0) {
    lines.push(``);
    lines.push(`USER VISUAL REFERENCE: ${userBundle.ref_images.length} avatar/reference image(s) attached via existing_image_urls.`);
    lines.push(`The person "${promptName}" MUST match the face, body, skin color, and hairstyle shown in those reference images.`);
    lines.push(`If reference images conflict with a generic description above, the REFERENCE IMAGES win.`);
  }

  lines.push(``);
  lines.push(`ENFORCEMENT:`);
  lines.push(`- "${promptName}" MUST be visibly present in this image as a real, rendered person.`);
  lines.push(`- Do NOT omit "${promptName}" from the scene.`);
  lines.push(`- Do NOT replace "${promptName}" with a generic or different-looking person.`);
  lines.push(`- Do NOT render "${promptName}" as a partial, obscured, or background-only figure when they are a focus participant.`);
  lines.push(`- Their skin tone, hair, facial features, body type, and gender presentation must match the identity profile above.`);
  lines.push(`════════════════════════════════════════════════════════════`);
  return `\n${lines.join('\n')}\n`;
}

Deno.serve(async (req) => {
  let eventId = null;
  let base44 = null;
  let narrativePersisted = false; // true after Step 1b succeeds — prevents outer catch from setting 'failed'
  const requiredFailures = []; // tracks REQUIRED effect failures — prevents premature 'complete'
  try {
    base44 = createClientFromRequest(req);
    const body = await req.json();

    eventId = body.event_id || (body.data ? body.data.id : null);
    if (!eventId) {
      return Response.json({ error: 'No story event id found' }, { status: 400 });
    }

    // Fetch the full StoryEvent record
    const records = await base44.asServiceRole.entities.StoryEvent.filter({ id: eventId }, null, 1);
    const event = records[0];
    if (!event) return Response.json({ error: 'StoryEvent not found' }, { status: 404 });

    if (event.status !== 'generating') {
      return Response.json({ success: true, skipped: true, reason: `status is ${event.status}` });
    }

    // ── IDEMPOTENT RE-ENTRY DETECTION ──────────────────────────────────────────
    // Canonical evidence of completed core narrative persistence:
    //   1. status === 'generating' (checked above — event not yet finalized)
    //   2. generated_narrative exists as a non-empty string
    // Step 1b writes generated_narrative and narrative_preview together in a
    // single update call. If generated_narrative is a non-empty string, that
    // update committed successfully — the LLM core generation succeeded and was
    // persisted. No arbitrary length threshold: a 50-char valid narrative is
    // just as canonical as a 500-char one. An empty string means the LLM
    // returned nothing, which is a genuine core failure.
    const narrativeAlreadyGenerated = !!event.generated_narrative;

    const ownerEmail = event.owner_email;
    const plot = event.plot || '';
    const additionalNotes = event.additional_notes || '';
    const title = event.title || 'Untitled Event';
    const eventDate = event.event_date;
    const venueName = event.venue_name || 'an undisclosed location';
    const isRabbitHole = event.is_rabbit_hole;
    const focusIds = event.focus_character_ids || [];
    const participantIds = event.participant_character_ids || [];
    const focusNames = event.focus_character_names || [];
    const participantNames = event.participant_character_names || [];
    // Include the user in name lists when they are a selected participant
    const userParticipantName = event.user_participant?.display_name || null;
    const userIsFocusParticipant = event.user_participant?.is_focus || false;
    const allFocusNames = userParticipantName && userIsFocusParticipant
      ? [...focusNames, userParticipantName]
      : focusNames;
    const allParticipantNames = userParticipantName
      ? [...participantNames, userParticipantName]
      : participantNames;
    const allDay = event.all_day;
    const startTime = event.start_time;
    const endTime = event.end_time;

    // Load character data for all participants
    const allIds = [...new Set([...focusIds, ...participantIds])];
    const charById = {};
    for (const cid of allIds) {
      try {
        const chars = await base44.asServiceRole.entities.Character.filter({ id: cid }, null, 1);
        if (chars[0]) charById[cid] = chars[0];
      } catch (_) {}
    }

    // ── CANONICAL PARTICIPANT BUNDLE RESOLUTION ───────────────────────────────
    // Each participant is resolved into a canonical bundle with:
    //   - character_id (DB-sourced, authoritative)
    //   - display_name
    //   - matched_prompt_name (first name from display_name)
    //   - reference images (CDN-filtered, no generated images first)
    //   - participant_type: 'character'
    //
    // The authenticated User is resolved separately below when included.
    // Characters are NEVER resolved by name matching alone — always by ID.

    const participantBundles = []; // { participant_type, character_id, user_id, display_name, matched_prompt_name, ref_images, appearance_notes }

    for (const cid of allIds) {
      const c = charById[cid];
      if (!c) continue;

      const displayName = c.name || c.display_name || cid;
      const firstName = displayName.split(/\s+/)[0];
      const refImages = resolveCharacterRefImages(c);

      // Build appearance notes for the narrative prompt (NOT used as ID — structural only)
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
      // Chat and Scene. Pass venue_id as locationId so facility uniforms resolve.
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
        console.warn(`[generateStoryEvent] Outfit resolve failed for ${c.id}: ${outfitErr?.message}`);
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

      console.log(`[generateStoryEvent] ✅ Bundle resolved: "${displayName}" (id=${c.id}) refs=${refImages.length} focus=${focusIds.includes(cid)}`);
    }

    // ── USER BUNDLE RESOLUTION ────────────────────────────────────────────────
    // GATE: The authenticated user is included ONLY when the Story Event payload
    // explicitly identifies the user as a selected participant via include_user=true.
    // World-name existence alone is NOT sufficient — the user must be intentionally
    // selected by the Story Event creator.
    //
    // The StoryEventCreator UI does not currently expose a "include me" toggle,
    // so include_user will be false/absent for all existing events. This gate
    // ensures the user is never injected based on account state alone.
    const includeUser = !!(body.include_user || event.user_participant);
    let userBundle = null;

    if (includeUser) {
      try {
        const userEntityList = await base44.asServiceRole.entities.User.filter({ email: ownerEmail }, null, 1).catch(() => []);
        const userEntityRecord = userEntityList?.[0] || null;
        const settingsList = await base44.asServiceRole.entities.UserSettings.filter({ owner_email: ownerEmail }, null, 1).catch(() => []);
        const settingsRecord = settingsList?.[0] || null;

        if (userEntityRecord || settingsRecord) {
          // ── FULL VISUAL IDENTITY RESOLUTION ────────────────────────────────
          // The User is a first-class visual subject — parallel to a character.
          // Pull EVERY identity-bearing field from both the User entity and
          // UserSettings so the image generator has a complete identity profile:
          //   - platform user ID (authoritative anchor, mirrors character_id)
          //   - world name (in-world display name)
          //   - avatar + generated avatars (body type, skin color, facial features, shape, hairstyle)
          //   - appearance_lock (height, skin tone, hair type, hairstyle, facial hair, clothing, aesthetic)
          //   - gender, culture, race, ethnicity (demographic identity anchors)
          const userEntityRefs = cdnFilter(userEntityRecord?.reference_image_urls || []);
          const userEntityAvatars = cdnFilter(userEntityRecord?.generated_avatar_urls || []);
          const settingsAvatar = cdnFilter([settingsRecord?.avatar_url, settingsRecord?.image_avatar_url].filter(Boolean));
          const userRefImages = [...userEntityRefs.slice(0, 3), ...userEntityAvatars.slice(0, 2), ...settingsAvatar.slice(0, 2)].filter(Boolean);

          const worldName = userEntityRecord?.world_name || settingsRecord?.fictional_world_name || null;
          const platformUserId = userEntityRecord?.id || ownerEmail; // user.id from User entity — NOT email

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
            console.warn(`[generateStoryEvent] User outfit resolve failed: ${userOutfitErr?.message}`);
          }

          userBundle = {
            participant_type: 'user',
            character_id: null,
            user_id: platformUserId,
            display_name: worldName || 'User / My Persona',
            matched_prompt_name: (worldName || 'User').split(/\s+/)[0],
            ref_images: userRefImages,
            appearance_lock: settingsRecord?.appearance_lock || null,
            world_name: worldName,
            // Demographic + visual identity anchors (zero-drift identity profile)
            gender: userEntityRecord?.gender || settingsRecord?.user_gender || null,
            culture: settingsRecord?.user_culture || null,
            race: settingsRecord?.user_race || null,
            ethnicities: userEntityRecord?.ethnicities || (settingsRecord?.user_race ? [settingsRecord.user_race] : []),
            avatar_url: settingsRecord?.avatar_url || userEntityAvatars[0] || null,
            image_avatar_url: settingsRecord?.image_avatar_url || null,
            outfit_text: userOutfitText,
            outfit_source: userOutfitSource,
            is_focus: event.user_participant?.is_focus || false,
          };
          console.log(`[generateStoryEvent] ✅ User bundle resolved (include_user=true): worldName="${worldName}" userId="${platformUserId}" refs=${userRefImages.length} appearance_lock=${!!settingsRecord?.appearance_lock} gender=${userBundle.gender || 'none'}`);
        }
      } catch (userBundleErr) {
        console.warn(`[generateStoryEvent] User bundle resolution failed (non-blocking): ${userBundleErr?.message}`);
      }
    } else {
      console.log(`[generateStoryEvent] ℹ️ User not included — include_user not set in Story Event payload (correct default)`);
    }

    // Build the full participant list for the Name Reference Key
    // User is included in the key only when they have a resolved world name (visual subject)
    const allBundles = [...participantBundles, ...(userBundle ? [userBundle] : [])];

    // Build the unified Name Reference Key using the canonical builder
    const nameReferenceKeyBlock = buildParticipantNameReferenceKeyBlock(
      allBundles.map(b => ({
        participant_type: b.participant_type,
        character_id: b.character_id,
        user_id: b.user_id,
        display_name: b.display_name,
        matched_prompt_name: b.matched_prompt_name,
      }))
    );

    console.log(`[generateStoryEvent] NAME REFERENCE KEY built: ${allBundles.length} participant(s) — ${allBundles.map(b => `${b.participant_type}:${b.display_name}`).join(', ')}`);
    console.log(`[generateStoryEvent] Key contains header: ${nameReferenceKeyBlock.includes('[NAME REFERENCE KEY — SELECTED PARTICIPANTS]')}`);

    // Build focus character ref images ordered list (focus first, then all)
    const focusRefImages = participantBundles.filter(b => b.is_focus).flatMap(b => b.ref_images);
    const allCharacterRefImages = participantBundles.flatMap(b => b.ref_images);
    const userRefImagesForPayload = userBundle?.ref_images || [];

    // Build character context for the LLM narrative prompt
    const characterContexts = participantBundles.map(b => {
      const c = b.char_record;
      const marker = b.is_focus ? '★ FOCUS' : '';
      const charType = c.character_type || '';
      const typeNote = charType === 'npc_family_member' ? ' [Family member]'
        : charType === 'npc_fictitious' ? ' [Fictional/NPC character]'
        : charType === 'npc_world_service' ? ' [World service character]'
        : '';
      const appearanceBlock = b.appearance_notes
        ? `  APPEARANCE (USE THIS FOR IMAGE GENERATION — DO NOT INVENT GENERIC STRANGERS): ${b.appearance_notes}`
        : '';
      return [
        `- ${b.display_name} ${marker}${typeNote}`,
        `  Character ID: ${b.character_id}`,
        c.personality_summary ? `  Personality: ${c.personality_summary}` : '',
        c.occupation ? `  Occupation: ${c.occupation}` : '',
        c.age ? `  Age: ${c.age}` : '',
        c.gender ? `  Gender: ${c.gender}` : '',
        appearanceBlock,
        c.communication_style ? `  Communication style: ${c.communication_style}` : '',
        c.current_situation ? `  Current situation: ${c.current_situation}` : '',
        c.profile_summary ? `  Summary: ${c.profile_summary}` : '',
        (c.memories || []).slice(0, 3).map(m => `  Memory: ${m.title || ''}`).filter(Boolean).join('\n'),
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    // Resolve relationships between participants
    const relationshipContexts = [];
    for (const b of participantBundles) {
      const c = b.char_record;
      const rels = (c.fictional_relationships || []).filter(r =>
        r.related_character_id && allIds.includes(r.related_character_id) && r.related_character_id !== b.character_id
      );
      for (const r of rels) {
        const target = charById[r.related_character_id];
        if (!target) continue;
        relationshipContexts.push(
          `${b.display_name} → ${target.name}: ${r.relationship_type}` +
          (r.friendship_level != null ? ` (friendship ${r.friendship_level})` : '') +
          (r.trust_level != null ? ` (trust ${r.trust_level})` : '') +
          (r.description ? ` — ${r.description}` : '')
        );
      }
    }

    const timeInfo = allDay
      ? 'All-day event'
      : `${startTime || 'TBD'}${endTime ? ` to ${endTime}` : ''}`;

    // Build venue appearance context from LocationReference if available
    let venueContext = '';
    if (!isRabbitHole && event.venue_id) {
      try {
        const venueRecs = await base44.asServiceRole.entities.LocationReference.filter({ id: event.venue_id }, null, 1);
        const venue = venueRecs[0];
        if (venue) {
          venueContext = [
            `Venue: ${venue.name}`,
            venue.description ? `Description: ${venue.description}` : '',
            venue.category ? `Category: ${venue.category}` : '',
          ].filter(Boolean).join('\n');
        }
      } catch (_) {}
    }

    // ── STEP 1: GENERATE NARRATIVE ──────────────────────────────────────────────
    // Pre-compute user inclusion strings for image prompt instructions
    const userImageRule = userBundle
      ? " The user participant '" + userBundle.display_name + "' (User ID: " + userBundle.user_id + ") MUST appear in EVERY image prompt by name, described with their appearance data. They are a real visible person — NOT a generic bystander."
      : "";
    const userImageRuleShort = userBundle
      ? " The user participant '" + userBundle.display_name + "' (User ID: " + userBundle.user_id + ") MUST appear in this image by name."
      : "";
    const userImageRuleLine = userBundle
      ? "- USER IMAGE INCLUSION RULE (CRITICAL): The user participant '" + userBundle.display_name + "' (User ID: " + userBundle.user_id + ") MUST appear in EVERY image prompt by name. Describe them as a real visible person in the scene. Do NOT omit them. Do NOT replace them with a generic person. Do NOT describe them as a background figure. Their name must appear in the prompt text just like character names do."
      : "";
    const narrativePrompt = [
      `You are a narrative writer creating a meaningful story for a character-driven world.`,
      ``,
      `EVENT TITLE: ${title}`,
      `DATE: ${eventDate || 'a specific date'}`,
      `TIME: ${timeInfo}`,
      `VENUE: ${venueName}${isRabbitHole ? ' (custom venue)' : ''}`,
      ``,
      venueContext ? `VENUE DETAILS:` : '',
      venueContext ? venueContext : '',
      venueContext ? `` : '',
      `USER'S PLOT (THIS IS THE FOUNDATION — DO NOT REPLACE IT):`,
      `${plot}`,
      ``,
      additionalNotes ? `ADDITIONAL NOTES FROM USER:` : '',
      additionalNotes ? `${additionalNotes}` : '',
      additionalNotes ? `` : '',
      `FOCUS PARTICIPANTS (give these the most narrative attention):`,
      allFocusNames.length > 0 ? allFocusNames.join(', ') : 'None specified',
      ``,
      `PARTICIPANTS (ALL present at the event — characters AND the user if included):`,
      allParticipantNames.join(', '),
      ``,
      `CHARACTER DETAILS:`,
      characterContexts,
      ...(userBundle ? [
        ``,
        `USER PARTICIPANT (the authenticated user — include them in the narrative and imagery, but do NOT create memories FOR them):`,
        `- ${userBundle.display_name} [User — not a character] (User ID: ${userBundle.user_id})`,
        userBundle.gender ? `  Gender: ${userBundle.gender}` : '',
        userBundle.is_focus ? `  ★ FOCUS participant — give them greater narrative attention` : '',
        `  NOTE: This person is the USER, not a character. Include them in the narrative and image descriptions, but do NOT include them in the memories array or emotional_outcomes array. Only create memories for CHARACTER participants.`,
      ].filter(Boolean) : []),
      ``,
      `RELATIONSHIPS BETWEEN PARTICIPANTS:`,
      relationshipContexts.length > 0 ? relationshipContexts.join('\n') : 'No known relationships',
      ``,
      `════════════════════════════════════`,
      `LEXICAL DISCIPLINE AND MEANING PRESERVATION — MANDATORY`,
      `════════════════════════════════════`,
      `The generated narrative, memory_text, memory_summary, and emotional_outcomes will be stored permanently as StoryEventMemory, Memory, CharacterMemory, LifeEvent, and Character memory records. All characters will read and learn from this text in future interactions.`,
      ``,
      `1. BANNED TERMS — Never use "chaos" or "chaotic" in narrative, memory_text, memory_summary, emotional_impact, or any output field.`,
      `   Do not describe busy, crowded, celebratory, emotional, energetic, or multi-person scenes with these terms.`,
      `   Instead describe the actual mechanics: lively, bustling, fast-moving, layered, warm, emotional, high-energy, noisy, complex.`,
      ``,
      `2. RESTRICTED TERM — Do not use "heavy" as vague emotional shorthand for important, emotional, stressful, meaningful, or serious.`,
      `   Literal physical weight is the only permitted use. For emotional weight, describe the specific reality instead.`,
      ``,
      `3. VALENCE ACCURACY — Classify from event facts and outcome, not dramatic wording.`,
      `   Joyful, loving, celebratory, healing, successful events → positive or mixed valence. Never negative.`,
      `   Painful, harmful, genuinely unresolved events → negative valence when supported.`,
      `   Do not balance a positive event by injecting negative language.`,
      ``,
      `4. IDENTITY PROTECTION — Do not promote situational descriptors into identity labels.`,
      `   A busy event does not mean the character creates disorder. A difficult moment is not a character flaw.`,
      ``,
      `5. REINFORCEMENT FAIRNESS — Memory text is learned from. Positive events must preserve positive reinforcement.`,
      `   Negative events must preserve accurate negative reinforcement. Complex events preserve their actual complexity.`,
      `════════════════════════════════════`,
      ``,
      `INSTRUCTIONS:`,
      `1. Write a narrative story about this event. The story MUST follow the user's plot above. Expand details, interactions, observations, and emotional moments — but DO NOT replace the user's intended event with a different storyline.`,
      `2. Focus characters should receive greater narrative attention, more detailed emotional moments, and more internal perspective. Supporting participants (including family members, NPCs, and service characters) should still be included where appropriate.`,
      `3. Include light dialogue where it supports the event. Dialogue should enhance the story, not dominate it.`,
      `4. Family members should behave according to their family role. Service characters should behave professionally.`,
      ``,
      `OUTPUT FORMAT — Return a JSON object with these fields:`,
      `{`,
      `  "narrative": "The full narrative story text, well-written and immersive, approximately 400-800 words.",`,
      `  "narrative_preview": "A short 1-2 sentence preview/summary of the event.",`,
      `  "emotional_outcomes": [`,
      `    { "character_id": "the_exact_id", "character_name": "Name", "emotion": "happy|proud|relieved|excited|comfortable|calm|trusting|anxious|sad|disappointed|frustrated|embarrassed|reflective|grateful|hopeful|tense|hurt|content", "intensity": "mild|moderate|strong", "reason": "Brief explanation tied to the narrative" }`,
      `  ],`,
      `  "relationship_changes": [`,
      `    { "source_character_id": "the_exact_id", "target_character_id": "the_exact_id_or_user_id", "source_name": "Name", "target_name": "Name", "dimension": "friendship|trust|familiarity|attraction|respect|tension", "change": "increased|decreased", "amount": 1-10, "reason": "Brief explanation tied to the narrative" }`,
      `  ],`,
      `  "memories": [`,
      `    { "character_id": "the_exact_id", "character_name": "Name", "memory_text": "What this character remembers about the event — personal, specific, from their perspective. Include: the event title, venue, who they saw there, what they did, interactions they had, and how they felt. A few sentences.", "memory_summary": "Short summary for retrieval (one sentence)", "importance_score": 1-10, "emotional_tone": "positive|negative|neutral|mixed" }`,
      `  ],`,
      `  "image_prompts": [`,
      `    { "moment": "opening", "prompt": "Image generation prompt for the opening moment at ${venueName}. CRITICAL: Describe each visible person using ONLY their APPEARANCE data from the character details above — skin tone, hair, hairstyle, facial hair, clothing style, overall aesthetic. DO NOT invent generic people. DO NOT describe strangers. Every person in this image must match their character's documented appearance.${userImageRule} Include venue ambiance, lighting, and mood.", "description": "What the image shows." },`,
      `    { "moment": "key_moment", "prompt": "Image generation prompt for the peak moment. Focus characters must be prominent and described using their documented appearance. Supporting characters who appear must also use their documented appearance. DO NOT generate stand-ins.${userImageRuleShort}", "description": "What the image shows." },`,
      `    { "moment": "closing", "prompt": "Image generation prompt for the closing moment. Describe each visible character using their documented appearance. No generic faces.${userImageRuleShort}", "description": "What the image shows." }`,
      `  ]`,
      `}`,
      ``,
      `RULES:`,
      `- The narrative MUST follow the user's plot. Do not invent a different storyline.`,
      `- Emotional outcomes must be supported by what happens in the narrative. No random emotions.`,
      `- Relationship changes must have a meaningful reason in the narrative. No unsupported changes.`,
      `- Focus characters get richer memories with higher importance scores.`,
      `- EVERY CHARACTER participant (family members, NPCs, service characters, AND active characters) gets at least one memory. No character who attended is left without a memory.`,
      `- The USER participant is NOT a character. Do NOT include them in the memories array, emotional_outcomes array, or any memory-related output. Only create memories for CHARACTER participants.`,
      `- Relationship changes can be created between CHARACTER participants who interact meaningfully. A character's relationship toward the USER can also change — when it does, use the user's User ID as target_character_id and the user's display name as target_name.`,
      `- Image prompts must reference the venue: ${venueName}.`,
      `- IMAGE IDENTITY RULE (CRITICAL): For every character visible in an image, copy their APPEARANCE data verbatim from the character details above. Use their actual skin tone, hair, hairstyle, clothing, aesthetic. DO NOT describe generic strangers. DO NOT invent replacement faces. The people shown must match the selected characters.`,
      userImageRuleLine,
      `- Only include relationship changes for character pairs that actually interact meaningfully.`,
    ].join('\n');

    let generated;

    if (narrativeAlreadyGenerated) {
      // ── IDEMPOTENT RE-ENTRY: Use existing generated data from the event record ──
      // The LLM step completed in a prior run. Reconstruct the generated object
      // from persisted fields so effects can complete without regenerating.
      generated = {
        narrative: event.generated_narrative,
        narrative_preview: event.narrative_preview,
        emotional_outcomes: event.emotional_outcomes || [],
        relationship_changes: event.relationship_changes || [],
        memories: [],
        image_prompts: [],
      };

      // Load existing StoryEventMemory records to know which characters are covered
      try {
        const existingMems = await base44.asServiceRole.entities.StoryEventMemory.filter(
          { story_event_id: eventId }, null, 200
        );
        generated.memories = existingMems.map(m => ({
          character_id: m.character_id,
          character_name: m.character_name,
          memory_text: m.memory_text,
          memory_summary: m.memory_summary,
          importance_score: m.importance_score,
          emotional_tone: m.emotional_tone,
        }));
      } catch (_) {}

      // Load existing StoryEventImage records to know which moments are covered
      try {
        const existingImgs = await base44.asServiceRole.entities.StoryEventImage.filter(
          { story_event_id: eventId }, null, 10
        );
        // Reconstruct minimal image_prompts for moments that don't have images yet
        // (failed moments have records but no image_url). We only need moment types.
        generated.image_prompts = existingImgs
          .filter(img => !img.image_url) // only retry failed/missing images
          .map(img => ({ moment: img.moment_type, prompt: img.prompt || '', description: img.description || '' }));
      } catch (_) {}

      console.log(`[generateStoryEvent] IDEMPOTENT RE-ENTRY: narrative already generated, completing effects for event ${eventId}`);
    } else {
      // ── STEP 1: GENERATE NARRATIVE (CORE — failure = failed) ──────────────────
      // This is the ONLY path to 'failed'. If the LLM cannot produce the narrative,
      // the Story Event itself cannot be created. All other failures are secondary.
      try {
        const llmRes = await base44.asServiceRole.integrations.Core.InvokeLLM({
          prompt: narrativePrompt,
          response_json_schema: {
            type: 'object',
            properties: {
              narrative: { type: 'string' },
              narrative_preview: { type: 'string' },
              emotional_outcomes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    character_id: { type: 'string' },
                    character_name: { type: 'string' },
                    emotion: { type: 'string' },
                    intensity: { type: 'string' },
                    reason: { type: 'string' },
                  },
                },
              },
              relationship_changes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    source_character_id: { type: 'string' },
                    target_character_id: { type: 'string' },
                    source_name: { type: 'string' },
                    target_name: { type: 'string' },
                    dimension: { type: 'string' },
                    change: { type: 'string' },
                    amount: { type: 'number' },
                    reason: { type: 'string' },
                  },
                },
              },
              memories: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    character_id: { type: 'string' },
                    character_name: { type: 'string' },
                    memory_text: { type: 'string' },
                    memory_summary: { type: 'string' },
                    importance_score: { type: 'number' },
                    emotional_tone: { type: 'string' },
                  },
                },
              },
              image_prompts: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    moment: { type: 'string' },
                    prompt: { type: 'string' },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
          model: 'gemini_3_1_pro',
        });
        generated = llmRes;

        // ── STEP 1b: PERSIST GENERATED NARRATIVE DATA (CORE — not terminal yet) ──
        // The narrative is the core Story Event content. Once persisted, the
        // core generation is done and the event cannot be 'failed' by downstream
        // errors. However, 'complete' is NOT set here — required commit effects
        // (memories, life events, participation, location history, narrative
        // injection) must also succeed before the event is exposed to the rest
        // of the application as fully complete. This prevents a split-brain
        // state where status=complete but characters don't know the event happened.
        await base44.asServiceRole.entities.StoryEvent.update(eventId, {
          generated_narrative: generated.narrative || '',
          narrative_preview: generated.narrative_preview || (generated.narrative || '').substring(0, 150),
          emotional_outcomes: generated.emotional_outcomes || [],
          relationship_changes: generated.relationship_changes || [],
          // status remains 'generating' — terminal 'complete' is set in STEP 7
        });
        narrativePersisted = true;

        console.log(`[generateStoryEvent] ✅ CORE NARRATIVE PERSISTED: event ${eventId} — required effects pending`);
      } catch (e) {
        // GENUINE CORE FAILURE: LLM narrative generation failed.
        // The Story Event itself cannot be created. This is the only path to 'failed'.
        await base44.asServiceRole.entities.StoryEvent.update(eventId, {
          status: 'failed',
          generation_error: `LLM error: ${e.message}`,
        });
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    // ── IDEMPOTENCY: Query existing derivative records in parallel ──────────────
    // Prevents duplicate effects when the function is re-entered after partial
    // persistence (e.g., automation re-trigger, timeout recovery, or retry).
    // Each query uses the stable identifying field for that entity so we can
    // compute missing = expected - existing without guessing.
    const [existingSEM, existingEP, existingLE, existingLH, existingSEI, existingMemEntity] = await Promise.all([
      base44.asServiceRole.entities.StoryEventMemory.filter({ story_event_id: eventId }, null, 200).catch(() => []),
      base44.asServiceRole.entities.EventParticipation.filter({ event_id: eventId }, null, 200).catch(() => []),
      base44.asServiceRole.entities.LifeEvent.filter({ context_tags: eventId }, null, 200).catch(() => []),
      base44.asServiceRole.entities.LocationHistory.filter({ travel_source: 'event' }, null, 200).catch(() => []),
      base44.asServiceRole.entities.StoryEventImage.filter({ story_event_id: eventId }, null, 20).catch(() => []),
      base44.asServiceRole.entities.Memory.filter({ source_context: `story_event_${eventId}` }, null, 200).catch(() => []),
    ]);
    const semCharIds = new Set(existingSEM.map(r => r.character_id));
    const epCharIds = new Set(existingEP.map(r => r.character_id));
    const leCharIds = new Set(existingLE.map(r => r.character_id));
    const lhCharIds = new Set(existingLH.filter(r => r.travel_reason?.includes(title)).map(r => r.character_id));
    const existingImageMoments = new Set(existingSEI.filter(r => r.image_url).map(r => r.moment_type));
    const memEntityCharIds = new Set(existingMemEntity.map(r => r.character_id));
    // CharacterMemory idempotency is resolved per-character in Step 2d below,
    // querying each participant's CharacterMemory records and checking for the
    // event title prefix in memory_text. This uses stable identity (character_id
    // + event title in memory_text) rather than a cross-entity heuristic.

    // ── STEP 2: CREATE STORY EVENT MEMORIES (idempotent + bulk) ──────────────────
    const memories = generated.memories || [];
    const _memoryCoveredIds = new Set(memories.map(m => m.character_id));
    const _uncoveredIds = allIds.filter(id => !_memoryCoveredIds.has(id));
    const _fallbackMemories = _uncoveredIds.map(cid => {
      const c = charById[cid];
      const cname = c?.name || c?.display_name || cid;
      return {
        character_id: cid, character_name: cname,
        memory_text: `${cname} attended the story event "${title}" on ${eventDate} at ${venueName}.`,
        memory_summary: `Attended "${title}" at ${venueName} on ${eventDate}`,
        importance_score: 3, emotional_tone: 'neutral',
      };
    });
    const _allMemoryEntries = [...memories, ..._fallbackMemories];
    const semToCreate = _allMemoryEntries
      .filter(m => m.character_id && !semCharIds.has(m.character_id))
      .map(m => ({
        story_event_id: eventId, character_id: m.character_id,
        character_name: m.character_name || '', memory_text: m.memory_text,
        memory_summary: m.memory_summary || m.memory_text.substring(0, 80),
        memory_type: 'event', importance_score: m.importance_score || 5,
        emotional_tone: m.emotional_tone || 'neutral', owner_email: ownerEmail,
      }));
    if (semToCreate.length > 0) {
      try { await base44.asServiceRole.entities.StoryEventMemory.bulkCreate(semToCreate); }
      catch (e) {
        console.warn(`[generateStoryEvent] StoryEventMemory bulkCreate FAILED (required): ${e.message}`);
        requiredFailures.push({ step: 'StoryEventMemory', error: e.message, count: semToCreate.length });
      }
    }

    // ── STEP 2b: WRITE TO CHARACTER.MEMORIES ARRAY (idempotent, REQUIRED) ────
    for (const mem of _allMemoryEntries) {
      if (!mem.character_id || !mem.memory_text) continue;
      try {
        const freshChars = await base44.asServiceRole.entities.Character.filter({ id: mem.character_id }, null, 1);
        const freshChar = freshChars[0];
        if (!freshChar) continue;
        const existingMemories = freshChar.memories || [];
        if (existingMemories.some(m => m.title === `Story Event: ${title}` && m.date === eventDate)) continue;
        const newMemoryEntry = {
          title: `Story Event: ${title}`,
          description: mem.memory_text,
          date: eventDate,
          emotion_state: mem.emotional_tone || 'neutral',
          created_date: new Date().toISOString(),
          story_event_id: eventId,
        };
        await base44.asServiceRole.entities.Character.update(mem.character_id, {
          memories: [...existingMemories, newMemoryEntry],
        });
      } catch (e) {
        console.warn(`[generateStoryEvent] Character.memories update FAILED (required) for ${mem.character_id}: ${e.message}`);
        requiredFailures.push({ step: 'Character.memories', character_id: mem.character_id, error: e.message });
      }
    }

    // ── EVENT TIME COMPUTATION (computed early — used by STEP 2c onward) ──────
    // eventArrivalTime and eventDepartureTime must be initialized BEFORE any
    // step that references them. STEP 2c (Memory entity) uses eventDepartureTime
    // as its timestamp field. Declaring these later (as STEP 5e once did) creates
    // a temporal dead zone: the binding is hoisted but uninitialized, so the
    // first read throws "Cannot access 'eventDepartureTime' before initialization"
    // and crashes the entire function with a 500 before images or participation
    // records are created.
    const eventArrivalTime = `${eventDate || ''}T${startTime || '12:00'}:00.000`;
    const eventDepartureTime = endTime
      ? `${eventDate}T${endTime}:00.000`
      : `${eventDate}T${startTime ? addHoursToTime(startTime, 2) : '14:00'}:00.000`;

    // ── STEP 2c: WRITE TO MEMORY ENTITY (idempotent + bulk) ───────────────────
    const memEntityToCreate = _allMemoryEntries
      .filter(m => m.character_id && !memEntityCharIds.has(m.character_id))
      .map(m => {
        const eventContext = `[Story Event: ${title} — ${eventDate} at ${venueName}]`;
        return {
          character_id: m.character_id,
          title: `Attended: ${title}`,
          description: `${eventContext} ${m.memory_text}`,
          emotional_impact: m.emotional_tone || 'neutral',
          source_context: `story_event_${eventId}`,
          timestamp: eventDepartureTime,
        };
      });
    if (memEntityToCreate.length > 0) {
      try { await base44.asServiceRole.entities.Memory.bulkCreate(memEntityToCreate); }
      catch (e) {
        console.warn(`[generateStoryEvent] Memory bulkCreate FAILED (required): ${e.message}`);
        requiredFailures.push({ step: 'Memory', error: e.message, count: memEntityToCreate.length });
      }
    }

    // ── STEP 2d: CREATE CHARACTER MEMORY RECORDS (idempotent, per-character) ───
    // Idempotency: CharacterMemory has no story_event_id field, so we query
    // each participant's CharacterMemory records filtered by character_id and
    // check in code whether any memory_text contains this event's title prefix.
    // This is a stable identity check (character_id + event title in memory_text),
    // not a heuristic based on other entities existing.
    const charMemToCreate = [];
    const charMemEventPrefix = `[Story Event: ${title} —`;
    for (const mem of _allMemoryEntries) {
      if (!mem.character_id || !mem.memory_text) continue;
      let alreadyHasCharMem = false;
      try {
        const existingCharMems = await base44.asServiceRole.entities.CharacterMemory.filter(
          { character_id: mem.character_id }, '-created_date', 50
        ).catch(() => []);
        alreadyHasCharMem = (existingCharMems || []).some(
          r => r.memory_text && r.memory_text.includes(charMemEventPrefix)
        );
      } catch (_) {}
      if (alreadyHasCharMem) continue;
      charMemToCreate.push({
        character_id: mem.character_id,
        memory_type: 'event',
        memory_text: `[Story Event: ${title} — ${eventDate} at ${venueName}] ${mem.memory_text}`,
        memory_summary: mem.memory_summary || `Attended "${title}" at ${venueName} on ${eventDate}`,
        importance_score: mem.importance_score || 5,
        confidence_score: 0.95,
        permanence: (mem.importance_score || 5) >= 7 ? 'protected' : 'long_term',
        validation_status: 'confirmed',
        source_story_event_id: eventId,
      });
    }
    if (charMemToCreate.length > 0) {
      try { await base44.asServiceRole.entities.CharacterMemory.bulkCreate(charMemToCreate); }
      catch (e) {
        console.warn(`[generateStoryEvent] CharacterMemory bulkCreate FAILED (required): ${e.message}`);
        requiredFailures.push({ step: 'CharacterMemory', error: e.message, count: charMemToCreate.length });
      }
    }

    // ── STEP 3: UPDATE RELATIONSHIP SCORES ────────────────────────────────────
    // CHARACTER → CHARACTER: applied to fictional_relationships[] (existing, unchanged).
    // CHARACTER → USER: delegated to updateRelationshipLevels — the EXISTING canonical
    //   updater used by normal character/user interaction (Chat page). It computes
    //   and persists the character's relationship values toward the user through its
    //   own LLM + post-processing + persistence pipeline. No parallel writer here.
    const relChanges = generated.relationship_changes || [];
    const userIdForRelTarget = userBundle?.user_id || null;

    for (const rc of relChanges) {
      if (!rc.source_character_id || !rc.target_character_id || !rc.dimension) continue;
      const sourceChar = charById[rc.source_character_id];
      if (!sourceChar) continue;

      try {
        // ── CHARACTER → USER: delegate to the existing canonical updater ──
        if (userIdForRelTarget && rc.target_character_id === userIdForRelTarget) {
          const charMemory = (generated.memories || []).find(m => m.character_id === rc.source_character_id);
          await base44.asServiceRole.functions.invoke('updateRelationshipLevels', {
            characterId: rc.source_character_id,
            userMessage: `[Story Event: "${title}" at ${venueName}] ${plot}`,
            characterReply: charMemory?.memory_text || '',
            recentMessages: [],
            ownerEmail: ownerEmail,
          }).catch(e => console.warn(`[generateStoryEvent] updateRelationshipLevels delegation failed for ${rc.source_character_id}: ${e.message}`));
          continue;
        }

        // ── CHARACTER → CHARACTER: fictional_relationships[] (existing, unchanged) ──
        const existingRels = sourceChar.fictional_relationships || [];
        const relIdx = existingRels.findIndex(r => r.related_character_id === rc.target_character_id);
        const amount = Math.min(10, Math.max(1, rc.amount || 3));

        const dimensionFieldMap = {
          friendship: 'friendship_level',
          trust: 'trust_level',
          familiarity: 'familiarity_level',
          attraction: 'attraction_level',
          respect: 'user_respect_level',
          tension: 'tension_level',
        };

        const field = dimensionFieldMap[rc.dimension];
        if (!field) continue;

        if (relIdx >= 0) {
          const currentVal = existingRels[relIdx][field] ?? 50;
          const newVal = rc.change === 'increased'
            ? Math.min(100, currentVal + amount)
            : Math.max(0, currentVal - amount);
          existingRels[relIdx] = { ...existingRels[relIdx], [field]: newVal };
          await base44.asServiceRole.entities.Character.update(rc.source_character_id, {
            fictional_relationships: existingRels,
          });
        }
      } catch (_) {}
    }

    // ── STEP 4: UPDATE EMOTIONAL STATES ──────────────────────────────────────
    const emotionalOutcomes = generated.emotional_outcomes || [];
    for (const eo of emotionalOutcomes) {
      if (!eo.character_id || !eo.emotion) continue;
      try {
        await base44.asServiceRole.entities.Character.update(eo.character_id, {
          emotional_state: eo.emotion,
        });
      } catch (_) {}
    }

    // ── Find or create a real Conversation for Media Gallery visibility ────
    // The gallery discovers images by scanning Message records whose
    // conversation_id belongs to a Conversation entity owned by the user.
    // Service-role create + owner_email ensures the gallery's owner_email
    // query path finds these even when no user auth context is available
    // (e.g. when invoked from another backend function or a scheduled automation).
    let storyEventConversationId = `story_event_${eventId}`;
    try {
      const existingConvos = await base44.asServiceRole.entities.Conversation.filter(
        { title: `story_event::${eventId}`, channel: 'story_event' },
        '-created_date', 5
      ).catch(() => []);

      if (existingConvos?.length > 0 && existingConvos[0]?.id) {
        storyEventConversationId = existingConvos[0].id;
      } else {
        const storyConvo = await base44.asServiceRole.entities.Conversation.create({
          title: `story_event::${eventId}`,
          type: 'direct',
          character_ids: allIds,
          channel: 'story_event',
          owner_email: ownerEmail,
        }).catch(() => null);
        if (storyConvo?.id) {
          storyEventConversationId = storyConvo.id;
          console.log(`[generateStoryEvent] Created story event conversation for gallery: ${storyConvo.id}`);
        }
      }
    } catch (e) {
      console.warn(`[generateStoryEvent] Conversation creation failed (using fallback ID): ${e?.message}`);
    }

    // ── STEP 5: GENERATE IMAGES WITH UNIFIED IDENTITY GROUNDING ──────────────
    // Every image prompt now:
    //   1. Prepends the Name Reference Key (ID-anchored, canonical format)
    //   2. Receives participant reference images in existing_image_urls
    //   3. Stores resolved participant metadata in generation_context
    const imagePrompts = generated.image_prompts || [];
    const momentOrder = { opening: 0, key_moment: 1, closing: 2 };

    for (const img of imagePrompts) {
      if (!img.moment || !img.prompt) continue;
      try {
        // Determine which character bundles are visible for this moment
        const visibleCharIds = img.moment === 'opening'
          ? participantIds.slice(0, 3)
          : img.moment === 'key_moment'
          ? (focusIds.length > 0 ? focusIds : participantIds.slice(0, 2))
          : participantIds.slice(0, 2);

        const visibleBundles = participantBundles.filter(b => visibleCharIds.includes(b.character_id));
        const visibleCharNames = visibleBundles.map(b => b.display_name).filter(Boolean);
        const visibleCharTypes = visibleBundles.map(b => b.char_record?.character_type || 'active_created_character');

        // Build the Name Reference Key for this specific image's visible participants
        // Include user bundle only if they have a world name (visual identity anchor)
        const imageKeyParticipants = [
          ...visibleBundles.map(b => ({
            participant_type: 'character',
            character_id: b.character_id,
            user_id: null,
            display_name: b.display_name,
            matched_prompt_name: b.matched_prompt_name,
          })),
          ...(userBundle ? [{
            participant_type: 'user',
            character_id: null,
            user_id: userBundle.user_id,
            display_name: userBundle.display_name,
            matched_prompt_name: userBundle.matched_prompt_name,
          }] : []),
        ];

        const imageNameRefKey = buildParticipantNameReferenceKeyBlock(imageKeyParticipants);

        // ── USER IDENTITY LOCK BLOCK ─────────────────────────────────────────────
        // When the authenticated User is a selected Story Event participant, inject
        // their full identity profile (appearance_lock, avatar, gender, ethnicity,
        // culture, race, world name, user ID) DIRECTLY into the prompt string.
        // This is injected for EVERY image moment — regardless of focus status.
        // The User's likeness must never be omitted or genericized.
        const userIdentityLockBlock = buildUserIdentityLockBlock(userBundle);
        const userIsIncluded = !!userBundle;

        // ── FINAL IMAGE PROMPT: Name Reference Key + scene description ──────────
        const finalImagePrompt = [
          `════════════════════════════════════════════════════════════`,
          `⚠️ CRITICAL: FICTIONAL CHARACTER NOTICE`,
          `════════════════════════════════════════════════════════════`,
          `ALL subjects are 100% FICTIONAL CHARACTERS for a storytelling app. Not real people.`,
          `Treat as characters in a novel or video game. Render from descriptions and reference photos only.`,
          `════════════════════════════════════════════════════════════`,
          ``,
          imageNameRefKey,
          ``,
          // ── USER IDENTITY LOCK — zero-drift enforcement ──
          ...(userIdentityLockBlock ? [userIdentityLockBlock, ``] : []),
          `════════════════════════════════════════════════════════════`,
          `STORY EVENT: "${title}"`,
          `MOMENT: ${img.moment.replace('_', ' ')}`,
          `VENUE: ${venueName}`,
          `EVENT DATE: ${eventDate || 'unspecified'}`,
          `════════════════════════════════════════════════════════════`,
          ``,
          img.prompt,
          ``,
          `VISIBLE PARTICIPANTS (ALL listed must appear in this image — NO OMISSIONS, NO STAND-INS, NO GENERIC STRANGERS):`,
          allParticipantNames.length > 0 ? allParticipantNames.map(name => `- ${name}`).join('\n') : '- No participants specified',
          ``,
          `Photorealistic photograph. Ultra-detailed. Real human proportions. Not an illustration.`,
          ``,
          `IDENTITY ENFORCEMENT:`,
          `- Every person in this image must match a participant listed in the Name Reference Key above.`,
          `- Do NOT generate generic strangers, stand-ins, or placeholder people.`,
          `- Do NOT infer any appearance from names alone — use ONLY the visual identity references provided.`,
          `- Character IDs in the key are the sole identity anchors. Reference images define face/hair/body.`,
          ...(userIsIncluded ? [
            ``,
            `USER PRESENCE ENFORCEMENT:`,
            `- The authenticated User ("${userBundle.matched_prompt_name || 'User'}") IS a selected participant in this Story Event.`,
            `- They MUST appear as a visible, rendered person in this image — not omitted, not a stand-in, not a generic bystander.`,
            `- Their likeness must match the USER IDENTITY LOCK block above and the attached reference images.`,
            `- If they are a focus participant, they must be prominent and clearly visible in the foreground or central framing.`,
          ] : []),
          ``,
          `BACKGROUND POPULATION DIVERSITY LAW — ABSOLUTE OVERRIDE:`,
          `Caucasian/White is NEVER the default appearance for any automatically generated, unspecified, or background person.`,
          `This applies to: background figures, crowds, pedestrians, shoppers, coworkers, students, diners, patrons, visitors, commuters, and ALL other incidental or unnamed people.`,
          `When generating ANY person whose ethnicity is not explicitly defined by reference images, appearance lock, or character data:`,
          `✅ Distribute across diverse backgrounds: Black, Hispanic/Latino, Indian, Jamaican, African, Asian, Middle Eastern, Haitian, Mixed heritage, Indigenous, Pacific Islander, South Asian, and other culturally appropriate backgrounds.`,
          `✅ Vary skin tones, facial features, hair textures, and body types to reflect authentic real-world human diversity.`,
          `✅ Each background person should be a unique individual — do not make them all look the same.`,
          `✅ Reflect the natural diversity of a real public space — people of many backgrounds coexisting.`,
          `⛔ DO NOT collapse all background people to a single ethnicity.`,
          `⛔ DO NOT use training-data "generic person" defaults — those priors skew heavily Caucasian/White.`,
          `⛔ DO NOT render all background extras as White, fair-skinned, or European-featured.`,
          `⛔ DO NOT default to Caucasian when no ethnicity is specified — select from the diverse backgrounds listed above.`,
          `This rule overrides any training-data bias. Representation MUST reflect real-world diversity.`,
          `Explicitly defined characters (with reference images, appearance locks, or ethnicities) are NOT affected — their locked appearance is always preserved exactly.`,
        ].join('\n');

        // ── REFERENCE IMAGE PAYLOAD ────────────────────────────────────────────
        // Focus character refs first, then visible character refs, then user refs.
        // Deduplication and CDN-filtering applied.
        const visibleCharRefImages = visibleBundles.flatMap(b => b.ref_images);
        const refImages = [
          ...focusRefImages,
          ...visibleCharRefImages,
          ...userRefImagesForPayload,
        ]
          .filter((url, i, arr) => arr.indexOf(url) === i) // deduplicate
          .filter(Boolean)
          .slice(0, 10); // cap to avoid oversized payloads

        console.log(`[generateStoryEvent] IMAGE DISPATCH: moment="${img.moment}" participants=${imageKeyParticipants.length} ref_images=${refImages.length}`);
        console.log(`[generateStoryEvent]   key_header_present: ${finalImagePrompt.includes('[NAME REFERENCE KEY — SELECTED PARTICIPANTS]')}`);
        console.log(`[generateStoryEvent]   existing_image_urls_count: ${refImages.length}`);

        const imageRes = await base44.asServiceRole.integrations.Core.GenerateImage({
          prompt: finalImagePrompt,
          existing_image_urls: refImages.length > 0 ? refImages : undefined,
        });

        if (imageRes?.url) {
          // Metadata: resolved participant IDs, types, ref status
          const resolvedParticipantMetadata = imageKeyParticipants.map(p => ({
            participant_type: p.participant_type,
            id: p.character_id || p.user_id,
            display_name: p.display_name,
            ref_images_attached: p.participant_type === 'user'
              ? userRefImagesForPayload.length > 0
              : (visibleBundles.find(b => b.character_id === p.character_id)?.ref_images.length || 0) > 0,
          }));

          // Create StoryEventImage — canonical event-image link
          const storyImage = await base44.asServiceRole.entities.StoryEventImage.create({
            story_event_id: eventId,
            moment_type: img.moment,
            image_url: imageRes.url,
            description: img.description || '',
            prompt: finalImagePrompt,
            order: momentOrder[img.moment] ?? 0,
            visible_character_ids: visibleCharIds,
            visible_character_names: visibleCharNames,
            visible_character_types: visibleCharTypes,
            reference_image_urls: refImages.slice(0, 5),
            reference_lookup_status_by_character: Object.fromEntries(
              visibleBundles.map(b => [b.character_id, b.ref_images.length > 0 ? 'resolved' : 'reference_lookup_failed'])
            ),
          });

          // Create Message record for Media Gallery visibility
          // Uses the real Conversation ID so fetchMediaGalleryPage discovers it
          await base44.asServiceRole.entities.Message.create({
            conversation_id: storyEventConversationId,
            sender_type: 'user',
            content: '',
            image_url: imageRes.url,
            image_description: `${img.description || img.prompt}${userBundle ? ` — Featuring: ${userBundle.display_name} (User ID: ${userBundle.user_id})` : ''}`,
            image_analysis_status: 'complete',
            generation_context: {
              // Identity grounding metadata
              generation_context_version: 2,
              context_origin: 'story_event',
              name_reference_key_injected: true,
              name_reference_key_header_verified: finalImagePrompt.includes('[NAME REFERENCE KEY — SELECTED PARTICIPANTS]'),
              resolved_participant_ids: imageKeyParticipants.map(p => p.character_id || p.user_id),
              resolved_participant_metadata: resolvedParticipantMetadata,
              user_included: !!userBundle,
              user_id: userBundle?.user_id || null,
              user_world_name: userBundle?.display_name || null,
              reference_images_attached: refImages.length > 0,
              reference_image_count: refImages.length,
              // Standard story event fields
              source: 'story_event',
              story_event_id: eventId,
              story_event_image_id: storyImage?.id || null,
              event_title: title,
              event_date: eventDate,
              moment_type: img.moment,
              participant_character_ids: participantIds,
              focus_character_ids: focusIds,
              visible_character_ids: visibleCharIds,
              visible_character_names: visibleCharNames,
              venue_id: event.venue_id || null,
              venue_name: venueName,
              scene_prompt: finalImagePrompt,
              original_raw_prompt: img.prompt,
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
        }
      } catch (imgErr) {
        console.warn(`[generateStoryEvent] Image generation failed for moment="${img.moment}": ${imgErr?.message}`);
        // Create a failed StoryEventImage record so the frontend can show
        // an error placeholder with a regenerate button for this specific moment.
        // The event still completes — narrative success is never blocked by a single image failure.
        try {
          await base44.asServiceRole.entities.StoryEventImage.create({
            story_event_id: eventId,
            moment_type: img.moment,
            description: img.description || '',
            prompt: img.prompt || '',
            order: momentOrder[img.moment] ?? 0,
            visible_character_ids: [],
            visible_character_names: [],
            visible_character_types: [],
            regeneration_reason: `Generation failed: ${imgErr?.message || 'unknown error'}`,
          });
        } catch (_) {}
      }
    }

    // ── STEP 5b: CREATE LIFEEVENT RECORDS (idempotent + bulk) ──────────────────
    const isMajorEvent = (generated.narrative || '').length > 600 || (focusIds.length >= 2);
    const defaultEventType = isMajorEvent ? 'life_milestone_event' : 'bonding_event';

    const leToCreate = _allMemoryEntries
      .filter(m => m.character_id && !leCharIds.has(m.character_id))
      .map(mem => {
        const tone = mem.emotional_tone || 'neutral';
        const valence = tone === 'positive' || tone === 'mixed' ? 'positive'
          : tone === 'negative' ? 'negative' : 'neutral';
        const eventTypeForChar = tone === 'positive'
          ? (isMajorEvent ? 'celebration_event' : 'bonding_event')
          : tone === 'negative'
          ? 'setback_event'
          : defaultEventType;
        return {
          character_id: mem.character_id,
          character_name: mem.character_name || '',
          title: `Story Event: ${title}`,
          description: mem.memory_text,
          event_type: eventTypeForChar,
          severity: isMajorEvent ? 'major' : 'significant',
          valence,
          emotional_impact: `${mem.emotional_tone || 'neutral'} — ${eventTypeForChar.replace(/_/g, ' ')}`,
          timestamp: `${eventDate || ''}T${startTime || '12:00'}:00.000`,
          triggered_by: 'story_event',
          systems_updated: ['memories', 'relationships', 'emotional_state'],
          context_tags: ['story_event', eventId, `participant_${mem.character_id}`],
        };
      });
    if (leToCreate.length > 0) {
      try { await base44.asServiceRole.entities.LifeEvent.bulkCreate(leToCreate); }
      catch (e) {
        console.warn(`[generateStoryEvent] LifeEvent bulkCreate FAILED (required): ${e.message}`);
        requiredFailures.push({ step: 'LifeEvent', error: e.message, count: leToCreate.length });
      }
    }

    // ── STEP 5e: WRITE LOCATION HISTORY RECORDS (idempotent + bulk, REQUIRED) ─
    // eventArrivalTime and eventDepartureTime are computed early (before STEP 2c)
    // to avoid a temporal dead zone crash. Only eventDurationMinutes is computed
    // here — it is local to the Location History section.
    let eventDurationMinutes = null;
    if (eventArrivalTime && eventDepartureTime) {
      const arrD = new Date(eventArrivalTime);
      const depD = new Date(eventDepartureTime);
      eventDurationMinutes = Math.round((depD.getTime() - arrD.getTime()) / 60000);
      if (eventDurationMinutes < 0) eventDurationMinutes = 120;
    }

    // ── LOCATION HISTORY — RESPECT EXISTING LOCATION PIPELINE ──────────────
    // Story Event generation is a CONSUMER of existing resolved location truth.
    // It is NOT a location authority. LocationHistory records must only reference
    // real persisted LocationReference IDs — exactly what the production
    // writeVerifiedLocationHistory pipeline requires.
    //
    // TWO PATHWAYS (existing production contract):
    //   1. NORMAL LISTED LOCATION (venue_id exists):
    //      Write LocationHistory with the real venue_id. The prior location
    //      must also be a real persisted ID (home/work/school/resolved_current).
    //      If the character has no real prior location ID, skip that character —
    //      we cannot fabricate a location ID.
    //
    //   2. RABBIT-HOLE DESTINATION (is_rabbit_hole=true, venue_id=null):
    //      Do NOT write LocationHistory. The rabbit-hole state is tracked through
    //      Character.resolved_location_type and resolved_presence_status, NOT
    //      through LocationHistory. Production never writes LocationHistory for
    //      rabbit-hole destinations (resolved_current_location_id is null).
    //      The event venue name is carried in the StoryEvent record itself.
    //
    // NO FABRICATED IDS: never synthesize location_id values like
    // "story_event_venue_*" or "unknown_prior_*". If a real ID is missing, skip
    // the LocationHistory record rather than inventing a false location.
    const lhToCreate = [];
    const lhSkippedReasons = [];
    for (const cid of allIds) {
      // Idempotency: skip if this character already has event LocationHistory
      if (lhCharIds.has(cid)) continue;
      const c = charById[cid];
      const cname = c?.name || c?.display_name || cid;
      if (!c) continue;
      const presenceStatus = c.resolved_presence_status || 'home';
      const isConfined = presenceStatus === 'incarcerated' || presenceStatus === 'house_arrest' || presenceStatus === 'confined';
      if (isConfined) {
        lhSkippedReasons.push({ cid, reason: 'confined' });
        continue;
      }

      // ── RABBIT-HOLE: skip LocationHistory entirely ──
      // The venue is a non-persisted destination. Production tracks rabbit-hole
      // state through Character.resolved_location_type, not LocationHistory.
      // ONLY is_rabbit_hole=true triggers the rabbit-hole pathway.
      if (isRabbitHole) {
        lhSkippedReasons.push({ cid, reason: 'rabbit_hole' });
        continue;
      }

      // ── NORMAL EVENT WITH NO VENUE ID — skip LocationHistory ──
      // This is NOT a rabbit hole. The event was created without a venue_id
      // (e.g., user forgot to select one, or venue was deleted). We cannot
      // write LocationHistory without a real venue LocationReference ID.
      // Do not fabricate one. This is a data gap, not a rabbit-hole
      // classification. The event venue name is carried in the StoryEvent
      // record itself.
      if (!event.venue_id) {
        lhSkippedReasons.push({ cid, reason: 'no_venue_id' });
        continue;
      }

      // ── NORMAL LISTED LOCATION: resolve real prior location ID ──
      let priorLocId = c.current_home_location_id;
      let priorLocName = c.resolved_current_location_name || 'home';
      let priorCategory = 'home';
      const resolvedType = c.resolved_location_type || 'home';
      const isAsleep = presenceStatus === 'sleeping' || presenceStatus === 'napping';
      const isTraveling = presenceStatus === 'traveling';

      if (isAsleep && c.current_home_location_id) {
        priorLocId = c.current_home_location_id;
        priorLocName = c.resolved_current_location_name || 'home';
        priorCategory = 'home';
      } else if (isTraveling && c.traveling_to_location_id) {
        priorLocId = c.traveling_to_location_id;
        priorLocName = c.traveling_to_location_name || 'destination';
        priorCategory = 'travel';
      } else if (resolvedType === 'work' && c.current_work_location_id) {
        priorLocId = c.current_work_location_id;
        priorLocName = c.resolved_current_location_name || 'work';
        priorCategory = 'workplace';
      } else if (resolvedType === 'school' && c.current_school_location_id) {
        priorLocId = c.current_school_location_id;
        priorLocName = c.resolved_current_location_name || 'school';
        priorCategory = 'education';
      } else if (resolvedType === 'temporary_housing' && c.temporary_housing_location_id) {
        priorLocId = c.temporary_housing_location_id;
        priorLocName = c.resolved_current_location_name || 'temporary housing';
        priorCategory = 'home';
      } else if (c.resolved_current_location_id) {
        priorLocId = c.resolved_current_location_id;
        priorLocName = c.resolved_current_location_name || 'previous location';
        priorCategory = resolvedType === 'work' ? 'workplace'
          : resolvedType === 'school' ? 'education'
          : 'home';
      }

      // ── SKIP IF NO REAL PRIOR LOCATION ID ──
      // Cannot record travel from an unknown location. Do not fabricate.
      if (!priorLocId) {
        lhSkippedReasons.push({ cid, reason: 'no_real_prior_location' });
        continue;
      }

      // Venue location ID — real persisted ID only (rabbit holes already skipped above)
      const venueLocId = event.venue_id;

      lhToCreate.push(
        { character_id: cid, character_name: cname, owner_email: ownerEmail,
          location_id: priorLocId, location_name: priorLocName, location_category: priorCategory,
          event_type: 'departure', arrival_time: `${eventDate}T00:00:00.000`,
          departure_time: eventArrivalTime, travel_source: 'event',
          travel_reason: `Left to attend "${title}" Story Event`, is_current: false,
          notes: `Departed from ${priorLocName} for Story Event: ${title}` },
        { character_id: cid, character_name: cname, owner_email: ownerEmail,
          location_id: venueLocId, location_name: venueName, location_category: 'social',
          event_type: 'social_visit', arrival_time: eventArrivalTime, departure_time: eventDepartureTime,
          duration_minutes: eventDurationMinutes, travel_source: 'event',
          travel_reason: `Story Event: ${title}`, is_current: false,
          notes: `Attended "${title}" Story Event at ${venueName}.` },
        { character_id: cid, character_name: cname, owner_email: ownerEmail,
          location_id: venueLocId, location_name: venueName, location_category: 'social',
          event_type: 'departure', arrival_time: eventArrivalTime, departure_time: eventDepartureTime,
          travel_source: 'event', travel_reason: `Left "${title}" Story Event`,
          is_current: false, notes: `Departed from Story Event: ${title}` },
        { character_id: cid, character_name: cname, owner_email: ownerEmail,
          location_id: priorLocId, location_name: priorLocName, location_category: priorCategory,
          event_type: 'return_home', arrival_time: eventDepartureTime, departure_time: null,
          travel_source: 'event', travel_reason: `Returned after "${title}" Story Event`,
          is_current: false, notes: `Returned to ${priorLocName} after Story Event: ${title}` },
      );
    }
    if (lhToCreate.length > 0) {
      try { await base44.asServiceRole.entities.LocationHistory.bulkCreate(lhToCreate); }
      catch (e) {
        console.warn(`[generateStoryEvent] LocationHistory bulkCreate FAILED (required): ${e.message}`);
        requiredFailures.push({ step: 'LocationHistory', error: e.message, count: lhToCreate.length });
      }
    }

    // ── STEP 5d: CREATE EVENTPARTICIPATION (idempotent + bulk, REQUIRED) ─────
    const epToCreate = _allMemoryEntries
      .filter(m => m.character_id && !epCharIds.has(m.character_id))
      .map(mem => ({
        event_id: eventId,
        event_name: title,
        character_id: mem.character_id,
        character_name: mem.character_name || '',
        owner_email: ownerEmail,
        participation_type: 'attended',
        emotional_tone: mem.emotional_tone || 'neutral',
        participation_date: `${eventDate || ''}T${startTime || '12:00'}:00.000`,
        memory_strength: (mem.importance_score || 5) >= 7 ? 'strong' : 'moderate',
        notes: mem.memory_summary || mem.memory_text?.substring(0, 120) || '',
        saw_character_ids: participantIds.filter(id => id !== mem.character_id),
      }));
    if (epToCreate.length > 0) {
      try { await base44.asServiceRole.entities.EventParticipation.bulkCreate(epToCreate); }
      catch (e) {
        console.warn(`[generateStoryEvent] EventParticipation bulkCreate FAILED (required): ${e.message}`);
        requiredFailures.push({ step: 'EventParticipation', error: e.message, count: epToCreate.length });
      }
    }

    // ── STEP 6: REMOVED — Coverage is now handled by _allMemoryEntries ────────
    // The _allMemoryEntries array (LLM memories + fallback for uncovered) is
    // used by Steps 2, 2b, 2c, 2d, 5b, 5d, and 5e. Every participant receives
    // all required continuity records through the idempotent bulk operations.
    // The separate Step 6 loop was redundant and created duplicate records.
    const uncoveredIds = []; // kept for response metadata — always empty now

    // ── STEP 6.5: INJECT NARRATIVE INTO CHARACTER CHAT (REQUIRED) ────────────
    // Push each character's memory of the event into their active direct and
    // phone conversations as a narrative message, timestamped at the event's
    // end time. Uses the same Conversation.filter + Message.create pattern as
    // the Chat page (useChatLoadConvo) and submitNarrative.
    const narrativeTimestamp = eventDepartureTime || new Date().toISOString();

    for (const mem of _allMemoryEntries) {
      if (!mem.character_id || !mem.memory_text) continue;
      try {
        const memChar = charById[mem.character_id];
        const memCharName = memChar?.name || memChar?.display_name || mem.character_name || mem.character_id;
        const narrativeContent = mem.memory_text;

        // ── Resolve or create the character's DIRECT conversation (Chat page) ──
        const existingDirect = await base44.asServiceRole.entities.Conversation.filter(
          { owner_email: ownerEmail, type: 'direct', character_ids: mem.character_id },
          '-last_message_date', 50
        ).catch(() => []);

        const directConvos = (existingDirect || []).filter(c => {
          const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
          return ids.length === 1 && ids[0] === mem.character_id && !c.shared_conversation_key && c.channel !== 'world_phone';
        });

        let directConvoId = null;
        if (directConvos.length > 0) {
          const withHistory = directConvos.filter(c => c.last_message_date);
          const withoutHistory = directConvos.filter(c => !c.last_message_date);
          const sortByRecency = (a, b) => new Date(b.last_message_date || b.created_date).getTime() - new Date(a.last_message_date || a.created_date).getTime();
          directConvoId = [...withHistory.sort(sortByRecency), ...withoutHistory.sort(sortByRecency)][0]?.id || null;
        } else {
          const newConvo = await base44.asServiceRole.entities.Conversation.create({
            title: `direct with ${memCharName}`,
            type: 'direct',
            character_ids: [mem.character_id],
            owner_email: ownerEmail,
          }).catch(() => null);
          if (newConvo?.id) directConvoId = newConvo.id;
        }

        if (directConvoId) {
          // ── Idempotency: check if narrative message already exists ──────────
          // Match by conversation_id + character_id + is_narrative + timestamp.
          // narrativeTimestamp is deterministic (eventDepartureTime), so re-entry
          // produces the same timestamp — if a message already exists, skip.
          let directAlreadyInjected = false;
          try {
            const existingDirectMsgs = await base44.asServiceRole.entities.Message.filter(
              { conversation_id: directConvoId, character_id: mem.character_id, timestamp: narrativeTimestamp },
              '-created_date', 10
            );
            directAlreadyInjected = (existingDirectMsgs || []).some(m => m.is_narrative === true);
          } catch (_) {}

          if (!directAlreadyInjected) {
            await base44.asServiceRole.entities.Message.create({
              conversation_id: directConvoId,
              sender_type: 'character',
              character_id: mem.character_id,
              character_name: memCharName,
              content: narrativeContent,
              is_narrative: true,
              is_read: false,
              timestamp: narrativeTimestamp,
              memory_eligible: false,
              relationship_eligible: false,
            }).catch(() => {});

            await base44.asServiceRole.entities.Conversation.update(directConvoId, {
              last_message_preview: `✦ ${narrativeContent.substring(0, 80)}...`,
              last_message_date: narrativeTimestamp,
            }).catch(() => {});
          }
        }

        // ── Inject into PHONE conversation (Text page) — create if needed ──
        // Mirrors the direct conversation path: if no phone conversation exists,
        // create one so the narrative reaches the Text page. Without this,
        // characters the user has never texted would never receive the
        // completed narrative on their Text page.
        const existingPhone = await base44.asServiceRole.entities.Conversation.filter(
          { owner_email: ownerEmail, type: 'phone', character_ids: mem.character_id },
          '-last_message_date', 50
        ).catch(() => []);

        const phoneConvos = (existingPhone || []).filter(c => {
          const ids = Array.isArray(c.character_ids) ? c.character_ids : [];
          return ids.length === 1 && ids[0] === mem.character_id && !c.shared_conversation_key && c.channel !== 'world_phone';
        });

        let phoneConvoId = null;
        if (phoneConvos.length > 0) {
          const withHistoryP = phoneConvos.filter(c => c.last_message_date);
          const withoutHistoryP = phoneConvos.filter(c => !c.last_message_date);
          const sortByRecencyP = (a, b) => new Date(b.last_message_date || b.created_date).getTime() - new Date(a.last_message_date || a.created_date).getTime();
          phoneConvoId = [...withHistoryP.sort(sortByRecencyP), ...withoutHistoryP.sort(sortByRecencyP)][0]?.id || null;
        } else {
          const newPhoneConvo = await base44.asServiceRole.entities.Conversation.create({
            title: `phone with ${memCharName}`,
            type: 'phone',
            character_ids: [mem.character_id],
            owner_email: ownerEmail,
          }).catch(() => null);
          if (newPhoneConvo?.id) phoneConvoId = newPhoneConvo.id;
        }

        if (phoneConvoId) {
          // ── Idempotency: check if narrative message already exists ──────────
          let phoneAlreadyInjected = false;
          try {
            const existingPhoneMsgs = await base44.asServiceRole.entities.Message.filter(
              { conversation_id: phoneConvoId, character_id: mem.character_id, timestamp: narrativeTimestamp },
              '-created_date', 10
            );
            phoneAlreadyInjected = (existingPhoneMsgs || []).some(m => m.is_narrative === true);
          } catch (_) {}

          if (!phoneAlreadyInjected) {
            await base44.asServiceRole.entities.Message.create({
              conversation_id: phoneConvoId,
              sender_type: 'character',
              character_id: mem.character_id,
              character_name: memCharName,
              content: narrativeContent,
              is_narrative: true,
              is_read: false,
              timestamp: narrativeTimestamp,
              memory_eligible: false,
              relationship_eligible: false,
            }).catch(() => {});

            await base44.asServiceRole.entities.Conversation.update(phoneConvoId, {
              last_message_preview: `✦ ${narrativeContent.substring(0, 80)}...`,
              last_message_date: narrativeTimestamp,
            }).catch(() => {});
          }
        }
      } catch (e) {
        console.warn(`[generateStoryEvent] Narrative injection FAILED (required) for ${mem.character_id}: ${e.message}`);
        requiredFailures.push({ step: 'NarrativeInjection', character_id: mem.character_id, error: e.message });
      }
    }

    // ── STEP 7: VERIFIED COMMIT GATE ────────────────────────────────────────────
    // The narrative is the resumable boundary. Once persisted, the event is
    // NEVER marked 'failed' by downstream effect errors — that would destroy
    // successfully generated narrative work. Instead:
    //
    //   - All required effects verified (requiredFailures empty) → 'complete'
    //   - Required effects still incomplete → stay 'generating' and record
    //     the exact failures in generation_error so they are surfaced (not
    //     hidden behind a generic 'generating' label). A future idempotent
    //     re-entry resumes only the missing work without duplication.
    //
    // 'failed' is reserved exclusively for genuine core narrative generation
    // failure (narrative could not be produced/persisted). That path is
    // handled in the Step 1 catch block and the outer catch — never here.
    //
    // Optional effects (images, relationship scores, emotional state) do NOT
    // gate completion — their failures are logged and independently recoverable.
    if (requiredFailures.length === 0) {
      await base44.asServiceRole.entities.StoryEvent.update(eventId, {
        status: 'complete',
        generation_error: null,
      });
      console.log(`[generateStoryEvent] ✅ COMMIT GATE PASSED: event ${eventId} set to 'complete' — all required effects verified`);
    } else {
      // Required effects incomplete — preserve narrative, surface exact failures.
      // Stay 'generating' so idempotent re-entry can resume missing work.
      const failSummary = requiredFailures.map(f =>
        `${f.step}${f.character_id ? `(${f.character_id})` : ''}${f.count ? `[${f.count}]` : ''}: ${f.error || 'verification failed'}`
      ).join('; ');
      await base44.asServiceRole.entities.StoryEvent.update(eventId, {
        status: 'generating',
        generation_error: `Required effects incomplete: ${failSummary}`,
      });
      console.warn(`[generateStoryEvent] ⏳ COMMIT GATE BLOCKED: event ${eventId} remains 'generating' — ${requiredFailures.length} required effect failure(s): ${failSummary}`);
    }

    return Response.json({
      success: true,
      eventId,
      memoriesCreated: _allMemoryEntries.length,
      uncoveredFilled: uncoveredIds.length,
      totalParticipants: allIds.length,
      imagesGenerated: imagePrompts.length,
      relationshipChanges: relChanges.length,
      requiredFailures: requiredFailures.length > 0 ? requiredFailures : undefined,
      participantTypes: allIds.map(id => charById[id]?.character_type || 'unknown'),
      identity_grounding: {
        name_reference_key_injected: true,
        participant_bundles_resolved: participantBundles.length,
        user_bundle_resolved: !!userBundle,
        user_id: userBundle?.user_id || null,
        participant_ids: participantBundles.map(b => b.character_id),
        participants_with_ref_images: participantBundles.filter(b => b.ref_images.length > 0).length,
        participants_without_ref_images: participantBundles.filter(b => b.ref_images.length === 0).map(b => b.display_name),
      },
    });
  } catch (error) {
    console.error('[generateStoryEvent]', error.message, error.stack);
    // CLASSIFICATION:
    //   Case A — narrative was never persisted (narrativePersisted = false):
    //     The Story Event generation itself failed. The narrative could not be
    //     produced or persisted. This is the only legitimate path to 'failed'.
    //     Use the existing failure handling for this condition.
    //
    //   Case B — narrative already persisted (narrativePersisted = true):
    //     The core narrative exists. A downstream effect threw an uncaught
    //     error (escaped its per-effect try-catch). Do NOT mark 'failed' — that
    //     would destroy the successfully generated narrative. Do NOT silently
    //     leave the event in 'generating' with no explanation. Instead, record
    //     the exact error in generation_error and leave status as 'generating'
    //     so idempotent re-entry can resume the missing work.
    if (eventId && !narrativePersisted) {
      // Case A: genuine core failure
      try {
        await base44.asServiceRole.entities.StoryEvent.update(eventId, {
          status: 'failed',
          generation_error: error.message || 'Core narrative generation failed',
        });
      } catch (_) {}
    } else if (eventId && narrativePersisted) {
      // Case B: downstream effect crashed after narrative persisted.
      // Preserve narrative + successful effects. Surface the exact failure.
      // Stay 'generating' for idempotent re-entry.
      try {
        await base44.asServiceRole.entities.StoryEvent.update(eventId, {
          status: 'generating',
          generation_error: `Downstream effect error: ${error.message || 'unknown error'}`,
        });
      } catch (_) {}
    }
    return Response.json({ error: error.message, narrativePersisted }, { status: 500 });
  }
});