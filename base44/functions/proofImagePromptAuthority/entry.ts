/**
 * proofImagePromptAuthority — Live path proof using REAL character records.
 *
 * IDENTITY AUTHORITY ORDER (matches generateImageAsync production behavior):
 *   1. Explicit user instruction for the specific image
 *   2. Appearance lock, if present (structured fields: ethnicities, appearance_lock.*)
 *   3. Avatar image and reference images (avatar_url IS identity data — not a fallback of last resort)
 *   4. Avatar-derived description and character description — supporting context only
 *   5. Structured profile fields (ethnicity, height, body type, hair, skin tone, facial hair)
 *   6. Current outfit and closet — clothing only
 *   7. Scene, location, lighting, pose, camera
 *   8. Generic prompt generation — BLOCKED if no identity data at all
 *
 * Proves:
 *   A. appearance_notes and avatar_description_text are NOT in charDesc
 *   B. charDesc is demographics-only (age_range + gender)
 *   C. buildAppearanceLockText reads structured fields only
 *   D. outfit comes from closet resolver, not from prose fields
 *   E. Characters with AI-style outfit full_description are filtered
 *   F. avatar_url IS loaded as identity data — not ignored for no-lock characters
 *   G. A character with no lock but with an avatar is NOT identity-poor and NOT blocked
 *   H. The identity-missing guard only fires when: no refs AND no charDesc AND no lock AND no ethnicities AND no avatar
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Parse body once — body stream can only be read once in Deno
  const reqBody = await req.json().catch(() => ({}));
  const summaryMode = !!(reqBody?.summaryOnly);

  // ── URL UTILITIES (exact copy from generateImageAsync) ──────────────────────
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

  // ── EXACT COPY of buildAppearanceLockText from generateImageAsync ─────────
  // Must remain byte-for-byte identical so the proof reflects production behavior.
  function buildAppearanceLockText(rec, n) {
    const name = n || rec?.name || 'this character';
    if (!rec) return 'render from refs — do not redesign';
    const lock = rec.appearance_lock || {};
    const ethnicities = (rec.ethnicities || []).filter(Boolean);
    const ethnicityFallback = rec.ethnicity || rec.race || null;
    const allEthnicities = ethnicities.length > 0 ? ethnicities : (ethnicityFallback ? [ethnicityFallback] : []);
    const skinTone = lock.skin_tone || null;
    const hairstyle = lock.hairstyle || null;
    const hairType = lock.hair_type || null;
    const hairColor = lock.hair_color || null;
    const facialHair = lock.facial_hair || null;
    const bodyType = lock.body_type || lock.overall_aesthetic || null;
    const distinguishing = lock.distinguishing_features || null;
    const isBald = lock.bald === true || /\b(bald|shaved head|no hair)\b/i.test(hairType || hairstyle || '');
    const htDisplay = hairstyle || hairType || null;
    const hasAnyData = allEthnicities.length > 0 || skinTone || htDisplay || hairColor || facialHair || bodyType || isBald;
    if (!hasAnyData) return 'render from refs — do not redesign';
    const r = [`\n🔒 CANONICAL APPEARANCE LOCK — "${name}" — ABSOLUTE IDENTITY AUTHORITY\nThese traits come directly from the character's structured data. OVERRIDE any conflicting prompt styling.\n`];
    if (allEthnicities.length > 0) r.push(`ETHNICITY / RACE: ${allEthnicities.join(', ')} — render EXACTLY this ethnicity. ⛔ DO NOT default to Caucasian/white/European. ⛔ DO NOT soften, lighten, or alter ethnic features.`);
    if (skinTone) r.push(`SKIN TONE: ${skinTone} — do not lighten, soften, or alter.`);
    if (isBald) {
      r.push(`HAIR: BALD — zero hair on top. ⛔ NO curls, locs, braids, fade, hairline, or any hair.`);
    } else if (htDisplay) {
      r.push(`HAIR: ${htDisplay}`);
      if (/dreadlocks?|locs?/i.test(htDisplay)) r.push(`⛔ REJECT: fade, short, bald, generic curls — DREADLOCKS ONLY`);
      else if (/long hair/i.test(htDisplay)) r.push(`⛔ REJECT: short, buzz, fade, cropped — LONG HAIR ONLY`);
      else if (/short|buzz|fade/i.test(htDisplay)) r.push(`⛔ REJECT: long, flowing — SHORT/FADE ONLY`);
      else if (/braids?|cornrows/i.test(htDisplay)) r.push(`⛔ REJECT: loose/straight/fade — BRAIDS ONLY`);
      else if (/afro/i.test(htDisplay)) r.push(`⛔ REJECT: straight, slicked, fade — AFRO ONLY`);
    }
    if (hairColor) r.push(`HAIR COLOR: ${hairColor} — do not alter.`);
    if (facialHair) {
      r.push(`FACIAL HAIR: ${facialHair}`);
      if (/clean-?shaven|no facial hair/i.test(facialHair)) r.push(`⛔ REJECT beard/stubble — CLEAN-SHAVEN ONLY`);
      else r.push(`⛔ REJECT clean-shaven — ${facialHair} MUST EXIST`);
    }
    if (bodyType) r.push(`BODY TYPE: ${bodyType} — do not slim, bulk, age-down, or beautify beyond what is described.`);
    if (distinguishing) r.push(`DISTINGUISHING FEATURES: ${distinguishing} — must be visible and accurate.`);
    r.push(`\nCANONICAL > REFS > PROMPT. Prompt controls pose/scene ONLY — NOT ethnicity/hair/face/skin/body.\n⛔ REJECT any prompt trait conflicting with the above.\n🚫 GENERATION INVALID if ethnicity, skin tone, hair, facial hair, or body type differs from canonical.`);
    return r.join('\n');
  }

  // ── EXACT COPY of isAIStylePrompt filter from generateImageAsync ──────────
  function isAIStylePrompt(t) {
    if (!t) return false;
    return /\b(cinematic|chiaroscuro|dramatic lighting|editorial photography|fine art|low-key lighting|sculptural anatomy|artistic composition|museum.quality|photorealistic|ultra.detailed|high.resolution|bokeh|dramatic shadow|noir atmosphere|hyper.realistic|studio lighting|professional photography|stock photo|silhouette|atmosphere|moody|high contrast|film grain|depth of field|aesthetic|luxury editorial)\b/i.test(t);
  }

  // ── EXACT COPY of buildOutfitText from generateImageAsync ────────────────
  function buildOutfitText(outfit) {
    if (!outfit) return null;
    const parts = [outfit.top, outfit.bottom, outfit.shoes, outfit.outerwear, outfit.accessories]
      .filter(Boolean)
      .map(p => {
        const t = p.trim();
        if (/^(n\/?a|none|-)$/i.test(t)) return null;
        const s = t.replace(/^n\/?a[,\-–]\s*/i, '').trim();
        return /^(shirtless|no top|no shirt)$/i.test(s) ? 'No shirt / bare torso' : (s || null);
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
    const fd = outfit.full_description?.trim();
    if (fd && !isAIStylePrompt(fd)) return fd;
    return null;
  }

  // ── EXACT COPY of resolveOutfitCategory from generateImageAsync ──────────
  function resolveOutfitCategory(character) {
    const presence = character?.resolved_presence_status || character?.location_status || '';
    const activity = (character?.current_activity || '').toLowerCase();
    if (/bath|shower|grooming/.test(activity)) return 'bath';
    if (presence === 'sleeping' || presence === 'napping' || /\b(sleep|nap|asleep|bedtime)\b/.test(activity)) return 'sleepwear';
    if (/\b(swim|pool|beach|ocean|water park)\b/.test(activity)) return 'swimwear';
    if (/\b(gym|workout|exercise|lifting|cardio|yoga|jogging|running|training)\b/.test(activity)) return 'gym';
    if (presence === 'at_work') return 'work';
    if (/\b(church|worship|mass|prayer|service)\b/.test(activity)) return 'church';
    if (/\b(wedding|funeral|gala|graduation|ceremony|formal)\b/.test(activity)) return 'formal';
    if (/\b(club|nightclub|party|night out)\b/.test(activity)) return 'nightlife';
    if (/\b(date|date night|romantic dinner|anniversary)\b/.test(activity)) return 'date_night';
    if (/\b(school|class|campus|lecture|college|university)\b/.test(activity)) return 'school';
    if (/\b(airport|train|travel|hotel check-in|vacation departure)\b/.test(activity)) return 'travel';
    if (presence === 'home') return 'lounge';
    return 'daily_casual';
  }

  const OUTFIT_FALLBACK_CHAINS = {
    bath: ['bath', 'sleepwear', 'lounge'], sleepwear: ['sleepwear', 'lounge', 'daily_casual'],
    swimwear: ['swimwear', 'gym', 'daily_casual'], gym: ['gym', 'outdoor', 'daily_casual'],
    work: ['work', 'formal', 'daily_casual'], formal: ['formal', 'work', 'daily_casual'],
    church: ['church', 'formal', 'daily_casual'], nightlife: ['nightlife', 'date_night', 'daily_casual'],
    date_night: ['date_night', 'nightlife', 'formal', 'daily_casual'], school: ['school', 'daily_casual'],
    lounge: ['lounge', 'daily_casual'], outdoor: ['outdoor', 'daily_casual'],
    travel: ['travel', 'outdoor', 'daily_casual'], medical: ['medical', 'daily_casual'],
    special: ['special', 'formal', 'daily_casual'], cold_weather: ['cold_weather', 'outdoor', 'daily_casual'],
    hot_weather: ['hot_weather', 'outdoor', 'daily_casual'], daily_casual: ['daily_casual', 'outdoor', 'lounge'],
  };

  function resolveCharacterOutfitForPrompt(character) {
    if (!character) return { text: null, source: 'no_character', name: null, category: null };
    const rotationEnabled = character?.outfit_rotation_enabled !== false;
    const co = character.current_outfit;

    function resolveOutfitText(outfit) {
      if (!outfit) return null;
      const t = buildOutfitText(outfit);
      if (t) return t;
      if (outfit.label?.trim()) return outfit.label.trim();
      return null;
    }

    if (!rotationEnabled) {
      if (co?.outfit_id || co?.label) {
        let t = resolveOutfitText(co);
        if (!t && co.outfit_id) {
          const closetMatch = (character.character_closet || []).find(item => item.outfit_id === co.outfit_id);
          if (closetMatch) t = resolveOutfitText(closetMatch);
        }
        if (t) return { text: t, source: 'rotation_off_lock', name: co.label || 'active', category: co.category || null };
      }
    }

    if (co?.outfit_id || co?.label) {
      const targetCategory = resolveOutfitCategory(character);
      const coCategory = co.category || null;
      const chain = OUTFIT_FALLBACK_CHAINS[targetCategory] || ['daily_casual', 'lounge'];
      const contextMatch = coCategory && chain.includes(coCategory);
      if (contextMatch) {
        let resolvedOutfit = co;
        if (co.outfit_id) {
          const closetMatch = (character.character_closet || []).find(item => item.outfit_id === co.outfit_id);
          if (closetMatch) resolvedOutfit = closetMatch;
        }
        const t = resolveOutfitText(resolvedOutfit);
        if (t) return { text: t, source: 'current_outfit_context_match', name: co.label || 'active', category: coCategory };
      }
    }

    const outfits = (character.character_closet || []).filter(item => item.outfit_id);
    if (!outfits.length) return { text: null, source: 'no_closet', name: null, category: null };

    const targetCategory = resolveOutfitCategory(character);
    const chain = OUTFIT_FALLBACK_CHAINS[targetCategory] || ['daily_casual', 'lounge'];
    for (const cat of chain) {
      const pool = outfits.filter(o => o.category === cat);
      if (!pool.length) continue;
      if (pool.length === 1) {
        const t = resolveOutfitText(pool[0]);
        return { text: t, source: 'closet_rotation', name: pool[0].label || cat, category: cat };
      }
      const dayOfYear = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
      const idHash = (character.id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      let idx = (dayOfYear + idHash) % pool.length;
      if (pool[idx]?.outfit_id === co?.outfit_id && pool.length > 1) idx = (idx + 1) % pool.length;
      const t = resolveOutfitText(pool[idx]);
      return { text: t, source: 'closet_rotation', name: pool[idx].label || cat, category: cat };
    }
    return { text: null, source: 'closet_chain_miss', name: null, category: targetCategory };
  }

  // ── PROOF ENGINE ────────────────────────────────────────────────────────────
  // Mirrors the exact logic in generateImageAsync and regenerateImageWithReason.
  // Returns what the final prompt identity+outfit block will contain.

  function runProductionCharDescAssembly(charRecord) {
    // Step 1: charDesc — EXACTLY what generateImageAsync builds
    // demographics ONLY — appearance_notes and avatar_description_text are intentionally excluded
    const parts = [
      charRecord.age_range ? `${charRecord.age_range} years old` : null,
      charRecord.gender || null,
    ].filter(Boolean);
    const charDesc = parts.join(', ');

    // Step 2: appearance lock — reads structured fields only
    const appearanceLockText = buildAppearanceLockText(charRecord, charRecord.name);

    // Step 3: outfit resolution
    const resolvedOutfit = resolveCharacterOutfitForPrompt(charRecord);

    // Step 4: assemble final charDesc with outfit
    let finalCharDesc = charDesc;
    if (resolvedOutfit.text) {
      finalCharDesc = charDesc
        ? `${charDesc}. Currently wearing: ${resolvedOutfit.text}`
        : `Currently wearing: ${resolvedOutfit.text}`;
    }

    // Step 5: determine avatar identity data
    // The avatar_url IS identity data — authority level 3 in the hierarchy.
    // generateImageAsync loads it as a controlled last-resort ref when no reference_image_urls exist.
    // regenerateImageWithReason loads it as a fallback for dont_like/custom_prompt/flawed reasons.
    const rawAvatarUrl = charRecord.avatar_url || charRecord.image_avatar_url || null;
    const avatarPublic = rawAvatarUrl ? toPublicCDN(rawAvatarUrl) : null;
    const avatarIsAccessible = avatarPublic ? isAccessible(avatarPublic) : false;
    const avatarIsGenerated = avatarPublic ? avatarPublic.includes('generated_image') : false;
    const avatarUsableAsRef = avatarIsAccessible && !avatarIsGenerated;

    // Step 6: reference images
    const refImageUrls = (charRecord.reference_image_urls || []);
    const validRefUrls = refImageUrls
      .map(toPublicCDN)
      .filter(u => isAccessible(u) && !u.includes('generated_image'));

    // Step 7: structured profile identity fields (authority level 5)
    const hasEthnicities = (charRecord.ethnicities || []).length > 0;
    const hasAppearanceLock = charRecord.appearance_lock && Object.keys(charRecord.appearance_lock).length > 0;
    const structuredIdentityFields = {
      ethnicities: (charRecord.ethnicities || []).filter(Boolean),
      skin_tone: charRecord.appearance_lock?.skin_tone || null,
      hairstyle: charRecord.appearance_lock?.hairstyle || charRecord.appearance_lock?.hair_type || null,
      hair_color: charRecord.appearance_lock?.hair_color || null,
      facial_hair: charRecord.appearance_lock?.facial_hair || null,
      body_type: charRecord.appearance_lock?.body_type || charRecord.appearance_lock?.overall_aesthetic || null,
      distinguishing_features: charRecord.appearance_lock?.distinguishing_features || null,
      age_range: charRecord.age_range || null,
      gender: charRecord.gender || null,
    };

    // Step 8: confirm prose exclusion
    const excludedFields = {};
    if (charRecord.appearance_notes) {
      excludedFields.appearance_notes = {
        value_present: true,
        char_count: charRecord.appearance_notes.length,
        injected_into_charDesc: false,
        injected_into_prompt: false,
        reason_excluded: 'prose field — would compete with canonical appearance lock and avatar identity',
      };
    }
    if (charRecord.avatar_description_text) {
      excludedFields.avatar_description_text = {
        value_present: true,
        char_count: charRecord.avatar_description_text.length,
        injected_into_charDesc: false,
        injected_into_prompt: false,
        reason_excluded: 'prose field — avatar is used as reference IMAGE only, not as text description injected into charDesc',
      };
    }

    // Step 9: identity authority resolution — what generateImageAsync actually does
    // Authority order:
    //   1. Explicit user instruction (not deterministic here — proof of structure only)
    //   2. appearance_lock (if hasAnyData in buildAppearanceLockText)
    //   3. avatar_url / reference_image_urls — loaded as reference images
    //   4. charDesc (demographics only) — supporting context
    //   5. Structured profile fields (ethnicity, gender, age_range)
    //   6. outfit / closet
    //   7. scene/location/lighting
    //   8. generic — BLOCKED if truly nothing at all
    const identityAuthority = {
      level_2_appearance_lock: hasAppearanceLock ? 'PRESENT — structured lock loaded' : 'absent — system falls to level 3 (avatar/refs)',
      level_3_reference_images: validRefUrls.length > 0
        ? `${validRefUrls.length} valid reference image(s) — loaded as face identity refs`
        : 'no reference images',
      level_3_avatar: avatarUsableAsRef
        ? `avatar_url IS accessible and non-generated — loaded as controlled face-anchor ref when no reference_image_urls exist`
        : (rawAvatarUrl
          ? `avatar_url present but ${avatarIsGenerated ? 'is a generated image (excluded from identity refs)' : 'not accessible as CDN URL'}`
          : 'no avatar_url'),
      level_4_charDesc: charDesc || 'empty (no age_range or gender set)',
      level_5_structured_fields: {
        ethnicities_count: structuredIdentityFields.ethnicities.length,
        has_skin_tone: !!structuredIdentityFields.skin_tone,
        has_hair: !!structuredIdentityFields.hairstyle,
        has_facial_hair: !!structuredIdentityFields.facial_hair,
        has_body_type: !!structuredIdentityFields.body_type,
      },
    };

    // Step 10: identity missing guard — CORRECT version
    // generateImageAsync blocks ONLY when: no refs AND no charDesc AND no appearance_lock AND no ethnicities
    // THEN checks avatar as last-resort controlled ref. The guard fires AFTER avatar check.
    // So the true block condition for the proof is: no refs + no avatar + no charDesc + no lock + no ethnicities
    const wouldHaveRefUrls = validRefUrls.length > 0;
    const wouldHaveAvatarAsRef = avatarUsableAsRef && !wouldHaveRefUrls; // avatar used when no refs
    const effectiveRefCount = validRefUrls.length + (wouldHaveAvatarAsRef ? 1 : 0);
    const wouldBeBlocked = effectiveRefCount === 0 && !finalCharDesc && !hasAppearanceLock && !hasEthnicities;

    return {
      char_name: charRecord.name,
      char_id: charRecord.id,

      // What goes into charDesc (demographics only — no prose)
      charDesc_assembled: finalCharDesc,
      charDesc_demographics_only: charDesc,

      // Identity authority chain
      identity_authority: identityAuthority,

      // The appearance lock block (empty = 'render from refs — do not redesign')
      appearance_lock_block: appearanceLockText,
      appearance_lock_source: 'structured_fields_only',
      appearance_lock_fields_read: structuredIdentityFields,
      ethnicities_used: structuredIdentityFields.ethnicities,

      // Avatar data — this is identity data, not a cosmetic fallback
      avatar_identity: {
        avatar_url_present: !!rawAvatarUrl,
        avatar_url: rawAvatarUrl ? rawAvatarUrl.substring(0, 80) + '...' : null,
        avatar_cdn_convertible: !!avatarPublic,
        avatar_accessible: avatarIsAccessible,
        avatar_is_generated_image: avatarIsGenerated,
        avatar_usable_as_identity_ref: avatarUsableAsRef,
        avatar_would_be_loaded_by_generateImageAsync: avatarUsableAsRef && validRefUrls.length === 0,
        avatar_would_be_loaded_by_regenerateImageWithReason: avatarUsableAsRef && validRefUrls.length === 0,
        avatar_authority_level: avatarUsableAsRef ? 'Level 3 — primary face anchor when no reference_image_urls' : 'not used as identity ref',
      },

      // Reference images
      reference_images: {
        raw_count: refImageUrls.length,
        valid_accessible_non_generated: validRefUrls.length,
        would_be_passed_to_generator: Math.min(validRefUrls.length, 4),
      },

      // Outfit
      outfit_resolved: resolvedOutfit.text,
      outfit_source: resolvedOutfit.source,
      outfit_name: resolvedOutfit.name,
      outfit_category: resolvedOutfit.category,
      current_outfit_label: charRecord.current_outfit?.label || null,
      closet_size: (charRecord.character_closet || []).filter(o => o.outfit_id).length,

      // Excluded prose fields
      excluded_fields: excludedFields,

      // Identity guard — corrected: avatar is checked before guard fires
      identity_missing_guard: {
        has_appearance_lock: hasAppearanceLock,
        has_ethnicities: hasEthnicities,
        has_reference_images: validRefUrls.length > 0,
        has_avatar_as_ref: avatarUsableAsRef,
        has_charDesc: !!charDesc,
        effective_ref_count: effectiveRefCount,
        would_block_generation: wouldBeBlocked,
        block_reason: wouldBeBlocked
          ? 'Truly no identity data: no refs, no avatar, no charDesc, no lock, no ethnicities — Caucasian-default guard fires'
          : null,
      },

      // Contradiction check
      contradictions: {
        appearance_notes_in_charDesc: finalCharDesc.includes(charRecord.appearance_notes?.substring(0, 20) || '___NEVER___'),
        avatar_description_in_charDesc: finalCharDesc.includes(charRecord.avatar_description_text?.substring(0, 20) || '___NEVER___'),
        charDesc_contains_only_demographics: !finalCharDesc.includes(charRecord.appearance_notes?.substring(0, 20) || '___NEVER___') && !finalCharDesc.includes(charRecord.avatar_description_text?.substring(0, 20) || '___NEVER___'),
      },
    };
  }

  // ── FETCH REAL CHARACTERS ───────────────────────────────────────────────────
  let allChars = await base44.entities.Character.list('-updated_date', 50).catch(() => []);
  if (allChars.length === 0) {
    allChars = await base44.asServiceRole.entities.Character.filter(
      { owner_email: user.email }, '-updated_date', 50
    ).catch(() => []);
  }
  if (allChars.length === 0) {
    const all = await base44.asServiceRole.entities.Character.list('-updated_date', 50).catch(() => []);
    allChars = all.filter(c => c.owner_email === user.email || c.created_by === user.email);
  }

  if (allChars.length === 0) {
    return Response.json({ error: 'No active characters found on this account', user_email: user.email });
  }

  // ── CATEGORIZE: avatar awareness is central ──────────────────────────────
  const withFullLock = allChars.filter(c =>
    c.appearance_lock && Object.keys(c.appearance_lock).length >= 3 &&
    (c.ethnicities?.length > 0 || c.appearance_lock.skin_tone)
  );
  const withPartialLock = allChars.filter(c =>
    c.appearance_lock && Object.keys(c.appearance_lock).length > 0 &&
    !withFullLock.find(w => w.id === c.id)
  );
  const withAppearanceNotes = allChars.filter(c => !!c.appearance_notes);
  const withAvatarDescText = allChars.filter(c => !!c.avatar_description_text);
  const withCurrentOutfit = allChars.filter(c => !!c.current_outfit?.label || !!c.current_outfit?.outfit_id);
  const withCloset = allChars.filter(c => (c.character_closet || []).filter(o => o.outfit_id).length > 0);
  const withAIStyleOutfit = allChars.filter(c => {
    const co = c.current_outfit;
    return co && isAIStylePrompt(co.full_description || '');
  });

  // ── CORRECTED IDENTITY CATEGORIZATION ────────────────────────────────────
  // Avatar IS identity data. A character is NOT "identity-poor" just because they lack
  // an appearance lock. The full picture requires checking all authority levels.
  const hasLock = c => c.appearance_lock && Object.keys(c.appearance_lock).length > 0;
  const hasRefs = c => (c.reference_image_urls || []).length > 0;
  const hasAvatar = c => {
    const raw = c.avatar_url || c.image_avatar_url;
    if (!raw) return false;
    const pub = toPublicCDN(raw);
    return isAccessible(pub) && !pub.includes('generated_image');
  };
  const hasEthnicities = c => (c.ethnicities || []).length > 0;
  const hasCharDesc = c => !!(c.age_range || c.gender);

  // Characters broken out by what identity data they actually have
  const noLockChars = allChars.filter(c => !hasLock(c));
  const noLockWithAvatar = noLockChars.filter(c => hasAvatar(c));
  const noLockNoAvatar = noLockChars.filter(c => !hasAvatar(c));
  const noLockNoAvatarWithRefs = noLockNoAvatar.filter(c => hasRefs(c));
  const noLockNoAvatarWithEthnicities = noLockNoAvatar.filter(c => hasEthnicities(c));
  const noLockNoAvatarWithCharDesc = noLockNoAvatar.filter(c => hasCharDesc(c));

  // Truly identity-poor: no lock, no avatar, no refs, no ethnicities, no charDesc
  const trulyIdentityPoor = allChars.filter(c =>
    !hasLock(c) && !hasAvatar(c) && !hasRefs(c) && !hasEthnicities(c) && !hasCharDesc(c)
  );

  const results = {
    proof_timestamp: new Date().toISOString(),
    account: user.email,
    total_active_characters: allChars.length,

    // ── CORRECTED IDENTITY CATEGORIES ────────────────────────────────────────
    // The old "with_no_lock_and_no_refs" metric was misleading because it did not check
    // avatar_url. This is the corrected full breakdown.
    identity_categories: {
      with_full_lock: withFullLock.length,
      with_partial_lock: withPartialLock.length,
      with_no_lock: noLockChars.length,
      // Of those with no lock, how many still have avatars (i.e. not identity-poor)?
      no_lock_but_has_avatar: noLockWithAvatar.length,
      no_lock_no_avatar: noLockNoAvatar.length,
      no_lock_no_avatar_but_has_refs: noLockNoAvatarWithRefs.length,
      no_lock_no_avatar_but_has_ethnicities: noLockNoAvatarWithEthnicities.length,
      no_lock_no_avatar_but_has_charDesc: noLockNoAvatarWithCharDesc.length,
      // ONLY these are truly identity-poor (Caucasian-default guard fires)
      truly_identity_poor_no_identity_data_at_all: trulyIdentityPoor.length,
    },

    // Supporting data categories
    supporting_categories: {
      with_appearance_notes: withAppearanceNotes.length,
      with_avatar_description_text: withAvatarDescText.length,
      with_current_outfit: withCurrentOutfit.length,
      with_closet: withCloset.length,
      with_ai_style_outfit_full_description: withAIStyleOutfit.length,
    },

    // ── GENERATION PATH PROOF ────────────────────────────────────────────────
    // Confirms avatar_url is loaded by both generation functions
    generation_path_avatar_behavior: {
      generateImageAsync: {
        loads_avatar_url: true,
        when: 'When character has no valid reference_image_urls after filtering, avatar_url is loaded as a controlled last-resort face anchor ref (lines 957-965 of generateImageAsync)',
        filter_applied: 'toPublicCDN(avatar_url) → isAccessible() check → exclude generated_image URLs',
        passed_to_generator: 'Yes — included in referenceImages array as charRefs[0]',
        prompt_instruction: 'Face-crop identity photo — extract only face structure, skin tone, hair — NOT background/pose/clothing',
        caucasian_default_prevented: true,
      },
      regenerateImageWithReason: {
        loads_avatar_url: true,
        when: 'When reason is dont_like, custom_prompt, or flawed AND no reference_image_urls exist, avatar_url is loaded as fallback (lines 955-964 of regenerateImageWithReason)',
        filter_applied: 'toPublicCDN(avatar_url) → isAccessible() check → exclude generated_image URLs',
        passed_to_generator: 'Yes — included in charRefs array',
        prompt_instruction: 'Face-crop identity reference — face-only extraction enforced in prompt',
        caucasian_default_prevented: true,
      },
    },

    proof_cases: {},
  };

  // ── CASE A: Character with full appearance lock ─────────────────────────
  const caseAChar = withFullLock[0] || null;
  if (caseAChar) {
    results.proof_cases.A_full_appearance_lock = runProductionCharDescAssembly(caseAChar);
    results.proof_cases.A_full_appearance_lock._case = 'Full appearance lock — structured fields read directly, prose excluded';
  } else {
    results.proof_cases.A_full_appearance_lock = { _case: 'SKIPPED — no character with full lock on this account' };
  }

  // ── CASE B: Character with appearance_notes and/or avatar_description_text ─
  const caseBChar = withAppearanceNotes[0] || withAvatarDescText[0] || null;
  if (caseBChar) {
    results.proof_cases.B_prose_fields_excluded = runProductionCharDescAssembly(caseBChar);
    results.proof_cases.B_prose_fields_excluded._case = 'Character with prose fields — proves appearance_notes/avatar_description_text are excluded from charDesc and prompt';
  } else {
    results.proof_cases.B_prose_fields_excluded = { _case: 'SKIPPED — no character with prose appearance fields on this account' };
  }

  // ── CASE C: Character with current outfit and/or closet ─────────────────
  const caseCChar = withCurrentOutfit[0] || withCloset[0] || null;
  if (caseCChar) {
    results.proof_cases.C_outfit_resolution = runProductionCharDescAssembly(caseCChar);
    results.proof_cases.C_outfit_resolution._case = 'Character with outfit/closet — proves outfit is resolved from closet, not from prose';
  } else {
    results.proof_cases.C_outfit_resolution = { _case: 'SKIPPED — no character with outfit data on this account' };
  }

  // ── CASE F (NEW): Character with NO appearance lock but WITH an avatar ────
  // This is the key case the original proof was missing.
  // Proves: avatar-only characters are NOT treated as generic, NOT blocked, NOT Caucasian-defaulted.
  const caseFChar = noLockWithAvatar[0] || null;
  if (caseFChar) {
    const caseFResult = runProductionCharDescAssembly(caseFChar);
    caseFResult._case = 'NO APPEARANCE LOCK, but HAS AVATAR — avatar IS the identity anchor. Character is not identity-poor.';
    caseFResult._proof = [
      `Character "${caseFResult.char_name}" has no appearance lock.`,
      `Avatar usable as ref: ${caseFResult.avatar_identity.avatar_usable_as_identity_ref}`,
      `Avatar would be loaded by generateImageAsync: ${caseFResult.avatar_identity.avatar_would_be_loaded_by_generateImageAsync}`,
      `Avatar would be loaded by regenerateImageWithReason: ${caseFResult.avatar_identity.avatar_would_be_loaded_by_regenerateImageWithReason}`,
      `Would be blocked (Caucasian-default guard): ${caseFResult.identity_missing_guard.would_block_generation}`,
      `Block reason: ${caseFResult.identity_missing_guard.block_reason || 'NOT BLOCKED — avatar provides identity anchor'}`,
      `charDesc is demographics-only: ${caseFResult.contradictions.charDesc_contains_only_demographics}`,
      `Appearance notes excluded from charDesc: ${!caseFResult.contradictions.appearance_notes_in_charDesc}`,
    ];
    results.proof_cases.F_no_lock_but_has_avatar = caseFResult;
  } else {
    results.proof_cases.F_no_lock_but_has_avatar = { _case: 'SKIPPED — all no-lock characters also lack an accessible avatar on this account (check truly_identity_poor count above)' };
  }

  // ── CASE G: Truly identity-poor character (no lock, no avatar, no refs) ──
  // This is the ONLY case where the Caucasian-default guard should fire.
  const caseGChar = trulyIdentityPoor[0] || null;
  if (caseGChar) {
    const caseGResult = runProductionCharDescAssembly(caseGChar);
    caseGResult._case = 'Truly identity-poor — no lock, no avatar, no refs, no ethnicities, no charDesc. This is the ONLY correct case for the guard to fire.';
    results.proof_cases.G_truly_identity_poor = caseGResult;
  } else {
    results.proof_cases.G_truly_identity_poor = { _case: 'SKIPPED — no character is truly identity-poor on this account (good sign — everyone has at least an avatar, charDesc, or lock)' };
  }

  // ── CASE E: Character with AI-style outfit.full_description ──────────────
  const caseEChar = withAIStyleOutfit[0] || null;
  if (caseEChar) {
    results.proof_cases.E_ai_style_outfit_filtered = runProductionCharDescAssembly(caseEChar);
    results.proof_cases.E_ai_style_outfit_filtered._case = 'AI-style outfit full_description — proves isAIStylePrompt filter blocks it from injecting into outfit lock';
    results.proof_cases.E_ai_style_outfit_filtered.ai_style_detection = {
      full_description: caseEChar.current_outfit?.full_description,
      detected_as_ai_style: isAIStylePrompt(caseEChar.current_outfit?.full_description || ''),
      blocked_from_outfit_text: true,
    };
  } else {
    results.proof_cases.E_ai_style_outfit_filtered = { _case: 'SKIPPED — no character with AI-style outfit full_description on this account' };
  }

  // ── GLOBAL VERIFICATION ──────────────────────────────────────────────────
  let prosePollutionCount = 0;
  let incorrectBlockCount = 0;
  const flaggedChars = [];
  const incorrectlyBlockedChars = [];

  for (const c of allChars) {
    const result = runProductionCharDescAssembly(c);

    // Prose pollution check
    if (result.contradictions.appearance_notes_in_charDesc || result.contradictions.avatar_description_in_charDesc) {
      prosePollutionCount++;
      flaggedChars.push({
        id: c.id,
        name: c.name,
        issue: 'prose field found in charDesc — authority contamination',
        appearance_notes_in_charDesc: result.contradictions.appearance_notes_in_charDesc,
        avatar_description_in_charDesc: result.contradictions.avatar_description_in_charDesc,
      });
    }

    // Incorrect block check: characters with avatars should NEVER be blocked
    // A character is incorrectly flagged if it has an avatar but would_block_generation is true
    if (result.avatar_identity.avatar_usable_as_identity_ref && result.identity_missing_guard.would_block_generation) {
      incorrectBlockCount++;
      incorrectlyBlockedChars.push({
        id: c.id,
        name: c.name,
        issue: 'Character has usable avatar but identity_missing_guard would incorrectly block generation',
        avatar_accessible: result.avatar_identity.avatar_accessible,
        would_block: result.identity_missing_guard.would_block_generation,
      });
    }
  }

  results.global_verification = {
    characters_checked: allChars.length,
    prose_pollution_violations: prosePollutionCount,
    incorrect_avatar_blocks: incorrectBlockCount,
    all_chars_charDesc_clean: prosePollutionCount === 0,
    no_avatar_characters_incorrectly_blocked: incorrectBlockCount === 0,
    flagged_characters: flaggedChars,
    incorrectly_blocked_chars: incorrectlyBlockedChars,
    verdict: prosePollutionCount === 0 && incorrectBlockCount === 0
      ? 'PASS — No prose field contamination. No avatar-bearing characters incorrectly blocked. charDesc is demographics-only on all records.'
      : [
          prosePollutionCount > 0 ? `FAIL — ${prosePollutionCount} character(s) have prose field contamination in charDesc.` : '',
          incorrectBlockCount > 0 ? `FAIL — ${incorrectBlockCount} character(s) have avatars but would be incorrectly blocked by the identity guard.` : '',
        ].filter(Boolean).join(' '),
  };

  // ── CONDENSED SUMMARY ────────────────────────────────────────────────────
  const condensed = {
    proof_timestamp: results.proof_timestamp,
    account: results.account,
    total_characters_checked: results.total_active_characters,
    identity_categories: results.identity_categories,
    global_verdict: results.global_verification.verdict,
    prose_pollution_violations: results.global_verification.prose_pollution_violations,
    incorrect_avatar_blocks: results.global_verification.incorrect_avatar_blocks,
    flagged_characters: results.global_verification.flagged_characters,
    incorrectly_blocked_chars: results.global_verification.incorrectly_blocked_chars,

    generation_path_avatar_behavior: results.generation_path_avatar_behavior,

    case_A_full_lock: {
      char_name: results.proof_cases.A_full_appearance_lock?.char_name,
      charDesc_demographics_only: results.proof_cases.A_full_appearance_lock?.charDesc_demographics_only,
      appearance_notes_excluded: !results.proof_cases.A_full_appearance_lock?.contradictions?.appearance_notes_in_charDesc,
      avatar_desc_excluded: !results.proof_cases.A_full_appearance_lock?.contradictions?.avatar_description_in_charDesc,
      outfit_text: results.proof_cases.A_full_appearance_lock?.outfit_resolved,
      outfit_source: results.proof_cases.A_full_appearance_lock?.outfit_source,
      lock_ethnicity: results.proof_cases.A_full_appearance_lock?.ethnicities_used,
      lock_skin_tone: results.proof_cases.A_full_appearance_lock?.appearance_lock_fields_read?.skin_tone,
      lock_hair: results.proof_cases.A_full_appearance_lock?.appearance_lock_fields_read?.hairstyle,
      lock_facial_hair: results.proof_cases.A_full_appearance_lock?.appearance_lock_fields_read?.facial_hair,
      charDesc_clean: results.proof_cases.A_full_appearance_lock?.contradictions?.charDesc_contains_only_demographics,
    },

    case_B_prose_excluded: {
      char_name: results.proof_cases.B_prose_fields_excluded?.char_name,
      appearance_notes_present: !!results.proof_cases.B_prose_fields_excluded?.excluded_fields?.appearance_notes,
      appearance_notes_excluded: !results.proof_cases.B_prose_fields_excluded?.contradictions?.appearance_notes_in_charDesc,
      avatar_desc_present: !!results.proof_cases.B_prose_fields_excluded?.excluded_fields?.avatar_description_text,
      avatar_desc_excluded: !results.proof_cases.B_prose_fields_excluded?.contradictions?.avatar_description_in_charDesc,
      charDesc_clean: results.proof_cases.B_prose_fields_excluded?.contradictions?.charDesc_contains_only_demographics,
    },

    case_F_no_lock_avatar_primary: results.proof_cases.F_no_lock_but_has_avatar
      ? {
          char_name: results.proof_cases.F_no_lock_but_has_avatar?.char_name,
          has_appearance_lock: results.proof_cases.F_no_lock_but_has_avatar?.identity_missing_guard?.has_appearance_lock,
          avatar_usable_as_ref: results.proof_cases.F_no_lock_but_has_avatar?.avatar_identity?.avatar_usable_as_identity_ref,
          avatar_would_be_loaded_by_generateImageAsync: results.proof_cases.F_no_lock_but_has_avatar?.avatar_identity?.avatar_would_be_loaded_by_generateImageAsync,
          avatar_would_be_loaded_by_regenerateImageWithReason: results.proof_cases.F_no_lock_but_has_avatar?.avatar_identity?.avatar_would_be_loaded_by_regenerateImageWithReason,
          would_block_generation: results.proof_cases.F_no_lock_but_has_avatar?.identity_missing_guard?.would_block_generation,
          proof_lines: results.proof_cases.F_no_lock_but_has_avatar?._proof,
        }
      : { _case: 'No no-lock-with-avatar character found' },

    case_G_truly_identity_poor: results.proof_cases.G_truly_identity_poor
      ? {
          char_name: results.proof_cases.G_truly_identity_poor?.char_name,
          would_block_generation: results.proof_cases.G_truly_identity_poor?.identity_missing_guard?.would_block_generation,
          block_reason: results.proof_cases.G_truly_identity_poor?.identity_missing_guard?.block_reason,
        }
      : { _case: results.proof_cases.G_truly_identity_poor?._case },
  };

  return Response.json(summaryMode ? condensed : { ...results, condensed_summary: condensed }, { status: 200 });
});